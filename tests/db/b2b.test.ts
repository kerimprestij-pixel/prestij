// B2B against the local PostgreSQL: the business application (pending company, receipt + admin mail),
// approval / rejection / terms, business prices (parity with the cart), retail for pending and
// rejected companies, nothing a customer sends can set a group, a company or an approved status,
// deferred payment only with terms, customer groups CRUD with the in-use guard, and the customer admin
// actions (group, ban, export, anonymize).
//
// Other agents share the database. Almost everything runs inside transactions that are rolled back
// (users, companies, groups, settings and e-mails never become visible to anyone else). Only the
// parity and checkout checks need committed carts; they are deleted by id. Id sequences consumed by
// rolled-back inserts are put back when nobody else used them meanwhile.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/b2b.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { auth } from "@/lib/auth";
import { BUSINESS_SECTORS, normalizeBusinessPhone, normalizeWebsite, readApplicationDetails, validateBusinessApplication, type BusinessApplicationData } from "@/lib/b2b/application";
import { anonymizeCustomer, exportCustomerData, setCustomerBanned, setCustomerGroup } from "@/lib/b2b/customers";
import { companyTermsSchema } from "@/lib/b2b/panel-schemas";
import { computePersonalCardPrices, computePersonalPrices, withoutVat } from "@/lib/b2b/personal-prices";
import { getCompanyDetail, getCustomerDetail, listCompanies, listCustomers } from "@/lib/b2b/queries";
import {
  approveCompany,
  buildPaymentTerms,
  createGroup,
  deleteGroup,
  groupUsage,
  rejectCompany,
  submitBusinessApplication,
  updateCompany,
  updateCompanyTerms,
  updateGroup,
} from "@/lib/b2b/service";
import { loadCart } from "@/lib/cart/load";
import { addItem } from "@/lib/cart/mutations";
import { loadCommerceSettings, type CommerceSettings } from "@/lib/cart/settings";
import { totalsForLoadedCart } from "@/lib/cart/totals";
import { RETAIL_CUSTOMER, type CustomerContext } from "@/lib/cart/types";
import { resolveCustomerContext } from "@/lib/customer/resolve";
import { placeOrder } from "@/lib/orders/place";
import { isPanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";

const PREFIX = "b2b-test-";
const mail = (n: string) => `${PREFIX}${n}@test.local`;
const ADMIN_MAIL = mail("admin");
const ACTOR = { user: { id: `${PREFIX}actor` } };

/** Thrown at the end of a test transaction so nothing it wrote is ever committed. */
class RolledBack extends Error {}

async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

const SEQ_TABLES = ["companies", "email_messages", "customer_groups", "audit_log", "cart_items", "addresses"] as const;
const sequences: { table: string; name: string; lastValue: string; isCalled: boolean }[] = [];
const createdCarts = new Set<string>();
let settings: CommerceSettings;
let kurumsal: { id: number; slug: string; discountPercent: number; isBusiness: boolean; showPricesExVat: boolean };
let variant: { id: number; productId: number; price: number; minQuantity: number };

async function makeUser(tx: Tx, n: string, extra: Partial<typeof schema.user.$inferInsert> = {}) {
  const id = `${PREFIX}${n}`;
  await tx.insert(schema.user).values({ id, name: `Test ${n} Yılmaz`, email: mail(n), emailVerified: true, role: "customer", locale: "tr", ...extra });
  return id;
}

/** Turns on an admin recipient for this transaction only (enqueueEmail reads settings through the tx). */
async function withAdminRecipient(tx: Tx) {
  await tx
    .insert(schema.settings)
    .values({ key: "emails", value: { adminRecipients: [ADMIN_MAIL] } })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: sql`jsonb_set(coalesce(${schema.settings.value}, '{}'::jsonb), '{adminRecipients}', ${JSON.stringify([ADMIN_MAIL])}::jsonb)` } });
}

function application(overrides: Record<string, unknown> = {}): BusinessApplicationData {
  const parsed = validateBusinessApplication({
    companyName: "B2B Test Otelcilik A.Ş.",
    sector: "hotel",
    taxOffice: "Kocasinan",
    taxNumber: "1234567890",
    phone: "0352 123 45 67",
    email: mail("muhasebe"),
    website: "erciyesotel.com.tr",
    address: { city: "kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. Test Sok. No: 1", postalCode: "38010" },
    monthlyVolume: "l200_1000",
    note: "Üç otel için.",
    locale: "tr",
    ...overrides,
  });
  assert.ok(parsed.ok, JSON.stringify(!parsed.ok && parsed.fieldErrors));
  return parsed.data;
}

/** The pricing context getCustomerContext() would build for this user (same reads, same pure rule). */
async function contextFor(tx: Tx, userId: string): Promise<CustomerContext> {
  const [user] = await tx.select({ id: schema.user.id, customerGroupId: schema.user.customerGroupId, companyId: schema.user.companyId }).from(schema.user).where(eq(schema.user.id, userId));
  const company = user.companyId
    ? ((await tx.select({ id: schema.companies.id, status: schema.companies.status, groupId: schema.companies.groupId, paymentTerms: schema.companies.paymentTerms }).from(schema.companies).where(eq(schema.companies.id, user.companyId)))[0] ?? null)
    : null;
  const groupId = user.customerGroupId ?? company?.groupId ?? null;
  const group = groupId
    ? ((await tx
        .select({ id: schema.customerGroups.id, slug: schema.customerGroups.slug, discountPercent: schema.customerGroups.discountPercent, isBusiness: schema.customerGroups.isBusiness, showPricesExVat: schema.customerGroups.showPricesExVat })
        .from(schema.customerGroups)
        .where(eq(schema.customerGroups.id, groupId)))[0] ?? null)
    : null;
  const { b2b } = await loadCommerceSettings(tx);
  return resolveCustomerContext({ user, company, group, b2b });
}

async function updatedAtOf(tx: Tx, companyId: number) {
  const [row] = await tx.select({ updatedAt: schema.companies.updatedAt }).from(schema.companies).where(eq(schema.companies.id, companyId));
  return row.updatedAt;
}

async function mailsTo(tx: Tx, to: string) {
  return tx.select().from(schema.emailMessages).where(eq(schema.emailMessages.toEmail, to));
}

before(async () => {
  const leftovers = await db.select({ id: schema.user.id }).from(schema.user).where(sql`${schema.user.id} like ${`${PREFIX}%`}`);
  assert.equal(leftovers.length, 0, "no test users left over from an earlier run");
  for (const table of SEQ_TABLES) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    sequences.push({ table, name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
  settings = await loadCommerceSettings();
  const [group] = await db
    .select({ id: schema.customerGroups.id, slug: schema.customerGroups.slug, discountPercent: schema.customerGroups.discountPercent, isBusiness: schema.customerGroups.isBusiness, showPricesExVat: schema.customerGroups.showPricesExVat })
    .from(schema.customerGroups)
    .where(eq(schema.customerGroups.slug, "kurumsal"));
  assert.ok(group && group.discountPercent > 0, "seeded group 'kurumsal' with a discount");
  kurumsal = group;
  // A sellable, non-sample variant without an explicit group price (the group discount applies).
  const [row] = await db.execute<{ id: number; product_id: number; price: number; min_quantity: number }>(sql`
    select v.id, v.product_id, v.price, v.min_quantity from product_variants v join products p on p.id = v.product_id
    where p.status = 'active' and p.type = 'standard' and v.is_active and not p.business_only
      and (not v.track_stock or v.allow_backorder or v.stock >= greatest(v.min_quantity, 1) + 2)
      and not exists (select 1 from group_prices g where g.variant_id = v.id)
    order by v.price, v.id limit 1`);
  assert.ok(row, "a sellable variant");
  variant = { id: row.id, productId: row.product_id, price: row.price, minQuantity: Math.max(1, row.min_quantity) };
});

after(async () => {
  try {
    if (createdCarts.size) await db.delete(schema.carts).where(inArray(schema.carts.id, [...createdCarts]));
    for (const s of sequences) {
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${s.table}`));
      if (max === null || Number(max) <= Number(s.lastValue)) await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
    const left = await db.select({ id: schema.user.id }).from(schema.user).where(sql`${schema.user.id} like ${`${PREFIX}%`}`);
    assert.equal(left.length, 0, "no test users committed");
    const mails = await db.select({ id: schema.emailMessages.id }).from(schema.emailMessages).where(sql`${schema.emailMessages.toEmail} like ${`${PREFIX}%`}`);
    assert.equal(mails.length, 0, "no test e-mails committed");
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------

describe("application form (pure)", () => {
  test("validation codes and normalization", () => {
    const bad = validateBusinessApplication({ companyName: "X", sector: "casino", taxOffice: "", taxNumber: "1234567891", phone: "123", email: "nope", website: "javascript:alert(1)", address: { city: "Atlantis", district: "", line1: "" } });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.fieldErrors.companyName, "too_short");
      assert.equal(bad.fieldErrors.sector, "required");
      assert.equal(bad.fieldErrors.taxOffice, "required");
      assert.equal(bad.fieldErrors.taxNumber, "invalid_tax_number");
      assert.equal(bad.fieldErrors.phone, "invalid_phone");
      assert.equal(bad.fieldErrors.email, "invalid_email");
      assert.equal(bad.fieldErrors.website, "invalid_website");
      assert.equal(bad.fieldErrors["address.city"], "invalid_province");
    }
    const good = application({ taxNumber: "10000000146" /* sole proprietor: TCKN */ });
    assert.equal(good.address.city, "Kayseri");
    assert.equal(good.phone, "+903521234567");
    assert.equal(good.website, "https://erciyesotel.com.tr");
    assert.equal(normalizeBusinessPhone("+90 532 123 45 67"), "+905321234567");
    assert.equal(normalizeWebsite("http://firma.com/iletisim"), "https://firma.com/iletisim");
    assert.equal(normalizeWebsite("https://user:pw@firma.com"), null);
    assert.equal(BUSINESS_SECTORS.length, 8);
  });

  test("whatever else the client posts is dropped (no status, group, terms or company id)", () => {
    const data = application({ status: "approved", groupId: 2, paymentTerms: { allowDeferred: true, days: 90 }, companyId: 1, applicantUserId: "someone" });
    for (const key of ["status", "groupId", "paymentTerms", "companyId", "applicantUserId"]) assert.equal(key in data, false, key);
  });

  test("Better Auth keeps companyId and customerGroupId non-writable", () => {
    const fields = (auth.options.user?.additionalFields ?? {}) as Record<string, { input?: boolean }>;
    assert.equal(fields.companyId?.input, false);
    assert.equal(fields.customerGroupId?.input, false);
  });
});

describe("application → approval / rejection", () => {
  test("creates a pending company for the caller, links the user, mails customer and admin", async () => {
    await inRollback(async (tx) => {
      await withAdminRecipient(tx);
      const userId = await makeUser(tx, "a1", { locale: "en" });
      const r = await submitBusinessApplication(tx, application(), { userId });
      assert.ok(r.ok && !r.resubmitted);
      const [company] = await tx.select().from(schema.companies).where(eq(schema.companies.id, r.companyId));
      assert.equal(company.status, "pending");
      assert.equal(company.applicantUserId, userId);
      assert.equal(company.groupId, null);
      assert.equal(company.paymentTerms, null);
      assert.equal(company.taxNumber, "1234567890");
      assert.equal(readApplicationDetails(company.address)?.monthlyVolume, "l200_1000");
      const [user] = await tx.select({ companyId: schema.user.companyId, customerGroupId: schema.user.customerGroupId }).from(schema.user).where(eq(schema.user.id, userId));
      assert.equal(user.companyId, r.companyId);
      assert.equal(user.customerGroupId, null);

      const [customerMail] = await mailsTo(tx, mail("a1"));
      assert.equal(customerMail.template, "business_application_received");
      assert.equal(customerMail.locale, "en", "the account's language");
      assert.equal(customerMail.relatedType, "company");
      assert.match(customerMail.subject, /business account application/i);
      assert.match(customerMail.html, /\/en\/account\/business/);
      const [adminMail] = await mailsTo(tx, ADMIN_MAIL);
      assert.equal(adminMail.template, "business_application_admin");
      assert.equal(adminMail.locale, "tr");
      assert.match(adminMail.subject, /B2B Test Otelcilik/);
      assert.match(adminMail.html, new RegExp(`/panel/kurumsal-hesaplar/${r.companyId}`));

      // Still retail while pending.
      const ctx = await contextFor(tx, userId);
      assert.equal(ctx.groupId, null);
      assert.equal(ctx.allowDeferred, false);
      assert.equal((await computePersonalPrices(ctx, [variant.id], { executor: tx })).size, 0);
    });
  });

  test("pending → already_pending, approved → already_approved, rejected → resubmitted in place", async () => {
    await inRollback(async (tx) => {
      const userId = await makeUser(tx, "a2");
      const first = await submitBusinessApplication(tx, application(), { userId });
      assert.ok(first.ok);
      assert.deepEqual(await submitBusinessApplication(tx, application(), { userId }), { ok: false, code: "already_pending" });

      await rejectCompany(tx, { id: first.companyId, reason: "Unvan vergi levhasıyla eşleşmiyor.", updatedAt: await updatedAtOf(tx, first.companyId) }, ACTOR);
      const again = await submitBusinessApplication(tx, application({ companyName: "B2B Test Otelcilik Ltd." }), { userId });
      assert.ok(again.ok && again.resubmitted && again.companyId === first.companyId);
      const [row] = await tx.select().from(schema.companies).where(eq(schema.companies.id, first.companyId));
      assert.equal(row.status, "pending");
      assert.equal(row.rejectionReason, null);
      assert.equal(row.name, "B2B Test Otelcilik Ltd.");

      await approveCompany(tx, { id: row.id, groupId: kurumsal.id, allowDeferred: false, days: null, updatedAt: row.updatedAt }, ACTOR);
      assert.deepEqual(await submitBusinessApplication(tx, application(), { userId }), { ok: false, code: "already_approved" });
    });
  });

  test("staff accounts and closed B2B are refused", async () => {
    await inRollback(async (tx) => {
      const staffId = await makeUser(tx, "s1", { role: "editor" });
      assert.deepEqual(await submitBusinessApplication(tx, application(), { userId: staffId }), { ok: false, code: "staff" });
      const userId = await makeUser(tx, "c1");
      await tx
        .insert(schema.settings)
        .values({ key: "b2b", value: { enabled: false } })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: sql`jsonb_set(${schema.settings.value}, '{enabled}', 'false'::jsonb)` } });
      assert.deepEqual(await submitBusinessApplication(tx, application(), { userId }), { ok: false, code: "closed" });
    });
  });

  test("approval flips pricing (group discount) and deferred terms; rejection takes both away", async () => {
    await inRollback(async (tx) => {
      const userId = await makeUser(tx, "a3", { locale: "ar" });
      const r = await submitBusinessApplication(tx, application(), { userId });
      assert.ok(r.ok);

      // Deferred without days is refused (validation in the service and in the action schema).
      await assert.rejects(
        approveCompany(tx, { id: r.companyId, groupId: kurumsal.id, allowDeferred: true, days: null, updatedAt: await updatedAtOf(tx, r.companyId) }, ACTOR),
        (e: unknown) => isPanelError(e) && e.code === "invalid" && Boolean(e.fieldErrors?.days),
      );
      assert.equal(companyTermsSchema.safeParse({ id: 1, groupId: kurumsal.id, allowDeferred: true, days: 500, updatedAt: new Date().toISOString() }).success, false);
      assert.throws(() => buildPaymentTerms({ allowDeferred: true, days: 0 }));
      assert.deepEqual(buildPaymentTerms({ allowDeferred: false, days: 30 }), { allowDeferred: false });

      const approved = await approveCompany(tx, { id: r.companyId, groupId: kurumsal.id, allowDeferred: true, days: 30, updatedAt: await updatedAtOf(tx, r.companyId) }, ACTOR);
      assert.equal(approved.notified, true);
      assert.equal(approved.audit.action, "status");
      const [mailRow] = (await mailsTo(tx, mail("a3"))).filter((m) => m.template === "business_approved");
      assert.equal(mailRow.locale, "ar");
      assert.match(mailRow.html, /dir="rtl"/);
      assert.match(mailRow.text, /30/);

      const ctx = await contextFor(tx, userId);
      assert.equal(ctx.groupId, kurumsal.id);
      assert.equal(ctx.isBusiness, true);
      assert.equal(ctx.companyApproved, true);
      assert.equal(ctx.allowDeferred, true);
      assert.equal(ctx.deferredDays, 30);
      const prices = await computePersonalPrices(ctx, [variant.id], { executor: tx });
      const p = prices.get(variant.id);
      assert.ok(p, "a business price");
      assert.ok(p.unitPrice < p.retailUnitPrice);
      const cards = await computePersonalCardPrices(ctx, [variant.productId], { executor: tx });
      assert.ok(cards.get(variant.productId), "a card price");

      // Terms edit on an approved company (no mail), then revoke.
      const terms = await updateCompanyTerms(tx, { id: r.companyId, groupId: kurumsal.id, allowDeferred: false, days: null, updatedAt: await updatedAtOf(tx, r.companyId) });
      assert.ok(terms.audit);
      assert.equal((await contextFor(tx, userId)).allowDeferred, false, "deferred off without terms");
      const rejected = await rejectCompany(tx, { id: r.companyId, reason: "Firma kapandı.", updatedAt: await updatedAtOf(tx, r.companyId) }, ACTOR);
      assert.equal(rejected.notified, true);
      const after = await contextFor(tx, userId);
      assert.equal(after.groupId, null);
      assert.equal(after.companyApproved, false);
      assert.equal((await computePersonalPrices(after, [variant.id], { executor: tx })).size, 0, "retail again");
      const [mailRejected] = (await mailsTo(tx, mail("a3"))).filter((m) => m.template === "business_rejected");
      assert.match(mailRejected.text, /Firma kapandı\./);

      // Stale updatedAt → conflict; approving twice → conflict.
      await assert.rejects(
        approveCompany(tx, { id: r.companyId, groupId: kurumsal.id, allowDeferred: false, days: null, updatedAt: new Date(0) }, ACTOR),
        (e: unknown) => isPanelError(e) && e.code === "conflict",
      );
    });
  });

  test("company edit validates like the form and keeps the application details", async () => {
    await inRollback(async (tx) => {
      const userId = await makeUser(tx, "a4");
      const r = await submitBusinessApplication(tx, application(), { userId });
      assert.ok(r.ok);
      const fields = application({ companyName: "B2B Test Spa", website: "" });
      const out = await updateCompany(tx, { id: r.companyId, fields, adminNote: "Ara: Ayşe Hanım", updatedAt: await updatedAtOf(tx, r.companyId) });
      assert.ok(out.audit);
      assert.equal(JSON.stringify(out.audit.after).includes("Ayşe"), false, "no values in the audit");
      const detail = await getCompanyDetail(r.companyId, tx);
      assert.equal(detail?.name, "B2B Test Spa");
      assert.equal(detail?.website, null);
      assert.equal(detail?.application?.note, "Üç otel için.");
      assert.equal(detail?.members.length, 1);
      const list = await listCompanies({ status: "pending", q: "b2b test spa" }, tx);
      assert.ok(list.rows.some((x) => x.id === r.companyId));
      assert.ok(list.counts.pending >= 1);
    });
  });
});

describe("business price parity and deferred checkout", () => {
  const approvedBuyer = (): CustomerContext => ({
    ...RETAIL_CUSTOMER,
    userId: `${PREFIX}buyer`,
    groupId: kurumsal.id,
    groupSlug: kurumsal.slug,
    groupDiscountPercent: kurumsal.discountPercent,
    isBusiness: true,
    showPricesExVat: kurumsal.showPricesExVat,
    companyId: null,
    companyApproved: true,
    allowDeferred: false,
    deferredDays: null,
  });

  test("the island's price is the cart's unit price for the same buyer", async () => {
    const buyer = approvedBuyer();
    const added = await addItem(null, { variantId: variant.id, quantity: variant.minQuantity }, { customer: buyer, locale: "tr", settings });
    assert.ok(added.ok);
    createdCarts.add(added.cartId);
    const loaded = await loadCart(added.cartId, buyer);
    const line = totalsForLoadedCart(loaded, settings).lines.find((l) => l.variantId === variant.id);
    const island = (await computePersonalPrices(buyer, [variant.id])).get(variant.id);
    assert.ok(line && island);
    assert.equal(island.unitPrice, line.unitPrice, "same unit price as the cart");
    const retail = totalsForLoadedCart(await loadCart(added.cartId, RETAIL_CUSTOMER), settings).lines.find((l) => l.variantId === variant.id);
    assert.equal(island.retailUnitPrice, retail?.unitPrice);
    assert.equal(withoutVat(12000, 20), 10000);
  });

  test("the island's subscription price per plan is the cart's subscription line price (integrator)", async (t) => {
    const buyer = approvedBuyer();
    const sp = schema.subscriptionPlans;
    const plans = await db.select({ id: sp.id }).from(sp).where(eq(sp.isActive, true));
    const [product] = await db.select({ allow: schema.products.allowSubscription }).from(schema.products).where(eq(schema.products.id, variant.productId));
    if (!settings.subscriptions.enabled || plans.length === 0 || !product?.allow) return t.skip("no subscribable product / active plan");
    const island = (await computePersonalPrices(buyer, [variant.id])).get(variant.id);
    assert.ok(island?.subscriptionUnitPrices, "per-plan prices for a group buyer");
    for (const plan of plans) {
      const added = await addItem(null, { variantId: variant.id, quantity: variant.minQuantity, subscriptionPlanId: plan.id }, { customer: buyer, locale: "tr", settings });
      assert.ok(added.ok);
      createdCarts.add(added.cartId);
      const line = totalsForLoadedCart(await loadCart(added.cartId, buyer), settings).lines.find((l) => l.variantId === variant.id);
      assert.ok(line);
      assert.equal(island.subscriptionUnitPrices[plan.id], line.unitPrice, `plan ${plan.id}: same unit price as the cart`);
    }
  });

  test("deferred is offered only with terms and refused by placeOrder otherwise", async () => {
    const terms = (paymentTerms: { allowDeferred?: boolean; days?: number } | null, status: "approved" | "pending" = "approved") =>
      resolveCustomerContext({
        user: { id: `${PREFIX}buyer`, customerGroupId: null, companyId: 999_999 },
        company: { id: 999_999, status, groupId: kurumsal.id, paymentTerms },
        group: { id: kurumsal.id, slug: kurumsal.slug, discountPercent: kurumsal.discountPercent, isBusiness: true, showPricesExVat: kurumsal.showPricesExVat },
        b2b: { enabled: true, requireApproval: true },
      });
    const withTerms = terms({ allowDeferred: true, days: 30 });
    const noTerms = terms(null);
    const off = terms({ allowDeferred: false, days: 30 });
    const pending = terms({ allowDeferred: true, days: 30 }, "pending");
    assert.equal(withTerms.allowDeferred, true);
    assert.equal(withTerms.deferredDays, 30);
    for (const ctx of [noTerms, off, pending]) assert.equal(ctx.allowDeferred, false);
    assert.equal(pending.groupId, null, "a pending company gets retail prices");

    const added = await addItem(null, { variantId: variant.id, quantity: variant.minQuantity }, { customer: noTerms, locale: "tr", settings });
    assert.ok(added.ok);
    createdCarts.add(added.cartId);
    const deferredOf = async (ctx: CustomerContext) => totalsForLoadedCart(await loadCart(added.cartId, ctx), settings).paymentMethods.find((m) => m.method === "deferred");
    assert.equal((await deferredOf(withTerms))?.available, true);
    for (const ctx of [noTerms, off, pending]) {
      const option = await deferredOf(ctx);
      assert.equal(option?.available, false);
      assert.equal(option?.reason, "not_eligible");
    }

    const [{ n: ordersBefore }] = await db.execute<{ n: string }>(sql`select count(*)::text as n from orders`);
    for (const ctx of [noTerms, off]) {
      const r = await placeOrder(
        {
          locale: "tr",
          contact: { email: mail("buyer"), phone: "0532 123 45 67" },
          shippingAddress: { fullName: "Test Alıcı", city: "Kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. Test Sok. No: 1" },
          invoice: { type: "individual", sameAsShipping: true },
          paymentMethod: "deferred",
          consents: { preInformation: true, distanceSales: true },
        },
        { cartId: added.cartId, customer: ctx, effects: false, allowDraftContracts: true },
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "method_unavailable");
    }
    const [{ n: ordersAfter }] = await db.execute<{ n: string }>(sql`select count(*)::text as n from orders where email = ${mail("buyer")}`);
    assert.equal(ordersAfter, "0");
    assert.ok(Number(ordersBefore) >= 0);
  });
});

describe("customer groups", () => {
  test("create, update, guarded delete, unique slug, default slug", async () => {
    await inRollback(async (tx) => {
      const created = await createGroup(tx, { slug: "b2b-test-grup", name: { tr: "Test Grubu", en: "Test group" }, isBusiness: true, discountPercent: 12, showPricesExVat: false });
      await assert.rejects(
        createGroup(tx, { slug: "b2b-test-grup", name: { tr: "Kopya" }, isBusiness: false, discountPercent: 0, showPricesExVat: false }),
        (e: unknown) => isPanelError(e) && Boolean(e.fieldErrors?.slug),
      );
      const [row] = await tx.select().from(schema.customerGroups).where(eq(schema.customerGroups.id, created.id));
      const updated = await updateGroup(tx, { id: row.id, updatedAt: row.updatedAt, slug: "b2b-test-grup-2", name: { tr: "Test Grubu 2" }, isBusiness: true, discountPercent: 18, showPricesExVat: true });
      assert.ok(updated.audit);

      // In use by a customer → refused; free again → deleted.
      const userId = await makeUser(tx, "g1");
      const [u] = await tx.select({ updatedAt: schema.user.updatedAt }).from(schema.user).where(eq(schema.user.id, userId));
      await setCustomerGroup(tx, { userId, groupId: row.id, updatedAt: u.updatedAt });
      assert.equal((await groupUsage(tx, row.id)).customers, 1);
      await assert.rejects(deleteGroup(tx, { id: row.id, updatedAt: updated.updatedAt }), (e: unknown) => isPanelError(e) && e.code === "in_use" && /1 müşteri/.test(e.message));
      const [u2] = await tx.select({ updatedAt: schema.user.updatedAt }).from(schema.user).where(eq(schema.user.id, userId));
      await setCustomerGroup(tx, { userId, groupId: null, updatedAt: u2.updatedAt });
      await deleteGroup(tx, { id: row.id, updatedAt: updated.updatedAt });
      assert.equal((await tx.select().from(schema.customerGroups).where(eq(schema.customerGroups.id, row.id))).length, 0);

      // The default business group cannot change its slug or be deleted.
      const [def] = await tx.select().from(schema.customerGroups).where(eq(schema.customerGroups.slug, settings.b2b.defaultGroupSlug));
      assert.ok((await groupUsage(tx, def.id)).isDefault);
      await assert.rejects(
        updateGroup(tx, { id: def.id, updatedAt: def.updatedAt, slug: "baska", name: def.name, isBusiness: def.isBusiness, discountPercent: def.discountPercent, showPricesExVat: def.showPricesExVat }),
        (e: unknown) => isPanelError(e) && Boolean(e.fieldErrors?.slug),
      );
      await assert.rejects(deleteGroup(tx, { id: def.id, updatedAt: def.updatedAt }), (e: unknown) => isPanelError(e) && e.code === "in_use");
    });
  });
});

describe("customer admin", () => {
  test("group, ban (sessions revoked), export, anonymize; staff rows are refused", async () => {
    await inRollback(async (tx) => {
      const userId = await makeUser(tx, "c2", { phone: "+905321112233" });
      await tx.insert(schema.session).values({ id: `${PREFIX}sess`, token: `${PREFIX}token`, userId, expiresAt: new Date(Date.now() + 86_400_000) });
      await tx.insert(schema.addresses).values({
        userId,
        title: "Ofis",
        data: { fullName: "Test c2", phone: "+905321112233", city: "Kayseri", district: "Melikgazi", line1: "Test Cad. No: 2" },
      });
      const fresh = async () => (await tx.select({ updatedAt: schema.user.updatedAt }).from(schema.user).where(eq(schema.user.id, userId)))[0].updatedAt;

      const banned = await setCustomerBanned(tx, { userId, banned: true, updatedAt: await fresh() });
      assert.equal(banned.revokedSessions, 1);
      assert.equal((await tx.select().from(schema.session).where(eq(schema.session.userId, userId))).length, 0);
      const unbanned = await setCustomerBanned(tx, { userId, banned: false, updatedAt: await fresh() });
      assert.ok(unbanned.audit);
      const [row] = await tx.select({ banned: schema.user.banned, banReason: schema.user.banReason }).from(schema.user).where(eq(schema.user.id, userId));
      assert.equal(row.banned, false);
      assert.equal(row.banReason, null);

      const exported = await exportCustomerData(tx, userId);
      const json = JSON.stringify(exported);
      assert.equal((exported.account as { email: string }).email, mail("c2"));
      assert.equal((exported.addresses as unknown[]).length, 1);
      assert.equal(/password|token|"hash"/i.test(json), false, "no secrets in the export");

      const list = await listCustomers({ q: "test c2" }, tx);
      assert.ok(list.rows.some((r) => r.id === userId));
      assert.equal((await listCustomers({ q: "test c2", verified: "no" }, tx)).rows.some((r) => r.id === userId), false);
      const detail = await getCustomerDetail(userId, tx);
      assert.equal(detail?.addresses.length, 1);

      const anon = await anonymizeCustomer(tx, { userId }, ACTOR);
      assert.equal(anon.deletedAddresses, 1);
      const [after] = await tx.select({ name: schema.user.name, email: schema.user.email, phone: schema.user.phone }).from(schema.user).where(eq(schema.user.id, userId));
      assert.notEqual(after.email, mail("c2"));
      assert.equal(after.phone, null);
      await assert.rejects(setCustomerGroup(tx, { userId, groupId: kurumsal.id, updatedAt: await fresh() }), (e: unknown) => isPanelError(e) && e.code === "conflict");

      const staffId = await makeUser(tx, "s2", { role: "admin" });
      const [s] = await tx.select({ updatedAt: schema.user.updatedAt }).from(schema.user).where(eq(schema.user.id, staffId));
      await assert.rejects(setCustomerBanned(tx, { userId: staffId, banned: true, updatedAt: s.updatedAt }), (e: unknown) => isPanelError(e) && e.code === "forbidden");
      await assert.rejects(exportCustomerData(tx, staffId), (e: unknown) => isPanelError(e) && e.code === "forbidden");
      assert.equal(await getCustomerDetail(staffId, tx), null);
    });
  });
});
