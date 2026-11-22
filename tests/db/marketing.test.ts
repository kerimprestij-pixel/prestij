// MARKETING against the local PostgreSQL: campaign, coupon and newsletter services (through the real
// action schemas and executePanelAction), the affected-price preview, the CSV export and the
// display ↔ cart parity on a real cart. Every row it creates is removed again (the parity cart lives in
// a rolled-back transaction); the final hook checks counts and puts the id sequences back.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/marketing.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, asc, eq, inArray, like, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { campaignDisplayPrice, isCampaignLive, pickDisplayCampaign } from "@/lib/campaigns/pick";
import { loadCart } from "@/lib/cart/load";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { totalsForLoadedCart } from "@/lib/cart/totals";
import { RETAIL_CUSTOMER } from "@/lib/cart/types";
import { executePanelAction } from "@/lib/panel/action-core";
import { isPanelError } from "@/lib/panel/errors";
import { createCampaign, deleteCampaign, previewCampaign, setCampaignActive, updateCampaign } from "@/lib/panel/marketing/campaigns";
import { createCoupon, deleteCoupon, setCouponActive, updateCoupon } from "@/lib/panel/marketing/coupons";
import { deleteSubscriber, exportSubscribersCsv, listSubscribers, unsubscribeSubscriber } from "@/lib/panel/marketing/newsletter";
import { campaignCreateSchema, campaignUpdateSchema, couponCreateSchema, couponUpdateSchema, type CampaignCreateInput } from "@/lib/panel/marketing/schemas";
import type { StaffSession } from "@/lib/session";

const ACTOR_ID = "marketing-test-actor";
const ACTOR = {
  user: { id: ACTOR_ID, name: "Marketing Test", email: "marketing@test.local", role: "editor", banned: false },
  session: { id: "marketing-test-session" },
  staffRole: "editor",
} as unknown as StaffSession;
const NAME = "marketing-test"; // campaign name prefix owned by this file
const CODE = "MKTTEST"; // coupon code prefix owned by this file
const MAIL = "marketing-test"; // subscriber e-mail prefix owned by this file (…@test.local)

const COUNT_TABLES = ["campaigns", "coupons", "newsletter_subscribers", "audit_log", "carts", "cart_items"] as const;
const SEQ_TABLES = ["campaigns", "coupons", "newsletter_subscribers", "audit_log", "cart_items"] as const;
type SeqState = { table: string; name: string; lastValue: string; isCalled: boolean };
let counts: Record<string, number>;
let sequences: SeqState[] = [];

async function countRows(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of COUNT_TABLES) {
    const rows = await db.execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${t}`));
    out[t] = Number(rows[0].n);
  }
  return out;
}

async function readSequences(): Promise<SeqState[]> {
  const out: SeqState[] = [];
  for (const table of SEQ_TABLES) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    out.push({ table, name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
  return out;
}

/** Puts the id sequences back, unless someone else inserted rows meanwhile (other agents share the DB). */
async function restoreSequences() {
  for (const s of sequences) {
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${s.table}`));
    if (max === null || Number(max) <= Number(s.lastValue)) {
      await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
  }
}

async function cleanup() {
  await db.delete(schema.campaigns).where(like(schema.campaigns.name, `${NAME}%`));
  await db.delete(schema.coupons).where(like(schema.coupons.code, `${CODE}%`));
  await db.delete(schema.newsletterSubscribers).where(like(schema.newsletterSubscribers.email, `${MAIL}%@test.local`));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
}

/** Runs a service in a transaction and returns its PanelError (or fails when none is thrown). */
async function rejects(fn: (tx: typeof db) => Promise<unknown>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as typeof db);
    });
  } catch (error) {
    if (isPanelError(error)) return error;
    throw error;
  }
  assert.fail("expected a PanelError");
}

const campaignInput = (overrides: Partial<Record<keyof CampaignCreateInput, unknown>> = {}): CampaignCreateInput =>
  campaignCreateSchema.parse({
    name: `${NAME} kampanya`,
    label: { tr: "Test İndirimi", en: "Test Sale" },
    discountPercent: 15,
    productIds: [],
    categoryIds: [],
    customerGroupIds: [],
    schedule: { startsAt: null, endsAt: null },
    priority: 0,
    isActive: true,
    themeId: null,
    ...overrides,
  });

let product: { id: number; categoryId: number | null };
let variants: { id: number; price: number; compareAtPrice: number | null }[];
let sampleProductId: number | null;

before(async () => {
  await cleanup();
  counts = await countRows();
  sequences = await readSequences();
  const { products: p, productVariants: v } = schema;
  const [first] = await db
    .select({ id: p.id, categoryId: p.categoryId })
    .from(p)
    .where(and(eq(p.status, "active"), eq(p.type, "standard")))
    .orderBy(asc(p.position), asc(p.id))
    .limit(1);
  assert.ok(first, "an active standard product exists (seed)");
  product = first;
  variants = await db
    .select({ id: v.id, price: v.price, compareAtPrice: v.compareAtPrice })
    .from(v)
    .where(and(eq(v.productId, product.id), eq(v.isActive, true)))
    .orderBy(asc(v.position), asc(v.id));
  assert.ok(variants.length > 0);
  const [sample] = await db.select({ id: p.id }).from(p).where(eq(p.type, "sample")).limit(1);
  sampleProductId = sample?.id ?? null;
});

after(async () => {
  await cleanup();
  await restoreSequences();
  try {
    assert.deepEqual(await countRows(), counts, "row counts are back to the start");
  } finally {
    await db.$client.end();
  }
});

describe("campaigns", () => {
  test("schema: percent 1–90, end after start, Turkish messages at dotted paths", async () => {
    const { result } = await executePanelAction(
      { schema: campaignCreateSchema, run: async () => ({}) },
      ACTOR,
      { name: "", discountPercent: 95, productIds: [], categoryIds: [], customerGroupIds: [], schedule: { startsAt: "2026-12-10T10:00", endsAt: "2026-12-01T10:00" }, priority: 0, isActive: true },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.fieldErrors?.discountPercent, "Yüzde en fazla 90 olabilir.");
    assert.equal(result.fieldErrors?.["schedule.endsAt"], "Bitiş zamanı başlangıçtan sonra olmalı.");
    assert.match(result.fieldErrors?.name ?? "", /Kampanyaya bir ad verin/);
  });

  test("create → update (locked by updatedAt) → stop → delete, with audit and tags", async () => {
    const { result: created, tags } = await executePanelAction(
      { schema: campaignCreateSchema, run: async (input, { tx }) => {
        const r = await createCampaign(tx, input);
        return { data: { id: r.id, updatedAt: r.updatedAt.toISOString() }, tags: r.tags, audit: r.audit };
      } },
      ACTOR,
      { name: `${NAME} bir`, label: { tr: "Bahar", en: "", ar: "" }, discountPercent: 15, productIds: [product.id, product.id], categoryIds: [], customerGroupIds: [], schedule: { startsAt: null, endsAt: null }, priority: 3, isActive: true, themeId: null },
    );
    assert.equal(created.ok, true);
    assert.deepEqual(tags, ["campaigns"]);
    const { id, updatedAt } = (created as { data: { id: number; updatedAt: string } }).data;
    const [row] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
    assert.deepEqual(row.productIds, [product.id], "duplicate ids collapse");
    assert.deepEqual(row.label, { tr: "Bahar" }, "empty translations are dropped");
    assert.equal(row.categoryIds, null, "empty lists are stored as null (= all)");

    // A stale updatedAt is a conflict.
    const stale = await rejects((tx) => updateCampaign(tx, campaignUpdateSchema.parse({ ...campaignInput(), id, updatedAt: "2020-01-01T00:00:00.000Z" })));
    assert.equal(stale.code, "conflict");

    const update = campaignUpdateSchema.parse({ ...campaignInput({ name: `${NAME} iki`, discountPercent: 20, productIds: [product.id] }), id, updatedAt });
    const saved = await db.transaction((tx) => updateCampaign(tx, update));
    assert.deepEqual(saved.audit.after, { name: `${NAME} iki`, label: { tr: "Test İndirimi", en: "Test Sale" }, discountPercent: 20, priority: 0 });

    const stopped = await db.transaction((tx) => setCampaignActive(tx, { id, isActive: false, updatedAt: saved.updatedAt }));
    assert.deepEqual(stopped.audit.after, { isActive: false });
    const removed = await db.transaction((tx) => deleteCampaign(tx, { id, updatedAt: stopped.updatedAt }));
    assert.equal(removed.audit.action, "delete");
    assert.equal((await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id))).length, 0);
    const audits = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.userId, ACTOR_ID), eq(schema.auditLog.entity, "campaign")));
    assert.ok(audits.length >= 1, "executePanelAction wrote the create audit row");
  });

  test("references are re-checked on the server", async () => {
    const missing = await rejects((tx) => createCampaign(tx, campaignInput({ productIds: [2_000_000_000] })));
    assert.equal(missing.fieldErrors?.productIds !== undefined, true);
    const group = await rejects((tx) => createCampaign(tx, campaignInput({ customerGroupIds: [2_000_000_000] })));
    assert.ok(group.fieldErrors?.customerGroupIds);
    if (sampleProductId != null) {
      const sample = await rejects((tx) => createCampaign(tx, campaignInput({ productIds: [sampleProductId] })));
      assert.match(sample.fieldErrors?.productIds ?? "", /Numune/);
    }
    const [defaultTheme] = await db.select({ id: schema.themes.id }).from(schema.themes).where(eq(schema.themes.isDefault, true)).limit(1);
    if (defaultTheme) {
      const theme = await rejects((tx) => createCampaign(tx, campaignInput({ themeId: defaultTheme.id })));
      assert.ok(theme.fieldErrors?.themeId);
    }
  });

  test("a linked theme also invalidates the theme tag", async () => {
    const [other] = await db.select({ id: schema.themes.id }).from(schema.themes).where(eq(schema.themes.isDefault, false)).limit(1);
    if (!other) return;
    const created = await db.transaction((tx) => createCampaign(tx, campaignInput({ name: `${NAME} tema`, themeId: other.id })));
    assert.deepEqual(created.tags, ["campaigns", "theme"]);
    const removed = await db.transaction((tx) => deleteCampaign(tx, { id: created.id }));
    assert.deepEqual(removed.tags, ["campaigns", "theme"]);
  });

  test("preview: same matching and rounding as the cart, rivals flagged", async () => {
    const preview = await previewCampaign(db, campaignPreview({ productIds: [product.id] }));
    assert.equal(preview.everything, false);
    assert.equal(preview.productCount, 1);
    assert.equal(preview.variantCount, variants.length);
    for (const [i, row] of preview.rows.entries()) {
      assert.equal(row.variantId, variants[i].id);
      assert.equal(row.oldPrice, variants[i].price);
      assert.equal(row.newPrice, campaignDisplayPrice({ price: variants[i].price }, 15).unitPrice);
      assert.equal(row.overriddenBy, null);
    }

    const all = await previewCampaign(db, campaignPreview({}));
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.productVariants)
      .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
      .where(and(eq(schema.products.status, "active"), ne(schema.products.type, "sample"), eq(schema.productVariants.isActive, true)));
    assert.equal(all.everything, true);
    assert.equal(all.variantCount, n);

    // A higher-priority campaign on the same product wins over the draft.
    const rival = await db.transaction((tx) =>
      createCampaign(tx, campaignInput({ name: `${NAME} rakip`, discountPercent: 5, priority: 9, productIds: [product.id], schedule: { startsAt: "2026-01-01T00:00:00.000Z", endsAt: null } })),
    );
    try {
      const contested = await previewCampaign(db, campaignPreview({ productIds: [product.id], priority: 1 }));
      assert.equal(contested.overriddenProductCount, 1);
      assert.deepEqual(contested.rows[0].overriddenBy, { id: rival.id, name: `${NAME} rakip`, percent: 5 });
      // …unless their windows never overlap (the draft ended before the rival starts).
      const later = await previewCampaign(db, campaignPreview({ productIds: [product.id], priority: 1, schedule: { startsAt: null, endsAt: new Date("2000-01-01T00:00:00Z") } }));
      assert.equal(later.overriddenProductCount, 0);
      // The draft itself is not its own rival when editing.
      const self = await previewCampaign(db, campaignPreview({ id: rival.id, productIds: [product.id], priority: 1 }));
      assert.equal(self.overriddenProductCount, 0);
    } finally {
      await db.delete(schema.campaigns).where(eq(schema.campaigns.id, rival.id));
    }
  });

  test("parity on a real cart: storefront price == cart unit price for the same campaign rows", async () => {
    const settings = await loadCommerceSettings();
    const ROLLBACK = new Error("rollback");
    let checked = 0;
    await db
      .transaction(async (tx) => {
        await createCampaign(tx, campaignInput({ name: `${NAME} parite`, discountPercent: 15, productIds: [product.id] }));
        // An inactive and a group-only campaign with higher priority must not change the retail price.
        await createCampaign(tx, campaignInput({ name: `${NAME} pasif`, discountPercent: 50, priority: 9, isActive: false }));
        const [group] = await tx.select({ id: schema.customerGroups.id }).from(schema.customerGroups).limit(1);
        if (group) await createCampaign(tx, campaignInput({ name: `${NAME} grup`, discountPercent: 40, priority: 9, customerGroupIds: [group.id] }));

        // What getActiveCampaigns selects (active rows, priority desc, id asc), filtered by window.
        const c = schema.campaigns;
        const now = new Date();
        const rows = await tx
          .select({ id: c.id, label: c.label, percent: c.discountPercent, priority: c.priority, productIds: c.productIds, categoryIds: c.categoryIds, customerGroupIds: c.customerGroupIds, themeId: c.themeId, startsAt: c.startsAt, endsAt: c.endsAt })
          .from(c)
          .where(eq(c.isActive, true))
          .orderBy(sql`${c.priority} desc`, asc(c.id));
        const live = rows.filter((r) => isCampaignLive(r, now.getTime()));
        const hit = pickDisplayCampaign(live, { productId: product.id, categoryId: product.categoryId }, now.getTime());
        assert.equal(hit?.percent, 15);

        const cartId = randomUUID();
        await tx.insert(schema.carts).values({ id: cartId, locale: "tr" });
        for (const variant of variants) await tx.insert(schema.cartItems).values({ cartId, variantId: variant.id, quantity: 1 });
        const loaded = await loadCart(cartId, RETAIL_CUSTOMER, { executor: tx, now });
        const totals = totalsForLoadedCart(loaded, settings, { now });
        for (const variant of variants) {
          const line = totals.lines.find((l) => l.variantId === variant.id);
          assert.ok(line, `line for variant ${variant.id}`);
          if (!line.included) continue; // out of stock in the shared DB: nothing to compare
          const shown = campaignDisplayPrice(variant, hit?.percent);
          assert.equal(line.unitPrice, shown.unitPrice, `variant ${variant.id}`);
          assert.equal(line.compareAt, shown.compareAt ?? null, `variant ${variant.id} compareAt`);
          checked++;
        }
        throw ROLLBACK;
      })
      .catch((error) => {
        if (error !== ROLLBACK) throw error;
      });
    assert.ok(checked > 0, "at least one variant compared");
  });
});

describe("coupons", () => {
  const couponPayload = (overrides: Record<string, unknown> = {}) => ({
    code: `${CODE}10`,
    description: "Test kuponu",
    type: "percent",
    value: 10,
    minOrderTotal: 0,
    maxUses: null,
    perCustomerLimit: 1,
    productIds: [],
    categoryIds: [],
    customerGroupIds: [],
    schedule: { startsAt: null, endsAt: null },
    isActive: true,
    ...overrides,
  });

  test("schema: code normalised and validated, value checked against the type", () => {
    const parsed = couponCreateSchema.parse(couponPayload({ code: ` ${CODE.toLowerCase()} 10 ` }));
    assert.equal(parsed.code, `${CODE}10`);
    assert.equal(couponCreateSchema.parse(couponPayload({ type: "free_shipping", value: 99 })).value, 0);
    assert.equal(couponCreateSchema.parse(couponPayload({ type: "fixed", value: "50,00" })).value, 5000);
    const bad = couponCreateSchema.safeParse(couponPayload({ code: "ŞEKER", value: 0 }));
    assert.equal(bad.success, false);
    const paths = bad.success ? [] : bad.error.issues.map((i) => i.path.join("."));
    assert.ok(paths.includes("code"));
    const percent = couponCreateSchema.safeParse(couponPayload({ value: 0 }));
    assert.deepEqual(percent.success ? [] : percent.error.issues.map((i) => i.path.join(".")), ["value"]);
  });

  test("create, case-insensitive uniqueness, edit, deactivate, delete only when unused", async () => {
    const created = await db.transaction((tx) => createCoupon(tx, couponCreateSchema.parse(couponPayload())));
    const duplicate = await rejects((tx) => createCoupon(tx, couponCreateSchema.parse(couponPayload({ code: `${CODE.toLowerCase()}10` }))));
    assert.match(duplicate.fieldErrors?.code ?? "", /başka bir kuponda/);

    const edited = await db.transaction((tx) =>
      updateCoupon(tx, couponUpdateSchema.parse({ ...couponPayload({ code: `${CODE}20`, value: 20, maxUses: 5 }), id: created.id, updatedAt: created.updatedAt.toISOString() })),
    );
    assert.equal(edited.code, `${CODE}20`);
    assert.deepEqual(edited.audit.after, { code: `${CODE}20`, value: 20, maxUses: 5 });

    // Used coupons: the limit cannot drop below the usage and the coupon cannot be deleted.
    await db.update(schema.coupons).set({ usedCount: 3, updatedAt: edited.updatedAt }).where(eq(schema.coupons.id, created.id));
    const lowLimit = await rejects((tx) =>
      updateCoupon(tx, couponUpdateSchema.parse({ ...couponPayload({ code: `${CODE}20`, maxUses: 2 }), id: created.id, updatedAt: edited.updatedAt.toISOString() })),
    );
    assert.ok(lowLimit.fieldErrors?.maxUses);
    const inUse = await rejects((tx) => deleteCoupon(tx, { id: created.id }));
    assert.equal(inUse.code, "in_use");

    const off = await db.transaction((tx) => setCouponActive(tx, { id: created.id, isActive: false, updatedAt: edited.updatedAt }));
    assert.deepEqual(off.audit.after, { isActive: false });

    await db.update(schema.coupons).set({ usedCount: 0 }).where(eq(schema.coupons.id, created.id));
    const removed = await db.transaction((tx) => deleteCoupon(tx, { id: created.id }));
    assert.equal(removed.audit.action, "delete");
    assert.equal((await db.select().from(schema.coupons).where(eq(schema.coupons.id, created.id))).length, 0);
  });
});

describe("newsletter", () => {
  test("list, unsubscribe, KVKK delete and CSV export (BOM, Turkish text, no e-mail in the audit)", async () => {
    const email = `${MAIL}-${randomBytes(3).toString("hex")}@test.local`;
    const [row] = await db
      .insert(schema.newsletterSubscribers)
      .values({ email, locale: "tr", source: "footer", unsubscribeToken: randomBytes(24).toString("base64url") })
      .returning({ id: schema.newsletterSubscribers.id });

    const listed = await listSubscribers(db, { q: email.slice(0, 20), status: "active", source: "footer", locale: "tr" });
    assert.ok(listed.rows.some((r) => r.id === row.id));
    assert.equal(listed.stats.all >= 1, true);

    const { csv, rows } = await exportSubscribersCsv(db, { q: email, status: null, source: null, locale: null });
    assert.equal(rows, 1);
    assert.ok(csv.startsWith("﻿E-posta;Durum;Dil;Kaynak;İzin tarihi;İYS'ye aktarıldı;Kayıt tarihi;Son değişiklik\r\n"));
    assert.match(csv, new RegExp(`${email.replace(/[.]/g, "\\.")};Aktif;Türkçe;Alt bilgi;\\d{2}\\.\\d{2}\\.\\d{4} \\d{2}:\\d{2};Hayır;`));
    assert.ok(csv.endsWith("\r\n"));

    const unsub = await db.transaction((tx) => unsubscribeSubscriber(tx, row.id));
    assert.equal(unsub.changed, true);
    const again = await db.transaction((tx) => unsubscribeSubscriber(tx, row.id));
    assert.equal(again.changed, false);
    const [after] = await db.select({ status: schema.newsletterSubscribers.status }).from(schema.newsletterSubscribers).where(eq(schema.newsletterSubscribers.id, row.id));
    assert.equal(after.status, "unsubscribed");

    const erased = await db.transaction((tx) => deleteSubscriber(tx, row.id));
    assert.equal(JSON.stringify(erased.audit).includes(email), false, "no e-mail in the audit entry");
    assert.equal(JSON.stringify(unsub.audit).includes(email), false);
    assert.equal((await db.select().from(schema.newsletterSubscribers).where(inArray(schema.newsletterSubscribers.id, [row.id]))).length, 0);
    const missing = await rejects((tx) => deleteSubscriber(tx, row.id));
    assert.equal(missing.code, "not_found");
  });
});

function campaignPreview(overrides: Partial<{ id: number | null; productIds: number[]; categoryIds: number[]; customerGroupIds: number[]; priority: number; schedule: { startsAt: Date | null; endsAt: Date | null } }>) {
  return {
    id: null,
    discountPercent: 15,
    productIds: [],
    categoryIds: [],
    customerGroupIds: [],
    schedule: { startsAt: null, endsAt: null },
    priority: 0,
    ...overrides,
  };
}
