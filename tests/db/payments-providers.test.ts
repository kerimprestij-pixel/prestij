// iyzico and PayTR end to end against scripts/payment-mock.mjs (started in-process on a free port with
// made-up keys): placeOrder → initiate → the provider's page/iframe → callback / notification through
// the same Request handlers the routes use → completeCardPayment → refund. Covers success, failure +
// retry, duplicate notifications, amount tampering, forged signatures/hashes, unknown tokens, a missing
// configuration and refunds (iyzico cancel and per-item refund, PayTR iade).
//
// Shared database: only rows this file creates are touched (orders by e-mail @test.local with the
// payments- prefix, their carts, audit rows of the test actor, the callback rate-limit counter); stock
// and variant timestamps of the two variants used and the sequences are put back (never below what other
// writers used meanwhile). The payments settings row is never written: settings are passed in.
import "./setup/local-only";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addItem } from "@/lib/cart/mutations";
import { loadCommerceSettings, type CommerceSettings } from "@/lib/cart/settings";
import { RETAIL_CUSTOMER } from "@/lib/cart/types";
import { placeOrder, type PlaceOrderSuccess } from "@/lib/orders/place";
import { expireStalePendingOrders, type OrderActor } from "@/lib/orders/status";
import { attemptsOf } from "@/lib/payments/attempts";
import { getCardPageSession, getCardReturnState } from "@/lib/payments/card-page";
import { completeCardPayment, initiateCardPayment } from "@/lib/payments/complete";
import { iyzicoCallbackResponse, paytrNotifyResponse } from "@/lib/payments/http";
import { reconcileCardOrder } from "@/lib/payments/reconcile";
import { refundCardPayment } from "@/lib/payments/refund";
import { forgetLimits } from "@/lib/rate-limit-store";
import { startPaymentMock } from "../../scripts/payment-mock.mjs";

const EMAIL_PREFIX = "payments-buyer";
const EMAIL_DOMAIN = "test.local";
const IP = "203.0.113.77";
const ACTOR_ID = "payments-test-actor";
const ADMIN: OrderActor = { userId: ACTOR_ID, role: "admin", name: "Ödeme Testi" };
const NO_EFFECTS = { effects: false } as const;
const SKUS = ["PR-LVL-500", "PR-LVL-5L"] as const;

type Mock = Awaited<ReturnType<typeof startPaymentMock>>;

let mock: Mock;
let notifyServer: Server;
let notifyUrl = "";
let settings: CommerceSettings;
const variants: Record<string, { id: number; stock: number; updatedAt: string }> = {};
const createdCarts = new Set<string>();
let emailSeq = 0;
const savedEnv: Record<string, string | undefined> = {};
const ENV = {
  PAYMENT_SIMULATOR: "false",
  IYZICO_API_KEY: "mock-key",
  IYZICO_SECRET_KEY: "mock-secret",
  PAYTR_MERCHANT_ID: "100001",
  PAYTR_MERCHANT_KEY: "mock-paytr-key",
  PAYTR_MERCHANT_SALT: "mock-paytr-salt",
} as const;

type SeqSnap = { name: string; table: string | null; lastValue: bigint; isCalled: boolean };
let sequences: SeqSnap[] = [];

async function snapshotSequences(): Promise<SeqSnap[]> {
  const out: SeqSnap[] = [];
  for (const table of ["orders", "order_items", "order_events", "payments", "carts", "cart_items", "audit_log"]) {
    const r = await db.execute<{ seq: string | null }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const name = r[0]?.seq;
    if (!name) continue;
    const v = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${name}`));
    out.push({ name, table, lastValue: BigInt(v[0].last_value), isCalled: v[0].is_called });
  }
  const o = await db.execute<{ last_value: string; is_called: boolean }>(sql`select last_value::text, is_called from order_number_seq`);
  out.push({ name: "order_number_seq", table: null, lastValue: BigInt(o[0].last_value), isCalled: o[0].is_called });
  return out;
}

/** Back to the snapshot value, but never below an id someone else used meanwhile. */
async function restoreSequences() {
  for (const s of sequences) {
    let used = BigInt(0);
    if (s.table) {
      const r = await db.execute<{ m: string | null }>(sql.raw(`select max(id)::text as m from ${s.table}`));
      used = BigInt(r[0].m ?? "0");
    } else {
      const r = await db.execute<{ m: string | null }>(sql`select max(substring(order_number from 6)::bigint)::text as m from orders`);
      used = BigInt(r[0].m ?? "0");
    }
    if (used > s.lastValue) await db.execute(sql`select setval(${s.name}::regclass, ${used.toString()}::bigint, true)`);
    else await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue.toString()}::bigint, ${s.isCalled})`);
  }
}

async function cleanup() {
  const o = schema.orders;
  const ids = (await db.select({ id: o.id }).from(o).where(like(o.email, `${EMAIL_PREFIX}+%@${EMAIL_DOMAIN}`))).map((r) => r.id);
  if (ids.length) await db.delete(o).where(inArray(o.id, ids)); // items, events, payments cascade
  if (createdCarts.size) await db.delete(schema.carts).where(inArray(schema.carts.id, [...createdCarts]));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
  await forgetLimits([`paycb:ip:${IP}`]);
  for (const v of Object.values(variants)) {
    await db.execute(sql`update product_variants set stock = ${v.stock}, updated_at = ${v.updatedAt}::timestamptz where id = ${v.id}`);
  }
  await restoreSequences();
}

const withProvider = (provider: "iyzico" | "paytr"): CommerceSettings => ({
  ...settings,
  payments: { ...settings.payments, card: { ...settings.payments.card, enabled: true, provider, testMode: true, installments: true, maxInstallments: 3 } },
});

async function placeCardOrder(provider: "iyzico" | "paytr", quantity = 1): Promise<PlaceOrderSuccess> {
  const s = withProvider(provider);
  let cartId: string | null = null;
  for (const code of SKUS) {
    const r = await addItem(cartId, { variantId: variants[code].id, quantity }, { customer: RETAIL_CUSTOMER, locale: "tr", settings: s });
    assert.ok(r.ok, `addItem ${code}: ${JSON.stringify(r)}`);
    cartId = r.cartId;
    createdCarts.add(cartId);
  }
  const result = await placeOrder(
    {
      locale: "tr",
      contact: { email: `${EMAIL_PREFIX}+${++emailSeq}@${EMAIL_DOMAIN}`, phone: "0532 123 45 67" },
      shippingAddress: { fullName: "Ödeme Testi Alıcı", city: "Kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. Test Sok. No: 1", postalCode: "38010" },
      invoice: { type: "individual", sameAsShipping: true },
      paymentMethod: "card",
      consents: { preInformation: true, distanceSales: true },
    },
    { cartId, customer: RETAIL_CUSTOMER, settings: s, clientIp: IP, ...NO_EFFECTS, allowDraftContracts: true },
  );
  assert.equal(result.ok, true, `placeOrder: ${JSON.stringify(result)}`);
  return result as PlaceOrderSuccess;
}

const order = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const paymentsOf = (id: number) => db.select().from(schema.payments).where(eq(schema.payments.orderId, id)).orderBy(schema.payments.id);
const eventsOf = async (id: number, type: string) => db.select().from(schema.orderEvents).where(and(eq(schema.orderEvents.orderId, id), eq(schema.orderEvents.type, type)));

async function mockPost(path: string, body: unknown) {
  const res = await fetch(`${mock.url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** The browser POST from iyzico's page, through the same handler as the route. */
async function iyzicoCallback(token: string, orderNumber: string) {
  const res = await iyzicoCallbackResponse(
    new Request(`http://payments.test/api/payments/iyzico/callback?o=${encodeURIComponent(orderNumber)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": IP },
      body: new URLSearchParams({ token }).toString(),
    }),
    NO_EFFECTS,
  );
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

const iyzicoToken = (redirectTo: string) => {
  const m = /\/iyzico\/odeme\/([0-9a-f-]{36})$/.exec(redirectTo);
  assert.ok(m, `iyzico page URL: ${redirectTo}`);
  return m[1];
};

async function latestPaytrAttempt(orderId: number) {
  const rows = await paymentsOf(orderId);
  const attempt = attemptsOf(rows.at(-1)?.raw).at(-1);
  assert.ok(attempt?.iframeUrl, "PayTR attempt with an iframe URL");
  return { ...attempt, token: attempt.iframeUrl!.split("/").pop()! };
}

before(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  const leftovers = await db.select({ id: schema.orders.id }).from(schema.orders).where(like(schema.orders.email, `${EMAIL_PREFIX}+%@${EMAIL_DOMAIN}`));
  assert.equal(leftovers.length, 0, "payments test orders left over from an earlier run");
  sequences = await snapshotSequences();
  const v = schema.productVariants;
  const rows = await db.select({ id: v.id, sku: v.sku, stock: v.stock, updatedAt: sql<string>`${v.updatedAt}::text` }).from(v).where(inArray(v.sku, [...SKUS]));
  for (const r of rows) variants[r.sku] = { id: r.id, stock: r.stock, updatedAt: r.updatedAt };
  for (const code of SKUS) assert.ok(variants[code], `seed variant ${code}`);
  settings = await loadCommerceSettings();

  notifyServer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const response = await paytrNotifyResponse(
        new Request("http://payments.test/api/payments/paytr/notify", { method: "POST", headers: { "content-type": String(req.headers["content-type"] ?? "") }, body: Buffer.concat(chunks) }),
        NO_EFFECTS,
      );
      res.writeHead(response.status, { "Content-Type": response.headers.get("content-type") ?? "text/plain" });
      res.end(await response.text());
    });
  });
  await new Promise<void>((resolve) => notifyServer.listen(0, "127.0.0.1", resolve));
  notifyUrl = `http://127.0.0.1:${(notifyServer.address() as AddressInfo).port}/api/payments/paytr/notify`;
  mock = await startPaymentMock({
    port: 0,
    iyzico: { apiKey: ENV.IYZICO_API_KEY, secretKey: ENV.IYZICO_SECRET_KEY },
    paytr: { merchantId: ENV.PAYTR_MERCHANT_ID, merchantKey: ENV.PAYTR_MERCHANT_KEY, merchantSalt: ENV.PAYTR_MERCHANT_SALT },
    paytrNotifyUrl: notifyUrl,
    log: () => {},
  });
  process.env.IYZICO_BASE_URL = mock.url;
  process.env.PAYTR_BASE_URL = mock.url;
});

after(async () => {
  try {
    await cleanup();
    const left = await db.select({ id: schema.orders.id }).from(schema.orders).where(like(schema.orders.email, `${EMAIL_PREFIX}+%@${EMAIL_DOMAIN}`));
    assert.equal(left.length, 0, "test orders removed");
    for (const v of Object.values(variants)) {
      const [row] = await db.select({ stock: schema.productVariants.stock, updatedAt: sql<string>`${schema.productVariants.updatedAt}::text` }).from(schema.productVariants).where(eq(schema.productVariants.id, v.id));
      assert.deepEqual(row, { stock: v.stock, updatedAt: v.updatedAt }, "stock and timestamp restored");
    }
  } finally {
    await mock?.close();
    await new Promise<void>((resolve) => (notifyServer ? notifyServer.close(() => resolve()) : resolve()));
    for (const k of [...Object.keys(ENV), "IYZICO_BASE_URL", "PAYTR_BASE_URL"]) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------

describe("iyzico Checkout Form against the mock", () => {
  let paidOrderId = 0;

  test("success: hosted page → browser callback → retrieve + signature → paid; a replayed callback changes nothing", async () => {
    const placed = await placeCardOrder("iyzico");
    assert.ok(placed.redirectTo.startsWith(`${mock.url}/iyzico/odeme/`), placed.redirectTo);
    const token = iyzicoToken(placed.redirectTo);
    const [initiated] = await paymentsOf(placed.orderId);
    assert.equal(initiated.provider, "iyzico");
    assert.equal(initiated.status, "initiated");
    assert.deepEqual(
      attemptsOf(initiated.raw).map((a) => [a.n, a.ref, a.testMode, a.conversationId]),
      [[1, token, true, `${placed.orderNumber}-1`]],
    );

    assert.equal((await mockPost("/_mock/iyzico/complete", { token, outcome: "success" })).status, 200);
    const cb = await iyzicoCallback(token, placed.orderNumber);
    assert.equal(cb.status, 303);
    assert.match(cb.location, new RegExp(`^/tr/siparis/${placed.orderNumber}\\?t=${placed.accessToken}&new=1$`));
    const row = await order(placed.orderId);
    assert.equal(row.status, "paid");
    assert.equal(row.paymentProvider, "iyzico");
    const [paid] = await paymentsOf(placed.orderId);
    assert.equal(paid.status, "succeeded");
    assert.equal(paid.providerRef, row.paymentRef);
    assert.equal(paid.amount, row.grandTotal);
    assert.equal((paid.raw as Record<string, unknown>).testMode, true);
    assert.equal(attemptsOf(paid.raw).length, 1, "attempts kept on the completed row");

    const replay = await iyzicoCallback(token, placed.orderNumber);
    assert.equal(replay.status, 303);
    assert.equal(replay.location, `/tr/siparis/${placed.orderNumber}?t=${placed.accessToken}`);
    assert.equal((await eventsOf(placed.orderId, "payment_succeeded")).length, 1);
    assert.equal((await paymentsOf(placed.orderId)).length, 1);
    paidOrderId = placed.orderId;
  });

  test("failure keeps the order pending; the retry starts a new attempt that can succeed", async () => {
    const placed = await placeCardOrder("iyzico");
    const first = iyzicoToken(placed.redirectTo);
    await mockPost("/_mock/iyzico/complete", { token: first, outcome: "failure" });
    const cb = await iyzicoCallback(first, placed.orderNumber);
    assert.equal(cb.location, `/tr/siparis/${placed.orderNumber}?t=${placed.accessToken}&payment=failed`);
    assert.equal((await order(placed.orderId)).status, "pending_payment");
    const [failed] = await paymentsOf(placed.orderId);
    assert.equal(failed.status, "failed");
    assert.equal(failed.providerRef, `FAIL-${first}`);
    assert.equal((await eventsOf(placed.orderId, "payment_failed")).length, 1);

    const retry = await initiateCardPayment(placed.orderId, { clientIp: IP, payments: withProvider("iyzico").payments });
    assert.equal(retry.ok, true);
    const second = iyzicoToken(retry.ok ? retry.redirectUrl : "");
    assert.notEqual(second, first);
    const rows = await paymentsOf(placed.orderId);
    assert.equal(rows.length, 2);
    assert.deepEqual(attemptsOf(rows[1].raw).map((a) => a.n), [2]);
    await mockPost("/_mock/iyzico/complete", { token: second, outcome: "success" });
    const ok = await iyzicoCallback(second, placed.orderNumber);
    assert.match(ok.location, /&new=1$/);
    assert.equal((await order(placed.orderId)).status, "paid");
  });

  test("a correctly signed but lower amount is refused as amount_mismatch; the order stays unpaid", async () => {
    const placed = await placeCardOrder("iyzico");
    const token = iyzicoToken(placed.redirectTo);
    await mockPost("/_mock/iyzico/complete", { token, outcome: "success", tamper: "amount" });
    const cb = await iyzicoCallback(token, placed.orderNumber);
    assert.match(cb.location, /&payment=failed$/);
    assert.equal((await order(placed.orderId)).status, "pending_payment");
    const mismatch = await eventsOf(placed.orderId, "payment_amount_mismatch");
    assert.equal(mismatch.length, 1);
    const data = mismatch[0].data as { expected: number; received: number };
    assert.equal(data.expected - data.received, 100);
  });

  test("forged: a bad response signature, an unknown token and another order's token never reach the order page", async () => {
    const placed = await placeCardOrder("iyzico");
    const token = iyzicoToken(placed.redirectTo);
    await mockPost("/_mock/iyzico/complete", { token, outcome: "success", tamper: "signature" });
    const bad = await iyzicoCallback(token, placed.orderNumber);
    assert.equal(bad.location, "/tr/siparis");
    assert.equal((await order(placed.orderId)).status, "pending_payment");
    assert.equal((await paymentsOf(placed.orderId))[0].status, "initiated");

    const unknown = await iyzicoCallback("00000000-0000-4000-8000-00000000abcd", placed.orderNumber);
    assert.equal(unknown.location, "/tr/siparis");
    const garbage = await iyzicoCallback("<script>", placed.orderNumber);
    assert.equal(garbage.location, "/tr/siparis");

    const other = await placeCardOrder("iyzico");
    const otherToken = iyzicoToken(other.redirectTo);
    await mockPost("/_mock/iyzico/complete", { token: otherToken, outcome: "success" });
    const crossed = await iyzicoCallback(otherToken, placed.orderNumber);
    assert.equal(crossed.location, "/tr/siparis", "basketId of the other order → order_mismatch");
    assert.equal((await order(placed.orderId)).status, "pending_payment");
    assert.equal((await order(other.orderId)).status, "pending_payment");
  });

  test("refund: same-day cancel at iyzico, then mark_refunded (stock back); a second refund is refused", async () => {
    assert.ok(paidOrderId, "paid order from the first test");
    const before = await order(paidOrderId);
    const result = await refundCardPayment(paidOrderId, ADMIN, { expectedStatus: "paid", clientIp: IP, ...NO_EFFECTS });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.ok && result.ref.startsWith("cancel:") && result.transitioned);
    const after = await order(paidOrderId);
    assert.equal(after.status, "refunded");
    assert.equal(before.grandTotal, after.grandTotal);
    const [payment] = await paymentsOf(paidOrderId);
    assert.equal(payment.status, "refunded");
    assert.equal(((payment.raw as Record<string, unknown>).refund as Record<string, unknown>).state, "done");
    assert.equal((await eventsOf(paidOrderId, "payment_refunded")).length, 1);
    const state = (await (await fetch(`${mock.url}/_mock/state`)).json()) as { iyzicoPayments: { paymentId: string; cancelled: boolean }[] };
    assert.equal(state.iyzicoPayments.find((p) => p.paymentId === payment.providerRef)?.cancelled, true);
    const audit = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.userId, ACTOR_ID), eq(schema.auditLog.entityId, String(paidOrderId))));
    assert.equal(audit.length, 1);

    const again = await refundCardPayment(paidOrderId, ADMIN, NO_EFFECTS);
    assert.equal(again.ok, false);
    assert.equal(!again.ok && again.code, "invalid_transition");
    const staff = await refundCardPayment(paidOrderId, { ...ADMIN, role: "editor" }, NO_EFFECTS);
    assert.equal(!staff.ok && staff.code, "forbidden");
  });

  test("refund after the cancel window: one refund per basket item, totals match", async () => {
    await mockPost("/_mock/config", { iyzicoCancel: "refuse" });
    try {
      const placed = await placeCardOrder("iyzico", 2);
      const token = iyzicoToken(placed.redirectTo);
      await mockPost("/_mock/iyzico/complete", { token, outcome: "success" });
      await iyzicoCallback(token, placed.orderNumber);
      const result = await refundCardPayment(placed.orderId, ADMIN, { clientIp: IP, ...NO_EFFECTS });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.ok(result.ok && result.ref.startsWith("refund:"));
      const [payment] = await paymentsOf(placed.orderId);
      const refund = (payment.raw as Record<string, unknown>).refund as { method: string; items: string[] };
      assert.equal(refund.method, "refund");
      const items = (payment.raw as { itemTransactions: unknown[] }).itemTransactions;
      assert.equal(refund.items.length, items.length);
      const state = (await (await fetch(`${mock.url}/_mock/state`)).json()) as { iyzicoPayments: { paymentId: string; refunded: number }[] };
      assert.equal(state.iyzicoPayments.find((p) => p.paymentId === payment.providerRef)?.refunded, payment.amount);
      assert.equal((await order(placed.orderId)).status, "refunded");
    } finally {
      await mockPost("/_mock/config", { iyzicoCancel: "allow" });
    }
  });
});

describe("iyzico results that never reached us (reconciliation)", () => {
  /** Makes the order and its open payment look `minutes` old (the expiry job's clock). */
  async function age(orderId: number, orderMinutes: number, paymentMinutes = orderMinutes) {
    await db.execute(sql`update orders set created_at = now() - make_interval(mins => ${orderMinutes}) where id = ${orderId}`);
    await db.execute(sql`update payments set updated_at = now() - make_interval(mins => ${paymentMinutes}) where order_id = ${orderId}`);
  }

  test("iyzico down after a successful 3-D Secure: 'checking' page, no new attempt or cancel while unknown, then the charge pays the order", async () => {
    const placed = await placeCardOrder("iyzico");
    const token = iyzicoToken(placed.redirectTo);
    await mockPost("/_mock/iyzico/complete", { token, outcome: "success" });
    await mockPost("/_mock/config", { iyzicoRetrieve: "down" });
    try {
      const cb = await iyzicoCallback(token, placed.orderNumber);
      assert.equal(cb.status, 303);
      assert.equal(cb.location, `/tr/siparis/${placed.orderNumber}?t=${placed.accessToken}&payment=checking`, "never 'payment failed' for an unknown result");
      assert.equal((await order(placed.orderId)).status, "pending_payment");
      assert.equal((await eventsOf(placed.orderId, "payment_failed")).length, 0);

      assert.equal((await reconcileCardOrder(placed.orderId, NO_EFFECTS)).state, "unknown", "the retry button refuses on 'unknown'");
      await age(placed.orderId, 120);
      assert.equal((await expireStalePendingOrders(30, { only: [placed.orderId], effects: false })).expired, 0, "not cancelled while the result is unknown");
      assert.equal((await order(placed.orderId)).status, "pending_payment");
    } finally {
      await mockPost("/_mock/config", { iyzicoRetrieve: "ok" });
    }
    const check = await reconcileCardOrder(placed.orderId, NO_EFFECTS);
    assert.equal(check.state, "paid");
    const row = await order(placed.orderId);
    assert.equal(row.status, "paid");
    const payments = await paymentsOf(placed.orderId);
    assert.deepEqual(payments.map((p) => p.status), ["succeeded"], "one payment, no second attempt");
    assert.equal(payments[0].providerRef, row.paymentRef);
    assert.equal((await eventsOf(placed.orderId, "payment_succeeded")).length, 1);
    const state = (await (await fetch(`${mock.url}/_mock/state`)).json()) as { iyzico: { basketId: string }[] };
    assert.equal(state.iyzico.filter((s) => s.basketId === placed.orderNumber).length, 1, "iyzico saw a single checkout form");
    assert.equal((await reconcileCardOrder(placed.orderId, NO_EFFECTS)).state, "paid", "idempotent");
  });

  test("the expiry job pays an order whose callback never came, and still cancels an abandoned form", async () => {
    const charged = await placeCardOrder("iyzico");
    await mockPost("/_mock/iyzico/complete", { token: iyzicoToken(charged.redirectTo), outcome: "success" });
    const abandoned = await placeCardOrder("iyzico"); // form opened, never completed (iyzico: INIT_THREEDS)
    await age(charged.orderId, 45);
    await age(abandoned.orderId, 45);
    const run = await expireStalePendingOrders(30, { only: [charged.orderId, abandoned.orderId], effects: false });
    assert.deepEqual(run.orderNumbers, [abandoned.orderNumber]);
    assert.equal((await order(charged.orderId)).status, "paid");
    assert.equal((await order(abandoned.orderId)).status, "cancelled");
  });
});

describe("PayTR: a late failure of an older attempt", () => {
  test("is recorded on its own row: the open attempt stays, no 'payment failed', no expiry; the newer attempt then pays", async () => {
    const placed = await placeCardOrder("paytr");
    const first = await latestPaytrAttempt(placed.orderId);
    const retry = await initiateCardPayment(placed.orderId, { clientIp: IP, payments: withProvider("paytr").payments });
    assert.equal(retry.ok, true);
    const second = await latestPaytrAttempt(placed.orderId);
    assert.notEqual(second.ref, first.ref);

    const late = await mockPost("/_mock/paytr/complete", { token: first.token, outcome: "failure" });
    assert.equal((late.json.notify as { body: string }).body, "OK");
    const rows = await paymentsOf(placed.orderId);
    assert.deepEqual(rows.map((p) => p.status), ["initiated", "failed"]);
    assert.equal((rows[1].raw as Record<string, unknown>).superseded, true);
    assert.equal(rows[1].providerRef, first.ref);
    assert.deepEqual(attemptsOf(rows[0].raw).map((a) => a.ref), [first.ref, second.ref], "the open row keeps both attempts");
    assert.equal((await eventsOf(placed.orderId, "payment_failed")).length, 0, "no failure event, so no 'complete your payment' mail");
    const session = await getCardPageSession({ orderNumber: placed.orderNumber, token: placed.accessToken });
    assert.equal(session.state, "ready", "the card page still shows the newer attempt");

    // Order 35 minutes old, newer attempt started 5 minutes ago: not stale.
    await db.execute(sql`update orders set created_at = now() - interval '35 minutes' where id = ${placed.orderId}`);
    await db.execute(sql`update payments set updated_at = now() - interval '5 minutes' where id = ${rows[0].id}`);
    assert.equal((await expireStalePendingOrders(30, { only: [placed.orderId], effects: false })).expired, 0);

    // A replay of the late failure changes nothing.
    await mockPost("/_mock/paytr/replay", { merchantOid: first.ref });
    assert.equal((await paymentsOf(placed.orderId)).length, 2);

    await mockPost("/_mock/paytr/complete", { token: second.token, outcome: "success" });
    const row = await order(placed.orderId);
    assert.equal(row.status, "paid");
    assert.equal(row.paymentRef, second.ref);
    assert.equal((await eventsOf(placed.orderId, "payment_after_cancel")).length, 0);
  });
});

describe("PayTR iFrame against the mock", () => {
  let paidOrderId = 0;
  let paidOid = "";

  test("success: get-token → /odeme/kart iframe → server notification → OK + paid; the return page sees it", async () => {
    const placed = await placeCardOrder("paytr");
    assert.equal(placed.redirectTo, `/tr/odeme/kart?order=${placed.orderNumber}&t=${placed.accessToken}`);
    const attempt = await latestPaytrAttempt(placed.orderId);
    assert.match(attempt.ref, new RegExp(`^PR${placed.orderNumber.slice(3)}A1[A-Z0-9]{6}$`));
    assert.equal(attempt.paymentAmount, (await order(placed.orderId)).grandTotal);
    const session = await getCardPageSession({ orderNumber: placed.orderNumber, token: placed.accessToken });
    assert.equal(session.state, "ready");
    assert.ok(session.state === "ready" && session.iframeUrl.startsWith(`${mock.url}/odeme/guvenli/`) && session.frameOrigin === mock.url);
    assert.equal((await getCardPageSession({ orderNumber: placed.orderNumber, token: "00000000-0000-4000-8000-000000000000" })).state, "not_found");

    const done = await mockPost("/_mock/paytr/complete", { token: attempt.token, outcome: "success" });
    const notify = done.json.notify as { status: number; body: string };
    assert.deepEqual([notify.status, notify.body], [200, "OK"]);
    const row = await order(placed.orderId);
    assert.equal(row.status, "paid");
    assert.equal(row.paymentRef, attempt.ref);

    const r = new URL(String(done.json.redirectUrl)).searchParams.get("r");
    const back = await getCardReturnState(r);
    assert.equal(back.state, "paid");
    assert.equal(back.state === "paid" && back.redirectTo, `/tr/siparis/${placed.orderNumber}?t=${placed.accessToken}&new=1`);
    assert.equal((await getCardReturnState(`${r}x`)).state, "invalid");
    assert.equal((await getCardPageSession({ orderNumber: placed.orderNumber, token: placed.accessToken })).state, "not_pending");
    paidOrderId = placed.orderId;
    paidOid = attempt.ref;
  });

  test("duplicate notification: answered OK, applied once", async () => {
    const replay = await mockPost("/_mock/paytr/replay", { merchantOid: paidOid });
    const notify = replay.json.notify as { status: number; body: string };
    assert.deepEqual([notify.status, notify.body], [200, "OK"]);
    assert.equal((await eventsOf(paidOrderId, "payment_succeeded")).length, 1);
    assert.equal((await paymentsOf(paidOrderId)).length, 1);
  });

  test("failure keeps the order pending (return page: failed); a retry with a new merchant_oid succeeds", async () => {
    const placed = await placeCardOrder("paytr");
    const first = await latestPaytrAttempt(placed.orderId);
    const done = await mockPost("/_mock/paytr/complete", { token: first.token, outcome: "failure" });
    assert.equal((done.json.notify as { body: string }).body, "OK");
    assert.equal((await order(placed.orderId)).status, "pending_payment");
    const back = await getCardReturnState(new URL(String(done.json.redirectUrl)).searchParams.get("r"));
    assert.equal(back.state, "failed");
    assert.equal(back.state === "failed" && back.redirectTo, `/tr/siparis/${placed.orderNumber}?t=${placed.accessToken}&payment=failed`);

    const retry = await initiateCardPayment(placed.orderId, { clientIp: IP, payments: withProvider("paytr").payments, locale: "en" });
    assert.equal(retry.ok && retry.redirectUrl, `/en/checkout/card?order=${placed.orderNumber}&t=${placed.accessToken}`);
    const second = await latestPaytrAttempt(placed.orderId);
    assert.notEqual(second.ref, first.ref);
    assert.equal(second.n, 2);
    await mockPost("/_mock/paytr/complete", { token: second.token, outcome: "success" });
    assert.equal((await order(placed.orderId)).status, "paid");
  });

  test("tampered: a lower total_amount (valid hash) is recorded as a mismatch; a bad hash gets 400 and changes nothing", async () => {
    const placed = await placeCardOrder("paytr");
    const attempt = await latestPaytrAttempt(placed.orderId);
    const short = await mockPost("/_mock/paytr/complete", { token: attempt.token, outcome: "success", tamper: "amount" });
    assert.equal((short.json.notify as { body: string }).body, "OK");
    assert.equal((await order(placed.orderId)).status, "pending_payment");
    assert.equal((await eventsOf(placed.orderId, "payment_amount_mismatch")).length, 1);

    const other = await placeCardOrder("paytr");
    const otherAttempt = await latestPaytrAttempt(other.orderId);
    const forged = await mockPost("/_mock/paytr/complete", { token: otherAttempt.token, outcome: "success", tamper: "hash" });
    assert.deepEqual([(forged.json.notify as { status: number }).status, (forged.json.notify as { body: string }).body], [400, "PAYTR notification failed: bad hash"]);
    assert.equal((await order(other.orderId)).status, "pending_payment");
    assert.equal((await paymentsOf(other.orderId))[0].status, "initiated");

    const garbage = await paytrNotifyResponse(new Request("http://payments.test/api/payments/paytr/notify", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }), NO_EFFECTS);
    assert.equal(garbage.status, 400);
  });

  test("without PayTR keys a genuine notification gets 503 (PayTR retries later) and nothing is applied", async () => {
    const saved = process.env.PAYTR_MERCHANT_SALT;
    delete process.env.PAYTR_MERCHANT_SALT;
    try {
      const res = await paytrNotifyResponse(
        new Request("http://payments.test/api/payments/paytr/notify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "merchant_oid=X&status=success&total_amount=1&hash=y" }),
        NO_EFFECTS,
      );
      assert.equal(res.status, 503);
      assert.deepEqual(await completeCardPayment({ orderId: paidOrderId, providerRef: "X", success: true, amount: 1, provider: "paytr" }, NO_EFFECTS), { ok: false, code: "not_configured" });
    } finally {
      process.env.PAYTR_MERCHANT_SALT = saved;
    }
  });

  test("refund through PayTR's iade API, then mark_refunded", async () => {
    const result = await refundCardPayment(paidOrderId, ADMIN, { expectedStatus: "paid", ...NO_EFFECTS });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal((await order(paidOrderId)).status, "refunded");
    const state = (await (await fetch(`${mock.url}/_mock/state`)).json()) as { paytr: { merchantOid: string; refunded: number; amount: number }[] };
    const session = state.paytr.find((p) => p.merchantOid === paidOid);
    assert.equal(session?.refunded, session?.amount);
    const [payment] = await paymentsOf(paidOrderId);
    assert.equal(payment.status, "refunded");
  });
});

describe("PAYMENT_SIMULATOR stays the local default", () => {
  test("simulator on: it wins over configured providers; pay, then a local refund", async () => {
    process.env.PAYMENT_SIMULATOR = "true";
    try {
      const placed = await placeCardOrder("iyzico");
      assert.equal(placed.redirectTo, `/tr/odeme/simulator?order=${placed.orderNumber}&t=${placed.accessToken}`);
      const [initiated] = await paymentsOf(placed.orderId);
      assert.equal(initiated.provider, "simulator");
      const { simulateCardPayment } = await import("@/lib/payments/simulator");
      const paid = await simulateCardPayment({ orderNumber: placed.orderNumber, token: placed.accessToken, outcome: "success" }, NO_EFFECTS);
      assert.equal(paid.ok && paid.status, "paid");
      const refund = await refundCardPayment(placed.orderId, ADMIN, NO_EFFECTS);
      assert.equal(refund.ok && refund.provider, "simulator");
      assert.equal((await order(placed.orderId)).status, "refunded");
    } finally {
      process.env.PAYMENT_SIMULATOR = "false";
    }
  });
});
