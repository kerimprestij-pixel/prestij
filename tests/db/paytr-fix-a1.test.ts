// PayTR-fix IMPL-A1 against the local PostgreSQL (C3, C2 + X2, C4):
//   reconcile   PayTR Durum Sorgu for an order's unsettled attempts: "paid" is applied exactly like the
//               notification (same rows, events and stock as the notification path; idempotent per merchant_oid),
//               "not paid" (err 004) and "unknown" (001-003, HTTP 503, timeout) change nothing; a test payment
//               for an attempt sent live is never applied on a public origin (the shared C5 helper); a lower
//               amount writes nothing and stays unknown (PayTR-fix R1: only the notification may record a mismatch).
//   expiry      a PayTR order waits until its latest attempt is 45 minutes old (no inquiry before), is cancelled
//               (and restocked) only on "not paid", is paid on "paid", is kept on "unknown", and after 24 h of
//               "unknown" gets the dashboard to-do once (order_events "payment_unverified", counted by
//               countUnverifiedCardPayments); each run is bounded (breaker, order limit, time budget).
//   retry       checkBeforeCardRetry asks PayTR first (a paid order flips to paid), then refuses "verifying"
//               inside the window, "checking" while PayTR cannot be reached, and allows a retry after a decline.
//   mock        scripts/payment-mock.mjs /odeme/durum-sorgu (127.0.0.1, in-process) with its own token check and
//               the /_mock/config switch (auto / paid / not_paid / error / down), through queryPaytrStatus.
// No network: the reconcile, expiry and retry tests inject a fetch stub (it re-derives the paytr_token itself);
// PAYTR_BASE_URL points at a .invalid host so nothing could leave this machine anyway.
//
// Shared database: every order, item, payment and event is written inside a transaction that is rolled back
// (one per test); the sequences those inserts advanced are put back afterwards. Environment variables are
// restored after each test.
//   npx tsx --test --conditions=react-server --env-file=.env.local --import ./tests/db/setup/local-only.ts tests/db/paytr-fix-a1.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { createHmac, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, mock, test } from "node:test";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DbExecutor } from "@/lib/cart/settings";
import { expireStalePendingOrders } from "@/lib/orders/status";
import { withAttempt } from "@/lib/payments/attempts";
import { parsePaytrNotification, paytrIframeToken, paytrMerchantOid, paytrNotifyHash } from "@/lib/payments/paytr-crypto";
import { queryPaytrStatus } from "@/lib/payments/paytr-gateway";
import { applyPaytrResult } from "@/lib/payments/paytr-result";
import { PAYMENT_UNVERIFIED_EVENT } from "@/lib/payments/paytr-window";
import { checkBeforeCardRetry, paytrInquiryBudget, reconcileCardOrder } from "@/lib/payments/reconcile";
import { countUnverifiedCardPayments } from "@/lib/payments/unverified";
import { startPaymentMock } from "../../scripts/payment-mock.mjs";
import { restoreSequences, snapshotSequences, type SequenceSnapshot } from "./setup/sequences";

const env = process.env as Record<string, string | undefined>;
/** Made-up PayTR credentials (never real ones); nothing is sent anywhere with them. */
const KEYS = { PAYTR_MERCHANT_ID: "100001", PAYTR_MERCHANT_KEY: "paytr-fix-a1-test-key", PAYTR_MERCHANT_SALT: "paytr-fix-a1-test-salt" } as const;
const BASE = "https://paytr.invalid";
const TEST_ENV = { ...KEYS, PAYTR_BASE_URL: BASE, PAYMENT_SIMULATOR: "false", IYZICO_API_KEY: undefined, IYZICO_SECRET_KEY: undefined, IYZICO_BASE_URL: undefined };
const LIVE = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.prestij.example" };
const NO_EFFECTS = { effects: false } as const;
const MIN = 60_000;
const TOTAL = 39_970;
const QTY = 2;

let seqs: SequenceSnapshot;
let variant: { id: number; stock: number; sku: string };

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
}

class Rollback extends Error {}
/** Runs `fn` in a transaction that is always rolled back, with the test PayTR environment. */
async function inRollback(fn: (tx: DbExecutor) => Promise<void>): Promise<void> {
  await withEnv(TEST_ENV, async () => {
    try {
      await db.transaction(async (tx) => {
        await fn(tx as unknown as DbExecutor);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  });
}

// ---------------------------------------------------------------------------------------------------
// The Durum Sorgu stub: answers per merchant_oid, checks every request independently of src/.

type Answer = "paid" | "paid_test" | "short" | "not_paid" | "not_found" | "error" | "down" | "timeout";

function paytrStub() {
  const answers = new Map<string, Answer>();
  const calls: string[] = [];
  const problems: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const form = new URLSearchParams(String(init?.body ?? ""));
    const oid = form.get("merchant_oid") ?? "";
    calls.push(oid);
    if (url !== `${BASE}/odeme/durum-sorgu`) problems.push(`url ${url}`);
    if (init?.method !== "POST") problems.push(`method ${init?.method}`);
    if ([...form.keys()].sort().join(",") !== "merchant_id,merchant_oid,paytr_token") problems.push(`fields ${[...form.keys()].join(",")}`);
    if (form.get("merchant_id") !== KEYS.PAYTR_MERCHANT_ID) problems.push("merchant_id");
    // dev.paytr.com/durum-sorgu: base64(HMAC-SHA256(merchant_id + merchant_oid + merchant_salt, merchant_key)), raw digest
    const token = createHmac("sha256", KEYS.PAYTR_MERCHANT_KEY).update(`${KEYS.PAYTR_MERCHANT_ID}${oid}${KEYS.PAYTR_MERCHANT_SALT}`).digest("base64");
    if (form.get("paytr_token") !== token) problems.push(`token for ${oid}`);
    switch (answers.get(oid) ?? "not_paid") {
      case "paid":
        // Decimal currency units with a comma, like the docs' "10,8" (399.70 TL).
        return json({ status: "success", payment_amount: "399,7", payment_total: "399,70", currency: "TL", taksit: "0", odeme_tipi: "KART", test_mode: "0", net_tutar: "389.75", kesinti_tutari: "9.95", returns: [] });
      case "paid_test":
        return json({ status: "success", payment_amount: "399,7", payment_total: "399,7", currency: "TL", odeme_tipi: "KART", test_mode: "1", returns: [] });
      case "short":
        return json({ status: "success", payment_amount: "399,7", payment_total: "398,70", currency: "TL", odeme_tipi: "KART", test_mode: "0", returns: [] });
      case "not_paid":
        return json({ status: "error", err_no: "004", err_msg: "merchant_oid ile basarili odeme bulunamadi" });
      case "not_found":
        return json({ status: "error", err_no: "004", err_msg: "merchant_oid ile islem bulunamadi" });
      case "error":
        return json({ status: "error", err_no: "001", err_msg: "Gecersiz istek veya magaza aktif degil" });
      case "down":
        return new Response("<html><body>503 Service Unavailable</body></html>", { status: 503, headers: { "content-type": "text/html" } });
      case "timeout":
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          if (!signal) return reject(new Error("no abort signal: the inquiry would wait forever"));
          signal.addEventListener("abort", () => reject(signal.reason));
        });
    }
  }) as typeof fetch;
  return { answers, calls, problems, fetch: fetchStub };
}

// ---------------------------------------------------------------------------------------------------
// Rows

type Seeded = { id: number; orderNumber: string; oids: string[] };

/**
 * A PayTR card order in pending_payment with one tracked line (stock decremented at "placement") and an
 * initiated payments row holding its attempts; `attempts` = minutes ago each attempt started (oldest first).
 */
async function seedOrder(tx: DbExecutor, opts: { orderMinutes: number; attempts: number[]; attemptTestMode?: boolean }): Promise<Seeded> {
  const orderNumber = `PR-9${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
  const now = Date.now();
  const address = { fullName: "PayTR Test Alıcı", phone: "+905321234567", city: "Kayseri", district: "Kocasinan", line1: "Test Sok. No: 1" };
  const [order] = await tx
    .insert(schema.orders)
    .values({
      orderNumber,
      email: `paytr-fix-a1-${orderNumber.slice(3)}@test.local`,
      locale: "tr",
      status: "pending_payment",
      paymentMethod: "card",
      subtotal: TOTAL,
      grandTotal: TOTAL,
      shippingAddress: address,
      invoice: { type: "individual", fullName: address.fullName },
      createdAt: new Date(now - opts.orderMinutes * MIN),
      updatedAt: new Date(now - opts.orderMinutes * MIN),
    })
    .returning({ id: schema.orders.id });
  await tx.insert(schema.orderItems).values({
    orderId: order.id,
    variantId: variant.id,
    snapshot: { productId: 0, productName: { tr: "Test ürünü" }, variantTitle: { tr: "500 ml" }, sku: variant.sku, stockTracked: true },
    unitPrice: TOTAL / QTY,
    quantity: QTY,
    lineTotal: TOTAL,
  });
  await tx.execute(sql`update product_variants set stock = stock - ${QTY} where id = ${variant.id}`);
  const oids: string[] = [];
  let raw: unknown = {};
  opts.attempts.forEach((minutesAgo, i) => {
    const ref = paytrMerchantOid(orderNumber, i + 1, "ABCDE" + String.fromCharCode(70 + i));
    oids.push(ref);
    raw = withAttempt(raw, {
      n: i + 1,
      ref,
      testMode: opts.attemptTestMode ?? true,
      at: new Date(now - minutesAgo * MIN).toISOString(),
      iframeUrl: `${BASE}/odeme/guvenli/${ref.toLowerCase()}`,
      paymentAmount: TOTAL,
    });
  });
  const lastMinutes = opts.attempts.at(-1) ?? opts.orderMinutes;
  await tx.insert(schema.payments).values({
    orderId: order.id,
    provider: "paytr",
    status: "initiated",
    amount: TOTAL,
    raw: raw as Record<string, unknown>,
    createdAt: new Date(now - opts.orderMinutes * MIN),
    updatedAt: new Date(now - lastMinutes * MIN),
  });
  return { id: order.id, orderNumber, oids };
}

const orderOf = async (tx: DbExecutor, id: number) => (await tx.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const paymentsOf = (tx: DbExecutor, id: number) => tx.select().from(schema.payments).where(eq(schema.payments.orderId, id)).orderBy(asc(schema.payments.id));
const eventsOf = (tx: DbExecutor, id: number) => tx.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, id)).orderBy(asc(schema.orderEvents.id));
const stockOf = async (tx: DbExecutor) => (await tx.select({ stock: schema.productVariants.stock }).from(schema.productVariants).where(eq(schema.productVariants.id, variant.id)))[0].stock;

/** What a paid order looks like, with its own merchant_oid replaced, for comparing two paths. */
async function paidShape(tx: DbExecutor, seeded: Seeded) {
  const oid = seeded.oids.at(-1)!;
  const o = await orderOf(tx, seeded.id);
  const pays = await paymentsOf(tx, seeded.id);
  const evs = await eventsOf(tx, seeded.id);
  const norm = (v: unknown) => JSON.parse(JSON.stringify(v ?? null).split(oid).join("<oid>").split(seeded.orderNumber).join("<order>"));
  return {
    order: { status: o.status, paymentProvider: o.paymentProvider, paymentRef: norm(o.paymentRef), paid: o.paidAt !== null, cancelledAt: o.cancelledAt },
    payments: pays.map((p) => {
      const r = (p.raw ?? {}) as Record<string, unknown>;
      return {
        provider: p.provider,
        status: p.status,
        amount: p.amount,
        providerRef: norm(p.providerRef),
        attempts: Array.isArray(r.attempts) ? r.attempts.length : 0,
        testMode: r.testMode,
        requestedAmount: r.requestedAmount,
        totalAmount: r.totalAmount,
        paymentAmount: r.paymentAmount,
        providerTestMode: r.providerTestMode,
        resultStatus: r.status,
      };
    }),
    events: evs.map((e) => ({ type: e.type, data: norm(e.data), createdBy: e.createdBy })),
  };
}

before(async () => {
  seqs = await snapshotSequences();
  const [v] = await db.execute<{ id: number; stock: number; sku: string }>(
    sql`select id, stock, sku from product_variants where track_stock and is_active order by id limit 1`,
  );
  assert.ok(v, "a stock-tracked variant (seeded)");
  variant = { id: Number(v.id), stock: Number(v.stock), sku: String(v.sku) };
});

after(async () => {
  try {
    const [v] = await db.execute<{ stock: number }>(sql`select stock from product_variants where id = ${variant.id}`);
    assert.equal(Number(v.stock), variant.stock, "stock untouched (every change was rolled back)");
    await restoreSequences(seqs);
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------

describe("reconcile: PayTR Durum Sorgu for unsettled attempts", () => {
  test("paid: applied like the notification (order paid, one succeeded row, events), then idempotent per merchant_oid", async () => {
    await inRollback(async (tx) => {
      const stub = paytrStub();
      const order = await seedOrder(tx, { orderMinutes: 50, attempts: [50] });
      const oid = order.oids[0];
      stub.answers.set(oid, "paid");
      const stock = await stockOf(tx);
      const result = await reconcileCardOrder(order.id, { ...NO_EFFECTS, executor: tx, fetch: stub.fetch });
      assert.equal(result.state, "paid");
      assert.deepEqual(stub.calls, [oid]);
      const o = await orderOf(tx, order.id);
      assert.equal(o.status, "paid");
      assert.equal(o.paymentProvider, "paytr");
      assert.equal(o.paymentRef, oid);
      assert.ok(o.paidAt);
      const pays = await paymentsOf(tx, order.id);
      assert.deepEqual(pays.map((p) => [p.status, p.providerRef, p.amount]), [["succeeded", oid, TOTAL]]);
      const raw = pays[0].raw as Record<string, unknown>;
      assert.equal(raw.source, "durum-sorgu");
      assert.equal(raw.totalAmount, TOTAL, "399,70 TL → 39970 kuruş");
      assert.equal(raw.requestedAmount, TOTAL);
      assert.equal(raw.testMode, true, "the attempt's test mode");
      assert.equal((raw.attempts as unknown[]).length, 1, "attempts kept on the completed row");
      assert.deepEqual((await eventsOf(tx, order.id)).map((e) => e.type), ["payment_succeeded", "status_changed"]);
      assert.equal(await stockOf(tx), stock, "a payment does not touch stock");

      // Later: the order no longer waits (no inquiry); a late notification for the same merchant_oid is a replay.
      assert.equal((await reconcileCardOrder(order.id, { ...NO_EFFECTS, executor: tx, fetch: stub.fetch })).state, "paid");
      assert.equal(stub.calls.length, 1, "no second inquiry for a paid order");
      const replay = await applyPaytrResult(
        { orderId: order.id, merchantOid: oid, success: true, totalAmount: TOTAL, raw: { provider: "paytr", providerTestMode: true }, attempt: { testMode: true, paymentAmount: TOTAL } },
        { ...NO_EFFECTS, executor: tx },
      );
      assert.deepEqual(replay, { ok: true, status: "paid", alreadyProcessed: true, orderId: order.id, orderNumber: order.orderNumber });
      assert.equal((await eventsOf(tx, order.id)).length, 2, "no second event");
      assert.deepEqual(stub.problems, []);
    });
  });

  test("the same effects as the notification path (rows, events, stock)", async () => {
    // The notification handler (callbacks.ts) hands its verified fields to applyPaytrResult; so does the reconcile.
    const callbacks = readFileSync("src/lib/payments/callbacks.ts", "utf8");
    assert.match(callbacks, /await applyPaytrResult\(\s*\{ orderId: order\.id, merchantOid: n\.merchantOid, success: n\.success, totalAmount: n\.totalAmount, raw: n\.raw, attempt \}/);
    await inRollback(async (tx) => {
      const stub = paytrStub();
      const byNotification = await seedOrder(tx, { orderMinutes: 50, attempts: [50] });
      const byInquiry = await seedOrder(tx, { orderMinutes: 50, attempts: [50] });
      const stock = await stockOf(tx);

      // Exactly what handlePaytrNotify does once the hash is verified and the attempt found.
      const oidA = byNotification.oids[0];
      const fields = { merchant_oid: oidA, status: "success", total_amount: String(TOTAL), payment_amount: String(TOTAL), payment_type: "card", currency: "TL", test_mode: "1", installment_count: "1" };
      const keys = { merchantKey: KEYS.PAYTR_MERCHANT_KEY, merchantSalt: KEYS.PAYTR_MERCHANT_SALT };
      const parsed = parsePaytrNotification({ ...fields, hash: paytrNotifyHash(keys, { merchantOid: oidA, status: "success", totalAmount: String(TOTAL) }) }, keys);
      assert.ok(parsed.ok);
      const n = parsed.notification;
      const viaNotify = await applyPaytrResult(
        { orderId: byNotification.id, merchantOid: n.merchantOid, success: n.success, totalAmount: n.totalAmount, raw: n.raw, attempt: { testMode: true, paymentAmount: TOTAL } },
        { ...NO_EFFECTS, executor: tx },
      );
      assert.ok(viaNotify.ok && viaNotify.status === "paid" && !viaNotify.alreadyProcessed);

      stub.answers.set(byInquiry.oids[0], "paid_test");
      assert.equal((await reconcileCardOrder(byInquiry.id, { ...NO_EFFECTS, executor: tx, fetch: stub.fetch })).state, "paid");

      const a = await paidShape(tx, byNotification);
      const b = await paidShape(tx, byInquiry);
      assert.deepEqual(b, a);
      assert.equal(a.order.status, "paid");
      assert.deepEqual(a.events.map((e) => e.type), ["payment_succeeded", "status_changed"]);
      assert.equal(await stockOf(tx), stock, "neither path touches stock");
      assert.deepEqual(stub.problems, []);
    });
  });

  test("not paid (err 004, both texts) and unknown (001, HTTP 503, timeout) change nothing", async () => {
    await inRollback(async (tx) => {
      for (const [answer, state] of [
        ["not_paid", "unpaid"],
        ["not_found", "unpaid"],
        ["error", "unknown"],
        ["down", "unknown"],
        ["timeout", "unknown"],
      ] as const) {
        const stub = paytrStub();
        const order = await seedOrder(tx, { orderMinutes: 50, attempts: [50] });
        stub.answers.set(order.oids[0], answer);
        const before = await paidShape(tx, order);
        const started = Date.now();
        const result = await reconcileCardOrder(order.id, { ...NO_EFFECTS, executor: tx, fetch: stub.fetch, paytrBudget: paytrInquiryBudget({ timeoutMs: 600 }) });
        assert.equal(result.state, state, answer);
        assert.equal(result.paytr?.notPaid, state === "unpaid" ? 1 : 0, answer);
        assert.equal(result.paytr?.unknown, state === "unknown" ? 1 : 0, answer);
        assert.deepEqual(await paidShape(tx, order), before, `${answer}: nothing written`);
        assert.ok(Date.now() - started < 3000, `${answer}: a slow PayTR is cut off`);
        assert.deepEqual(stub.problems, []);
      }
    });
  });

  test("C5 rule: a test payment for an attempt sent live is never applied on a public origin", async () => {
    await inRollback(async (tx) => {
      const stub = paytrStub();
      const live = await seedOrder(tx, { orderMinutes: 50, attempts: [50], attemptTestMode: false });
      const testAttempt = await seedOrder(tx, { orderMinutes: 50, attempts: [50], attemptTestMode: true });
      stub.answers.set(live.oids[0], "paid_test");
      stub.answers.set(testAttempt.oids[0], "paid_test");
      await withEnv(LIVE, async () => {
        const refused = await reconcileCardOrder(live.id, { ...NO_EFFECTS, executor: tx, fetch: stub.fetch });
        assert.equal(refused.state, "unpaid");
        assert.equal(refused.paytr?.notPaid, 1);
        assert.equal((await orderOf(tx, live.id)).status, "pending_payment");
        assert.deepEqual((await paymentsOf(tx, live.id)).map((p) => p.status), ["initiated"]);
        assert.equal((await eventsOf(tx, live.id)).length, 0);
        // A test attempt (panel test mode) may be paid by a test payment.
        assert.equal((await reconcileCardOrder(testAttempt.id, { ...NO_EFFECTS, executor: tx, fetch: stub.fetch })).state, "paid");
      });
      // Locally the rule never applies (the payment mock answers test_mode=1).
      assert.equal((await reconcileCardOrder(live.id, { ...NO_EFFECTS, executor: tx, fetch: stub.fetch })).state, "paid");
      assert.deepEqual(stub.problems, []);
    });
  });

  test("a lower Durum Sorgu amount writes nothing and stays unknown (PayTR-fix R1)", async () => {
    await inRollback(async (tx) => {
      const stub = paytrStub();
      const order = await seedOrder(tx, { orderMinutes: 50, attempts: [50] });
      stub.answers.set(order.oids[0], "short");
      const before = await paidShape(tx, order);
      const warned = mock.method(console, "warn", () => {});
      let result: Awaited<ReturnType<typeof reconcileCardOrder>>;
      try {
        result = await reconcileCardOrder(order.id, { ...NO_EFFECTS, executor: tx, fetch: stub.fetch });
        assert.ok(
          warned.mock.calls.some((c) => String(c.arguments[0]).includes(`amount not applied order=${order.id} requested=${TOTAL} total=${TOTAL} reported=${TOTAL - 100}`)),
          "a log line with the order and both amounts",
        );
      } finally {
        warned.mock.restore();
      }
      assert.equal(result.state, "unknown");
      assert.deepEqual({ notPaid: result.paytr?.notPaid, unknown: result.paytr?.unknown }, { notPaid: 0, unknown: 1 });
      assert.deepEqual(await paidShape(tx, order), before, "no failed row, no mismatch event");
      // Still unsettled: asked again next time (the notification can still settle it), and a retry is not allowed.
      assert.deepEqual(await checkBeforeCardRetry(order.id, { ...NO_EFFECTS, executor: tx, fetch: stub.fetch }), { ok: false, code: "checking" });
      assert.equal(stub.calls.length, 2);
    });
  });
});

describe("expiry: PayTR orders (45-minute window, Durum Sorgu, 24 h to-do, bounded runs)", () => {
  const run = (tx: DbExecutor, ids: number[], fetch: typeof globalThis.fetch, extra: Parameters<typeof expireStalePendingOrders>[1] = {}) =>
    expireStalePendingOrders(30, { ...NO_EFFECTS, renewalWindowHours: 72, only: ids, executor: tx, fetch, ...extra });

  test("inside the window nothing is asked or cancelled, even when the order itself is old", async () => {
    await inRollback(async (tx) => {
      const stub = paytrStub();
      const order = await seedOrder(tx, { orderMinutes: 90, attempts: [40] });
      const result = await run(tx, [order.id], stub.fetch);
      assert.deepEqual({ expired: result.expired, waiting: result.waiting, unknown: result.unknown }, { expired: 0, waiting: 1, unknown: 0 });
      assert.deepEqual(stub.calls, [], "no inquiry before the latest attempt is 45 minutes old");
      assert.equal((await orderOf(tx, order.id)).status, "pending_payment");
    });
  });

  test("after the window: 'not paid' for every unsettled attempt cancels and restocks; 'paid' pays; 'unknown' keeps", async () => {
    await inRollback(async (tx) => {
      const stub = paytrStub();
      const unpaid = await seedOrder(tx, { orderMinutes: 120, attempts: [110, 50] });
      const paid = await seedOrder(tx, { orderMinutes: 60, attempts: [50] });
      const unknown = await seedOrder(tx, { orderMinutes: 60, attempts: [50] });
      const halfKnown = await seedOrder(tx, { orderMinutes: 120, attempts: [110, 50] });
      unpaid.oids.forEach((oid) => stub.answers.set(oid, "not_paid"));
      stub.answers.set(paid.oids[0], "paid");
      stub.answers.set(unknown.oids[0], "down");
      stub.answers.set(halfKnown.oids[0], "error"); // the older attempt cannot be checked
      stub.answers.set(halfKnown.oids[1], "not_paid");
      const stock = await stockOf(tx);
      const result = await run(tx, [unpaid.id, paid.id, unknown.id, halfKnown.id], stub.fetch, { limits: { maxInquiryFailures: 5 } });
      assert.deepEqual(result.orderNumbers, [unpaid.orderNumber]);
      assert.deepEqual({ expired: result.expired, paid: result.paid, unknown: result.unknown, waiting: result.waiting }, { expired: 1, paid: 1, unknown: 2, waiting: 0 });
      assert.deepEqual(new Set(stub.calls), new Set([...unpaid.oids, ...paid.oids, ...unknown.oids, ...halfKnown.oids]), "every unsettled attempt asked");

      const cancelled = await orderOf(tx, unpaid.id);
      assert.equal(cancelled.status, "cancelled");
      const ev = (await eventsOf(tx, unpaid.id)).find((e) => e.type === "status_changed");
      assert.equal((ev?.data as { reason?: string }).reason, "payment_timeout");
      assert.equal((ev?.data as { restocked?: boolean }).restocked, true);
      assert.equal(await stockOf(tx), stock + QTY, "only the cancelled order is restocked");
      assert.equal((await orderOf(tx, paid.id)).status, "paid");
      assert.equal((await orderOf(tx, unknown.id)).status, "pending_payment", "never cancelled while PayTR cannot answer");
      assert.equal((await orderOf(tx, halfKnown.id)).status, "pending_payment", "one unclear attempt is enough to keep it");
      assert.equal((await eventsOf(tx, unknown.id)).length, 0, "no to-do before 24 hours");
      assert.deepEqual(stub.problems, []);
    });
  });

  test("24 h of 'unknown': kept pending, the dashboard to-do is raised once", async () => {
    await inRollback(async (tx) => {
      const stub = paytrStub();
      const order = await seedOrder(tx, { orderMinutes: 25 * 60, attempts: [25 * 60] });
      stub.answers.set(order.oids[0], "error");
      const before = await countUnverifiedCardPayments(tx);
      const first = await run(tx, [order.id], stub.fetch);
      assert.deepEqual({ expired: first.expired, unknown: first.unknown }, { expired: 0, unknown: 1 });
      assert.equal((await orderOf(tx, order.id)).status, "pending_payment");
      const todo = (await eventsOf(tx, order.id)).filter((e) => e.type === PAYMENT_UNVERIFIED_EVENT);
      assert.equal(todo.length, 1);
      assert.equal(todo[0].createdBy, "system");
      assert.deepEqual({ ...(todo[0].data as Record<string, unknown>), since: "-" }, { provider: "paytr", merchantOid: order.oids[0], since: "-", attempts: 1 });
      assert.equal(await countUnverifiedCardPayments(tx), before + 1, "the dashboard line counts it");

      await run(tx, [order.id], stub.fetch);
      assert.equal((await eventsOf(tx, order.id)).filter((e) => e.type === PAYMENT_UNVERIFIED_EVENT).length, 1, "raised once");

      // PayTR answers again: "not paid" cancels it, and the to-do disappears with the pending status.
      stub.answers.set(order.oids[0], "not_paid");
      assert.equal((await run(tx, [order.id], stub.fetch)).expired, 1);
      assert.equal(await countUnverifiedCardPayments(tx), before);
      assert.deepEqual(stub.problems, []);
    });
  });

  test("a run is bounded: the breaker stops asking after repeated timeouts; order limit and time budget defer the rest", async () => {
    await inRollback(async (tx) => {
      const stub = paytrStub();
      const orders = [];
      for (let i = 0; i < 4; i++) orders.push(await seedOrder(tx, { orderMinutes: 60, attempts: [50] }));
      for (const o of orders) stub.answers.set(o.oids[0], "timeout");
      const ids = orders.map((o) => o.id);
      const started = Date.now();
      const outage = await run(tx, ids, stub.fetch, { limits: { inquiryTimeoutMs: 600, maxInquiryFailures: 2 } });
      assert.equal(stub.calls.length, 2, "two timeouts, then no more inquiries in this run");
      assert.deepEqual({ expired: outage.expired, unknown: outage.unknown }, { expired: 0, unknown: 4 });
      assert.ok(Date.now() - started < 4000, `an outage costs about two timeouts (${Date.now() - started} ms)`);

      for (const o of orders) stub.answers.set(o.oids[0], "not_paid");
      const limited = await run(tx, ids, stub.fetch, { limits: { maxOrders: 2 } });
      assert.deepEqual({ expired: limited.expired, deferred: limited.deferred }, { expired: 2, deferred: 2 });
      assert.deepEqual(limited.orderNumbers, orders.slice(0, 2).map((o) => o.orderNumber), "oldest ids first");

      const noTime = await run(tx, ids, stub.fetch, { limits: { budgetMs: 0 } });
      assert.deepEqual({ expired: noTime.expired, deferred: noTime.deferred }, { expired: 0, deferred: 2 });
      assert.equal((await run(tx, ids, stub.fetch)).expired, 2, "the next run takes the rest");
      assert.deepEqual(stub.problems, []);
    });
  });
});

describe("retry: checkBeforeCardRetry (what retryCardPayment runs first)", () => {
  test("asks PayTR first, then refuses inside the window ('verifying'), allows after it, refuses while PayTR is unreachable", async () => {
    await inRollback(async (tx) => {
      const stub = paytrStub();
      const opts = { ...NO_EFFECTS, executor: tx, fetch: stub.fetch };

      const open = await seedOrder(tx, { orderMinutes: 12, attempts: [10] });
      assert.deepEqual(await checkBeforeCardRetry(open.id, opts), { ok: false, code: "verifying" });
      assert.deepEqual(stub.calls, [open.oids[0]], "PayTR was asked before refusing");
      assert.equal((await orderOf(tx, open.id)).status, "pending_payment");

      const formClosed = await seedOrder(tx, { orderMinutes: 40, attempts: [35] });
      assert.deepEqual(await checkBeforeCardRetry(formClosed.id, opts), { ok: false, code: "verifying" }, "form closed, window still open");

      const paidMeanwhile = await seedOrder(tx, { orderMinutes: 12, attempts: [10] });
      stub.answers.set(paidMeanwhile.oids[0], "paid");
      assert.deepEqual(await checkBeforeCardRetry(paidMeanwhile.id, opts), { ok: false, code: "paid" });
      assert.equal((await orderOf(tx, paidMeanwhile.id)).status, "paid", "the paid order flips to paid instead of a second charge");

      const passed = await seedOrder(tx, { orderMinutes: 60, attempts: [50] });
      assert.deepEqual(await checkBeforeCardRetry(passed.id, opts), { ok: true });

      const unreachable = await seedOrder(tx, { orderMinutes: 60, attempts: [50] });
      stub.answers.set(unreachable.oids[0], "down");
      assert.deepEqual(await checkBeforeCardRetry(unreachable.id, opts), { ok: false, code: "checking" });

      // A recorded decline settles the latest attempt: a retry may start at once.
      const declined = await seedOrder(tx, { orderMinutes: 12, attempts: [10] });
      const failed = await applyPaytrResult(
        { orderId: declined.id, merchantOid: declined.oids[0], success: false, totalAmount: TOTAL, raw: { provider: "paytr", status: "failed" }, attempt: { testMode: true, paymentAmount: TOTAL } },
        { ...NO_EFFECTS, executor: tx },
      );
      assert.ok(failed.ok && failed.status === "failed");
      const callsBefore = stub.calls.length;
      assert.deepEqual(await checkBeforeCardRetry(declined.id, opts), { ok: true });
      assert.equal(stub.calls.length, callsBefore, "nothing unsettled to ask");
      assert.deepEqual(stub.problems, []);
    });
  });

  test("retryCardPayment uses it and asks initiateCardPayment to re-check under the order lock", () => {
    const actions = readFileSync("src/lib/orders/actions.ts", "utf8");
    assert.match(actions, /await checkBeforeCardRetry\(row\.id\)/);
    assert.match(actions, /initiateCardPayment\(row\.id, \{[^}]*notWhileVerifying: true/);
    // The lock itself is exercised by two concurrent retries in tests/db/paytr-fix-r.test.ts (PayTR-fix R2).
  });
});

describe("scripts/payment-mock.mjs: /odeme/durum-sorgu (127.0.0.1)", () => {
  test("its own token check, the session-based answer and every /_mock/config switch", async () => {
    const mock = await startPaymentMock({
      port: 0,
      paytr: { merchantId: KEYS.PAYTR_MERCHANT_ID, merchantKey: KEYS.PAYTR_MERCHANT_KEY, merchantSalt: KEYS.PAYTR_MERCHANT_SALT },
      log: () => {},
    });
    try {
      const config = { merchantId: KEYS.PAYTR_MERCHANT_ID, merchantKey: KEYS.PAYTR_MERCHANT_KEY, merchantSalt: KEYS.PAYTR_MERCHANT_SALT, baseUrl: mock.url, local: true };
      const post = async (path: string, body: Record<string, string> | object, form = false) => {
        const res = await fetch(`${mock.url}${path}`, {
          method: "POST",
          headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" },
          body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
        });
        return (await res.json()) as Record<string, unknown>;
      };
      // A get-token session (signed with src's get-token hash; the mock checks it independently).
      const oid = paytrMerchantOid("PR-26999901", 1, "MOCKAA");
      const f = { userIp: "203.0.113.9", merchantOid: oid, email: "mock@test.local", paymentAmount: String(TOTAL), userBasket: Buffer.from(JSON.stringify([["Test", "399.70", 1]])).toString("base64"), noInstallment: "1" as const, maxInstallment: "0", currency: "TL", testMode: "1" as const };
      const token = await post(
        "/odeme/api/get-token",
        {
          merchant_id: KEYS.PAYTR_MERCHANT_ID,
          user_ip: f.userIp,
          merchant_oid: oid,
          email: f.email,
          payment_amount: f.paymentAmount,
          paytr_token: paytrIframeToken(config, f),
          user_basket: f.userBasket,
          no_installment: f.noInstallment,
          max_installment: f.maxInstallment,
          user_name: "Mock",
          user_address: "Kayseri",
          user_phone: "05321234567",
          merchant_ok_url: "http://127.0.0.1/ok",
          merchant_fail_url: "http://127.0.0.1/fail",
          currency: "TL",
          test_mode: "1",
        },
        true,
      );
      assert.equal(token.status, "success", JSON.stringify(token));

      assert.deepEqual(await queryPaytrStatus(config, oid), { kind: "not_paid", merchantOid: oid, errNo: "004" }, "auto: no payment yet");
      assert.equal((await queryPaytrStatus({ ...config, merchantKey: "wrong" }, oid)).kind, "unknown", "the mock refuses a wrong token (003)");
      const unknownOid = await queryPaytrStatus(config, paytrMerchantOid("PR-26999902", 1, "MOCKAB"));
      assert.equal(unknownOid.kind, "not_paid", "never seen: err 004 'islem bulunamadi'");

      assert.equal((await post("/_mock/config", { paytrStatus: "paid" })).paytrStatus, "paid");
      const lost = await queryPaytrStatus(config, oid);
      assert.ok(lost.kind === "paid" && lost.totalAmount === TOTAL && lost.paymentAmount === TOTAL && lost.testMode === true, JSON.stringify(lost));
      assert.equal(lost.kind === "paid" && lost.raw.paymentType, "KART");

      await post("/_mock/config", { paytrStatus: "error" });
      assert.deepEqual(await queryPaytrStatus(config, oid), { kind: "unknown", merchantOid: oid, reason: "err_001" });
      await post("/_mock/config", { paytrStatus: "down" });
      assert.deepEqual(await queryPaytrStatus(config, oid), { kind: "unknown", merchantOid: oid, reason: "unreachable" });
      await post("/_mock/config", { paytrStatus: "not_paid" });
      assert.equal((await queryPaytrStatus(config, oid)).kind, "not_paid");

      // auto after a completed payment (no notify URL configured: the notification simply fails).
      await post("/_mock/config", { paytrStatus: "auto" });
      const done = await post("/_mock/paytr/complete", { merchantOid: oid, outcome: "success" });
      assert.equal(done.ok, true);
      const paid = await queryPaytrStatus(config, oid);
      assert.ok(paid.kind === "paid" && paid.totalAmount === TOTAL, JSON.stringify(paid));
    } finally {
      await mock.close();
    }
  });
});
