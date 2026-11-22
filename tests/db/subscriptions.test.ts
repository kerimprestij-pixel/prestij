// Subscribe and save against the local PostgreSQL: subscription creation from the first order (kapıda
// ödeme now, card when paid), renewals (one order per period even when two runs race, current price
// with the plan discount, stock), skip / pause / resume, out of stock (failure mail once per period),
// reminders with a skip link, the card renewal payment window, and IDOR.
//
// Shared database: only rows this file creates are touched (user subs-db-*@test.local); stock is put
// back relatively (restock of the test orders), sequences are reset only when nobody else used them.
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadCart } from "@/lib/cart/load";
import { addItem } from "@/lib/cart/mutations";
import { loadCommerceSettings, type CommerceSettings } from "@/lib/cart/settings";
import { totalsForLoadedCart } from "@/lib/cart/totals";
import { RETAIL_CUSTOMER, type CustomerContext, type PaymentMethod } from "@/lib/cart/types";
import { placeOrder, type PlaceOrderResult, type PlaceOrderSuccess } from "@/lib/orders/place";
import { expireStalePendingOrders, restockOrder } from "@/lib/orders/status";
import { anonymizeAccount } from "@/lib/account/service";
import { completeCardPayment } from "@/lib/payments";
import { sendDueReviewRequests } from "@/lib/reviews/requests";
import { resolveUnitPrice } from "@/lib/pricing/resolve";
import { renewDueSubscriptions, renewSubscription, sendDueReminders } from "@/lib/subscriptions/renew";
import { firstRunAt, istanbulDay } from "@/lib/subscriptions/schedule";
import { changeSubscription, readSubscriptionSkipToken, type SubscriptionChange } from "@/lib/subscriptions/service";

const TAG = `subs-db-${randomUUID().slice(0, 8)}`;
const EMAIL = `${TAG}-buyer@test.local`;
const OTHER_EMAIL = `${TAG}-other@test.local`;
const USER_ID = `${TAG}-user`;
const OTHER_ID = `${TAG}-other`;
const DEL_EMAIL = `${TAG}-deleted@test.local`;
const DEL_ID = `${TAG}-deleted`;
const NO_EFFECTS = { effects: false } as const;
const MONTHLY_PLAN_ID = 2; // seeded "Her ay", 5 %
const started = new Date();

const s = schema.subscriptions;
const o = schema.orders;
const createdCarts = new Set<string>();
let settings: CommerceSettings;
let codSettings: CommerceSettings;
let customer: CustomerContext;
const v: Record<string, { id: number; price: number }> = {};
let variantStamp: { id: number; updatedAt: string; stock: number }[] = [];
const SEQ_TABLES = ["orders", "order_items", "order_events", "payments", "subscriptions", "cart_items", "email_messages"] as const;
const seqBefore: { table: string; name: string; lastValue: string; isCalled: boolean }[] = [];
let orderNumberSeq: { lastValue: string; isCalled: boolean };

async function seqState(name: string) {
  const r = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${name}`));
  return { lastValue: r[0].last_value, isCalled: r[0].is_called };
}

before(async () => {
  assert.equal(process.env.PAYMENT_SIMULATOR, "true", "PAYMENT_SIMULATOR=true must be set in .env.local");
  for (const t of SEQ_TABLES) {
    const r = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${t}, 'id') as seq`);
    seqBefore.push({ table: t, name: r[0].seq, ...(await seqState(r[0].seq)) });
  }
  orderNumberSeq = await seqState("public.order_number_seq");
  const rows = await db.select({ id: schema.productVariants.id, sku: schema.productVariants.sku, price: schema.productVariants.price }).from(schema.productVariants);
  for (const r of rows) v[r.sku] = { id: r.id, price: r.price };
  for (const code of ["PR-OKY-500", "PR-POR-500"]) assert.ok(v[code], `seed variant ${code}`);
  const [plan] = await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, MONTHLY_PLAN_ID));
  assert.ok(plan?.isActive && plan.discountPercent === 5, "seeded plan 2 = Her ay, 5 %");
  variantStamp = (
    await db
      .select({ id: schema.productVariants.id, updatedAt: sql<string>`${schema.productVariants.updatedAt}::text`, stock: schema.productVariants.stock })
      .from(schema.productVariants)
      .where(inArray(schema.productVariants.id, [v["PR-OKY-500"].id, v["PR-POR-500"].id]))
  ).map((r) => r);
  await db.insert(schema.user).values([
    { id: USER_ID, name: "Abonelik Test", email: EMAIL, emailVerified: true, role: "customer", locale: "tr" },
    { id: OTHER_ID, name: "Başka Müşteri", email: OTHER_EMAIL, emailVerified: true, role: "customer", locale: "tr" },
    { id: DEL_ID, name: "Silinecek Müşteri", email: DEL_EMAIL, emailVerified: true, role: "customer", locale: "tr" },
  ]);
  settings = await loadCommerceSettings();
  codSettings = { ...settings, subscriptions: { ...settings.subscriptions, enabled: true, allowedMethods: ["card", "bank_transfer", "cash_on_delivery"] } };
  customer = { ...RETAIL_CUSTOMER, userId: USER_ID };
});

after(async () => {
  try {
    await db.transaction(async (tx) => {
      const mine = await tx.select({ id: o.id, status: o.status, couponId: o.couponId }).from(o).where(inArray(o.email, [EMAIL, OTHER_EMAIL, DEL_EMAIL])).for("update");
      // Put back the stock the test orders still hold (cancelled ones were restocked already).
      for (const order of mine) if (order.status !== "cancelled" && order.status !== "refunded") await restockOrder(tx, order);
      if (mine.length) await tx.delete(o).where(inArray(o.id, mine.map((m) => m.id)));
    });
    await db.delete(s).where(inArray(s.userId, [USER_ID, OTHER_ID, DEL_ID]));
    if (createdCarts.size) await db.delete(schema.carts).where(inArray(schema.carts.id, [...createdCarts]));
    await db.delete(schema.emailMessages).where(inArray(schema.emailMessages.toEmail, [EMAIL, OTHER_EMAIL, DEL_EMAIL]));
    await db.delete(schema.user).where(inArray(schema.user.id, [USER_ID, OTHER_ID, DEL_ID]));
    for (const stamp of variantStamp) {
      await db.execute(
        sql`update product_variants set updated_at = ${stamp.updatedAt}::timestamptz where id = ${stamp.id} and stock = ${stamp.stock} and updated_at <> ${stamp.updatedAt}::timestamptz`,
      );
    }
    // Sequences: reset only when no row of anyone else appeared since the test started.
    for (const q of seqBefore) {
      const floor = q.isCalled ? Number(q.lastValue) : Number(q.lastValue) - 1;
      const r = await db.execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${q.table} where id > ${floor}`));
      if (Number(r[0].n) === 0) await db.execute(sql`select setval(${q.name}::regclass, ${q.lastValue}::bigint, ${q.isCalled})`);
    }
    const recentOrders = await db.select({ id: o.id }).from(o).where(gte(o.createdAt, started)).limit(1);
    if (recentOrders.length === 0) await db.execute(sql`select setval('public.order_number_seq'::regclass, ${orderNumberSeq.lastValue}::bigint, ${orderNumberSeq.isCalled})`);
    const left = await db.select({ id: s.id }).from(s).where(inArray(s.userId, [USER_ID, OTHER_ID]));
    assert.equal(left.length, 0);
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------

function checkout(paymentMethod: PaymentMethod, email = EMAIL) {
  return {
    locale: "tr",
    contact: { email, phone: "0532 123 45 67" },
    shippingAddress: { fullName: "Abonelik Test", city: "Kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. Test Sok. No: 1", postalCode: "38010" },
    invoice: { type: "individual", sameAsShipping: true },
    paymentMethod,
    consents: { preInformation: true, distanceSales: true },
  };
}

async function subscriptionCart(items: { sku: string; quantity: number; plan?: number | null }[], who: CustomerContext = customer, s2 = codSettings): Promise<string> {
  let cartId: string | null = null;
  for (const item of items) {
    const r = await addItem(cartId, { variantId: v[item.sku].id, quantity: item.quantity, ...(item.plan !== undefined ? { subscriptionPlanId: item.plan } : {}) }, { customer: who, locale: "tr", settings: s2 });
    assert.ok(r.ok, `addItem ${item.sku}: ${JSON.stringify(r)}`);
    cartId = r.cartId;
    createdCarts.add(cartId);
  }
  return cartId!;
}

function ok(r: PlaceOrderResult): PlaceOrderSuccess {
  assert.equal(r.ok, true, `placeOrder failed: ${JSON.stringify(r)}`);
  return r as PlaceOrderSuccess;
}

const stockOf = async (code: string) =>
  (await db.select({ stock: schema.productVariants.stock }).from(schema.productVariants).where(eq(schema.productVariants.id, v[code].id)))[0].stock;
const subOf = async (id: number) => (await db.select().from(s).where(eq(s.id, id)))[0];
const renewalOrders = (id: number) => db.select().from(o).where(eq(o.subscriptionId, id)).orderBy(desc(o.id));
const mails = (template: string) =>
  db.select().from(schema.emailMessages).where(and(eq(schema.emailMessages.toEmail, EMAIL), eq(schema.emailMessages.template, template))).orderBy(desc(schema.emailMessages.id));
const change = (id: number, c: SubscriptionChange, userId = USER_ID) => db.transaction((tx) => changeSubscription(tx, { subscriptionId: id, change: c }, { type: "customer", userId }));
const makeDue = (id: number) => db.update(s).set({ nextRunAt: new Date(Date.now() - 60 * 60_000) }).where(eq(s.id, id));
// The seeded contract texts are 'taslak-1' drafts: renewals hold without allowDraftContracts (tested below).
const renewOpts = { ...NO_EFFECTS, settings: undefined as CommerceSettings | undefined, allowDraftContracts: true };

let codSubscriptionId = 0;

describe("subscription from the first order", () => {
  test("kapıda ödeme: the plan line is priced with the plan discount and one subscription starts", async () => {
    const cartId = await subscriptionCart([
      { sku: "PR-OKY-500", quantity: 2, plan: MONTHLY_PLAN_ID },
      { sku: "PR-POR-500", quantity: 1 },
    ]);
    const totals = totalsForLoadedCart(await loadCart(cartId, customer), codSettings);
    const subLine = totals.lines.find((l) => l.variantId === v["PR-OKY-500"].id)!;
    const expectedUnit = resolveUnitPrice({ basePrice: v["PR-OKY-500"].price, subscriptionPercent: 5, quantity: 2 }).unitPrice;
    assert.equal(subLine.unitPrice, expectedUnit);
    assert.equal(subLine.subscription?.discount, "subscription");
    assert.equal(totals.lines.find((l) => l.variantId === v["PR-POR-500"].id)!.subscription, null);

    const placedAt = new Date();
    const order = ok(await placeOrder(checkout("cash_on_delivery"), { cartId, customer, settings: codSettings, ...NO_EFFECTS, now: placedAt, allowDraftContracts: true }));
    assert.equal(order.status, "processing");
    const rows = await db.select().from(s).where(eq(s.userId, USER_ID));
    assert.equal(rows.length, 1, "one subscription per plan");
    const sub = rows[0];
    codSubscriptionId = sub.id;
    assert.equal(sub.planId, MONTHLY_PLAN_ID);
    assert.equal(sub.status, "active");
    assert.equal(sub.paymentMethod, "cash_on_delivery");
    assert.deepEqual(sub.items, [{ variantId: v["PR-OKY-500"].id, quantity: 2 }]);
    assert.equal(sub.email, EMAIL);
    assert.equal(sub.lastOrderId, order.orderId);
    assert.equal(sub.shippingAddress.city, "Kayseri");
    assert.equal(istanbulDay(sub.nextRunAt), istanbulDay(firstRunAt(placedAt, { interval: "month", intervalCount: 1 })));

    const events = await db.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, order.orderId));
    const createdEvent = events.find((e) => e.type === "subscription_created");
    assert.deepEqual((createdEvent?.data as { subscriptionIds: number[] }).subscriptionIds, [sub.id]);
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.orderId));
    const snap = items.find((i) => i.variantId === v["PR-OKY-500"].id)!.snapshot as { subscription?: { planId: number; percent: number } };
    assert.deepEqual(snap.subscription, { planId: MONTHLY_PLAN_ID, percent: 5, discount: "subscription" });
    assert.equal((items.find((i) => i.variantId === v["PR-POR-500"].id)!.snapshot as { subscription?: unknown }).subscription, undefined);
    const started = await mails("subscription_started");
    assert.equal(started.length, 1);
    assert.equal(started[0].dedupeKey, `subscription:${sub.id}:started:customer`);
  });

  test("a guest cannot order a subscription, and only the allowed methods pay for one", async () => {
    const guestCart = await subscriptionCart([{ sku: "PR-OKY-500", quantity: 1, plan: MONTHLY_PLAN_ID }], RETAIL_CUSTOMER);
    const guest = await placeOrder(checkout("cash_on_delivery", `${TAG}-guest@test.local`), { cartId: guestCart, customer: RETAIL_CUSTOMER, settings: codSettings, ...NO_EFFECTS, allowDraftContracts: true });
    assert.equal(guest.ok, false);
    assert.equal(!guest.ok && guest.code, "cart_has_issues");

    const cardOnly = { ...codSettings, subscriptions: { ...codSettings.subscriptions, allowedMethods: ["card" as const] } };
    const cartId = await subscriptionCart([{ sku: "PR-OKY-500", quantity: 1, plan: MONTHLY_PLAN_ID }], customer, cardOnly);
    const refused = await placeOrder(checkout("cash_on_delivery"), { cartId, customer, settings: cardOnly, ...NO_EFFECTS, allowDraftContracts: true });
    assert.equal(!refused.ok && refused.code, "method_unavailable");
    assert.equal(!refused.ok && refused.reason, "subscription");
    // switching the line back to a one-time purchase lifts the restriction
    const { setItemSubscription } = await import("@/lib/cart/mutations");
    const lines = (await loadCart(cartId, customer)).lines;
    const back = await setItemSubscription(cartId, { lineId: lines[0].lineId, planId: null }, { customer, locale: "tr", settings: cardOnly });
    assert.ok(back.ok);
    const once = totalsForLoadedCart(await loadCart(cartId, customer), cardOnly, { paymentMethod: "cash_on_delivery" });
    assert.equal(once.subscription.lineCount, 0);
    assert.equal(once.paymentMethods.find((m) => m.method === "cash_on_delivery")?.available, true);
  });
});

describe("renewals", () => {
  test("go-live CF-4: while a contract text is a draft the renewal is held (no order, no mail, next run unchanged)", async () => {
    assert.ok(codSubscriptionId > 0);
    await makeDue(codSubscriptionId);
    const before = await subOf(codSubscriptionId);
    const ordersBefore = (await renewalOrders(codSubscriptionId)).length;
    const failedMailsBefore = (await mails("subscription_renewal_failed")).length;
    const held = await renewSubscription(codSubscriptionId, { ...NO_EFFECTS });
    assert.deepEqual(held, { status: "held", subscriptionId: codSubscriptionId, reason: "legal_unavailable" });
    assert.deepEqual(await renewDueSubscriptions({ ...NO_EFFECTS, only: [codSubscriptionId] }), { renewed: 0, skipped: 0, failed: 0, busy: 0, held: 1 });
    const after = await subOf(codSubscriptionId);
    assert.equal(after.nextRunAt.getTime(), before.nextRunAt.getTime(), "the daily job retries");
    assert.equal(after.failedCount, before.failedCount, "a shop-side hold is not the customer's failure");
    assert.equal((await renewalOrders(codSubscriptionId)).length, ordersBefore);
    assert.equal((await mails("subscription_renewal_failed")).length, failedMailsBefore, "no renewal-failed mail to the customer");
  });

  test("two runs at the same time create exactly one renewal order with the current price and stock", async () => {
    assert.ok(codSubscriptionId > 0);
    await makeDue(codSubscriptionId);
    const before = await stockOf("PR-OKY-500");
    const [a, b] = await Promise.all([renewSubscription(codSubscriptionId, renewOpts), renewSubscription(codSubscriptionId, renewOpts)]);
    const statuses = [a.status, b.status].sort();
    assert.equal(statuses.filter((x) => x === "renewed").length, 1, `one renewal: ${JSON.stringify([a, b])}`);
    assert.ok(statuses.every((x) => x === "renewed" || x === "locked" || x === "not_due"));
    const orders = await renewalOrders(codSubscriptionId);
    assert.equal(orders.length, 1);
    const order = orders[0];
    assert.equal(order.status, "processing");
    assert.equal(order.paymentMethod, "cash_on_delivery");
    assert.equal(order.userId, USER_ID);
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 2);
    assert.equal(items[0].unitPrice, resolveUnitPrice({ basePrice: v["PR-OKY-500"].price, subscriptionPercent: 5, quantity: 2 }).unitPrice);
    assert.equal(order.subtotal, items[0].unitPrice * 2);
    assert.equal(order.grandTotal, order.subtotal + order.shippingTotal + order.paymentFee - order.discountTotal);
    assert.equal(await stockOf("PR-OKY-500"), before - 2);
    const sub = await subOf(codSubscriptionId);
    assert.ok(sub.nextRunAt.getTime() > Date.now(), "next renewal moved one period on");
    assert.equal(sub.lastOrderId, order.id);
    assert.equal(sub.failedCount, 0);
    // later runs in the same period do nothing
    assert.equal((await renewSubscription(codSubscriptionId, renewOpts)).status, "not_due");
    assert.deepEqual(await renewDueSubscriptions({ ...renewOpts, only: [codSubscriptionId] }), { renewed: 0, skipped: 0, failed: 0, busy: 0, held: 0 });
  });

  test("the job twice at once (next period): one more order", async () => {
    await makeDue(codSubscriptionId);
    const results = await Promise.all([renewDueSubscriptions({ ...renewOpts, only: [codSubscriptionId] }), renewDueSubscriptions({ ...renewOpts, only: [codSubscriptionId] })]);
    assert.equal(results.reduce((n, r) => n + r.renewed, 0), 1);
    assert.equal((await renewalOrders(codSubscriptionId)).length, 2);
  });

  test("skip the next delivery, pause and resume", async () => {
    const skip = await change(codSubscriptionId, { kind: "skip" });
    assert.ok(skip.ok);
    assert.equal((await subOf(codSubscriptionId)).skipNext, true);
    assert.equal((await change(codSubscriptionId, { kind: "skip" })).ok, false, "already skipped");
    await makeDue(codSubscriptionId);
    const r = await renewSubscription(codSubscriptionId, renewOpts);
    assert.equal(r.status, "skipped");
    let sub = await subOf(codSubscriptionId);
    assert.equal(sub.skipNext, false);
    assert.ok(sub.nextRunAt.getTime() > Date.now());
    assert.equal((await renewalOrders(codSubscriptionId)).length, 2, "no order for the skipped period");

    assert.ok((await change(codSubscriptionId, { kind: "pause" })).ok);
    await makeDue(codSubscriptionId);
    assert.equal((await renewSubscription(codSubscriptionId, renewOpts)).status, "not_due", "paused subscriptions never renew");
    assert.ok((await change(codSubscriptionId, { kind: "resume" })).ok);
    sub = await subOf(codSubscriptionId);
    assert.equal(sub.status, "active");
    assert.ok(sub.nextRunAt.getTime() > Date.now(), "a renewal date that passed while paused restarts from today");
    const changed = await mails("subscription_changed");
    assert.ok(changed.length >= 3, "skip, pause and resume each mailed the customer");
  });

  test("another customer's subscription is not found (IDOR), and plans must be active", async () => {
    const r = await change(codSubscriptionId, { kind: "cancel" }, OTHER_ID);
    assert.deepEqual(r, { ok: false, code: "not_found" });
    assert.equal((await subOf(codSubscriptionId)).status, "active");
    const inactive = await change(codSubscriptionId, { kind: "plan", planId: 999_999 });
    assert.deepEqual(inactive, { ok: false, code: "plan_unavailable" });
  });

  test("out of stock: no order, one failure mail per period, retried on the next run", async () => {
    const stock = await stockOf("PR-OKY-500");
    await db.update(schema.productVariants).set({ stock: 1 }).where(eq(schema.productVariants.id, v["PR-OKY-500"].id));
    try {
      await makeDue(codSubscriptionId);
      const due = (await subOf(codSubscriptionId)).nextRunAt;
      const first = await renewSubscription(codSubscriptionId, renewOpts);
      assert.deepEqual(first, { status: "failed", subscriptionId: codSubscriptionId, reason: "out_of_stock" });
      const again = await renewSubscription(codSubscriptionId, renewOpts);
      assert.equal(again.status, "failed");
      const sub = await subOf(codSubscriptionId);
      assert.equal(sub.failedCount, 2);
      assert.equal(sub.nextRunAt.getTime(), due.getTime(), "the renewal date stays: retried next run");
      assert.equal((await renewalOrders(codSubscriptionId)).length, 2);
      assert.equal(await stockOf("PR-OKY-500"), 1, "nothing was decremented");
      const failed = await mails("subscription_renewal_failed");
      assert.equal(failed.length, 1, "deduped per period");
      assert.equal(failed[0].dedupeKey, `subscription:${codSubscriptionId}:renewal_failed:${istanbulDay(due)}`);
    } finally {
      await db.update(schema.productVariants).set({ stock }).where(eq(schema.productVariants.id, v["PR-OKY-500"].id));
    }
    const ok3 = await renewSubscription(codSubscriptionId, renewOpts);
    assert.equal(ok3.status, "renewed");
    assert.equal((await subOf(codSubscriptionId)).failedCount, 0);
  });

  test("changed quantity rules (min / max / step): the renewal is refused instead of charging another quantity", async () => {
    const before = await subOf(codSubscriptionId);
    assert.deepEqual(before.items, [{ variantId: v["PR-OKY-500"].id, quantity: 2 }]);
    const [variant] = await db.select({ min: schema.productVariants.minQuantity }).from(schema.productVariants).where(eq(schema.productVariants.id, v["PR-OKY-500"].id));
    const orders = (await renewalOrders(codSubscriptionId)).length;
    const stock = await stockOf("PR-OKY-500");
    // Raw SQL: leaves updated_at alone (the file restores variant timestamps).
    await db.execute(sql`update product_variants set min_quantity = 3 where id = ${v["PR-OKY-500"].id}`);
    try {
      await makeDue(codSubscriptionId);
      const r = await renewSubscription(codSubscriptionId, renewOpts);
      assert.deepEqual(r, { status: "failed", subscriptionId: codSubscriptionId, reason: "quantity_changed" });
      assert.equal((await renewalOrders(codSubscriptionId)).length, orders, "no order for 3 units");
      assert.equal(await stockOf("PR-OKY-500"), stock);
      assert.deepEqual((await subOf(codSubscriptionId)).items, before.items, "the subscription itself is unchanged");
    } finally {
      await db.execute(sql`update product_variants set min_quantity = ${variant.min} where id = ${v["PR-OKY-500"].id}`);
      await db.update(s).set({ nextRunAt: before.nextRunAt, failedCount: before.failedCount }).where(eq(s.id, codSubscriptionId));
    }
  });

  test("an address change to the same address changes nothing and sends no second mail", async () => {
    const sub = await subOf(codSubscriptionId);
    const sent = (await mails("subscription_changed")).length;
    const same = await change(codSubscriptionId, { kind: "address", address: { ...sub.shippingAddress } });
    assert.ok(same.ok && !same.mailQueued);
    assert.equal((await subOf(codSubscriptionId)).updatedAt.getTime(), sub.updatedAt.getTime());
    assert.equal((await mails("subscription_changed")).length, sent);
  });

  test("reminder: once per renewal, with a skip link for exactly that renewal", async () => {
    const next = new Date(Date.now() + 2 * 86_400_000);
    await db.update(s).set({ nextRunAt: next, reminderSentAt: null, skipNext: false }).where(eq(s.id, codSubscriptionId));
    assert.deepEqual(await sendDueReminders({ only: [codSubscriptionId] }), { queued: 1, scanned: 1 });
    assert.deepEqual(await sendDueReminders({ only: [codSubscriptionId] }), { queued: 0, scanned: 1 });
    const [mail] = await mails("subscription_reminder");
    assert.equal(mail.dedupeKey, `subscription:${codSubscriptionId}:remind:${istanbulDay(next)}`);
    const token = decodeURIComponent(/atla=([^\s"&<]+)/.exec(mail.text)?.[1] ?? "");
    const parsed = readSubscriptionSkipToken(token);
    assert.deepEqual(parsed, { subscriptionId: codSubscriptionId, runAt: next.getTime() });
    assert.equal(readSubscriptionSkipToken(token.slice(0, -2) + "xx"), null, "forged token");
    assert.deepEqual(await change(codSubscriptionId, { kind: "skip", runAt: next.getTime() - 1 }), { ok: false, code: "state" }, "stale link");
    assert.ok((await change(codSubscriptionId, { kind: "skip", runAt: parsed!.runAt })).ok);
    assert.ok((await change(codSubscriptionId, { kind: "unskip" })).ok);
  });
});

describe("deleted accounts (KVKK)", () => {
  test("a card order paid after the account was deleted starts no subscription; no review request goes to the old address", async () => {
    const who: CustomerContext = { ...RETAIL_CUSTOMER, userId: DEL_ID };
    const cartId = await subscriptionCart([{ sku: "PR-POR-500", quantity: 1, plan: MONTHLY_PLAN_ID }], who);
    const order = ok(await placeOrder(checkout("card", DEL_EMAIL), { cartId, customer: who, settings: codSettings, ...NO_EFFECTS, allowDraftContracts: true }));
    assert.equal(order.status, "pending_payment");
    await db.transaction((tx) => anonymizeAccount(tx, DEL_ID, { actorId: DEL_ID, reason: "self" }));

    const [row] = await db.select({ grandTotal: o.grandTotal }).from(o).where(eq(o.id, order.orderId));
    const paid = await completeCardPayment({ orderId: order.orderId, providerRef: `${TAG}-${randomUUID()}`, success: true, amount: row.grandTotal, provider: "simulator" }, NO_EFFECTS);
    assert.ok(paid.ok && paid.status === "paid", JSON.stringify(paid));
    assert.equal((await db.select({ id: s.id }).from(s).where(eq(s.userId, DEL_ID))).length, 0, "no subscription for a deleted account");
    const events = await db.select({ type: schema.orderEvents.type, data: schema.orderEvents.data }).from(schema.orderEvents).where(eq(schema.orderEvents.orderId, order.orderId));
    assert.deepEqual(events.find((e) => e.type === "subscription_skipped")?.data, { reason: "account_deleted" });
    assert.equal(events.some((e) => e.type === "subscription_created"), false);
    const toOld = await db.select({ template: schema.emailMessages.template }).from(schema.emailMessages).where(eq(schema.emailMessages.toEmail, DEL_EMAIL));
    assert.deepEqual(toOld, [], "nothing queued to the deleted customer's address");

    // Delivered long enough ago for the review request: skipped (and stamped), not mailed.
    await db.update(o).set({ status: "delivered", deliveredAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(o.id, order.orderId));
    const run = await sendDueReviewRequests(db, { orderIds: [order.orderId] });
    assert.deepEqual(run, { queued: 0, skipped: 1, disabled: 0 });
    const [stamped] = await db.select({ at: o.reviewRequestedAt }).from(o).where(eq(o.id, order.orderId));
    assert.ok(stamped.at);
  });
});

describe("card subscriptions", () => {
  test("start when the first order is paid; renewals wait cardPaymentWindowHours, not 30 minutes", async () => {
    const cartId = await subscriptionCart([{ sku: "PR-POR-500", quantity: 1, plan: MONTHLY_PLAN_ID }]);
    const order = ok(await placeOrder(checkout("card"), { cartId, customer, settings: codSettings, ...NO_EFFECTS, allowDraftContracts: true }));
    assert.equal(order.status, "pending_payment");
    const before = await db.select({ id: s.id }).from(s).where(and(eq(s.userId, USER_ID), eq(s.paymentMethod, "card")));
    assert.equal(before.length, 0, "nothing starts before the payment");
    const [row] = await db.select({ grandTotal: o.grandTotal }).from(o).where(eq(o.id, order.orderId));
    const ref = `${TAG}-${randomUUID()}`;
    const paid = await completeCardPayment({ orderId: order.orderId, providerRef: ref, success: true, amount: row.grandTotal, provider: "simulator" }, NO_EFFECTS);
    assert.ok(paid.ok && paid.status === "paid", JSON.stringify(paid));
    const replay = await completeCardPayment({ orderId: order.orderId, providerRef: ref, success: true, amount: row.grandTotal, provider: "simulator" }, NO_EFFECTS);
    assert.ok(replay.ok && replay.alreadyProcessed);
    const cardSubs = await db.select().from(s).where(and(eq(s.userId, USER_ID), eq(s.paymentMethod, "card")));
    assert.equal(cardSubs.length, 1, "started once");
    const cardSub = cardSubs[0];

    await makeDue(cardSub.id);
    const r = await renewSubscription(cardSub.id, renewOpts);
    assert.equal(r.status, "renewed");
    assert.ok(r.status === "renewed" && r.orderStatus === "pending_payment");
    const [renewal] = await renewalOrders(cardSub.id);
    const due = await mails("subscription_payment_due");
    assert.equal(due.length, 1);
    assert.ok(due[0].text.includes(renewal.orderNumber) && due[0].text.includes(`t=${renewal.accessToken}`), "pay link to the order page");

    // 31 minutes old: an ordinary card order would expire, a renewal does not.
    const ago = (ms: number) => new Date(Date.now() - ms);
    await db.update(o).set({ createdAt: ago(31 * 60_000) }).where(eq(o.id, renewal.id));
    await db.update(schema.payments).set({ updatedAt: ago(31 * 60_000) }).where(eq(schema.payments.orderId, renewal.id));
    assert.equal((await expireStalePendingOrders(30, { ...NO_EFFECTS, renewalWindowHours: 72, only: [renewal.id] })).expired, 0);
    const stock = await stockOf("PR-POR-500");
    await db.update(o).set({ createdAt: ago(73 * 3_600_000) }).where(eq(o.id, renewal.id));
    await db.update(schema.payments).set({ updatedAt: ago(73 * 3_600_000) }).where(eq(schema.payments.orderId, renewal.id));
    assert.equal((await expireStalePendingOrders(30, { ...NO_EFFECTS, renewalWindowHours: 72, only: [renewal.id] })).expired, 1);
    const [cancelled] = await db.select({ status: o.status }).from(o).where(eq(o.id, renewal.id));
    assert.equal(cancelled.status, "cancelled");
    assert.equal(await stockOf("PR-POR-500"), stock + 1, "restocked");
    assert.equal((await subOf(cardSub.id)).status, "active", "the subscription continues with the next period");
  });
});
