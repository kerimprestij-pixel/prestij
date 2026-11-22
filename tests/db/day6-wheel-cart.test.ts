// Day 6 WHEEL-CART against the local PostgreSQL:
//   - auto-apply: a signed-in owner's usable prize lands on a cart without a code when a product is added,
//     when a quantity grows and when the buyer removes another code; never over a typed code; kept below
//     its minimum or without benefit; a prize the buyer took off stays off until the basket grows;
//   - a dead wheel code (expired, below its minimum) is released from the cart without changing the cart
//     revision, a typed code never is;
//   - the owner check through the cart API and in placeOrder (another account and a guest are refused);
//   - cartWheelPrize statuses and the spin label; getBestWheelCode;
//   - panel: Kuponlar lists manual codes only, a prize opens read-only, edits / deletes / re-activation
//     are refused, deactivation works and stops the auto-apply.
// Everything but the placeOrder block runs inside rolled-back transactions (the cart mutations join them
// as savepoints through MutationContext.executor). The placeOrder block commits its few rows (placeOrder
// opens its own transaction) and deletes them again. Test data: day6-test-wcart-… users (…@test.local),
// DAY6TEST-WC-… codes. Advanced id sequences are put back and the touched tables compared.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day6-wheel-cart.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadCart } from "@/lib/cart/load";
import { addItem, applyCouponCode, releaseDeadWheelCode, removeCouponCode, setItemQuantity, type MutationContext } from "@/lib/cart/mutations";
import { loadCommerceSettings, type CommerceSettings, type DbExecutor } from "@/lib/cart/settings";
import { cartRevision, totalsForLoadedCart } from "@/lib/cart/totals";
import { RETAIL_CUSTOMER, type CustomerContext } from "@/lib/cart/types";
import { buildCartView } from "@/lib/cart/view";
import { cartWheelPrize, getBestWheelCode } from "@/lib/cart/wheel-prize";
import { defaultMessages } from "@/i18n/messages";
import { placeOrder } from "@/lib/orders/place";
import { deleteCoupon, setCouponActive, updateCoupon, WHEEL_COUPON_READ_ONLY } from "@/lib/panel/marketing/coupons";
import { findCouponByCode, getPanelCoupon, getWheelCouponDetail, listPanelCoupons } from "@/lib/panel/marketing/queries";
import { couponUpdateSchema } from "@/lib/panel/marketing/schemas";
import type { Tx } from "@/lib/panel/tx";

const RUN = randomBytes(3).toString("hex");
const CODE = (tag: string) => `DAY6TEST-WC-${RUN}-${tag}`.toUpperCase();
const USER_A = `day6-test-wcart-a-${RUN}`;
const USER_B = `day6-test-wcart-b-${RUN}`;
const OWNER: CustomerContext = { ...RETAIL_CUSTOMER, userId: USER_A };
const OTHER: CustomerContext = { ...RETAIL_CUSTOMER, userId: USER_B };
const HOUR = 3600_000;

class Rollback extends Error {}
async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

type Seq = { last_value: string; is_called: boolean };
const SEQUENCES = ["coupons_id_seq", "cart_items_id_seq", "wheel_spins_id_seq"] as const;
/** Tables these tests write that the live site does not write while someone browses (carts do change: checked by prefix). */
const SNAPSHOT_TABLES = ["coupons", "wheel_spins", "orders"] as const;
const seqBefore = new Map<string, Seq>();
const tablesBefore = new Map<string, string>();
const readSeq = async (name: string): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from ${name}`));
  return { last_value: row.last_value, is_called: row.is_called };
};
const tableHash = async (table: string): Promise<string> => {
  const [row] = await db.execute<{ h: string }>(sql.raw(`select count(*)::text || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as h from "${table}" t`));
  return row.h;
};

let settings: CommerceSettings;
let variant: { id: number; price: number };

before(async () => {
  for (const name of SEQUENCES) seqBefore.set(name, await readSeq(name));
  for (const t of SNAPSHOT_TABLES) tablesBefore.set(t, await tableHash(t));
  settings = await loadCommerceSettings();
  const [row] = await db.execute<{ id: number; price: number }>(
    sql`select v.id, v.price from product_variants v join products p on p.id = v.product_id
        where p.status = 'active' and p.type = 'standard' and not p.business_only and v.is_active
          and v.price > 0 and v.price * 3 < ${settings.shipping.freeThreshold} and v.min_quantity <= 1
          and (v.max_quantity is null or v.max_quantity >= 5) and (not v.track_stock or v.allow_backorder or v.stock >= 50)
        order by v.price, v.id limit 1`,
  );
  assert.ok(row, "a buyable standard variant well below the free-shipping threshold");
  variant = { id: Number(row.id), price: Number(row.price) };
  const [left] = await db.execute<{ coupons: string; users: string }>(
    sql`select (select count(*) from coupons where code like 'DAY6TEST-WC-%')::text as coupons, (select count(*) from "user" where id like 'day6-test-wcart-%')::text as users`,
  );
  assert.deepEqual({ ...left }, { coupons: "0", users: "0" }, "nothing left over from an earlier run");
});

after(async () => {
  try {
    for (const name of SEQUENCES) {
      const seq = seqBefore.get(name)!;
      const table = name.replace(/_id_seq$/, "");
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${table}`));
      if (max === null || Number(max) <= Number(seq.last_value)) {
        await db.execute(sql`select setval(${name}::regclass, ${seq.last_value}::bigint, ${seq.is_called})`);
      }
      assert.deepEqual(await readSeq(name), seq, `${name} restored`);
    }
    for (const t of SNAPSHOT_TABLES) assert.equal(await tableHash(t), tablesBefore.get(t), `${t} unchanged`);
    const [own] = await db.execute<{ users: string; carts: string }>(
      sql`select (select count(*) from "user" where id like 'day6-test-wcart-%')::text as users, (select count(*) from carts where user_id like 'day6-test-wcart-%')::text as carts`,
    );
    assert.deepEqual({ ...own }, { users: "0", carts: "0" }, "no test users or carts left");
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------

async function users(tx: Tx) {
  await tx.insert(schema.user).values([
    { id: USER_A, name: "Day6 WCart A", email: `${USER_A}@test.local` },
    { id: USER_B, name: "Day6 WCart B", email: `${USER_B}@test.local` },
  ]);
}

async function prizeCoupon(tx: Tx, tag: string, over: Partial<typeof schema.coupons.$inferInsert> = {}) {
  const [row] = await tx
    .insert(schema.coupons)
    .values({
      code: CODE(tag),
      type: "percent",
      value: 10,
      source: "wheel",
      userId: USER_A,
      maxUses: 1,
      perCustomerLimit: 1,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 72 * HOUR),
      ...over,
    })
    .returning({ id: schema.coupons.id, code: schema.coupons.code, updatedAt: schema.coupons.updatedAt });
  return row;
}

async function manualCoupon(tx: Tx, tag: string, over: Partial<typeof schema.coupons.$inferInsert> = {}) {
  const [row] = await tx
    .insert(schema.coupons)
    .values({ code: CODE(tag), type: "percent", value: 5, ...over })
    .returning({ id: schema.coupons.id, code: schema.coupons.code });
  return row;
}

const ctx = (customer: CustomerContext, tx: Tx, s: CommerceSettings = settings): MutationContext => ({
  customer,
  locale: "tr",
  settings: s,
  executor: tx as unknown as DbExecutor,
});

async function stored(tx: Tx, cartId: string): Promise<string | null> {
  const [row] = await tx.select({ code: schema.carts.couponCode }).from(schema.carts).where(eq(schema.carts.id, cartId));
  return row?.code ?? null;
}

async function state(tx: Tx, cartId: string | null, customer: CustomerContext = OWNER, s: CommerceSettings = settings) {
  const now = new Date();
  const loaded = await loadCart(cartId, customer, { executor: tx, now });
  const totals = totalsForLoadedCart(loaded, s, { now });
  const prize = await cartWheelPrize(tx, { loaded, totals, settings: s, now });
  return { loaded, totals, prize, revision: cartRevision(totals) };
}

function cartIdOf(r: Awaited<ReturnType<typeof addItem>>): string {
  assert.ok(r.ok, `cart write failed: ${JSON.stringify(r)}`);
  return r.cartId;
}

// ---------------------------------------------------------------------------------------------------

describe("auto-apply on addItem", () => {
  test("the owner's prize lands on a new cart; guests and other accounts get nothing", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      const prize = await prizeCoupon(tx, "a10");
      const r = await addItem(null, { variantId: variant.id, quantity: 1 }, ctx(OWNER, tx));
      const cartId = cartIdOf(r);
      assert.equal(r.ok && r.autoApplied, prize.code);
      assert.equal(await stored(tx, cartId), prize.code);
      const s = await state(tx, cartId);
      assert.equal(s.totals.coupon?.status, "applied");
      assert.equal(s.prize?.status, "applied");
      assert.equal(s.prize?.code, prize.code);
      assert.ok(s.revision.endsWith(`|${prize.code}`), "the applied prize is part of the revision");
      for (const customer of [RETAIL_CUSTOMER, OTHER]) {
        const g = await addItem(null, { variantId: variant.id, quantity: 1 }, ctx(customer, tx));
        const gid = cartIdOf(g);
        assert.equal(g.ok && g.autoApplied, undefined, String(customer.userId));
        assert.equal(await stored(tx, gid), null);
        assert.equal((await state(tx, gid, customer)).prize, null);
      }
    });
  });

  test("never over a typed code; removing that code brings the prize in; a prize taken off stays off until the basket grows", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      const prize = await prizeCoupon(tx, "b10");
      const typed = await manualCoupon(tx, "b5");
      // The cart gets the typed code before the owner touches it (created as a guest, then the owner's session).
      const cartId = cartIdOf(await addItem(null, { variantId: variant.id, quantity: 1 }, ctx(RETAIL_CUSTOMER, tx)));
      assert.ok((await applyCouponCode(cartId, { code: typed.code }, ctx(OWNER, tx))).ok);

      const more = await addItem(cartId, { variantId: variant.id, quantity: 1 }, ctx(OWNER, tx));
      assert.equal(more.ok && more.autoApplied, undefined);
      assert.equal(await stored(tx, cartId), typed.code, "the buyer's code stays");
      assert.equal((await state(tx, cartId)).prize?.status, "other_code");

      const removed = await removeCouponCode(cartId, ctx(OWNER, tx));
      assert.equal(removed.ok && removed.autoApplied, prize.code, "removing the other code brings the prize in");
      assert.equal(await stored(tx, cartId), prize.code);

      const off = await removeCouponCode(cartId, ctx(OWNER, tx));
      assert.equal(off.ok && off.autoApplied, undefined, "removing the prize itself brings nothing back");
      assert.equal(await stored(tx, cartId), null);
      assert.equal((await state(tx, cartId)).prize?.status, "ready", "the cart offers to apply it again");

      const lineId = (await state(tx, cartId)).loaded.lines[0].lineId;
      const fewer = await setItemQuantity(cartId, { lineId, quantity: 1 }, ctx(OWNER, tx));
      assert.equal(fewer.ok && fewer.autoApplied, undefined, "a shrinking basket does not re-apply it");
      const grown = await addItem(cartId, { variantId: variant.id, quantity: 1 }, ctx(OWNER, tx));
      assert.equal(grown.ok && grown.autoApplied, prize.code, "the next growth of the basket does (documented)");
    });
  });

  test("below its minimum the prize is kept, lands when the quantity grows past it, and leaves when the cart falls below", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      const min = variant.price + 1;
      const prize = await prizeCoupon(tx, "c20", { value: 20, minOrderTotal: min });
      const r = await addItem(null, { variantId: variant.id, quantity: 1 }, ctx(OWNER, tx));
      const cartId = cartIdOf(r);
      assert.equal(r.ok && r.autoApplied, undefined);
      assert.equal(await stored(tx, cartId), null);
      const kept = await state(tx, cartId);
      assert.equal(kept.prize?.status, "min_order");
      const view = buildCartView(kept.totals, kept.loaded, "tr", defaultMessages.tr, { wheelPrize: kept.prize, now: new Date() });
      assert.match(view.wheelPrize?.message ?? "", /otomatik uygulanır/);

      const lineId = kept.loaded.lines[0].lineId;
      const grown = await setItemQuantity(cartId, { lineId, quantity: 2 }, ctx(OWNER, tx));
      assert.equal(grown.ok && grown.autoApplied, prize.code);

      const shrunk = await setItemQuantity(cartId, { lineId, quantity: 1 }, ctx(OWNER, tx));
      assert.equal(shrunk.ok && shrunk.autoApplied, undefined);
      const dead = await state(tx, cartId);
      assert.equal(dead.totals.coupon?.status, "invalid");
      assert.equal(dead.totals.coupon?.reason, "min_order");
      const released = await releaseDeadWheelCode(dead.loaded, dead.totals, tx as unknown as DbExecutor);
      assert.equal(released?.reason, "min_order");
      assert.equal(await stored(tx, cartId), null);
      const after = await state(tx, cartId);
      assert.equal(after.revision, dead.revision, "releasing a dead code never changes the revision");
      assert.equal(after.prize?.status, "min_order", "the prize is kept for the next growth");
    });
  });

  test("no benefit now: free shipping on a cart that already ships free is kept and explained", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      const free: CommerceSettings = { ...settings, shipping: { ...settings.shipping, freeThreshold: 1 } };
      await prizeCoupon(tx, "dfs", { type: "free_shipping", value: 0 });
      const r = await addItem(null, { variantId: variant.id, quantity: 1 }, ctx(OWNER, tx, free));
      const cartId = cartIdOf(r);
      assert.equal(r.ok && r.autoApplied, undefined);
      assert.equal(await stored(tx, cartId), null);
      assert.equal((await state(tx, cartId, OWNER, free)).prize?.status, "no_benefit");
      if (settings.shipping.flatFee > 0) {
        assert.equal((await state(tx, cartId, OWNER, settings)).prize?.status, "ready", "below the threshold it would save the shipping fee");
      }
    });
  });
});

describe("dead wheel codes and the owner check", () => {
  test("an expired prize leaves the cart; a typed code never does; the revision stays", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      const prize = await prizeCoupon(tx, "e10");
      const cartId = cartIdOf(await addItem(null, { variantId: variant.id, quantity: 1 }, ctx(OWNER, tx)));
      assert.equal(await stored(tx, cartId), prize.code);
      await tx.update(schema.coupons).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(schema.coupons.id, prize.id));

      const dead = await state(tx, cartId);
      assert.equal(dead.totals.coupon?.reason, "expired");
      assert.equal(dead.totals.coupon?.source, "wheel");
      const released = await releaseDeadWheelCode(dead.loaded, dead.totals, tx as unknown as DbExecutor);
      assert.equal(released?.reason, "expired");
      assert.equal(await stored(tx, cartId), null);
      const after = await state(tx, cartId);
      assert.equal(after.revision, dead.revision);
      assert.equal(after.prize, null, "no usable prize left");
      assert.equal(await getBestWheelCode(tx as unknown as DbExecutor, USER_A, new Date()), null);

      const typed = await manualCoupon(tx, "e5", { endsAt: new Date(Date.now() - 1000) });
      await tx.update(schema.carts).set({ couponCode: typed.code }).where(eq(schema.carts.id, cartId));
      const typedDead = await state(tx, cartId);
      assert.equal(typedDead.totals.coupon?.reason, "expired");
      assert.equal(await releaseDeadWheelCode(typedDead.loaded, typedDead.totals, tx as unknown as DbExecutor), null);
      assert.equal(await stored(tx, cartId), typed.code, "the buyer sees their own expired code and removes it");
    });
  });

  test("another account's prize: unknown to the cart API, never released for them, never auto-applied", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      const prize = await prizeCoupon(tx, "f10");
      const cartId = cartIdOf(await addItem(null, { variantId: variant.id, quantity: 1 }, ctx(OTHER, tx)));
      for (const customer of [OTHER, RETAIL_CUSTOMER]) {
        const r = await applyCouponCode(cartId, { code: prize.code }, ctx(customer, tx));
        assert.deepEqual(r, { ok: false, cartId, code: "coupon_not_found" }, String(customer.userId));
      }
      // Stored behind the owner's back (e.g. an old merged cart): invalid for B, nothing about it passed on.
      await tx.update(schema.carts).set({ couponCode: prize.code }).where(eq(schema.carts.id, cartId));
      const foreign = await state(tx, cartId, OTHER);
      assert.equal(foreign.totals.coupon?.reason, "not_owner");
      assert.equal(foreign.totals.coupon?.source, undefined);
      assert.equal(foreign.prize, null);
      assert.equal(await releaseDeadWheelCode(foreign.loaded, foreign.totals, tx as unknown as DbExecutor), null);
      const owner = await applyCouponCode(cartId, { code: prize.code }, ctx(OWNER, tx));
      assert.equal(owner.ok, true, "the owner may use it");
    });
  });

  test("cartWheelPrize: the spin's label, the first-expiring prize, 'no_items' without a cart", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      const later = await prizeCoupon(tx, "g72");
      await tx.insert(schema.wheelSpins).values({
        round: 1,
        sliceKey: "indirim-10",
        prize: { type: "percent", value: 10, label: { tr: "%10 indirim", en: "10% off", ar: "خصم 10%" }, minOrderTotal: 0 },
        status: "claimed",
        userId: USER_A,
        boundVia: "signed_in",
        couponId: later.id,
        claimedAt: new Date(),
      });
      const cartId = cartIdOf(await addItem(null, { variantId: variant.id, quantity: 1 }, ctx(OWNER, tx)));
      const applied = await state(tx, cartId);
      assert.equal(applied.prize?.status, "applied");
      assert.deepEqual(applied.prize?.label, { tr: "%10 indirim", en: "10% off", ar: "خصم 10%" });
      const view = buildCartView(applied.totals, applied.loaded, "en", defaultMessages.en, { wheelPrize: applied.prize, now: new Date() });
      assert.equal(view.wheelPrize?.label, "10% off");
      assert.equal(view.wheelPrize?.message, defaultMessages.en.wheel.cart.applied);

      const sooner = await prizeCoupon(tx, "g24", { endsAt: new Date(Date.now() + 24 * HOUR) });
      assert.equal(await getBestWheelCode(tx as unknown as DbExecutor, USER_A, new Date()), sooner.code, "the one that expires first");
      const none = await state(tx, null);
      assert.equal(none.prize?.status, "no_items");
      assert.equal(none.prize?.code, sooner.code);
      assert.equal(none.prize?.label, undefined, "no spin row: the view builds the label from type and value");
      assert.equal(await getBestWheelCode(tx as unknown as DbExecutor, null, new Date()), null);
    });
  });
});

describe("panel: wheel prizes are read-only and stay out of the Kuponlar list", () => {
  test("list, lookup, detail, refusals and deactivation", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      const prize = await prizeCoupon(tx, "h10");
      const manual = await manualCoupon(tx, "h5");
      const ids = (await listPanelCoupons(tx)).map((r) => r.id);
      assert.ok(ids.includes(manual.id), "manual codes are listed");
      assert.ok(!ids.includes(prize.id), "wheel prizes are not");
      assert.equal((await getPanelCoupon(prize.id, tx))?.source, "wheel");
      assert.equal((await getPanelCoupon(manual.id, tx))?.source, "manual");
      assert.deepEqual(await findCouponByCode(` ${prize.code.toLowerCase()} `, tx), { id: prize.id, code: prize.code, source: "wheel" });
      assert.equal(await findCouponByCode("DAY6TEST-WC-NOPE", tx), null);

      const detail = await getWheelCouponDetail(prize.id, tx);
      assert.equal(detail?.status, "active");
      assert.deepEqual(detail?.owner, { id: USER_A, name: "Day6 WCart A", email: `${USER_A}@test.local` });
      assert.deepEqual(detail?.orders, []);
      assert.equal(detail?.spin, null);
      assert.equal(await getWheelCouponDetail(manual.id, tx), null, "only wheel prizes have this page");

      const refused = async (work: () => Promise<unknown>, label: string) => {
        await assert.rejects(work, (error: unknown) => error instanceof Error && error.message === WHEEL_COUPON_READ_ONLY, label);
      };
      const input = couponUpdateSchema.parse({
        id: prize.id,
        updatedAt: prize.updatedAt.toISOString(),
        code: prize.code,
        description: "",
        type: "percent",
        value: 50,
        minOrderTotal: 0,
        maxUses: 5,
        perCustomerLimit: 1,
        productIds: [],
        categoryIds: [],
        customerGroupIds: [],
        schedule: { startsAt: null, endsAt: null },
        isActive: true,
      });
      await refused(() => updateCoupon(tx, input), "edit");
      await refused(() => deleteCoupon(tx, { id: prize.id }), "delete");
      await refused(() => setCouponActive(tx, { id: prize.id, isActive: true, updatedAt: prize.updatedAt }), "re-activate");
      const [unchanged] = await tx.select({ value: schema.coupons.value, maxUses: schema.coupons.maxUses }).from(schema.coupons).where(eq(schema.coupons.id, prize.id));
      assert.deepEqual(unchanged, { value: 10, maxUses: 1 });

      const off = await setCouponActive(tx, { id: prize.id, isActive: false, updatedAt: prize.updatedAt });
      assert.equal(off.audit.entity, "coupon");
      assert.equal((await getWheelCouponDetail(prize.id, tx))?.status, "inactive");
      assert.equal(await getBestWheelCode(tx as unknown as DbExecutor, USER_A, new Date()), null, "a deactivated prize is never auto-applied");
      const r = await addItem(null, { variantId: variant.id, quantity: 1 }, ctx(OWNER, tx));
      assert.equal(r.ok && r.autoApplied, undefined);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// placeOrder opens its own transaction, so this block commits a few rows and deletes them again.

describe("placeOrder: the owner check", () => {
  const cartIds: string[] = [];
  const checkout = (email: string) => ({
    locale: "tr",
    contact: { email, phone: "0532 123 45 67" },
    shippingAddress: { fullName: "Test Alıcı", city: "Kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. Test Sok. No: 1", postalCode: "38010" },
    invoice: { type: "individual", sameAsShipping: true },
    paymentMethod: "cash_on_delivery",
    consents: { preInformation: true, distanceSales: true },
  });

  after(async () => {
    if (cartIds.length) await db.delete(schema.carts).where(inArray(schema.carts.id, cartIds));
    await db.delete(schema.coupons).where(like(schema.coupons.code, `${CODE("")}%`));
    await db.delete(schema.user).where(inArray(schema.user.id, [USER_A, USER_B]));
  });

  test("another account and a guest cannot pay with someone's prize; the owner's cart computes it as applied", async () => {
    await users(db as unknown as Tx);
    const prize = await prizeCoupon(db as unknown as Tx, "p10");
    const [cart] = await db
      .insert(schema.carts)
      .values({ userId: USER_A, locale: "tr", couponCode: prize.code, expiresAt: new Date(Date.now() + 24 * HOUR) })
      .returning({ id: schema.carts.id });
    cartIds.push(cart.id);
    await db.insert(schema.cartItems).values({ cartId: cart.id, variantId: variant.id, quantity: 1 });
    const cod: CommerceSettings = {
      ...settings,
      payments: { ...settings.payments, cashOnDelivery: { ...settings.payments.cashOnDelivery, enabled: true, maxOrderTotal: 0 } },
    };

    const owner = totalsForLoadedCart(await loadCart(cart.id, OWNER), cod);
    assert.equal(owner.coupon?.status, "applied", "valid for its owner");

    for (const [customer, email] of [
      [OTHER, `${USER_B}@test.local`],
      [RETAIL_CUSTOMER, `guest-${RUN}@test.local`],
    ] as const) {
      await db.update(schema.carts).set({ couponCode: prize.code }).where(eq(schema.carts.id, cart.id));
      const r = await placeOrder(checkout(email), { cartId: cart.id, customer, settings: cod, effects: false, allowDraftContracts: true });
      assert.deepEqual(r, { ok: false, code: "coupon_unavailable", fieldErrors: {} }, String(customer.userId));
    }
    const [{ used }] = await db.select({ used: schema.coupons.usedCount }).from(schema.coupons).where(eq(schema.coupons.id, prize.id));
    assert.equal(used, 0, "the prize was not used up");
    const [{ n }] = await db.execute<{ n: string }>(sql`select count(*)::text as n from orders where email like ${`%${RUN}@test.local`}`);
    assert.equal(n, "0", "no order was created");
  });
});
