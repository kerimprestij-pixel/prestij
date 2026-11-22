// PayTR-fix FIX stage (review findings) against the local PostgreSQL:
//   R1    a Durum Sorgu answer whose amount does not give the order total ("1.500" for 1.500,00 TL, or a readable
//         lower amount) writes nothing and stays unknown: the expiry keeps the order, and PayTR's hash-verified
//         notification with the full amount then pays it. An amount mismatch recorded from an inquiry (older rows) is
//         replaced by such a notification; another inquiry or a notification mismatch is not.
//   R2    two concurrent retries of one order against a slow get-token: exactly one opens a PayTR form, the other gets
//         "verifying" (payments.raw.startingAt under the order row lock); the marker is gone afterwards, also after a
//         refused start.
//   R4    the expiry bounds iyzico retrieves: a hanging iyzico costs about the budget plus one timeout, the breaker
//         stops asking, skipped retrieves count as unknown (the order is kept).
//   R7    a test_mode=1 success without a stored attempt is refused while the panel is live on a public origin, and
//         applied (flagged as a test) while the panel is in test mode.
//   R-UX8 countPaymentEventAlerts names the single affected order; paymentEventAlertWhere filters like the count.
// No network: PayTR and iyzico answers come from fetch stubs (they re-derive the tokens and hashes themselves);
// PAYTR_BASE_URL / IYZICO_BASE_URL point at .invalid hosts so nothing could leave this machine anyway.
//
// Shared database: everything except R2 runs in transactions that are rolled back. R2 needs two real connections
// (the row lock), so it writes one throwaway order (e-mail @test.local) and deletes every row it wrote in a finally
// block; the sequences advanced by all tests are put back afterwards. Environment variables are restored after each
// test.
//   npx tsx --test --conditions=react-server --env-file=.env.local --import ./tests/db/setup/local-only.ts tests/db/paytr-fix-r.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { createHmac, randomInt } from "node:crypto";
import { after, before, describe, mock, test } from "node:test";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DbExecutor } from "@/lib/cart/settings";
import { expireStalePendingOrders, type ExpiryLimits } from "@/lib/orders/status";
import { countPaymentEventAlerts, PAYMENT_REFUSED_EVENT, paymentEventAlertWhere } from "@/lib/payments/alerts";
import { attemptsOf, isSupersededPayment, isTestPayment, withAttempt } from "@/lib/payments/attempts";
import { handlePaytrNotify } from "@/lib/payments/callbacks";
import { ATTEMPT_STARTING_MS, completeCardPayment, initiateCardPayment } from "@/lib/payments/complete";
import { loadPaymentSettings } from "@/lib/payments/gateway";
import { paytrMerchantOid, TEST_PAYMENT_ON_LIVE } from "@/lib/payments/paytr-crypto";
import { reconcileCardOrder } from "@/lib/payments/reconcile";
import { restoreSequences, snapshotSequences, type SequenceSnapshot } from "./setup/sequences";

const env = process.env as Record<string, string | undefined>;
/** Made-up credentials (never real ones); nothing is sent anywhere with them. */
const KEYS = { PAYTR_MERCHANT_ID: "100003", PAYTR_MERCHANT_KEY: "paytr-fix-r-test-key", PAYTR_MERCHANT_SALT: "paytr-fix-r-test-salt" } as const;
const BASE = "https://paytr.invalid";
const IYZICO = { IYZICO_API_KEY: "sandbox-paytr-fix-r-key", IYZICO_SECRET_KEY: "sandbox-paytr-fix-r-secret", IYZICO_BASE_URL: "https://iyzico.invalid" } as const;
const TEST_ENV = { ...KEYS, PAYTR_BASE_URL: BASE, PAYMENT_SIMULATOR: "false", IYZICO_API_KEY: undefined, IYZICO_SECRET_KEY: undefined, IYZICO_BASE_URL: undefined };
const LIVE = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.prestij.example" };
const NO_EFFECTS = { effects: false } as const;
const MIN = 60_000;
/** 1.500,00 TL: the amount the finding's scenario is about. */
const BIG = 150_000;

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
async function inRollback(fn: (tx: DbExecutor) => Promise<void>, extraEnv: Record<string, string | undefined> = {}): Promise<void> {
  await withEnv({ ...TEST_ENV, ...extraEnv }, async () => {
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

type Seeded = { id: number; orderNumber: string; oids: string[] };

/** A card order in pending_payment with an initiated payments row holding its attempts (minutes ago, oldest first). */
async function seedOrder(
  exec: DbExecutor,
  opts: { total?: number; orderMinutes?: number; attempts: number[]; attemptTestMode?: boolean; provider?: "paytr" | "iyzico"; item?: boolean },
): Promise<Seeded> {
  const total = opts.total ?? BIG;
  const provider = opts.provider ?? "paytr";
  const orderNumber = `PR-9${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
  const now = Date.now();
  const created = new Date(now - (opts.orderMinutes ?? 50) * MIN);
  const address = { fullName: "PayTR Test Alıcı", phone: "+905321234567", city: "Kayseri", district: "Kocasinan", line1: "Test Sok. No: 1" };
  const [order] = await exec
    .insert(schema.orders)
    .values({
      orderNumber,
      email: `paytr-fix-r-${orderNumber.slice(3)}@test.local`,
      locale: "tr",
      status: "pending_payment",
      paymentMethod: "card",
      subtotal: total,
      grandTotal: total,
      shippingAddress: address,
      invoice: { type: "individual", fullName: address.fullName },
      createdAt: created,
      updatedAt: created,
    })
    .returning({ id: schema.orders.id });
  if (opts.item) {
    await exec.insert(schema.orderItems).values({
      orderId: order.id,
      variantId: variant.id,
      snapshot: { productId: 0, productName: { tr: "Test ürünü" }, variantTitle: { tr: "5 L" }, sku: variant.sku, stockTracked: true },
      unitPrice: total,
      quantity: 1,
      lineTotal: total,
    });
  }
  const oids: string[] = [];
  let raw: unknown = {};
  opts.attempts.forEach((minutesAgo, i) => {
    const ref = provider === "paytr" ? paytrMerchantOid(orderNumber, i + 1, "RSTUV" + String.fromCharCode(70 + i)) : `iyzico-token-paytr-fix-r-${orderNumber.slice(3)}-${i + 1}`;
    oids.push(ref);
    raw = withAttempt(raw, {
      n: i + 1,
      ref,
      testMode: opts.attemptTestMode ?? true,
      at: new Date(now - minutesAgo * MIN).toISOString(),
      ...(provider === "paytr" ? { iframeUrl: `${BASE}/odeme/guvenli/${ref.toLowerCase()}`, paymentAmount: total } : { conversationId: `${orderNumber}-${i + 1}` }),
    });
  });
  if (opts.attempts.length > 0) {
    const last = new Date(now - (opts.attempts.at(-1) ?? 0) * MIN);
    await exec.insert(schema.payments).values({ orderId: order.id, provider, status: "initiated", amount: total, raw: raw as Record<string, unknown>, createdAt: created, updatedAt: last });
  }
  return { id: order.id, orderNumber, oids };
}

const orderOf = async (exec: DbExecutor, id: number) => (await exec.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const paymentsOf = (exec: DbExecutor, id: number) => exec.select().from(schema.payments).where(eq(schema.payments.orderId, id)).orderBy(asc(schema.payments.id));
const eventsOf = (exec: DbExecutor, id: number) => exec.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, id)).orderBy(asc(schema.orderEvents.id));

/** Durum Sorgu stub: answers `payment_total` per merchant_oid (a "success"), checks the token independently of src/. */
function statusStub(totals: Map<string, string>) {
  const calls: string[] = [];
  const problems: string[] = [];
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body ?? ""));
    const oid = form.get("merchant_oid") ?? "";
    calls.push(oid);
    if (String(input) !== `${BASE}/odeme/durum-sorgu`) problems.push(`url ${String(input)}`);
    const token = createHmac("sha256", KEYS.PAYTR_MERCHANT_KEY).update(`${KEYS.PAYTR_MERCHANT_ID}${oid}${KEYS.PAYTR_MERCHANT_SALT}`).digest("base64");
    if (form.get("paytr_token") !== token) problems.push(`token for ${oid}`);
    const total = totals.get(oid);
    const body = total
      ? { status: "success", payment_amount: total, payment_total: total, currency: "TL", taksit: "0", odeme_tipi: "KART", test_mode: "1", returns: [] }
      : { status: "error", err_no: "004", err_msg: "merchant_oid ile basarili odeme bulunamadi" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, problems, fetch: fetchStub };
}

/** PayTR's notification fields; hash = base64(HMAC-SHA256(merchant_oid + salt + status + total_amount, key)) (step 2). */
function notification(oid: string, opts: { status?: "success" | "failed"; total: number; testMode?: "0" | "1" }): Record<string, string> {
  const status = opts.status ?? "success";
  const total = String(opts.total);
  const hash = createHmac("sha256", KEYS.PAYTR_MERCHANT_KEY).update(`${oid}${KEYS.PAYTR_MERCHANT_SALT}${status}${total}`).digest("base64");
  return { merchant_oid: oid, status, total_amount: total, hash, payment_type: "card", currency: "TL", payment_amount: total, test_mode: opts.testMode ?? "1", installment_count: "1" };
}

before(async () => {
  seqs = await snapshotSequences();
  const [v] = await db.execute<{ id: number; stock: number; sku: string }>(sql`select id, stock, sku from product_variants where track_stock and is_active order by id limit 1`);
  assert.ok(v, "a stock-tracked variant (seeded)");
  variant = { id: Number(v.id), stock: Number(v.stock), sku: String(v.sku) };
});

after(async () => {
  try {
    const [v] = await db.execute<{ stock: number }>(sql`select stock from product_variants where id = ${variant.id}`);
    assert.equal(Number(v.stock), variant.stock, "stock untouched");
    await restoreSequences(seqs);
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------

describe("R1: an inquiry never writes a final failure", () => {
  test("'1.500' for 1.500,00 TL: nothing written, unknown, the expiry keeps it; the notification then pays the order", async () => {
    await inRollback(async (tx) => {
      const order = await seedOrder(tx, { attempts: [50] });
      const oid = order.oids[0];
      const stub = statusStub(new Map([[oid, "1.500"]]));
      const warned = mock.method(console, "warn", () => {});
      try {
        const result = await reconcileCardOrder(order.id, { ...NO_EFFECTS, executor: tx, fetch: stub.fetch });
        assert.equal(result.state, "unknown");
        assert.deepEqual(await paymentsOf(tx, order.id).then((p) => p.map((r) => [r.status, r.providerRef])), [["initiated", null]]);
        assert.deepEqual(await eventsOf(tx, order.id), []);

        // The expiry (latest attempt 50 minutes old, past the 45-minute window) asks again and keeps the order.
        const expiry = await expireStalePendingOrders(30, { ...NO_EFFECTS, renewalWindowHours: 72, only: [order.id], executor: tx, fetch: stub.fetch });
        assert.deepEqual({ expired: expiry.expired, unknown: expiry.unknown }, { expired: 0, unknown: 1 });
        assert.equal((await orderOf(tx, order.id)).status, "pending_payment", "never cancelled on a misread amount");
      } finally {
        warned.mock.restore();
      }

      // PayTR's notification (valid hash, total_amount in kuruş) settles it.
      const res = await handlePaytrNotify(notification(oid, { total: BIG }), { ...NO_EFFECTS, executor: tx });
      assert.equal(res.body, "OK");
      assert.ok(res.completion?.ok && res.completion.status === "paid" && !res.completion.alreadyProcessed, JSON.stringify(res.completion));
      const o = await orderOf(tx, order.id);
      assert.equal(o.status, "paid");
      assert.ok(o.paidAt);
      assert.deepEqual((await paymentsOf(tx, order.id)).map((p) => [p.status, p.amount, p.providerRef]), [["succeeded", BIG, oid]]);
      assert.deepEqual((await eventsOf(tx, order.id)).map((e) => e.type), ["payment_succeeded", "status_changed"]);
      assert.deepEqual(stub.problems, []);
    });
  });

  test("a readable lower amount ('1499,00'): the same, with a log line naming both amounts", async () => {
    await inRollback(async (tx) => {
      const order = await seedOrder(tx, { attempts: [50] });
      const oid = order.oids[0];
      const stub = statusStub(new Map([[oid, "1499,00"]]));
      const warned = mock.method(console, "warn", () => {});
      try {
        const result = await reconcileCardOrder(order.id, { ...NO_EFFECTS, executor: tx, fetch: stub.fetch });
        assert.equal(result.state, "unknown");
        assert.ok(warned.mock.calls.some((c) => String(c.arguments[0]).includes(`amount not applied order=${order.id} requested=${BIG} total=${BIG} reported=149900`)));
      } finally {
        warned.mock.restore();
      }
      assert.deepEqual((await paymentsOf(tx, order.id)).map((p) => p.status), ["initiated"]);
      assert.deepEqual(await eventsOf(tx, order.id), []);
      // A full answer later pays it (the attempt is still unsettled, so it is asked again).
      stub.calls.length = 0;
      const paid = statusStub(new Map([[oid, "1.500,00"]]));
      assert.equal((await reconcileCardOrder(order.id, { ...NO_EFFECTS, executor: tx, fetch: paid.fetch })).state, "paid");
      assert.deepEqual(paid.calls, [oid]);
    });
  });

  test("an inquiry's recorded mismatch (older rows) is replaced by the notification with the full amount; nothing else replaces a mismatch", async () => {
    await inRollback(async (tx) => {
      // What the pre-fix reconcile wrote: completeCardPayment with the inquiry's raw (source durum-sorgu) and a lower amount.
      const order = await seedOrder(tx, { attempts: [50] });
      const oid = order.oids[0];
      const inquiryRaw = { provider: "paytr", source: "durum-sorgu", merchantOid: oid, status: "success", totalAmount: 150, providerTestMode: true, testMode: true, requestedAmount: BIG };
      const old = await completeCardPayment({ orderId: order.id, providerRef: oid, success: true, amount: 150, raw: inquiryRaw, provider: "paytr", attemptRef: oid }, { ...NO_EFFECTS, executor: tx });
      assert.deepEqual(old, { ok: false, code: "amount_mismatch" });
      const [row] = await paymentsOf(tx, order.id);
      assert.equal(row.status, "failed");

      // Another inquiry with the full amount does not replace it (only the hash-verified notification may).
      const again = await completeCardPayment(
        { orderId: order.id, providerRef: oid, success: true, amount: BIG, raw: { ...inquiryRaw, totalAmount: BIG }, provider: "paytr", attemptRef: oid },
        { ...NO_EFFECTS, executor: tx },
      );
      assert.ok(again.ok && again.status === "failed" && again.alreadyProcessed, JSON.stringify(again));
      assert.equal((await orderOf(tx, order.id)).status, "pending_payment");

      const warned = mock.method(console, "warn", () => {});
      try {
        const res = await handlePaytrNotify(notification(oid, { total: BIG }), { ...NO_EFFECTS, executor: tx });
        assert.ok(res.completion?.ok && res.completion.status === "paid", JSON.stringify(res.completion));
        assert.ok(warned.mock.calls.some((c) => String(c.arguments[0]).includes("replaces an inquiry's amount mismatch")));
      } finally {
        warned.mock.restore();
      }
      const pays = await paymentsOf(tx, order.id);
      assert.deepEqual(pays.map((p) => [p.id, p.status, p.amount, p.providerRef]), [[row.id, "succeeded", BIG, oid]], "the same row, now succeeded");
      const raw = pays[0].raw as Record<string, unknown>;
      assert.equal(raw.source, undefined, "the notification's raw replaced the inquiry's");
      assert.equal(raw.reason, undefined);
      assert.equal(attemptsOf(raw).length, 1, "attempts kept");
      assert.equal((await orderOf(tx, order.id)).status, "paid");
      assert.deepEqual((await eventsOf(tx, order.id)).map((e) => e.type), ["payment_amount_mismatch", "payment_succeeded", "status_changed"]);

      // A mismatch recorded from the notification itself stays final (PayTR counts the first notification).
      const other = await seedOrder(tx, { attempts: [50] });
      const short = await handlePaytrNotify(notification(other.oids[0], { total: BIG - 100 }), { ...NO_EFFECTS, executor: tx });
      assert.deepEqual(short.completion, { ok: false, code: "amount_mismatch" });
      const full = await handlePaytrNotify(notification(other.oids[0], { total: BIG }), { ...NO_EFFECTS, executor: tx });
      assert.ok(full.completion?.ok && full.completion.status === "failed" && full.completion.alreadyProcessed, JSON.stringify(full.completion));
      assert.equal((await orderOf(tx, other.id)).status, "pending_payment");
    });
  });
});

// ---------------------------------------------------------------------------------------------------

describe("R2: two tabs cannot both open a new form", () => {
  test("two concurrent retries against a slow get-token: one form, one 'verifying'; the marker is gone afterwards", async () => {
    await withEnv(TEST_ENV, async () => {
      const base = await loadPaymentSettings();
      const payments = { ...base, card: { ...base.card, enabled: true, provider: "paytr" as const, testMode: true, installments: false, maxInstallments: 1 } };
      // Committed rows (two connections must compete for the order row lock); removed in the finally block.
      const order = await seedOrder(db, { attempts: [20], item: true });
      try {
        // The earlier attempt was declined: settled, so a retry may start (not "verifying" by the window).
        const [first] = await paymentsOf(db, order.id);
        await db.update(schema.payments).set({ status: "failed", providerRef: order.oids[0] }).where(eq(schema.payments.id, first.id));

        const requests: string[] = [];
        const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input instanceof Request ? input.url : input);
          if (url !== `${BASE}/odeme/api/get-token`) throw new Error(`unexpected request ${url}`);
          const form = new URLSearchParams(String(init?.body ?? ""));
          requests.push(form.get("merchant_oid") ?? "");
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          return new Response(JSON.stringify({ status: "success", token: `tok${requests.length}abcdef` }), { status: 200, headers: { "content-type": "application/json" } });
        });
        let results: Awaited<ReturnType<typeof initiateCardPayment>>[];
        try {
          results = await Promise.all([
            initiateCardPayment(order.id, { payments, notWhileVerifying: true, clientIp: "203.0.113.7" }),
            initiateCardPayment(order.id, { payments, notWhileVerifying: true, clientIp: "203.0.113.8" }),
          ]);
        } finally {
          fetchMock.mock.restore();
        }
        assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
        assert.deepEqual(results.filter((r) => !r.ok), [{ ok: false, code: "verifying" }]);
        assert.equal(requests.length, 1, "one get-token: one merchant_oid");

        const pays = await paymentsOf(db, order.id);
        const open = pays.filter((p) => p.status === "initiated");
        assert.equal(open.length, 1);
        const raw = open[0].raw as Record<string, unknown>;
        assert.equal("startingAt" in raw, false, "the marker is removed once the attempt is stored");
        assert.deepEqual(attemptsOf(raw).map((a) => [a.n, a.ref]), [[2, requests[0]]]);

        // Another retry now meets the new attempt inside its window ("verifying" by the window, no request).
        const third = await initiateCardPayment(order.id, { payments, notWhileVerifying: true });
        assert.deepEqual(third, { ok: false, code: "verifying" });

        // A refused start removes the marker too (and keeps PayTR's reason), so the next retry is not blocked by it.
        await db.update(schema.payments).set({ status: "failed", providerRef: requests[0] }).where(eq(schema.payments.id, open[0].id));
        const refusedMock = mock.method(globalThis, "fetch", async () =>
          new Response(JSON.stringify({ status: "failed", reason: "test refusal" }), { status: 200, headers: { "content-type": "application/json" } }),
        );
        const logged = mock.method(console, "error", () => {});
        try {
          assert.deepEqual(await initiateCardPayment(order.id, { payments, notWhileVerifying: true }), { ok: false, code: "gateway_error" });
        } finally {
          refusedMock.mock.restore();
          logged.mock.restore();
        }
        const refusedRow = (await paymentsOf(db, order.id)).filter((p) => p.status === "initiated").at(-1);
        const refusedRaw = (refusedRow?.raw ?? {}) as Record<string, unknown>;
        assert.equal("startingAt" in refusedRaw, false);
        assert.equal((refusedRaw.lastError as { message?: string } | undefined)?.message, "test refusal");

        // A marker younger than ATTEMPT_STARTING_MS refuses a retry; an older one (a crashed request) does not.
        assert.ok(refusedRow);
        await db.update(schema.payments).set({ raw: { ...refusedRaw, startingAt: new Date(Date.now() - 5_000).toISOString() } }).where(eq(schema.payments.id, refusedRow.id));
        assert.deepEqual(await initiateCardPayment(order.id, { payments, notWhileVerifying: true }), { ok: false, code: "verifying" });
        await db
          .update(schema.payments)
          .set({ raw: { ...refusedRaw, startingAt: new Date(Date.now() - ATTEMPT_STARTING_MS - 1_000).toISOString() } })
          .where(eq(schema.payments.id, refusedRow.id));
        const staleMock = mock.method(globalThis, "fetch", async () =>
          new Response(JSON.stringify({ status: "success", token: "tokstaleabcdef" }), { status: 200, headers: { "content-type": "application/json" } }),
        );
        try {
          const late = await initiateCardPayment(order.id, { payments, notWhileVerifying: true });
          assert.equal(late.ok, true, JSON.stringify(late));
        } finally {
          staleMock.mock.restore();
        }
      } finally {
        await db.delete(schema.orderEvents).where(eq(schema.orderEvents.orderId, order.id));
        await db.delete(schema.payments).where(eq(schema.payments.orderId, order.id));
        await db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
        await db.delete(schema.orders).where(eq(schema.orders.id, order.id));
      }
      assert.equal((await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.id, order.id))).length, 0, "cleaned up");
    });
  });
});

// ---------------------------------------------------------------------------------------------------

describe("R4: the expiry bounds iyzico retrieves", () => {
  /** iyzico never answers: every retrieve waits for its abort signal. */
  function hangingIyzico() {
    const calls: string[] = [];
    const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(String(input));
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error("no abort signal: the retrieve would wait forever"));
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    }) as typeof fetch;
    return { calls, fetch: fetchStub };
  }
  const run = (tx: DbExecutor, ids: number[], fetchImpl: typeof fetch, limits: Partial<ExpiryLimits>) =>
    expireStalePendingOrders(30, { ...NO_EFFECTS, renewalWindowHours: 72, only: ids, executor: tx, fetch: fetchImpl, limits });

  test("a hanging iyzico costs about the budget plus one timeout; skipped retrieves are unknown and the order is kept", async () => {
    await inRollback(
      async (tx) => {
        const order = await seedOrder(tx, { provider: "iyzico", orderMinutes: 60, attempts: [59, 58, 57, 56] });
        const stub = hangingIyzico();
        const logged = mock.method(console, "error", () => {});
        const warned = mock.method(console, "warn", () => {});
        const started = Date.now();
        let result: Awaited<ReturnType<typeof expireStalePendingOrders>>;
        try {
          result = await run(tx, [order.id], stub.fetch, { budgetMs: 900, iyzicoTimeoutMs: 400, maxInquiryFailures: 10 });
        } finally {
          logged.mock.restore();
          warned.mock.restore();
        }
        const elapsed = Date.now() - started;
        assert.ok(elapsed < 900 + 400 + 1_500, `bounded by the budget plus one timeout (${elapsed} ms; unbounded: 4 × 20 s)`);
        assert.ok(stub.calls.length >= 1 && stub.calls.length <= 3, `retrieves started before the deadline only (${stub.calls.length})`);
        assert.deepEqual({ expired: result.expired, unknown: result.unknown }, { expired: 0, unknown: 1 });
        assert.equal((await orderOf(tx, order.id)).status, "pending_payment", "kept (iyzico's 48 h grace)");
      },
      IYZICO,
    );
  });

  test("the breaker stops asking iyzico after the allowed failures", async () => {
    await inRollback(
      async (tx) => {
        const order = await seedOrder(tx, { provider: "iyzico", orderMinutes: 60, attempts: [59, 58, 57, 56] });
        const stub = hangingIyzico();
        const logged = mock.method(console, "error", () => {});
        const warned = mock.method(console, "warn", () => {});
        let result: Awaited<ReturnType<typeof expireStalePendingOrders>>;
        try {
          result = await run(tx, [order.id], stub.fetch, { budgetMs: 10_000, iyzicoTimeoutMs: 200, maxInquiryFailures: 2 });
        } finally {
          logged.mock.restore();
          warned.mock.restore();
        }
        assert.equal(stub.calls.length, 2, "two timeouts, then no more retrieves in this run");
        assert.equal(result.unknown, 1);
        assert.equal((await orderOf(tx, order.id)).status, "pending_payment");
      },
      IYZICO,
    );
  });
});

// ---------------------------------------------------------------------------------------------------

describe("R7: a test payment without a stored attempt", () => {
  const setPanelTestMode = (tx: DbExecutor, testMode: boolean) =>
    tx.execute(sql`update settings set value = jsonb_set(value, '{card,testMode}', ${JSON.stringify(testMode)}::jsonb, true) where key = 'payments'`);

  test("panel live on a public site: refused (no money moved), never paid; panel in test mode: applied and flagged", async () => {
    await inRollback(async (tx) => {
      const [settingsRow] = await tx.select({ key: schema.settings.key }).from(schema.settings).where(eq(schema.settings.key, "payments"));
      if (!settingsRow) await tx.insert(schema.settings).values({ key: "payments", value: { card: { testMode: true } } });

      // Storing the attempt after get-token failed: the order has no payments row with that merchant_oid.
      const live = await seedOrder(tx, { attempts: [] });
      const oid = paytrMerchantOid(live.orderNumber, 1, "NOATTM");
      await setPanelTestMode(tx, false);
      assert.equal((await loadPaymentSettings(tx)).card.testMode, false);
      const warned = mock.method(console, "warn", () => {});
      const logged = mock.method(console, "error", () => {});
      try {
        await withEnv(LIVE, async () => {
          const res = await handlePaytrNotify(notification(oid, { total: BIG, testMode: "1" }), { ...NO_EFFECTS, executor: tx });
          assert.deepEqual([res.status, res.body, res.reason], [200, "OK", TEST_PAYMENT_ON_LIVE]);
          assert.ok(res.refusal?.ok, JSON.stringify(res.refusal));
        });
      } finally {
        warned.mock.restore();
        logged.mock.restore();
      }
      const o = await orderOf(tx, live.id);
      assert.equal(o.status, "pending_payment");
      assert.equal(o.paidAt, null);
      const pays = await paymentsOf(tx, live.id);
      assert.deepEqual(pays.map((p) => [p.status, p.providerRef]), [["failed", oid]]);
      assert.equal((pays[0].raw as Record<string, unknown>).refused, TEST_PAYMENT_ON_LIVE);
      assert.ok(isSupersededPayment(pays[0].raw), "a row of its own: it says nothing about an open attempt");
      assert.deepEqual((await eventsOf(tx, live.id)).map((e) => e.type), [PAYMENT_REFUSED_EVENT]);

      // The panel still in test mode: the same notification is applied, flagged as a test payment (as before).
      const test = await seedOrder(tx, { attempts: [] });
      const testOid = paytrMerchantOid(test.orderNumber, 1, "NOATTM");
      await setPanelTestMode(tx, true);
      const warned2 = mock.method(console, "warn", () => {});
      try {
        await withEnv(LIVE, async () => {
          const res = await handlePaytrNotify(notification(testOid, { total: BIG, testMode: "1" }), { ...NO_EFFECTS, executor: tx });
          assert.ok(res.completion?.ok && res.completion.status === "paid", JSON.stringify(res));
        });
      } finally {
        warned2.mock.restore();
      }
      const testPays = await paymentsOf(tx, test.id);
      assert.deepEqual(testPays.map((p) => p.status), ["succeeded"]);
      assert.ok(isTestPayment("paytr", testPays[0].raw), "flagged TEST ÖDEMESİ");

      // A live payment (test_mode=0) without a stored attempt is applied whatever the panel says.
      await setPanelTestMode(tx, false);
      const real = await seedOrder(tx, { attempts: [] });
      const realOid = paytrMerchantOid(real.orderNumber, 1, "NOATTM");
      const warned3 = mock.method(console, "warn", () => {});
      try {
        await withEnv(LIVE, async () => {
          const res = await handlePaytrNotify(notification(realOid, { total: BIG, testMode: "0" }), { ...NO_EFFECTS, executor: tx });
          assert.ok(res.completion?.ok && res.completion.status === "paid", JSON.stringify(res));
        });
      } finally {
        warned3.mock.restore();
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------

describe("R-UX8: the affected order of a payment warning", () => {
  test("countPaymentEventAlerts names the single order; paymentEventAlertWhere selects the same orders", async () => {
    await inRollback(async (tx) => {
      const now = Date.now();
      const base = await countPaymentEventAlerts(tx, now);
      const a = await seedOrder(tx, { attempts: [5] });
      const b = await seedOrder(tx, { attempts: [5] });
      const c = await seedOrder(tx, { attempts: [5] });
      const refused = (orderId: number) =>
        tx.insert(schema.orderEvents).values({ orderId, type: PAYMENT_REFUSED_EVENT, data: { provider: "paytr", providerRef: "x", reason: TEST_PAYMENT_ON_LIVE, amount: BIG }, createdBy: "system" });
      await refused(a.id);
      const one = await countPaymentEventAlerts(tx, now + 1_000);
      assert.equal(one.testOnLive, base.testOnLive + 1);
      assert.equal(one.testOnLiveOrderId, base.testOnLive === 0 ? a.id : null);
      await refused(b.id);
      const two = await countPaymentEventAlerts(tx, now + 1_000);
      assert.equal(two.testOnLiveOrderId, null, "several orders: the list filter instead");

      // A success after a failure on c (unpaid): counted and filtered; paid orders drop out of that warning.
      await tx.insert(schema.orderEvents).values({ orderId: c.id, type: "payment_success_after_failure", data: { provider: "paytr", providerRef: "y", amount: BIG }, createdBy: "system" });
      const ids = [a.id, b.id, c.id];
      const select = (kind: "testOnLive" | "successAfterFailure", at = now + 1_000) =>
        tx
          .select({ id: schema.orders.id })
          .from(schema.orders)
          .where(and(inArray(schema.orders.id, ids), paymentEventAlertWhere(kind, at)))
          .orderBy(asc(schema.orders.id))
          .then((rows) => rows.map((r) => r.id));
      assert.deepEqual(await select("testOnLive"), [a.id, b.id]);
      assert.deepEqual(await select("successAfterFailure"), [c.id]);
      await tx.update(schema.orders).set({ paidAt: new Date() }).where(eq(schema.orders.id, c.id));
      assert.deepEqual(await select("successAfterFailure"), []);
      // Outside the 72-hour window the test-payment warning is gone, as on the dashboard.
      assert.deepEqual(await select("testOnLive", now + 73 * 3_600_000), []);
    });
  });
});
