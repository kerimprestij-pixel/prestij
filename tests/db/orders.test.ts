// Integration tests against the local PostgreSQL (npm run test:db). They create carts, coupons and
// orders, then delete every row they created, put stock back and reset the sequences, so the database
// ends exactly as it started (verified in the final `after` hook).
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addItem, addSampleItem, applyCouponCode, removeItem, setItemQuantity, syncCart } from "@/lib/cart/mutations";
import { findCart, loadCart } from "@/lib/cart/load";
import { loadCommerceSettings, type CommerceSettings } from "@/lib/cart/settings";
import { cartRevision, totalsForLoadedCart } from "@/lib/cart/totals";
import { RETAIL_CUSTOMER, type CustomerContext, type PaymentMethod } from "@/lib/cart/types";
import { bankTransferDeadline } from "@/lib/orders/bank-transfer-deadline";
import { placeOrder, type PlaceOrderResult, type PlaceOrderSuccess } from "@/lib/orders/place";
import { getOrderByToken, getOrderDetail, getOrderLegalSnapshot, listOrders, lookupOrder } from "@/lib/orders/read";
import { expireStalePendingOrders, transitionOrder, type OrderActor } from "@/lib/orders/status";
import { completeCardPayment, getSimulatorSession, initiateCardPayment, simulateCardPayment } from "@/lib/payments";

const DOMAIN = "test.prestij.invalid";
const COUPON_PREFIX = "T2DB";
const NO_EFFECTS = { effects: false } as const;
const STAFF: OrderActor = { userId: null, role: "staff", name: "Test Personel" };
const ADMIN: OrderActor = { userId: null, role: "admin", name: "Test Yönetici" };
const DEFERRED_BUYER: CustomerContext = { ...RETAIL_CUSTOMER, companyApproved: true, allowDeferred: true, deferredDays: 30, isBusiness: true };

const createdCarts = new Set<string>();
const createdOrders = new Set<number>();
let emailSeq = 0;
const email = (tag = "buyer") => `${tag}+${++emailSeq}@${DOMAIN}`;

type Snapshot = {
  stock: Map<number, number>;
  /** Variant updated_at (ISO): stock writes touch it, so cleanup puts it back too. */
  stamps: Map<number, string>;
  counts: Record<string, number>;
  settings: string;
  sequences: { name: string; lastValue: string; isCalled: boolean }[];
};

let snap: Snapshot;
let settings: CommerceSettings;
let havaleSettings: CommerceSettings;
const v: Record<string, { id: number; price: number }> = {};

const COUNT_TABLES = ["orders", "order_items", "payments", "coupons", "carts", "cart_items", "order_events"] as const;
const SEQ_TABLES = ["orders", "order_items", "order_events", "payments", "coupons", "cart_items"] as const;

async function takeSnapshot(): Promise<Snapshot> {
  const stockRows = await db
    .select({ id: schema.productVariants.id, stock: schema.productVariants.stock, updatedAt: sql<string>`${schema.productVariants.updatedAt}::text` })
    .from(schema.productVariants)
    .orderBy(schema.productVariants.id);
  const counts: Record<string, number> = {};
  for (const t of COUNT_TABLES) {
    const rows = await db.execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${t}`));
    counts[t] = Number(rows[0].n);
  }
  const settingsRows = await db.execute<{ s: string }>(sql`select coalesce(json_agg(json_build_object('k', key, 'v', value) order by key)::text, '[]') as s from settings`);
  const sequences: Snapshot["sequences"] = [];
  const names = ["public.order_number_seq"];
  for (const t of SEQ_TABLES) {
    const r = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${t}, 'id') as seq`);
    names.push(r[0].seq);
  }
  for (const name of names) {
    const r = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${name}`));
    sequences.push({ name, lastValue: r[0].last_value, isCalled: r[0].is_called });
  }
  return {
    stock: new Map(stockRows.map((r) => [r.id, r.stock])),
    stamps: new Map(stockRows.map((r) => [r.id, r.updatedAt])),
    counts,
    settings: settingsRows[0].s,
    sequences,
  };
}

async function cleanup() {
  const o = schema.orders;
  const orderIds = (await db.select({ id: o.id }).from(o).where(or(like(o.email, `%@${DOMAIN}`), createdOrders.size ? inArray(o.id, [...createdOrders]) : sql`false`))).map((r) => r.id);
  if (orderIds.length) await db.delete(o).where(inArray(o.id, orderIds)); // items, events, payments cascade
  if (createdCarts.size) await db.delete(schema.carts).where(inArray(schema.carts.id, [...createdCarts])); // cart_items cascade
  await db.delete(schema.coupons).where(like(schema.coupons.code, `${COUPON_PREFIX}%`));
  for (const [id, stock] of snap.stock) {
    const stamp = snap.stamps.get(id)!;
    await db.execute(
      sql`update product_variants set stock = ${stock}, updated_at = ${stamp}::timestamptz where id = ${id} and (stock <> ${stock} or updated_at <> ${stamp}::timestamptz)`,
    );
  }
  for (const s of snap.sequences) await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
}

const sku = (code: string) => v[code];

async function cart(items: { sku: string; quantity?: number }[], customer: CustomerContext = RETAIL_CUSTOMER, s: CommerceSettings = settings): Promise<string> {
  let cartId: string | null = null;
  for (const item of items) {
    const r = await addItem(cartId, { variantId: sku(item.sku).id, quantity: item.quantity ?? 1 }, { customer, locale: "tr", settings: s });
    assert.ok(r.ok, `addItem ${item.sku}: ${JSON.stringify(r)}`);
    cartId = r.cartId;
    createdCarts.add(cartId);
  }
  return cartId!;
}

function checkout(paymentMethod: PaymentMethod, extra: Record<string, unknown> = {}) {
  return {
    locale: "tr",
    contact: { email: email(), phone: "0532 123 45 67" },
    shippingAddress: { fullName: "Test Alıcı", city: "Kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. Test Sok. No: 1", postalCode: "38010" },
    invoice: { type: "individual", sameAsShipping: true },
    paymentMethod,
    consents: { preInformation: true, distanceSales: true },
    ...extra,
  };
}

async function place(cartId: string, method: PaymentMethod, opts: { customer?: CustomerContext; settings?: CommerceSettings; extra?: Record<string, unknown> } = {}): Promise<PlaceOrderResult> {
  const r = await placeOrder(checkout(method, opts.extra), { cartId, customer: opts.customer ?? RETAIL_CUSTOMER, settings: opts.settings, ...NO_EFFECTS, allowDraftContracts: true });
  if (r.ok) createdOrders.add(r.orderId);
  return r;
}

function ok(r: PlaceOrderResult): PlaceOrderSuccess {
  assert.equal(r.ok, true, `placeOrder failed: ${JSON.stringify(r)}`);
  return r as PlaceOrderSuccess;
}

async function orderRow(id: number) {
  const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
  return row;
}

async function stockOf(code: string) {
  const [row] = await db.select({ stock: schema.productVariants.stock }).from(schema.productVariants).where(eq(schema.productVariants.id, sku(code).id));
  return row.stock;
}

async function events(orderId: number) {
  return db.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, orderId));
}

async function makeCoupon(code: string, values: Partial<typeof schema.coupons.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.coupons)
    .values({ code: `${COUPON_PREFIX}${code}`, type: "percent", value: 10, ...values })
    .returning();
  return row;
}

async function couponUsed(id: number) {
  const [row] = await db.select({ n: schema.coupons.usedCount }).from(schema.coupons).where(eq(schema.coupons.id, id));
  return row.n;
}

before(async () => {
  snap = await takeSnapshot();
  const leftovers = await db.select({ id: schema.orders.id }).from(schema.orders).where(like(schema.orders.email, `%@${DOMAIN}`));
  assert.equal(leftovers.length, 0, "test orders left over from an earlier run");
  assert.equal(process.env.PAYMENT_SIMULATOR, "true", "PAYMENT_SIMULATOR=true must be set in .env.local");
  const rows = await db.select({ id: schema.productVariants.id, sku: schema.productVariants.sku, price: schema.productVariants.price }).from(schema.productVariants);
  for (const r of rows) v[r.sku] = { id: r.id, price: r.price };
  for (const code of ["PR-LVL-500", "PR-LVL-5L", "PR-POR-20L", "PR-LVL-NUM", "PR-LAV-NUM", "PR-POR-NUM"]) assert.ok(v[code], `seed variant ${code}`);
  settings = await loadCommerceSettings();
  havaleSettings = {
    ...settings,
    payments: {
      ...settings.payments,
      bankTransfer: {
        ...settings.payments.bankTransfer,
        enabled: true,
        discountPercent: 5,
        accounts: [{ bank: "Test Bankası", holder: "PRESTİJ BUKLET KOZMETİK", iban: "TR330006100519786457841326" }],
      },
    },
  };
});

after(async () => {
  try {
    await cleanup();
    const end = await takeSnapshot();
    assert.deepEqual(end.counts, snap.counts, "row counts restored");
    assert.deepEqual([...end.stock], [...snap.stock], "stock restored");
    assert.deepEqual([...end.stamps], [...snap.stamps], "variant updated_at restored");
    assert.equal(end.settings, snap.settings, "settings untouched");
    assert.deepEqual(end.sequences, snap.sequences, "sequences restored");
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------

describe("cart mutations", () => {
  test("add, merge, clamp, quantity, samples, coupon, prune", async () => {
    const ctx = { customer: RETAIL_CUSTOMER, locale: "tr" as const, settings };
    const first = await addItem(null, { variantId: sku("PR-LVL-500").id, quantity: 2 }, ctx);
    assert.ok(first.ok && first.created && first.notice === "added");
    const cartId = first.cartId;
    createdCarts.add(cartId);
    const merged = await addItem(cartId, { variantId: sku("PR-LVL-500").id, quantity: 1 }, ctx);
    assert.ok(merged.ok && !merged.created);
    let loaded = await loadCart(cartId, RETAIL_CUSTOMER);
    assert.equal(loaded.lines.length, 1);
    assert.equal(loaded.lines[0].quantity, 3);
    const clamped = await addItem(cartId, { variantId: sku("PR-LVL-500").id, quantity: 500 }, ctx);
    assert.ok(clamped.ok);
    assert.equal(clamped.notice, "added_limited");
    assert.deepEqual(clamped.vars, { count: 99 });

    const lineId = loaded.lines[0].lineId;
    const set = await setItemQuantity(cartId, { lineId, quantity: 5 }, ctx);
    assert.ok(set.ok && set.notice === "updated");
    const foreign = await setItemQuantity(randomUUID(), { lineId, quantity: 2 }, ctx);
    assert.equal((foreign as { code: string }).code, "line_not_found", "another cart cannot touch the line");

    assert.equal((await addItem(cartId, { variantId: sku("PR-LVL-NUM").id, quantity: 1 }, ctx)).ok, false, "samples go through addSample");
    assert.equal(((await addItem(cartId, { variantId: 99_999_999, quantity: 1 }, ctx)) as { code: string }).code, "variant_not_found");

    assert.equal((await addSampleItem(cartId, { variantId: sku("PR-LVL-NUM").id }, ctx)).ok, true);
    assert.equal(((await addSampleItem(cartId, { variantId: sku("PR-LVL-NUM").id }, ctx)) as { code: string }).code, "sample_in_cart");
    assert.equal((await addSampleItem(cartId, { variantId: sku("PR-LAV-NUM").id }, ctx)).ok, true);
    const third = await addSampleItem(cartId, { variantId: sku("PR-POR-NUM").id }, ctx);
    assert.deepEqual(third, { ok: false, cartId, code: "sample_limit", vars: { count: 2 } });
    assert.equal(((await addSampleItem(null, { variantId: sku("PR-POR-NUM").id }, ctx)) as { code: string }).code, "sample_needs_product");

    assert.equal(((await applyCouponCode(cartId, { code: "YOK-BOYLE-KOD" }, ctx)) as { code: string }).code, "coupon_not_found");
    const c = await makeCoupon("TEN", { minOrderTotal: 100 });
    const applied = await applyCouponCode(cartId, { code: ` ${c.code.toLowerCase()} ` }, ctx);
    assert.ok(applied.ok, JSON.stringify(applied));
    loaded = await loadCart(cartId, RETAIL_CUSTOMER);
    assert.equal(loaded.coupon?.id, c.id);
    assert.equal(loaded.cart?.couponCode, c.code);
    const high = await makeCoupon("HIGH", { minOrderTotal: 10_000_000 });
    assert.deepEqual(await applyCouponCode(cartId, { code: high.code }, ctx), { ok: false, cartId, code: "coupon_min_order", vars: { amount: 10_000_000 } });

    // Removing the paid line invalidates the samples; syncCart deletes them.
    assert.ok((await removeItem(cartId, { lineId }, ctx)).ok);
    loaded = await loadCart(cartId, RETAIL_CUSTOMER);
    const totals = totalsForLoadedCart(loaded, settings);
    assert.ok(totals.issues.some((i) => i.code === "samples_only"));
    const sync = await syncCart(cartId, totals);
    assert.deepEqual(sync, { changed: true, samplesRemoved: true, adjusted: [] });
    assert.equal((await loadCart(cartId, RETAIL_CUSTOMER)).lines.length, 0);
  });
});

describe("card payments", () => {
  test("place → simulator success → paid; replays are idempotent", async () => {
    const before = await stockOf("PR-LVL-5L");
    const cartId = await cart([{ sku: "PR-LVL-5L", quantity: 2 }]);
    const r = ok(await place(cartId, "card"));
    assert.equal(r.status, "pending_payment");
    assert.equal(r.existing, false);
    assert.match(r.orderNumber, /^PR-\d{2}\d{4,}$/);
    assert.match(r.redirectTo, new RegExp(`^/tr/odeme/simulator\\?order=${r.orderNumber}&t=${r.accessToken}$`));

    const row = await orderRow(r.orderId);
    // 2 × 449,90 = 899,80 < 1.500 → flat 99,90; 10,6 kg → 1 kg over → 15,00
    assert.equal(row.subtotal, 89980);
    assert.equal(row.shippingTotal, 9990 + 1500);
    assert.equal(row.grandTotal, 101470);
    assert.equal(row.vatTotal, 14997 + 1915);
    assert.equal(row.cartId, cartId);
    assert.equal(row.phone, "+905321234567");
    assert.deepEqual(row.breakdown, {
      couponDiscount: 0,
      couponType: null,
      bankTransferDiscount: 0,
      bankTransferPercent: 0,
      shippingFlat: 9990,
      shippingHeavy: 1500,
      heavyKg: 1,
      freeShipping: false,
      freeShippingReason: null,
      totalWeightGrams: 10600,
      itemCount: 2,
    });
    assert.deepEqual(
      row.consents?.map((c) => [c.key, c.version]),
      [
        ["pre_information", "taslak-1"],
        ["distance_sales", "taslak-1"],
      ],
    );
    assert.equal(await stockOf("PR-LVL-5L"), before - 2);
    assert.equal(await findCart(cartId), null, "cart deleted");
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, r.orderId));
    assert.equal(items.length, 1);
    assert.equal(items[0].snapshot.stockTracked, true);
    assert.equal(items[0].snapshot.productSlug, "lavanta-latte");
    assert.equal(items[0].lineTotal, 89980);
    const types = (await events(r.orderId)).map((e) => e.type).sort();
    assert.deepEqual(types, ["legal_snapshot", "payment_initiated", "placed"]);
    const legal = await getOrderLegalSnapshot(r.orderId);
    assert.ok(legal?.preInformation.html.includes(r.orderNumber));
    assert.ok(legal?.distanceSales.html.includes("Test Alıcı"));
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, r.orderId));
    assert.equal(payment.status, "initiated");
    assert.equal(payment.amount, 101470);
    assert.equal(payment.provider, "simulator");

    const session = await getSimulatorSession({ orderNumber: r.orderNumber, token: r.accessToken });
    assert.ok(session.ok && session.amount === 101470);
    assert.deepEqual(await getSimulatorSession({ orderNumber: r.orderNumber, token: randomUUID() }), { ok: false, code: "not_found" });

    const paid = await simulateCardPayment({ orderNumber: r.orderNumber, token: r.accessToken, outcome: "success" }, NO_EFFECTS);
    assert.ok(paid.ok && paid.status === "paid");
    assert.match(paid.redirectTo, /^\/tr\/siparis\/PR-\d+\?t=[0-9a-f-]+&new=1$/);
    const after = await orderRow(r.orderId);
    assert.equal(after.status, "paid");
    assert.ok(after.paidAt);
    assert.match(after.paymentRef ?? "", /^SIM-/);

    const replay = await completeCardPayment({ orderId: r.orderId, providerRef: after.paymentRef!, success: true, amount: 101470 }, NO_EFFECTS);
    assert.deepEqual(replay, { ok: true, status: "paid", alreadyProcessed: true, orderId: r.orderId, orderNumber: r.orderNumber });
    assert.equal((await events(r.orderId)).filter((e) => e.type === "payment_succeeded").length, 1);
    assert.deepEqual(await getSimulatorSession({ orderNumber: r.orderNumber, token: r.accessToken }), { ok: false, code: "not_pending" });
    const again = await simulateCardPayment({ orderNumber: r.orderNumber, token: r.accessToken, outcome: "success" }, NO_EFFECTS);
    assert.equal(again.ok, false);
  });

  test("failure keeps the order payable; amount mismatch is refused; retry then success", async () => {
    const cartId = await cart([{ sku: "PR-LVL-500" }]);
    const r = ok(await place(cartId, "card"));
    const total = (await orderRow(r.orderId)).grandTotal;
    assert.equal(total, 14990 + 9990);

    const failed = await completeCardPayment({ orderId: r.orderId, providerRef: "T-FAIL-1", success: false, amount: total }, NO_EFFECTS);
    assert.deepEqual(failed, { ok: true, status: "failed", alreadyProcessed: false, orderId: r.orderId, orderNumber: r.orderNumber });
    assert.equal((await orderRow(r.orderId)).status, "pending_payment");

    const retry = await initiateCardPayment(r.orderId);
    assert.ok(retry.ok && retry.redirectUrl.startsWith("/tr/odeme/simulator?"));
    const pays = await db.select().from(schema.payments).where(eq(schema.payments.orderId, r.orderId));
    assert.deepEqual(pays.map((p) => p.status).sort(), ["failed", "initiated"]);

    const mismatch = await completeCardPayment({ orderId: r.orderId, providerRef: "T-MISMATCH-1", success: true, amount: total - 1 }, NO_EFFECTS);
    assert.deepEqual(mismatch, { ok: false, code: "amount_mismatch" });
    assert.equal((await orderRow(r.orderId)).status, "pending_payment");
    assert.ok((await events(r.orderId)).some((e) => e.type === "payment_amount_mismatch"));
    assert.deepEqual(await completeCardPayment({ orderId: r.orderId, providerRef: "T-MISMATCH-1", success: true, amount: total - 1 }, NO_EFFECTS), {
      ok: false,
      code: "amount_mismatch",
    });

    const success = await completeCardPayment({ orderId: r.orderId, providerRef: "T-OK-1", success: true, amount: total }, NO_EFFECTS);
    assert.ok(success.ok && success.status === "paid" && !success.alreadyProcessed);
    assert.equal((await orderRow(r.orderId)).status, "paid");
    assert.deepEqual(await completeCardPayment({ orderId: r.orderId, providerRef: "T-FAIL-1", success: false, amount: total }, NO_EFFECTS), {
      ok: true,
      status: "failed",
      alreadyProcessed: true,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
    });
    assert.deepEqual(await completeCardPayment({ orderId: 2_000_000_000, providerRef: "X", success: true, amount: 1 }, NO_EFFECTS), { ok: false, code: "not_found" });
  });

  test("fails closed without PAYMENT_SIMULATOR", async () => {
    const cartId = await cart([{ sku: "PR-LVL-500" }]);
    const previous = process.env.PAYMENT_SIMULATOR;
    process.env.PAYMENT_SIMULATOR = "false";
    try {
      const r = await place(cartId, "card");
      assert.equal(r.ok, false);
      assert.equal((r as { code: string }).code, "card_not_configured");
      assert.deepEqual(await completeCardPayment({ orderId: 1, providerRef: "X", success: true, amount: 1 }, NO_EFFECTS), { ok: false, code: "not_configured" });
      assert.deepEqual(await getSimulatorSession({ orderNumber: "PR-261001", token: randomUUID() }), { ok: false, code: "disabled" });
      assert.equal(((await simulateCardPayment({ orderNumber: "PR-261001", token: randomUUID(), outcome: "success" }, NO_EFFECTS)) as { code: string }).code, "disabled");
      const view = totalsForLoadedCart(await loadCart(cartId, RETAIL_CUSTOMER), settings, { cardGatewayReady: false });
      assert.equal(view.paymentMethods.find((m) => m.method === "card")?.reason, "not_configured");
    } finally {
      process.env.PAYMENT_SIMULATOR = previous;
    }
    assert.ok(await findCart(cartId), "the cart survives a refused checkout");
  });
});

describe("other payment methods", () => {
  test("havale: coupon then 5 % discount, awaiting_transfer, full status flow", async () => {
    const c = await makeCoupon("HAVALE", { value: 10 });
    const cartId = await cart([{ sku: "PR-LVL-500", quantity: 2 }], RETAIL_CUSTOMER, havaleSettings);
    assert.ok((await applyCouponCode(cartId, { code: c.code }, { customer: RETAIL_CUSTOMER, locale: "tr", settings: havaleSettings })).ok);
    // FIX F4: placed with 6 payment days while the stored setting (what the order page reads) says something else.
    const sixDays: CommerceSettings = { ...havaleSettings, payments: { ...havaleSettings.payments, bankTransfer: { ...havaleSettings.payments.bankTransfer, paymentDays: 6 } } };
    const r = ok(await place(cartId, "bank_transfer", { settings: sixDays, extra: { expectedTotal: 35623 } }));
    assert.equal(r.status, "awaiting_transfer");
    assert.match(r.redirectTo, /^\/tr\/siparis\/PR-\d+\?t=.+&new=1$/);
    const row = await orderRow(r.orderId);
    assert.equal(row.discountTotal, 2998 + 1349);
    assert.equal(row.grandTotal, 29980 - 2998 - 1349 + 9990);
    assert.equal(row.breakdown?.bankTransferDiscount, 1349);
    assert.equal(row.breakdown?.couponDiscount, 2998);
    assert.equal(row.breakdown?.bankTransferDays, 6, "the havale day count is stored with the order");
    const contract = await getOrderLegalSnapshot(r.orderId);
    assert.match(contract?.preInformation.html ?? "", /sipariş tarihinden itibaren 6 gün\)\.<\/p>/, "the contract was written with the same count");
    assert.equal(row.couponId, c.id);
    assert.equal(row.paymentProvider, "manual");
    assert.equal(await couponUsed(c.id), 1);
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, r.orderId));
    assert.equal(items[0].discount, 4347);
    assert.equal(items[0].lineTotal, 29980 - 4347);

    const view = await getOrderByToken(r.orderNumber, r.accessToken);
    assert.deepEqual(view?.payment.bankTransfer?.accounts, [], "accounts come from the DB settings (none configured locally)");
    assert.equal(view?.totals.bankTransferPercent, 5);
    assert.notEqual(settings.payments.bankTransfer.paymentDays, 6, "the stored setting differs from the order's count");
    assert.equal(view?.payment.bankTransfer?.deadline, bankTransferDeadline(row.createdAt, 6).toISOString(), "the order page reads the order's own count, not today's setting");

    assert.deepEqual(await transitionOrder(r.orderId, "ship", { actor: STAFF, carrier: "yurtici", trackingNumber: "YK1" }, NO_EFFECTS), {
      ok: false,
      code: "invalid_tracking",
    });
    assert.equal((await transitionOrder(r.orderId, "ship", { actor: STAFF, carrier: "yurtici", trackingNumber: "YK12345678" }, NO_EFFECTS)).ok, false, "not paid yet");
    assert.ok((await transitionOrder(r.orderId, "mark_paid", { actor: STAFF }, NO_EFFECTS)).ok);
    assert.ok((await transitionOrder(r.orderId, "start_processing", { actor: STAFF }, NO_EFFECTS)).ok);
    assert.deepEqual(await transitionOrder(r.orderId, "ship", { actor: STAFF, carrier: "ups" }, NO_EFFECTS), { ok: false, code: "invalid_carrier" });
    assert.deepEqual(await transitionOrder(r.orderId, "ship", { actor: STAFF, carrier: "yurtici" }, NO_EFFECTS), { ok: false, code: "tracking_required" });
    assert.ok((await transitionOrder(r.orderId, "ship", { actor: STAFF, carrier: "yurtici", trackingNumber: "yk 1234 5678" }, NO_EFFECTS)).ok);
    assert.ok((await transitionOrder(r.orderId, "add_note", { actor: STAFF, note: "Müşteri aradı." }, NO_EFFECTS)).ok);
    assert.deepEqual(await transitionOrder(r.orderId, "add_note", { actor: STAFF, note: "  " }, NO_EFFECTS), { ok: false, code: "note_required" });
    assert.ok((await transitionOrder(r.orderId, "deliver", { actor: STAFF }, NO_EFFECTS)).ok);

    const done = await getOrderByToken(r.orderNumber, r.accessToken);
    assert.ok(done);
    assert.equal(done.status, "delivered");
    assert.deepEqual(
      done.timeline.map((s) => s.state),
      ["done", "done", "done", "done", "done"],
    );
    assert.equal(done.carrier?.trackingNumber, "YK12345678");
    assert.ok(done.carrier?.trackingUrl?.includes("YK12345678"));
    assert.equal(
      done.events.some((e) => e.type === "note"),
      false,
      "staff notes are not shown to the customer",
    );

    assert.deepEqual(await transitionOrder(r.orderId, "mark_refunded", { actor: STAFF }, NO_EFFECTS), { ok: false, code: "forbidden" });
    const before = await stockOf("PR-LVL-500");
    const refunded = await transitionOrder(r.orderId, "mark_refunded", { actor: ADMIN }, NO_EFFECTS);
    assert.ok(refunded.ok && refunded.status === "refunded" && refunded.restocked === false);
    assert.equal(await stockOf("PR-LVL-500"), before, "a refund after delivery does not restock");

    const detail = await getOrderDetail(r.orderId);
    assert.ok(detail);
    assert.ok(detail.events.some((e) => e.type === "note" && e.message === "Müşteri aradı."));
    assert.deepEqual(detail.actionsByRole.admin, ["add_note"]);
    assert.equal(detail.carriers.length, 3);
  });

  test("kapıda ödeme adds the fee and starts in processing", async () => {
    const cartId = await cart([{ sku: "PR-LVL-500" }]);
    const r = ok(await place(cartId, "cash_on_delivery"));
    assert.equal(r.status, "processing");
    const row = await orderRow(r.orderId);
    assert.equal(row.paymentFee, 4990);
    assert.equal(row.grandTotal, 14990 + 9990 + 4990);
    assert.equal(row.paymentProvider, null);
  });

  test("deferred only for approved companies with deferred terms", async () => {
    const retailCart = await cart([{ sku: "PR-LVL-500" }]);
    const refused = await place(retailCart, "deferred");
    assert.deepEqual(refused, { ok: false, code: "method_unavailable", fieldErrors: {}, reason: "not_eligible" });
    const bizCart = await cart([{ sku: "PR-LVL-500" }], DEFERRED_BUYER);
    const r = ok(await place(bizCart, "deferred", { customer: DEFERRED_BUYER }));
    assert.equal(r.status, "processing");
  });
});

describe("races and idempotency", () => {
  test("two orders for the last unit: exactly one wins, stock never negative", async () => {
    await db.update(schema.productVariants).set({ stock: 1 }).where(eq(schema.productVariants.id, sku("PR-POR-20L").id));
    const a = await cart([{ sku: "PR-POR-20L" }]);
    const b = await cart([{ sku: "PR-POR-20L" }]);
    const results = await Promise.all([place(a, "cash_on_delivery"), place(b, "cash_on_delivery")]);
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    assert.equal(winners.length, 1, JSON.stringify(results));
    // Depending on timing the loser fails at the guarded UPDATE (out_of_stock) or already sees stock 0
    // when it reloads the cart under its lock (cart_has_issues). Both refuse; neither oversells.
    const code = (losers[0] as { code: string }).code;
    assert.ok(code === "out_of_stock" || code === "cart_has_issues", code);
    assert.equal(await stockOf("PR-POR-20L"), 0);
    const loserCart = winners[0] === results[0] ? b : a;
    assert.ok(await findCart(loserCart), "the losing cart is untouched");
    const again = await place(loserCart, "cash_on_delivery");
    assert.equal(again.ok, false);
    assert.equal(await stockOf("PR-POR-20L"), 0);
    const [{ n }] = await db.execute<{ n: string }>(sql`select count(*)::text as n from product_variants where stock < 0 and track_stock and not allow_backorder`);
    assert.equal(n, "0");
  });

  test("double submit of one cart creates one order", async () => {
    const before = await stockOf("PR-LVL-500");
    const cartId = await cart([{ sku: "PR-LVL-500" }]);
    const [x, y] = await Promise.all([place(cartId, "card"), place(cartId, "card")]);
    const a = ok(x);
    const b = ok(y);
    assert.equal(a.orderNumber, b.orderNumber);
    assert.deepEqual([a.existing, b.existing].sort(), [false, true]);
    assert.equal(b.redirectTo.split("?")[0], "/tr/odeme/simulator");
    const rows = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.cartId, cartId));
    assert.equal(rows.length, 1);
    assert.equal(await stockOf("PR-LVL-500"), before - 1);
    const third = ok(await place(cartId, "cash_on_delivery"));
    assert.equal(third.existing, true);
    assert.equal(third.paymentMethod, "card", "the first submit wins");
  });

  test("coupon maxUses race: the last use goes to exactly one order", async () => {
    const c = await makeCoupon("ONCE", { type: "fixed", value: 1000, maxUses: 1 });
    const a = await cart([{ sku: "PR-LVL-500" }]);
    const b = await cart([{ sku: "PR-LVL-500" }]);
    for (const id of [a, b]) assert.ok((await applyCouponCode(id, { code: c.code }, { customer: RETAIL_CUSTOMER, locale: "tr", settings })).ok);
    const before = await stockOf("PR-LVL-500");
    const results = await Promise.all([place(a, "cash_on_delivery"), place(b, "cash_on_delivery")]);
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
    assert.deepEqual(
      results.find((r) => !r.ok),
      { ok: false, code: "coupon_unavailable", fieldErrors: {} },
    );
    assert.equal(await couponUsed(c.id), 1);
    assert.equal(await stockOf("PR-LVL-500"), before - 1, "the refused order rolled back its stock");
    const winner = results.find((r) => r.ok) as PlaceOrderSuccess;
    assert.equal((await orderRow(winner.orderId)).discountTotal, 1000);
  });

  test("perCustomerLimit is checked by e-mail (case-insensitive), cancelled orders do not count", async () => {
    const c = await makeCoupon("PERCUST", { perCustomerLimit: 1 });
    const buyer = `Limit+${Date.now()}@${DOMAIN}`;
    const withCoupon = async () => {
      const id = await cart([{ sku: "PR-LVL-500" }]);
      assert.ok((await applyCouponCode(id, { code: c.code }, { customer: RETAIL_CUSTOMER, locale: "tr", settings })).ok);
      return id;
    };
    const first = ok(await place(await withCoupon(), "cash_on_delivery", { extra: { contact: { email: buyer, phone: "05321234567" } } }));
    const second = await place(await withCoupon(), "cash_on_delivery", { extra: { contact: { email: buyer.toUpperCase(), phone: "05321234567" } } });
    assert.deepEqual(second, { ok: false, code: "coupon_limit_reached", fieldErrors: {} });
    ok(await place(await withCoupon(), "cash_on_delivery"));
    assert.ok((await transitionOrder(first.orderId, "cancel", { actor: STAFF, note: "Test iptali" }, NO_EFFECTS)).ok);
    ok(await place(await withCoupon(), "cash_on_delivery", { extra: { contact: { email: buyer, phone: "05321234567" } } }));
  });
});

describe("cancel and expiry", () => {
  test("cancel restocks and releases the coupon use", async () => {
    const c = await makeCoupon("CANCEL", { value: 5 });
    const cartId = await cart([{ sku: "PR-LVL-5L", quantity: 3 }], RETAIL_CUSTOMER, havaleSettings);
    assert.ok((await applyCouponCode(cartId, { code: c.code }, { customer: RETAIL_CUSTOMER, locale: "tr", settings: havaleSettings })).ok);
    const before = await stockOf("PR-LVL-5L");
    const r = ok(await place(cartId, "bank_transfer", { settings: havaleSettings }));
    assert.equal(await stockOf("PR-LVL-5L"), before - 3);
    assert.equal(await couponUsed(c.id), 1);

    assert.deepEqual(await transitionOrder(r.orderId, "cancel", { actor: STAFF }, NO_EFFECTS), { ok: false, code: "note_required" });
    const cancelled = await transitionOrder(r.orderId, "cancel", { actor: STAFF, note: "Müşteri vazgeçti" }, NO_EFFECTS);
    assert.ok(cancelled.ok && cancelled.restocked && cancelled.status === "cancelled");
    assert.equal(await stockOf("PR-LVL-5L"), before);
    assert.equal(await couponUsed(c.id), 0);
    const ev = (await events(r.orderId)).find((e) => e.type === "status_changed");
    assert.equal(ev?.message, "Müşteri vazgeçti");
    assert.deepEqual(ev?.data, { action: "cancel", from: "awaiting_transfer", to: "cancelled", restocked: true, couponReleased: true, actorName: "Test Personel" });
    assert.ok((await orderRow(r.orderId)).cancelledAt);
    assert.deepEqual(await transitionOrder(r.orderId, "cancel", { actor: STAFF, note: "tekrar" }, NO_EFFECTS), { ok: false, code: "invalid_transition" });
    assert.deepEqual(await transitionOrder(r.orderId, "mark_refunded", { actor: ADMIN }, NO_EFFECTS), { ok: false, code: "not_paid" });
    assert.deepEqual(await transitionOrder(2_000_000_000, "cancel", { actor: STAFF, note: "x" }, NO_EFFECTS), { ok: false, code: "not_found" });
  });

  test("expireStalePendingOrders cancels old card orders and restocks; late money is flagged", async () => {
    const before = await stockOf("PR-LVL-5L");
    const old = ok(await place(await cart([{ sku: "PR-LVL-5L" }]), "card"));
    const fresh = ok(await place(await cart([{ sku: "PR-LVL-5L" }]), "card"));
    await db.execute(sql`update orders set created_at = now() - interval '31 minutes' where id = ${old.orderId}`);
    // Staleness counts from the latest payment activity too (a retry touches the open attempt).
    await db.execute(sql`update payments set updated_at = now() - interval '31 minutes' where order_id = ${old.orderId}`);
    assert.equal(await stockOf("PR-LVL-5L"), before - 2);
    const result = await expireStalePendingOrders(30, NO_EFFECTS);
    assert.ok(result.orderNumbers.includes(old.orderNumber));
    assert.ok(!result.orderNumbers.includes(fresh.orderNumber));
    assert.equal((await orderRow(old.orderId)).status, "cancelled");
    assert.equal((await orderRow(fresh.orderId)).status, "pending_payment");
    assert.equal(await stockOf("PR-LVL-5L"), before - 1);
    const ev = (await events(old.orderId)).find((e) => e.type === "status_changed");
    assert.equal((ev?.data as { reason?: string }).reason, "payment_timeout");
    assert.equal(ev?.createdBy, "system");

    const late = await completeCardPayment({ orderId: old.orderId, providerRef: "T-LATE-1", success: true, amount: (await orderRow(old.orderId)).grandTotal }, NO_EFFECTS);
    assert.deepEqual(late, { ok: false, code: "order_cancelled" });
    assert.equal((await orderRow(old.orderId)).status, "cancelled");
    assert.ok((await events(old.orderId)).some((e) => e.type === "payment_after_cancel"));
    // The captured money is on the order now, so the refund can be recorded in the panel.
    assert.ok((await orderRow(old.orderId)).paidAt, "paidAt set by the late capture");
    assert.deepEqual((await getOrderDetail(old.orderId))?.actionsByRole.admin, ["mark_refunded", "add_note"]);
    const refunded = await transitionOrder(old.orderId, "mark_refunded", { actor: ADMIN }, NO_EFFECTS);
    assert.ok(refunded.ok && refunded.status === "refunded" && !refunded.restocked, JSON.stringify(refunded));
    assert.equal(await stockOf("PR-LVL-5L"), before - 1, "no second restock");
  });
});

describe("checkout refusals and reads", () => {
  test("invalid input, empty cart, samples only, price changed", async () => {
    const invalid = await placeOrder({ locale: "tr", paymentMethod: "card" }, { cartId: randomUUID(), customer: RETAIL_CUSTOMER, ...NO_EFFECTS });
    assert.equal(invalid.ok, false);
    assert.equal((invalid as { code: string }).code, "invalid_input");
    assert.equal((invalid as { fieldErrors: Record<string, string> }).fieldErrors["consents"], "consent_required");
    assert.deepEqual(await place(randomUUID(), "card"), { ok: false, code: "cart_empty", fieldErrors: {} });

    const ctx = { customer: RETAIL_CUSTOMER, locale: "tr" as const, settings };
    const cartId = await cart([{ sku: "PR-LVL-500" }]);
    assert.ok((await addSampleItem(cartId, { variantId: sku("PR-LVL-NUM").id }, ctx)).ok);
    const paidLine = (await loadCart(cartId, RETAIL_CUSTOMER)).lines.find((l) => l.productType !== "sample")!;
    assert.deepEqual(await place(cartId, "card", { extra: { expectedTotal: 1 } }), { ok: false, code: "price_changed", fieldErrors: {}, actualTotal: 14990 + 9990 });
    await removeItem(cartId, { lineId: paidLine.lineId }, ctx);
    assert.deepEqual(await place(cartId, "card"), { ok: false, code: "samples_only", fieldErrors: {} });
  });

  test("a coupon that stopped being valid is never dropped silently", async () => {
    const c = await makeCoupon("STALE", { value: 20 });
    const cartId = await cart([{ sku: "PR-LVL-500" }]);
    assert.ok((await applyCouponCode(cartId, { code: c.code }, { customer: RETAIL_CUSTOMER, locale: "tr", settings })).ok);
    await db.update(schema.coupons).set({ isActive: false }).where(eq(schema.coupons.id, c.id));
    assert.deepEqual(await place(cartId, "cash_on_delivery"), { ok: false, code: "coupon_unavailable", fieldErrors: {} });
    assert.equal((await findCart(cartId))?.couponCode, null, "the stale code is removed from the cart");
    const r = ok(await place(cartId, "cash_on_delivery"));
    assert.equal((await orderRow(r.orderId)).couponCode, null);
    assert.equal(await couponUsed(c.id), 0);
  });

  test("a sample ships with the order at 0 and its stock is decremented", async () => {
    const before = await stockOf("PR-LAV-NUM");
    const cartId = await cart([{ sku: "PR-LVL-500" }]);
    assert.ok((await addSampleItem(cartId, { variantId: sku("PR-LAV-NUM").id }, { customer: RETAIL_CUSTOMER, locale: "tr", settings })).ok);
    const r = ok(await place(cartId, "cash_on_delivery"));
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, r.orderId));
    const s = items.find((i) => i.isSample)!;
    assert.equal(s.unitPrice, 0);
    assert.equal(s.lineTotal, 0);
    assert.equal(await stockOf("PR-LAV-NUM"), before - 1);
    assert.equal((await orderRow(r.orderId)).breakdown?.itemCount, 2);
  });

  test("token page, lookup, panel list and detail", async () => {
    const buyer = `Okur+${Date.now()}@${DOMAIN}`;
    const r = ok(await place(await cart([{ sku: "PR-LVL-500" }]), "cash_on_delivery", { extra: { contact: { email: buyer, phone: "05321234567" } } }));
    const view = await getOrderByToken(r.orderNumber, r.accessToken);
    assert.ok(view);
    assert.equal(view.items[0].name.tr, "Lavanta Latte");
    assert.equal(view.totals.paymentFee, 4990);
    assert.equal(view.payment.canRetry, false);
    assert.ok(view.legal?.preInformation.html.includes(r.orderNumber));
    assert.equal(view.events.every((e) => e.message === null && e.createdBy === null), true);
    assert.equal(await getOrderByToken(r.orderNumber, randomUUID()), null);
    assert.equal(await getOrderByToken(r.orderNumber, "not-a-token"), null);
    assert.equal(await getOrderByToken("PR-999999", r.accessToken), null);

    assert.deepEqual(await lookupOrder(r.orderNumber.toLowerCase(), ` ${buyer.toUpperCase()} `), { orderNumber: r.orderNumber, accessToken: r.accessToken, locale: "tr" });
    assert.equal(await lookupOrder(r.orderNumber, `someone@${DOMAIN}`), null);

    const list = await listOrders({ q: DOMAIN, page: 1, pageSize: 5 });
    assert.ok(list.total >= 10);
    assert.equal(list.items.length, 5);
    assert.equal(list.counts.all, list.total);
    assert.ok(list.counts.processing >= 1 && list.counts.cancelled >= 1);
    const byNumber = await listOrders({ q: r.orderNumber });
    assert.equal(byNumber.items[0].orderNumber, r.orderNumber);
    assert.equal(byNumber.items[0].customerName, "Test Alıcı");
    assert.equal(byNumber.items[0].itemCount, 1);
    const processing = await listOrders({ q: DOMAIN, status: "processing", pageSize: 100 });
    assert.ok(processing.items.every((i) => i.status === "processing"));
    assert.equal(processing.total, list.counts.processing);
    const byPhone = await listOrders({ q: "532 123 45 67", pageSize: 1 });
    assert.ok(byPhone.total >= 1);

    const detail = await getOrderDetail(r.orderId);
    assert.ok(detail);
    assert.deepEqual(detail.actionsByRole.staff, ["ship", "cancel", "add_note"]);
    assert.deepEqual(detail.actionsByRole.admin, ["ship", "cancel", "add_note"], "unpaid kapıda ödeme: nothing to refund yet");
    assert.equal(detail.customerHref, `/tr/siparis/${r.orderNumber}?t=${r.accessToken}`);
    assert.ok(detail.events.some((e) => e.type === "placed"));
    assert.equal(detail.consents.length, 2);
    assert.equal(await getOrderDetail(2_000_000_000), null);
  });
});

// ---------------------------------------------------------------------------------------------
// Review fixes (day-2 review): races, refunds, payments, checkout guards, coupons, cart sync.

describe("review fixes: status and payments", () => {
  test("expiry skips an order that was paid between the job's scan and its row lock", async () => {
    const r = ok(await place(await cart([{ sku: "PR-LVL-5L" }]), "card"));
    await db.execute(sql`update orders set created_at = now() - interval '2 hours' where id = ${r.orderId}`);
    await db.execute(sql`update payments set updated_at = now() - interval '2 hours' where order_id = ${r.orderId}`);
    const before = await stockOf("PR-LVL-5L");
    let expiry: ReturnType<typeof expireStalePendingOrders> | null = null;
    await db.transaction(async (tx) => {
      // Hold the row like a payment callback in flight; the job scans, then waits for the lock.
      await tx.execute(sql`select id from orders where id = ${r.orderId} for update`);
      expiry = expireStalePendingOrders(60, NO_EFFECTS);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await tx.execute(sql`update orders set status = 'paid', paid_at = now() where id = ${r.orderId}`);
    });
    const result = await expiry!;
    assert.ok(!result.orderNumbers.includes(r.orderNumber), JSON.stringify(result));
    const row = await orderRow(r.orderId);
    assert.equal(row.status, "paid");
    assert.equal(row.cancelledAt, null);
    assert.equal(await stockOf("PR-LVL-5L"), before, "no restock of a paid order");
  });

  test("a payment retry restarts the expiry clock", async () => {
    const r = ok(await place(await cart([{ sku: "PR-LVL-500" }]), "card"));
    const backdate = async () => {
      await db.execute(sql`update orders set created_at = now() - interval '2 hours' where id = ${r.orderId}`);
      await db.execute(sql`update payments set updated_at = now() - interval '2 hours' where order_id = ${r.orderId}`);
    };
    await backdate();
    const retry = await initiateCardPayment(r.orderId);
    assert.ok(retry.ok);
    const pays = await db.select().from(schema.payments).where(eq(schema.payments.orderId, r.orderId));
    assert.equal(pays.length, 1, "the open attempt is reused (touched), not duplicated");
    assert.ok(!(await expireStalePendingOrders(60, NO_EFFECTS)).orderNumbers.includes(r.orderNumber), "payment in progress");
    await backdate();
    assert.ok((await expireStalePendingOrders(60, NO_EFFECTS)).orderNumbers.includes(r.orderNumber), "stale again → expired");
  });

  test("panel actions are bound to the status the staff saw", async () => {
    const r = ok(await place(await cart([{ sku: "PR-LVL-500" }], RETAIL_CUSTOMER, havaleSettings), "bank_transfer", { settings: havaleSettings }));
    assert.ok((await transitionOrder(r.orderId, "mark_paid", { actor: STAFF, expectedStatus: "awaiting_transfer" }, NO_EFFECTS)).ok);
    // A second staff member still looking at "awaiting transfer" cancels as unpaid: refused.
    const stale = await transitionOrder(r.orderId, "cancel", { actor: STAFF, note: "Havale gelmedi", expectedStatus: "awaiting_transfer" }, NO_EFFECTS);
    assert.deepEqual(stale, { ok: false, code: "invalid_transition" });
    assert.equal((await orderRow(r.orderId)).status, "paid");
    assert.ok((await transitionOrder(r.orderId, "add_note", { actor: STAFF, note: "Not" }, NO_EFFECTS)).ok);
  });

  test("a providerRef of another order is refused; a late failure after payment is only recorded", async () => {
    const a = ok(await place(await cart([{ sku: "PR-LVL-500" }]), "card"));
    const b = ok(await place(await cart([{ sku: "PR-LVL-500" }]), "card"));
    const total = (await orderRow(a.orderId)).grandTotal;
    assert.ok((await completeCardPayment({ orderId: b.orderId, providerRef: "T-REF-B", success: true, amount: total }, NO_EFFECTS)).ok);
    assert.deepEqual(await completeCardPayment({ orderId: a.orderId, providerRef: "T-REF-B", success: true, amount: total }, NO_EFFECTS), {
      ok: false,
      code: "invalid_input",
    });
    assert.equal((await orderRow(a.orderId)).status, "pending_payment");

    const late = await completeCardPayment({ orderId: b.orderId, providerRef: "T-FAIL-LATE", success: false, amount: total }, NO_EFFECTS);
    assert.deepEqual(late, { ok: false, code: "not_pending" });
    assert.equal((await orderRow(b.orderId)).status, "paid");
    assert.equal((await events(b.orderId)).filter((e) => e.type === "payment_failed").length, 0, "no 'payment failed' for a paid order");
    const pays = await db.select().from(schema.payments).where(eq(schema.payments.orderId, b.orderId));
    assert.deepEqual(pays.map((p) => p.status).sort(), ["failed", "succeeded"], "kept for the audit trail");
  });

  test("kapıda ödeme: no refund before the money is collected; a refused parcel is cancelled with restock", async () => {
    const before = await stockOf("PR-LVL-500");
    const refused = ok(await place(await cart([{ sku: "PR-LVL-500" }]), "cash_on_delivery"));
    assert.deepEqual(await transitionOrder(refused.orderId, "mark_refunded", { actor: ADMIN }, NO_EFFECTS), { ok: false, code: "not_paid" });
    assert.ok((await transitionOrder(refused.orderId, "ship", { actor: STAFF, carrier: "yurtici", trackingNumber: "YK11112222" }, NO_EFFECTS)).ok);
    assert.deepEqual(await transitionOrder(refused.orderId, "mark_refunded", { actor: ADMIN }, NO_EFFECTS), { ok: false, code: "not_paid" });
    assert.deepEqual((await getOrderDetail(refused.orderId))?.actionsByRole.staff, ["deliver", "cancel", "add_note"]);
    const cancelled = await transitionOrder(refused.orderId, "cancel", { actor: STAFF, note: "Alıcı paketi teslim almadı", expectedStatus: "shipped" }, NO_EFFECTS);
    assert.ok(cancelled.ok && cancelled.restocked && cancelled.previousStatus === "shipped", JSON.stringify(cancelled));
    assert.equal(await stockOf("PR-LVL-500"), before);

    const delivered = ok(await place(await cart([{ sku: "PR-LVL-500" }]), "cash_on_delivery"));
    assert.ok((await transitionOrder(delivered.orderId, "ship", { actor: STAFF, carrier: "aras", trackingNumber: "AR22223333" }, NO_EFFECTS)).ok);
    assert.ok((await transitionOrder(delivered.orderId, "deliver", { actor: STAFF }, NO_EFFECTS)).ok);
    assert.ok((await orderRow(delivered.orderId)).paidAt, "the courier collected the money");
    const refund = await transitionOrder(delivered.orderId, "mark_refunded", { actor: ADMIN }, NO_EFFECTS);
    assert.ok(refund.ok && !refund.restocked, JSON.stringify(refund));
  });
});

describe("review fixes: checkout guards", () => {
  test("the cart the buyer confirmed (revision) and the total of the chosen method are both checked", async () => {
    const cartId = await cart([{ sku: "PR-LVL-500" }]);
    const revision = cartRevision(totalsForLoadedCart(await loadCart(cartId, RETAIL_CUSTOMER), settings));
    assert.equal(revision, `${sku("PR-LVL-500").id}:1|`);
    // Same total, other product (another scent's 500 ml): refused.
    assert.deepEqual(await place(cartId, "cash_on_delivery", { extra: { expectedCart: `${sku("PR-LAV-500").id}:1|` } }), {
      ok: false,
      code: "cart_changed",
      fieldErrors: {},
    });
    const cod = 14990 + 9990 + 4990;
    // Posted without JavaScript: the card total was rendered as the selected one, COD chosen.
    assert.deepEqual(await place(cartId, "cash_on_delivery", { extra: { expectedTotals: { card: 24980, cash_on_delivery: 1 } } }), {
      ok: false,
      code: "price_changed",
      fieldErrors: {},
      actualTotal: cod,
    });
    const r = ok(await place(cartId, "cash_on_delivery", { extra: { expectedCart: revision, expectedTotals: { card: 24980, cash_on_delivery: cod } } }));
    assert.equal((await orderRow(r.orderId)).grandTotal, cod);
  });

  test("no order without the contract texts (legal_unavailable)", async () => {
    const cartId = await cart([{ sku: "PR-LVL-500" }]);
    const [doc] = await db.execute<{ id: number }>(sql`select id from legal_documents where key = 'pre_information' and is_current limit 1`);
    assert.ok(doc, "seeded pre_information document");
    try {
      await db.execute(sql`update legal_documents set is_current = false where id = ${doc.id}`);
      assert.deepEqual(await place(cartId, "cash_on_delivery"), { ok: false, code: "legal_unavailable", fieldErrors: {} });
    } finally {
      await db.execute(sql`update legal_documents set is_current = true where id = ${doc.id}`);
    }
    assert.ok(await findCart(cartId), "the cart survives");
  });
});

describe("review fixes: coupons and cart sync", () => {
  test("a code that would not lower the amount is refused; a free_shipping code that saved nothing is not used up", async () => {
    const ctx = { customer: RETAIL_CUSTOMER, locale: "tr" as const, settings };
    const ship = await makeCoupon("SHIPFREE", { type: "free_shipping", value: 0, maxUses: 1 });
    // Above the free-shipping threshold already: nothing to save.
    const big = await cart([{ sku: "PR-LVL-5L", quantity: 4 }]);
    assert.deepEqual(await applyCouponCode(big, { code: ship.code }, ctx), { ok: false, cartId: big, code: "coupon_no_benefit" });
    // A small fixed code that pushes the cart below the threshold would add the shipping fee.
    const low = { ...settings, shipping: { ...settings.shipping, freeThreshold: 29000 } };
    const small = await makeCoupon("SMALL", { type: "fixed", value: 1000 });
    const two = await cart([{ sku: "PR-LVL-500", quantity: 2 }], RETAIL_CUSTOMER, low);
    assert.deepEqual(await applyCouponCode(two, { code: small.code }, { ...ctx, settings: low }), { ok: false, cartId: two, code: "coupon_no_benefit" });

    // Applied while it helped, then the cart grew past the threshold: the order does not use it up.
    const grows = await cart([{ sku: "PR-LVL-500" }]);
    assert.ok((await applyCouponCode(grows, { code: ship.code }, ctx)).ok);
    const lineId = (await loadCart(grows, RETAIL_CUSTOMER)).lines[0].lineId;
    assert.ok((await setItemQuantity(grows, { lineId, quantity: 11 }, ctx)).ok);
    const r = ok(await place(grows, "cash_on_delivery"));
    const row = await orderRow(r.orderId);
    assert.equal(row.couponId, null);
    assert.equal(row.couponCode, null);
    assert.equal(row.breakdown?.freeShippingReason, "threshold");
    assert.equal(await couponUsed(ship.id), 0, "the single-use code is still available");
  });

  test("syncCart never overwrites a quantity changed meanwhile; stock clamps are reported", async () => {
    const cartId = await cart([{ sku: "PR-LVL-500" }]);
    const lineId = (await loadCart(cartId, RETAIL_CUSTOMER)).lines[0].lineId;
    const ci = schema.cartItems;
    await db.update(ci).set({ quantity: 150 }).where(eq(ci.id, lineId));
    const stale = totalsForLoadedCart(await loadCart(cartId, RETAIL_CUSTOMER), settings);
    await db.update(ci).set({ quantity: 1 }).where(eq(ci.id, lineId)); // another tab, after the read
    const sync = await syncCart(cartId, stale);
    assert.deepEqual(sync.adjusted, []);
    assert.equal((await loadCart(cartId, RETAIL_CUSTOMER)).lines[0].quantity, 1, "the newer quantity wins");

    await db.update(ci).set({ quantity: 150 }).where(eq(ci.id, lineId));
    const fresh = await syncCart(cartId, totalsForLoadedCart(await loadCart(cartId, RETAIL_CUSTOMER), settings));
    const allowed = Math.min(99, await stockOf("PR-LVL-500"));
    assert.deepEqual(fresh.adjusted, [{ lineId, from: 150, to: allowed }]);
    assert.equal((await loadCart(cartId, RETAIL_CUSTOMER)).lines[0].quantity, allowed);
  });

  test("a sold-out free sample never blocks the order and is pruned from the cart", async () => {
    const cartId = await cart([{ sku: "PR-LVL-500" }]);
    assert.ok((await addSampleItem(cartId, { variantId: sku("PR-POR-NUM").id }, { customer: RETAIL_CUSTOMER, locale: "tr", settings })).ok);
    await db.update(schema.productVariants).set({ stock: 0 }).where(eq(schema.productVariants.id, sku("PR-POR-NUM").id)); // restored by cleanup()
    const totals = totalsForLoadedCart(await loadCart(cartId, RETAIL_CUSTOMER), settings);
    assert.equal(totals.checkoutAllowed, true);
    assert.deepEqual(await syncCart(cartId, totals), { changed: true, samplesRemoved: true, adjusted: [] });
    assert.equal((await loadCart(cartId, RETAIL_CUSTOMER)).lines.length, 1);
    ok(await place(cartId, "cash_on_delivery"));
  });
});
