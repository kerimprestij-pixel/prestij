// REQUESTS against the local PostgreSQL: the public quote and sample forms (validation, honeypot,
// durable rate limits, site-wide cap, ids re-read from the database, account linking), the e-mails they
// queue (customer + admin, localized, deduped), the panel workflows (offer with server-side total,
// revised offers, status rules, sample approve / ship / reject), the contact form's admin e-mail and
// the content script's request-form step.
//
// Every test runs inside a transaction that is rolled back at the end (settings such as the admin
// recipients are changed only inside it), so no row survives; the durable rate-limit counters of the
// test IPs and addresses are forgotten and the id sequences put back afterwards.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/requests.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { submitContactForm } from "@/lib/contact/service";
import { contactLimitKeys } from "@/lib/contact/throttle";
import type { Tx } from "@/lib/panel/tx";
import { isPanelError } from "@/lib/panel/errors";
import { checkLimits, forgetLimits } from "@/lib/rate-limit-store";
import { quoteOfferSchema, runSendQuoteOffer, sampleStatusSchema } from "@/lib/requests/definitions";
import { getQuoteRequest, getSampleRequest, listQuoteRequests, listSampleRequests } from "@/lib/requests/queries";
import { parseQuantity, parseQuoteForm, readQuoteForm } from "@/lib/requests/schema";
import { requestPrefillFor, submitQuoteRequest, submitSampleRequest } from "@/lib/requests/service";
import { REQUEST_RULES, requestLimitKeys } from "@/lib/requests/throttle";
import { parseRequestRef, quoteRef, sampleRef } from "@/lib/requests/types";
import { istanbulToday, normalizeTrackingNumber, saveQuoteNote, sendQuoteOffer, setQuoteStatus, setSampleStatus, shipSample } from "@/lib/requests/workflow";
import type { StaffSession } from "@/lib/session";
import { requestForms } from "../../scripts/content-day4";

const PREFIX = "requests-test-";
const email = (n: number | string) => `${PREFIX}${n}@test.local`;
const ADMIN = email("admin");
const ACTOR_ID = "requests-test-actor";
const ACTOR = {
  user: { id: ACTOR_ID, name: "Requests Test", email: email("actor"), role: "staff", banned: false },
  session: { id: "requests-test-session" },
  staffRole: "staff",
} as unknown as StaffSession;

const IP = (n: number) => `198.51.100.${150 + n}`;

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back. */
async function inTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** Admin recipients for this transaction only (merged into the stored e-mail settings). */
async function withAdminRecipients(tx: Tx, recipients: string[]) {
  const [row] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "emails")).limit(1);
  const value = { ...((row?.value as Record<string, unknown>) ?? {}), adminRecipients: recipients, templates: {} };
  await tx.insert(schema.settings).values({ key: "emails", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

async function setSampleForm(tx: Tx, enabled: boolean) {
  const [row] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "samples")).limit(1);
  const value = { ...((row?.value as Record<string, unknown>) ?? {}), requestFormEnabled: enabled };
  await tx.insert(schema.settings).values({ key: "samples", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

const mails = (tx: Tx, type: "quote" | "sample" | "contact", id: number) =>
  tx
    .select()
    .from(schema.emailMessages)
    .where(and(eq(schema.emailMessages.relatedType, type), eq(schema.emailMessages.relatedId, String(id))))
    .orderBy(schema.emailMessages.id);

// Catalog ids looked up by SKU / slug (never hard-coded).
let V: { lvl5: number; lvl500: number; oky500: number; set: number };
let P: { lavantaLatte: number; portakal: number; bundle: number; sample: number };

const quoteForm = (overrides: Record<string, string> = {}) => ({
  companyName: "Requests Test Otelcilik",
  contactName: "Ayşe Deneme",
  email: email("quote"),
  phone: "0532 000 00 00",
  sector: "hotel",
  lines: JSON.stringify([
    { variantId: V.lvl5, label: "", quantity: "12" },
    { variantId: V.oky500, label: "", quantity: "1.000" },
    { variantId: null, label: "Dispenser için dolum hortumu", quantity: "4" },
    { variantId: V.lvl5, label: "", quantity: "3" },
    { variantId: null, label: "", quantity: "" },
  ]),
  message: "Üç otelimiz için düzenli tedarik düşünüyoruz.",
  consent: "on",
  locale: "en",
  website: "",
  ...overrides,
});

const sampleForm = (overrides: Record<string, string | string[]> = {}) => ({
  companyName: "Requests Test Spa",
  contactName: "Mehmet Deneme",
  email: email("sample"),
  phone: "+90 532 000 00 01",
  sector: "spa",
  city: "kayseri",
  district: "Melikgazi",
  line1: "Alpaslan Mah. Deneme Sok. No:1",
  productIds: [String(P.lavantaLatte), String(P.portakal)],
  estimatedMonthlyLiters: "120",
  message: "",
  consent: "on",
  locale: "ar",
  website: "",
  ...overrides,
});

// ---------------------------------------------------------------------------------------------
// Bookkeeping: counts, sequences, rate-limit counters

const TABLES = ["quote_requests", "sample_requests", "email_messages", "contact_messages", "audit_log", "page_sections", "menus"] as const;
let counts: Record<string, number>;
type SeqState = { table: string; name: string; lastValue: string; isCalled: boolean };
let sequences: SeqState[] = [];

async function countRows() {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = await db.execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${t}`));
    out[t] = Number(rows[0].n);
  }
  return out;
}

async function readSequences(): Promise<SeqState[]> {
  const out: SeqState[] = [];
  for (const table of ["quote_requests", "sample_requests", "email_messages", "contact_messages", "page_sections", "companies", "audit_log", "tier_prices"]) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    out.push({ table, name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
  return out;
}

/** Puts the id sequences back unless someone else inserted rows meanwhile (other agents share the DB). */
async function restoreSequences() {
  for (const s of sequences) {
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${s.table}`));
    if (max === null || Number(max) <= Number(s.lastValue)) {
      await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
  }
}

const TEST_EMAILS = ["quote", "sample", "contact", "limit", "daily", "linked", "tiers", ...Array.from({ length: 25 }, (_, i) => `d${i}`)].map(email);
async function forgetRequestLimits() {
  const keys: string[] = [];
  for (let n = 0; n <= 40; n++) {
    for (const kind of ["quote", "sample"] as const) keys.push(...requestLimitKeys(kind, { ip: IP(n), email: null }).map(([k]) => k));
    keys.push(...contactLimitKeys({ ip: IP(n), email: null }).map(([k]) => k));
  }
  for (const address of TEST_EMAILS) {
    for (const kind of ["quote", "sample"] as const) keys.push(...requestLimitKeys(kind, { ip: IP(0), email: address }).slice(1).map(([k]) => k));
    keys.push(...contactLimitKeys({ ip: IP(0), email: address }).slice(1).map(([k]) => k));
  }
  await forgetLimits(keys);
}

before(async () => {
  const variants = await db
    .select({ id: schema.productVariants.id, sku: schema.productVariants.sku })
    .from(schema.productVariants)
    .where(inArray(schema.productVariants.sku, ["PR-LVL-5L", "PR-LVL-500", "PR-OKY-500", "PR-SET-4X5L"]));
  const bySku = Object.fromEntries(variants.map((v) => [v.sku, v.id]));
  V = { lvl5: bySku["PR-LVL-5L"], lvl500: bySku["PR-LVL-500"], oky500: bySku["PR-OKY-500"], set: bySku["PR-SET-4X5L"] };
  const products = await db
    .select({ id: schema.products.id, slug: schema.products.slug })
    .from(schema.products)
    .where(inArray(schema.products.slug, ["lavanta-latte", "portakal", "dort-koku-koleksiyonu", "lavanta-latte-numune"]));
  const bySlug = Object.fromEntries(products.map((p) => [p.slug, p.id]));
  P = { lavantaLatte: bySlug["lavanta-latte"], portakal: bySlug.portakal, bundle: bySlug["dort-koku-koleksiyonu"], sample: bySlug["lavanta-latte-numune"] };
  for (const value of [...Object.values(V), ...Object.values(P)]) assert.ok(Number.isInteger(value), "seeded catalog is present");
  counts = await countRows();
  sequences = await readSequences();
});

beforeEach(() => forgetRequestLimits());

after(async () => {
  try {
    await forgetRequestLimits();
    await restoreSequences();
    assert.deepEqual(await countRows(), counts, "row counts are back to the start");
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------

describe("pure helpers", () => {
  test("references and quantities", () => {
    assert.equal(quoteRef(12), "TKL-00012");
    assert.equal(sampleRef(7), "NMN-00007");
    assert.equal(parseRequestRef("tkl-00012", "TKL"), 12);
    assert.equal(parseRequestRef("#12", "NMN"), 12);
    assert.equal(parseRequestRef("NMN12", "TKL"), null);
    assert.equal(parseQuantity("1.000"), 1000);
    assert.equal(parseQuantity("12"), 12);
    assert.equal(parseQuantity("1,5"), null);
    assert.equal(normalizeTrackingNumber(" yk 123 456 "), "YK123456");
    assert.equal(normalizeTrackingNumber("ab"), null);
  });

  test("quote form validation: codes per field and per row, blank rows ignored, duplicates merged", () => {
    const bad = parseQuoteForm(
      readQuoteForm({
        ...quoteForm(),
        email: "nope",
        consent: "",
        sector: "",
        lines: JSON.stringify([
          { variantId: 1, quantity: "0" },
          { variantId: null, label: "x", quantity: "2" },
          { variantId: null, label: "", quantity: "" },
        ]),
      }),
    );
    assert.equal(bad.success, false);
    if (bad.success) return;
    assert.deepEqual(bad.fieldErrors, {
      email: "invalid_email",
      sector: "required",
      "lines.0.quantity": "invalid_quantity",
      "lines.1.label": "too_short",
      consent: "consent",
    });
    const empty = parseQuoteForm(readQuoteForm({ ...quoteForm(), lines: "[]" }));
    assert.ok(!empty.success && empty.fieldErrors.lines === "no_lines");
    const good = parseQuoteForm(readQuoteForm(quoteForm()));
    assert.ok(good.success);
    if (!good.success) return;
    assert.equal(good.data.lines.length, 3, "blank row dropped, duplicate variant merged");
    assert.equal(good.data.lines.find((l) => l.variantId === V.lvl5)?.quantity, 15);
    assert.equal(good.data.lines.find((l) => l.variantId === V.oky500)?.quantity, 1000);
    assert.equal(good.data.phone, "+905320000000");
    assert.equal(good.data.locale, "en");
  });
});

describe("quote requests", () => {
  test("a valid request is stored with Turkish labels and queues the customer (en) and admin mails", async () => {
    await inTx(async (tx) => {
      await withAdminRecipients(tx, [ADMIN]);
      const { state, id } = await submitQuoteRequest(quoteForm(), { ip: IP(1), executor: tx });
      assert.equal(state.status, "success", JSON.stringify(state));
      assert.ok(id);
      assert.equal(state.reference, quoteRef(id!));
      const [row] = await tx.select().from(schema.quoteRequests).where(eq(schema.quoteRequests.id, id!));
      assert.equal(row.status, "new");
      assert.equal(row.locale, "en");
      assert.equal(row.email, email("quote"));
      assert.equal(row.sector, "hotel");
      assert.ok(row.consentAt instanceof Date);
      assert.equal(row.userId, null);
      assert.deepEqual(
        row.items.map((i) => [i.variantId ?? null, i.label, i.quantity]),
        [
          [V.lvl5, "Lavanta Latte · 5 L Bidon", 15],
          [V.oky500, "Okyanus · Pompalı Şişe 500 ml", 1000],
          [null, "Dispenser için dolum hortumu", 4],
        ],
      );

      const sent = await mails(tx, "quote", id!);
      assert.deepEqual(
        sent.map((m) => [m.template, m.toEmail, m.locale, m.status, m.dedupeKey]),
        [
          ["quote_received", email("quote"), "en", "queued", `quote:${id}:received:customer`],
          ["quote_received_admin", ADMIN, "tr", "queued", `quote:${id}:received:admin:${ADMIN}`],
        ],
      );
      const customer = sent[0];
      assert.match(customer.subject, new RegExp(quoteRef(id!)));
      assert.match(customer.html, /5 L Canister/, "product lines are localized for the reader");
      assert.match(customer.html, /Dispenser için dolum hortumu/);
      assert.match(sent[1].subject, /Yeni teklif talebi: Requests Test Otelcilik/);
      assert.match(sent[1].html, new RegExp(`/panel/teklifler/${id}`));

      // The panel list and detail read it back.
      const list = await listQuoteRequests({ q: quoteRef(id!) }, tx);
      assert.equal(list.rows[0]?.id, id);
      assert.equal(list.rows[0].totalQuantity, 1019);
      const detail = await getQuoteRequest(id!, tx);
      assert.ok(detail);
      assert.equal(detail.lines[0].listPrice, (await tx.select({ price: schema.productVariants.price }).from(schema.productVariants).where(eq(schema.productVariants.id, V.lvl5)))[0].price);
      assert.ok(detail.lines[0].groupPrice !== null && detail.lines[0].groupPrice <= detail.lines[0].listPrice!, "the reference group's price is shown");
      assert.equal(detail.lines[2].listPrice, null);
      assert.equal(detail.emails.length, 2);
    });
  });

  test("the offer editor's group price follows the cart engine: an explicit group price takes no volume tier", async () => {
    await inTx(async (tx) => {
      const [b2b] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "b2b"));
      const slug = (b2b?.value as { defaultGroupSlug?: string } | undefined)?.defaultGroupSlug;
      const [group] = slug ? await tx.select({ id: schema.customerGroups.id }).from(schema.customerGroups).where(eq(schema.customerGroups.slug, slug)) : [];
      assert.ok(group, "a default business group exists");
      // Explicit group price 100,00 ₺ for Okyanus 500 ml, plus a retail 10 % tier from 10 units.
      await tx.delete(schema.groupPrices).where(and(eq(schema.groupPrices.groupId, group.id), eq(schema.groupPrices.variantId, V.oky500)));
      await tx.insert(schema.groupPrices).values({ groupId: group.id, variantId: V.oky500, price: 10000 });
      await tx.insert(schema.tierPrices).values({ variantId: V.oky500, groupId: null, minQuantity: 10, discountPercent: 10 });
      const { id } = await submitQuoteRequest(quoteForm({ email: email("tiers") }), { ip: IP(40), executor: tx });
      assert.ok(id);
      const detail = await getQuoteRequest(id, tx);
      const line = detail?.lines.find((l) => l.variantId === V.oky500);
      assert.equal(line?.quantity, 1000);
      assert.equal(line?.groupPrice, 10000, "the cart charges the explicit group price, so the reference shows it (not 90,00 ₺)");
    });
  });

  test("invalid input stores nothing and does not count against the limits", async () => {
    await inTx(async (tx) => {
      const before = await tx.select({ id: schema.quoteRequests.id }).from(schema.quoteRequests);
      const { state, id } = await submitQuoteRequest(quoteForm({ email: "x@", consent: "" }), { ip: IP(2), executor: tx });
      assert.equal(state.status, "error");
      assert.equal(state.error, "invalid");
      assert.deepEqual(state.fieldErrors, { email: "invalid_email", consent: "consent" });
      assert.equal(state.values?.companyName, "Requests Test Otelcilik", "values are echoed");
      assert.equal(id, null);
      assert.equal((await tx.select({ id: schema.quoteRequests.id }).from(schema.quoteRequests)).length, before.length);
      assert.equal((await checkLimits(requestLimitKeys("quote", { ip: IP(2), email: email("quote") }))).retryAfterMinutes, 0);
    });
  });

  test("a variant that is not offered (sample or unknown) is refused per row", async () => {
    const [sampleVariant] = await db.select({ id: schema.productVariants.id }).from(schema.productVariants).where(eq(schema.productVariants.productId, P.sample));
    await inTx(async (tx) => {
      const lines = JSON.stringify([
        { variantId: V.lvl500, quantity: "2" },
        { variantId: sampleVariant.id, quantity: "1" },
        { variantId: 99_999_999, quantity: "1" },
      ]);
      const { state, id } = await submitQuoteRequest(quoteForm({ lines }), { ip: IP(3), executor: tx });
      assert.equal(id, null);
      assert.deepEqual(state.fieldErrors, { "lines.1.variantId": "invalid_product", "lines.2.variantId": "invalid_product" });
    });
  });

  test("honeypot: pretends success, stores nothing, counts against the IP", async () => {
    await inTx(async (tx) => {
      const { state, id } = await submitQuoteRequest(quoteForm({ website: "http://spam.example" }), { ip: IP(4), executor: tx });
      assert.equal(state.status, "success");
      assert.equal(state.reference, null);
      assert.equal(id, null);
      assert.equal((await mails(tx, "quote", 0)).length, 0);
    });
    const ipOnly = requestLimitKeys("quote", { ip: IP(4), email: null });
    // One of five used: still allowed.
    assert.equal((await checkLimits(ipOnly)).allowed, true);
  });

  test("rate limits: 5 per hour per IP, 20 per day per e-mail; the site-wide cap", async () => {
    await inTx(async (tx) => {
      for (let i = 0; i < REQUEST_RULES.ip.limit; i++) {
        const { state } = await submitQuoteRequest(quoteForm({ email: email(`d${i}`) }), { ip: IP(5), executor: tx });
        assert.equal(state.status, "success", `request ${i + 1}`);
      }
      const blocked = await submitQuoteRequest(quoteForm({ email: email("limit") }), { ip: IP(5), executor: tx });
      assert.equal(blocked.state.error, "too_many");
      assert.ok((blocked.state.retryMinutes ?? 0) > 0);
      assert.equal(blocked.id, null);

      // Per e-mail: 20 a day from different IPs, the 21st is refused.
      for (let i = 0; i < REQUEST_RULES.email.limit; i++) {
        const { state } = await submitQuoteRequest(quoteForm({ email: email("daily") }), { ip: IP(10 + i), executor: tx });
        assert.equal(state.status, "success", `daily ${i + 1}`);
      }
      const daily = await submitQuoteRequest(quoteForm({ email: email("daily") }), { ip: IP(31), executor: tx });
      assert.equal(daily.state.error, "too_many");

      const capped = await submitQuoteRequest(quoteForm({ email: email("d20") }), { ip: IP(32), executor: tx, siteLimit: 0 });
      assert.equal(capped.state.error, "too_many");
    });
  });

  test("a signed-in customer's request is linked to the account and company; prefill returns only their data", async () => {
    await inTx(async (tx) => {
      const [company] = await tx
        .insert(schema.companies)
        .values({ name: "Requests Test Kurumsal A.Ş.", sector: "office", status: "approved", phone: "+903520000000" })
        .returning({ id: schema.companies.id });
      const userId = "requests-test-user";
      await tx.insert(schema.user).values({ id: userId, name: "Linked Kişi", email: email("linked"), emailVerified: true, role: "customer", companyId: company.id });
      const prefill = await requestPrefillFor(userId, tx);
      assert.deepEqual(prefill, { contactName: "Linked Kişi", email: email("linked"), phone: "+903520000000", companyName: "Requests Test Kurumsal A.Ş.", sector: "office" });
      const { id } = await submitQuoteRequest(quoteForm({ email: email("linked") }), { ip: IP(6), userId, executor: tx });
      const [row] = await tx.select().from(schema.quoteRequests).where(eq(schema.quoteRequests.id, id!));
      assert.equal(row.userId, userId);
      assert.equal(row.companyId, company.id);
      assert.equal(await requestPrefillFor("requests-test-nobody", tx), null);
    });
  });
});

describe("quote workflow", () => {
  async function newQuote(tx: Tx) {
    const { id } = await submitQuoteRequest(quoteForm(), { ip: IP(7), executor: tx });
    const [row] = await tx.select().from(schema.quoteRequests).where(eq(schema.quoteRequests.id, id!));
    return row;
  }

  test("status rules", async () => {
    await inTx(async (tx) => {
      const row = await newQuote(tx);
      const reviewed = await setQuoteStatus(tx, { id: row.id, status: "in_review", updatedAt: row.updatedAt });
      assert.deepEqual(reviewed.audit.after, { status: "in_review" });
      await assert.rejects(setQuoteStatus(tx, { id: row.id, status: "won", updatedAt: reviewed.updatedAt }), (e) => isPanelError(e) && e.code === "invalid");
      await assert.rejects(setQuoteStatus(tx, { id: row.id, status: "rejected", updatedAt: row.updatedAt }), (e) => isPanelError(e) && e.code === "conflict", "a stale view is a conflict");
      const rejected = await setQuoteStatus(tx, { id: row.id, status: "rejected", updatedAt: reviewed.updatedAt });
      const reopened = await setQuoteStatus(tx, { id: row.id, status: "in_review", updatedAt: rejected.updatedAt });
      assert.ok(reopened.updatedAt);
      const note = await saveQuoteNote(tx, { id: row.id, adminNote: "Fiyat onayı bekleniyor", updatedAt: reopened.updatedAt });
      assert.deepEqual(note.audit?.after, { adminNoteLength: 22 }, "the note text stays out of the audit");
    });
  });

  test("sending an offer: server-side total, status quoted, localized mail; a revision sends a second mail", async () => {
    await inTx(async (tx) => {
      await withAdminRecipients(tx, [ADMIN]);
      const row = await newQuote(tx);
      const validUntil = istanbulToday(new Date(Date.now() + 20 * 86_400_000));
      const lines = [
        { variantId: V.lvl5, label: "ignored for product lines", quantity: 15, unitPrice: 38_990 },
        { variantId: V.oky500, label: "", quantity: 1000, unitPrice: 12_490 },
        { variantId: null, label: "Dispenser için dolum hortumu", quantity: 4, unitPrice: 15_000 },
      ];
      const parsed = quoteOfferSchema.parse({ id: row.id, updatedAt: row.updatedAt.toISOString(), lines, validUntil, note: "Kayseri içi teslimat ücretsizdir." });
      const result = await runSendQuoteOffer(parsed, { actor: ACTOR, tx });
      const total = 15 * 38_990 + 1000 * 12_490 + 4 * 15_000;
      assert.equal(result.data?.total, total);
      assert.equal(result.data?.emailQueued, true);

      const [saved] = await tx.select().from(schema.quoteRequests).where(eq(schema.quoteRequests.id, row.id));
      assert.equal(saved.status, "quoted");
      assert.equal(saved.offerTotal, total);
      assert.equal(saved.offer?.total, total);
      assert.equal(saved.offer?.validUntil, validUntil);
      assert.equal(saved.offer?.lines[0].label, "Lavanta Latte · 5 L Bidon", "product line labels come from the database");

      const offers = (await mails(tx, "quote", row.id)).filter((m) => m.template === "quote_offer");
      assert.equal(offers.length, 1);
      assert.equal(offers[0].locale, "en");
      assert.equal(offers[0].createdBy, ACTOR_ID);
      assert.match(offers[0].html, /5 L Canister/);
      assert.match(offers[0].text, /Prices include VAT/);
      assert.match(offers[0].text, /Kayseri içi teslimat ücretsizdir/);

      // Revised offer from "quoted": a second mail with its own dedupe key.
      const revised = await sendQuoteOffer(tx, { id: row.id, updatedAt: saved.updatedAt, lines: lines.slice(0, 1), validUntil: null, note: null }, { userId: ACTOR_ID });
      assert.equal(revised.total, 15 * 38_990);
      assert.equal((await mails(tx, "quote", row.id)).filter((m) => m.template === "quote_offer").length, 2);

      // Then won; no offer from "won".
      const won = await setQuoteStatus(tx, { id: row.id, status: "won", updatedAt: revised.updatedAt });
      await assert.rejects(sendQuoteOffer(tx, { id: row.id, updatedAt: won.updatedAt, lines, validUntil: null, note: null }, { userId: null }), (e) => isPanelError(e) && e.code === "invalid");
    });
  });

  test("offer validation: past validity, zero total, empty lines", async () => {
    await inTx(async (tx) => {
      const row = await newQuote(tx);
      const base = { id: row.id, updatedAt: row.updatedAt, note: null };
      await assert.rejects(
        sendQuoteOffer(tx, { ...base, lines: [{ variantId: V.lvl5, label: "", quantity: 1, unitPrice: 100 }], validUntil: "2020-01-01" }, { userId: null }),
        (e) => isPanelError(e) && e.fieldErrors?.validUntil !== undefined,
      );
      await assert.rejects(
        sendQuoteOffer(tx, { ...base, lines: [{ variantId: V.lvl5, label: "", quantity: 3, unitPrice: 0 }], validUntil: null }, { userId: null }),
        (e) => isPanelError(e) && e.fieldErrors?.lines !== undefined,
      );
      assert.equal(quoteOfferSchema.safeParse({ ...base, updatedAt: row.updatedAt.toISOString(), lines: [], validUntil: "" }).success, false);
      const zod = quoteOfferSchema.safeParse({ ...base, updatedAt: row.updatedAt.toISOString(), lines: [{ quantity: 0, unitPrice: -1 }], validUntil: "" });
      assert.equal(zod.success, false);
    });
  });
});

describe("sample requests", () => {
  test("a valid request is stored with the address and queues the customer (ar) and admin mails", async () => {
    await inTx(async (tx) => {
      await withAdminRecipients(tx, [ADMIN]);
      const { state, id } = await submitSampleRequest(sampleForm(), { ip: IP(8), executor: tx });
      assert.equal(state.status, "success", JSON.stringify(state));
      assert.equal(state.reference, sampleRef(id!));
      const [row] = await tx.select().from(schema.sampleRequests).where(eq(schema.sampleRequests.id, id!));
      assert.equal(row.status, "new");
      assert.equal(row.sector, "spa");
      assert.equal(row.phone, "+905320000001");
      assert.deepEqual(row.address, { fullName: "Mehmet Deneme", phone: "+905320000001", city: "Kayseri", district: "Melikgazi", line1: "Alpaslan Mah. Deneme Sok. No:1", country: "TR" });
      assert.deepEqual(row.productIds, [P.lavantaLatte, P.portakal]);
      assert.equal(row.estimatedMonthlyLiters, 120);
      assert.equal(row.message, null);
      const sent = await mails(tx, "sample", id!);
      assert.deepEqual(
        sent.map((m) => [m.template, m.toEmail, m.locale]),
        [
          ["sample_received", email("sample"), "ar"],
          ["sample_received_admin", ADMIN, "tr"],
        ],
      );
      assert.match(sent[0].html, /dir="rtl"/);
      assert.match(sent[0].html, /Melikgazi/);
      const list = await listSampleRequests({ status: "new", q: email("sample") }, tx);
      assert.equal(list.rows[0]?.id, id);
      assert.deepEqual(
        list.rows[0].products.map((p) => p.id),
        [P.lavantaLatte, P.portakal],
      );
    });
  });

  test("only active scents can be sampled; field errors; the form switch", async () => {
    await inTx(async (tx) => {
      const bundle = await submitSampleRequest(sampleForm({ productIds: [String(P.bundle)] }), { ip: IP(9), executor: tx });
      assert.deepEqual(bundle.state.fieldErrors, { productIds: "invalid_product" });
      const sample = await submitSampleRequest(sampleForm({ productIds: [String(P.sample)] }), { ip: IP(9), executor: tx });
      assert.deepEqual(sample.state.fieldErrors, { productIds: "invalid_product" });
      const invalid = await submitSampleRequest(sampleForm({ productIds: [], city: "Atlantis", phone: "", district: "x", line1: "" }), { ip: IP(9), executor: tx });
      assert.deepEqual(invalid.state.fieldErrors, { phone: "required", city: "invalid_city", district: "too_short", line1: "required", productIds: "no_products" });
      await setSampleForm(tx, false);
      const closed = await submitSampleRequest(sampleForm(), { ip: IP(9), executor: tx });
      assert.equal(closed.state.error, "closed");
      assert.equal(closed.id, null);
    });
  });

  test("workflow: approve → ship (carrier + tracking) → won, with one mail per step; reject rules", async () => {
    await inTx(async (tx) => {
      await withAdminRecipients(tx, []);
      const { id } = await submitSampleRequest(sampleForm(), { ip: IP(11), executor: tx });
      let [row] = await tx.select().from(schema.sampleRequests).where(eq(schema.sampleRequests.id, id!));
      await assert.rejects(shipSample(tx, { id: row.id, carrier: "yurtici", trackingNumber: "YK123456", updatedAt: row.updatedAt }, { userId: null }), (e) => isPanelError(e) && e.code === "invalid");

      const approved = await setSampleStatus(tx, { id: row.id, status: "approved", updatedAt: row.updatedAt }, { userId: ACTOR_ID });
      assert.equal(approved.emailQueued, true);
      await assert.rejects(shipSample(tx, { id: row.id, carrier: "nope", trackingNumber: "YK123456", updatedAt: approved.updatedAt }, { userId: null }), (e) => isPanelError(e) && e.fieldErrors?.carrier !== undefined);
      await assert.rejects(shipSample(tx, { id: row.id, carrier: "yurtici", trackingNumber: "ab", updatedAt: approved.updatedAt }, { userId: null }), (e) => isPanelError(e) && e.fieldErrors?.trackingNumber !== undefined);
      const shipped = await shipSample(tx, { id: row.id, carrier: "yurtici", trackingNumber: " yk 123 456 ", updatedAt: approved.updatedAt }, { userId: ACTOR_ID });
      assert.equal(shipped.emailQueued, true);
      [row] = await tx.select().from(schema.sampleRequests).where(eq(schema.sampleRequests.id, row.id));
      assert.equal(row.status, "shipped");
      assert.equal(row.trackingNumber, "YK123456");
      assert.equal(row.carrier, "yurtici");
      assert.ok(row.approvedAt && row.shippedAt);

      const lost = await setSampleStatus(tx, { id: row.id, status: "rejected", updatedAt: row.updatedAt }, { userId: ACTOR_ID });
      assert.equal(lost.emailQueued, null, "closing a shipped request sends no rejection mail");

      const sent = await mails(tx, "sample", row.id);
      assert.deepEqual(
        sent.map((m) => m.template),
        ["sample_received", "sample_approved", "sample_shipped"],
      );
      const shippedMail = sent[2];
      assert.match(shippedMail.html, /YK123456/);
      assert.match(shippedMail.html, /yurticikargo\.com/);
      const detail = await getSampleRequest(row.id, tx);
      assert.equal(detail?.carrier?.name, "Yurtiçi Kargo");
      assert.match(detail?.trackingUrl ?? "", /code=YK123456/);
    });
  });

  test("rejecting before shipping e-mails the requester with the optional note", async () => {
    await inTx(async (tx) => {
      const { id } = await submitSampleRequest(sampleForm({ locale: "tr" }), { ip: IP(12), executor: tx });
      const [row] = await tx.select().from(schema.sampleRequests).where(eq(schema.sampleRequests.id, id!));
      const input = sampleStatusSchema.parse({ id: row.id, status: "rejected", updatedAt: row.updatedAt.toISOString(), note: "Bu ay numune stoğumuz tükendi." });
      const rejected = await setSampleStatus(tx, input, { userId: ACTOR_ID });
      assert.equal(rejected.emailQueued, true);
      const [mail] = (await mails(tx, "sample", row.id)).filter((m) => m.template === "sample_rejected");
      assert.match(mail.text, /Bu ay numune stoğumuz tükendi/);
      assert.equal(mail.dedupeKey, `sample:${row.id}:rejected:customer`);
      // Reopen and reject again: the mail is not sent twice.
      const reopened = await setSampleStatus(tx, { id: row.id, status: "in_review", updatedAt: rejected.updatedAt }, { userId: ACTOR_ID });
      const again = await setSampleStatus(tx, { id: row.id, status: "rejected", updatedAt: reopened.updatedAt }, { userId: ACTOR_ID });
      assert.equal(again.emailQueued, false);
    });
  });
});

describe("contact form admin e-mail (contact_message)", () => {
  const contact = { name: "Requests Test Kişi", email: email("contact"), phone: "", subject: "quote", message: "Otelimiz için 20 L bidon fiyatı rica ediyoruz.", locale: "en", website: "" };

  test("one mail per admin recipient in the message's transaction; none without recipients", async () => {
    await inTx(async (tx) => {
      await withAdminRecipients(tx, [ADMIN, email("admin2")]);
      const { state, messageId } = await submitContactForm(contact, { ip: IP(13), executor: tx });
      assert.equal(state.status, "success");
      const sent = await mails(tx, "contact", messageId!);
      assert.deepEqual(
        sent.map((m) => [m.template, m.toEmail, m.locale, m.dedupeKey]),
        [
          ["contact_message", ADMIN, "tr", `contact:${messageId}:new:admin:${ADMIN}`],
          ["contact_message", email("admin2"), "tr", `contact:${messageId}:new:admin:${email("admin2")}`],
        ],
      );
      assert.match(sent[0].subject, /Kurumsal teklif · Requests Test Kişi/);
      assert.match(sent[0].html, new RegExp(`/panel/mesajlar/${messageId}`));
      await withAdminRecipients(tx, []);
    });
    await inTx(async (tx) => {
      await withAdminRecipients(tx, []);
      const [general] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "general"));
      const value = { ...((general?.value as Record<string, unknown>) ?? {}), email: "" };
      await tx.update(schema.settings).set({ value }).where(eq(schema.settings.key, "general"));
      const { messageId } = await submitContactForm({ ...contact, email: email("contact") }, { ip: IP(14), executor: tx });
      assert.equal((await mails(tx, "contact", messageId!)).length, 0);
    });
  });
});

describe("content script: request forms", () => {
  test("idempotent, inserts the forms after their anchors and retargets only untouched seeded values", async () => {
    await inTx(async (tx) => {
      // Simulate a day-3 database: no forms yet, the old CTA, a client-edited CTA.
      const [kurumsal] = await tx.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.slug, "kurumsal"));
      await tx.delete(schema.pageSections).where(and(eq(schema.pageSections.pageId, kurumsal.id), eq(schema.pageSections.type, "quote_form")));
      const [hero] = await tx
        .select()
        .from(schema.pageSections)
        .where(and(eq(schema.pageSections.pageId, kurumsal.id), eq(schema.pageSections.type, "hero")));
      const heroContent = hero.content as { primaryCta: { href: string } };
      await tx
        .update(schema.pageSections)
        .set({ content: { ...heroContent, primaryCta: { ...heroContent.primaryCta, href: "/iletisim?konu=teklif" } } })
        .where(eq(schema.pageSections.id, hero.id));
      const [faq] = await tx
        .select()
        .from(schema.pageSections)
        .where(and(eq(schema.pageSections.pageId, kurumsal.id), eq(schema.pageSections.type, "faq")));
      const edited = { ...(faq.content as Record<string, unknown>), items: [{ question: { tr: "Özel" }, answer: { tr: "Müşterinin kendi metni" } }] };
      await tx.update(schema.pageSections).set({ content: edited }).where(eq(schema.pageSections.id, faq.id));

      const first = await requestForms(tx);
      assert.ok(first.inserted.some((l) => l.includes("quote_form on /kurumsal")), first.inserted.join("\n"));
      assert.ok(first.updated.some((l) => l.includes(`#${hero.id}: hero.primaryCta.href`)));
      assert.ok(first.skipped.some((l) => l.includes("/kurumsal faq.items.0.answer: edited in the panel")));
      const [faqAfter] = await tx.select().from(schema.pageSections).where(eq(schema.pageSections.id, faq.id));
      assert.deepEqual(faqAfter.content, edited, "a client edit is never overwritten");

      // The new section sits right after the b2b_cta (same position, later id).
      const sections = await tx
        .select({ id: schema.pageSections.id, type: schema.pageSections.type })
        .from(schema.pageSections)
        .where(eq(schema.pageSections.pageId, kurumsal.id))
        .orderBy(schema.pageSections.position, schema.pageSections.id);
      const types = sections.map((s) => s.type);
      assert.equal(types[types.indexOf("b2b_cta") + 1], "quote_form");

      const second = await requestForms(tx);
      assert.deepEqual([second.inserted, second.updated], [[], []], "a second run has nothing to do");
    });
  });
});
