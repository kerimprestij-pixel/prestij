// PayTR-fix IMPL-A2 against the local PostgreSQL, through the same Request handler as the notify route:
//   C5    a PayTR test payment (test_mode=1) for an attempt sent live, on a public site, is recorded as refused
//         ("test_payment_on_live"), answered "OK", never marks the order paid, raises the dashboard count; replays
//         change nothing; locally, for test-mode attempts and for live payments nothing changes.
//   notify refusals  bad hash, missing fields and missing keys are recorded in audit_log for the panel ("PayTR
//         bildirimleri reddediliyor", last time and count) when the merchant_oid is a stored attempt of one of our
//         orders (PayTR-fix R5; an unreadable body or a made-up merchant_oid is logged only): never the body or hash;
//         at most one row per kind per 10 minutes, one write per kind per 10 s per instance, a busy lock never
//         queues; the 72-hour summary.
//   C13a  a success after a recorded failure for the same merchant_oid: one order event and a log line, no state change.
//   C13b  a notification without a Content-Type is read as a form (hand-built, and sent so by the payment mock).
//   C13c  get-token tokens of other shapes are accepted when they fit the iframe path, else refused clearly.
//   C8    user_ip: IPv4-mapped IPv6 sent as IPv4, IPv6 compressed, never cut; the hash checked independently.
//   C10   the iade error texts (006 / 009 / 010) and the timeout text, with stubbed HTTP and against the mock.
// No network: PayTR answers come from fetch stubs (they re-derive every token themselves) or from
// scripts/payment-mock.mjs on 127.0.0.1 (its own hash checks); PAYTR_BASE_URL points at a .invalid host otherwise.
//
// Shared database: every order, payment, event and audit row is written inside a transaction that is rolled back
// (one per test); the sequences those inserts advanced are put back afterwards. Environment variables are restored
// after each test. Refusal records use clock values in 2099 so they never meet real rows.
//   npx tsx --test --conditions=react-server --env-file=.env.local --import ./tests/db/setup/local-only.ts tests/db/paytr-fix-a2.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { createHmac, randomInt } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, mock, test } from "node:test";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DbExecutor } from "@/lib/cart/settings";
import {
  countPaymentEventAlerts,
  NOTIFY_REFUSAL_ACTION,
  NOTIFY_REFUSAL_ENTITY,
  notifyRefusalSummary,
  PAYMENT_REFUSED_EVENT,
  PAYMENT_SUCCESS_AFTER_FAILURE_EVENT,
  recordNotifyRefusal,
} from "@/lib/payments/alerts";
import { attemptsOf, isSupersededPayment, isTestPayment, withAttempt } from "@/lib/payments/attempts";
import { refuseCardResult } from "@/lib/payments/complete";
import { paytrNotifyResponse } from "@/lib/payments/http";
import { paytrMerchantOid, TEST_PAYMENT_ON_LIVE } from "@/lib/payments/paytr-crypto";
import { createPaytrGateway } from "@/lib/payments/paytr-gateway";
import { paytrAttemptState } from "@/lib/payments/paytr-window";
import { reconcileCardOrder } from "@/lib/payments/reconcile";
import { GatewayRefusedError } from "@/lib/payments/refusal";
import type { GatewayOrder } from "@/lib/payments/types";
import { startPaymentMock } from "../../scripts/payment-mock.mjs";
import { restoreSequences, snapshotSequences, type SequenceSnapshot } from "./setup/sequences";

const env = process.env as Record<string, string | undefined>;
/** Made-up PayTR credentials (never real ones); nothing is sent anywhere with them. */
const KEYS = { PAYTR_MERCHANT_ID: "100002", PAYTR_MERCHANT_KEY: "paytr-fix-a2-test-key", PAYTR_MERCHANT_SALT: "paytr-fix-a2-test-salt" } as const;
const CONFIG_KEYS = { merchantId: KEYS.PAYTR_MERCHANT_ID, merchantKey: KEYS.PAYTR_MERCHANT_KEY, merchantSalt: KEYS.PAYTR_MERCHANT_SALT };
const BASE = "https://paytr.invalid";
const TEST_ENV = { ...KEYS, PAYTR_BASE_URL: BASE, PAYMENT_SIMULATOR: "false", IYZICO_API_KEY: undefined, IYZICO_SECRET_KEY: undefined, IYZICO_BASE_URL: undefined };
const LIVE = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.prestij.example" };
const NO_EFFECTS = { effects: false } as const;
const MIN = 60_000;
const TOTAL = 39_970;
/** Refusal records: clock values far from any real row. */
const T0 = Date.UTC(2099, 0, 1, 9, 0, 0);

let seqs: SequenceSnapshot;
let mockServer: Awaited<ReturnType<typeof startPaymentMock>>;
let bridge: Server;
let bridgeUrl = "";
/** The rolled-back transaction the notify bridge uses for the current mock test. */
let bridgeExec: DbExecutor | null = null;
const bridgeContentTypes: (string | undefined)[] = [];

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

// ---------------------------------------------------------------------------------------------------
// Rows and requests

type Seeded = { id: number; orderNumber: string; oids: string[] };

/** A PayTR card order in pending_payment with an initiated payments row holding its attempts (minutes ago, oldest first). */
async function seedOrder(tx: DbExecutor, opts: { attempts: number[]; attemptTestMode?: boolean; status?: "pending_payment" | "paid" }): Promise<Seeded> {
  const orderNumber = `PR-9${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
  const now = Date.now();
  const address = { fullName: "PayTR Test Alıcı", phone: "+905321234567", city: "Kayseri", district: "Kocasinan", line1: "Test Sok. No: 1" };
  const [order] = await tx
    .insert(schema.orders)
    .values({
      orderNumber,
      email: `paytr-fix-a2-${orderNumber.slice(3)}@test.local`,
      locale: "tr",
      status: opts.status ?? "pending_payment",
      paymentMethod: "card",
      subtotal: TOTAL,
      grandTotal: TOTAL,
      shippingAddress: address,
      invoice: { type: "individual", fullName: address.fullName },
      ...(opts.status === "paid" ? { paidAt: new Date(now - 5 * MIN) } : {}),
    })
    .returning({ id: schema.orders.id });
  const oids: string[] = [];
  let raw: unknown = {};
  opts.attempts.forEach((minutesAgo, i) => {
    const ref = paytrMerchantOid(orderNumber, i + 1, "QWERT" + String.fromCharCode(70 + i));
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
  if (opts.attempts.length > 0) {
    await tx.insert(schema.payments).values({ orderId: order.id, provider: "paytr", status: "initiated", amount: TOTAL, raw: raw as Record<string, unknown> });
  }
  return { id: order.id, orderNumber, oids };
}

const orderOf = async (tx: DbExecutor, id: number) => (await tx.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const paymentsOf = (tx: DbExecutor, id: number) => tx.select().from(schema.payments).where(eq(schema.payments.orderId, id)).orderBy(asc(schema.payments.id));
const eventsOf = (tx: DbExecutor, id: number) => tx.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, id)).orderBy(asc(schema.orderEvents.id));
const refusalRows = (tx: DbExecutor) =>
  tx
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.entity, NOTIFY_REFUSAL_ENTITY), eq(schema.auditLog.action, NOTIFY_REFUSAL_ACTION), sql`${schema.auditLog.createdAt} >= ${new Date(T0 - 3_600_000).toISOString()}::timestamptz`))
    .orderBy(asc(schema.auditLog.id));

/** A notification as PayTR posts it; hash = base64(HMAC-SHA256(merchant_oid + salt + status + total_amount, key)) (step 2). */
function notification(oid: string, opts: { status?: "success" | "failed"; total?: number; testMode?: "0" | "1"; hashKey?: string } = {}): Record<string, string> {
  const status = opts.status ?? "success";
  const total = String(opts.total ?? TOTAL);
  const hash = createHmac("sha256", opts.hashKey ?? KEYS.PAYTR_MERCHANT_KEY).update(`${oid}${KEYS.PAYTR_MERCHANT_SALT}${status}${total}`).digest("base64");
  return {
    merchant_oid: oid,
    status,
    total_amount: total,
    hash,
    payment_type: "card",
    currency: "TL",
    payment_amount: String(TOTAL),
    test_mode: opts.testMode ?? "0",
    ...(status === "failed" ? { failed_reason_code: "2", failed_reason_msg: "Ödeme onaylanmadı" } : { installment_count: "1" }),
  };
}

async function post(fields: Record<string, string> | string, options: { executor: DbExecutor; effects?: boolean; now?: number; contentType?: string | null }) {
  const body = typeof fields === "string" ? fields : new URLSearchParams(fields).toString();
  const contentType = options.contentType === undefined ? "application/x-www-form-urlencoded" : options.contentType;
  const request =
    contentType === null
      ? new Request("http://payments.test/api/payments/paytr/notify", { method: "POST", body: new TextEncoder().encode(body) })
      : new Request("http://payments.test/api/payments/paytr/notify", { method: "POST", headers: { "content-type": contentType }, body });
  const res = await paytrNotifyResponse(request, { executor: options.executor, effects: options.effects ?? false, now: options.now });
  return { status: res.status, body: await res.text(), requestType: request.headers.get("content-type") };
}

/** A minimal GatewayOrder for the gateway tests. */
function gatewayOrder(clientIp: string | null, orderNumber = "PR-9261001", attempt = 1): GatewayOrder {
  const address = { contactName: "PayTR Test", city: "Kayseri", district: "Kocasinan", line: "Test Sok. No: 1", zipCode: null, country: "TR" };
  return {
    id: 1,
    orderNumber,
    accessToken: "t",
    amount: TOTAL,
    locale: "tr",
    email: "gateway@test.local",
    details: {
      buyer: { id: "guest", fullName: "PayTR Test", email: "gateway@test.local", phone: "+905321234567", identityNumber: null, registeredAt: null },
      shippingAddress: address,
      billingAddress: address,
      lines: [{ id: "item-1", name: "Test", quantity: 1, total: TOTAL, kind: "item" }],
      clientIp,
      attempt,
    },
  };
}

/** get-token stub: checks the paytr_token itself (step 1 hash_str + salt, raw digest base64) and answers `answer`. */
function getTokenStub(answer: () => Record<string, unknown>) {
  const forms: URLSearchParams[] = [];
  const problems: string[] = [];
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body ?? ""));
    forms.push(form);
    if (String(input) !== `${BASE}/odeme/api/get-token`) problems.push(`url ${String(input)}`);
    const g = (k: string) => form.get(k) ?? "";
    const hashStr = `${g("merchant_id")}${g("user_ip")}${g("merchant_oid")}${g("email")}${g("payment_amount")}${g("user_basket")}${g("no_installment")}${g("max_installment")}${g("currency")}${g("test_mode")}`;
    const token = createHmac("sha256", KEYS.PAYTR_MERCHANT_KEY).update(hashStr + KEYS.PAYTR_MERCHANT_SALT).digest("base64");
    if (g("paytr_token") !== token) problems.push("paytr_token");
    if (g("user_ip").length > 39) problems.push(`user_ip ${g("user_ip").length} characters`);
    return new Response(JSON.stringify(answer()), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { forms, problems, fetch: fetchStub };
}

const gatewayFor = (baseUrl: string, fetchImpl?: typeof fetch, testMode = false) =>
  createPaytrGateway({ ...CONFIG_KEYS, baseUrl, local: baseUrl.startsWith("http://"), testMode, installments: false, maxInstallments: 1, fetch: fetchImpl });

/** Stores a gateway attempt on the seeded order's payments row (what initiateCardPayment does after initiate()). */
async function attachAttempt(tx: DbExecutor, orderId: number, attempt: { ref: string; testMode: boolean; raw?: Record<string, unknown> }) {
  const [row] = await tx.select({ id: schema.payments.id, raw: schema.payments.raw }).from(schema.payments).where(eq(schema.payments.orderId, orderId)).limit(1);
  const raw = withAttempt(row?.raw, { n: attemptsOf(row?.raw).length + 1, ref: attempt.ref, testMode: attempt.testMode, at: new Date().toISOString(), ...attempt.raw });
  if (row) await tx.update(schema.payments).set({ raw }).where(eq(schema.payments.id, row.id));
  else await tx.insert(schema.payments).values({ orderId, provider: "paytr", status: "initiated", amount: TOTAL, raw });
}

async function mockPost(path: string, body: unknown) {
  const res = await fetch(`${mockServer.url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as Record<string, unknown>;
}

before(async () => {
  seqs = await snapshotSequences();
  // The notify URL the mock posts to: the same handler as the route, inside the current test's transaction.
  bridge = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      bridgeContentTypes.push(req.headers["content-type"]);
      const headers: Record<string, string> = {};
      if (req.headers["content-type"]) headers["content-type"] = String(req.headers["content-type"]);
      try {
        if (!bridgeExec) throw new Error("no test transaction");
        const response = await paytrNotifyResponse(
          new Request("http://payments.test/api/payments/paytr/notify", { method: "POST", headers, body: Buffer.concat(chunks) }),
          { executor: bridgeExec, effects: false },
        );
        res.writeHead(response.status, { "Content-Type": "text/plain" });
        res.end(await response.text());
      } catch (error) {
        res.writeHead(599, { "Content-Type": "text/plain" });
        res.end(String(error));
      }
    });
  });
  await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  bridgeUrl = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}/api/payments/paytr/notify`;
  mockServer = await startPaymentMock({ port: 0, paytr: CONFIG_KEYS, paytrNotifyUrl: bridgeUrl, log: () => {} });
});

after(async () => {
  try {
    await restoreSequences(seqs);
  } finally {
    await mockServer?.close();
    await new Promise<void>((resolve) => (bridge ? bridge.close(() => resolve()) : resolve()));
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------

describe("C5: a PayTR test payment for an attempt sent live", () => {
  test("public site: recorded as refused, answered OK, order not paid, dashboard count; a replay changes nothing", async () => {
    await inRollback(async (tx) => {
      const order = await seedOrder(tx, { attempts: [5], attemptTestMode: false });
      const oid = order.oids[0];
      const before = await countPaymentEventAlerts(tx);
      await withEnv(LIVE, async () => {
        const res = await post(notification(oid, { testMode: "1" }), { executor: tx });
        assert.deepEqual([res.status, res.body], [200, "OK"], "PayTR stops retrying");
      });
      const o = await orderOf(tx, order.id);
      assert.equal(o.status, "pending_payment");
      assert.equal(o.paidAt, null);
      const pays = await paymentsOf(tx, order.id);
      assert.deepEqual(pays.map((p) => [p.status, p.providerRef, p.amount]), [["failed", oid, TOTAL]]);
      const raw = pays[0].raw as Record<string, unknown>;
      assert.equal(raw.refused, TEST_PAYMENT_ON_LIVE);
      assert.equal(raw.providerTestMode, true);
      assert.equal(raw.testMode, false, "the attempt was live");
      assert.equal(attemptsOf(raw).length, 1, "attempts kept");
      const events = await eventsOf(tx, order.id);
      assert.deepEqual(
        events.map((e) => [e.type, e.data, e.createdBy]),
        [[PAYMENT_REFUSED_EVENT, { provider: "paytr", providerRef: oid, reason: TEST_PAYMENT_ON_LIVE, amount: TOTAL }, "system"]],
      );
      assert.deepEqual(await countPaymentEventAlerts(tx), {
        ...before,
        testOnLive: before.testOnLive + 1,
        testOnLiveOrderId: before.testOnLive === 0 ? order.id : null,
      });
      const state = paytrAttemptState(pays, Date.now());
      assert.equal(state.latestResult, "failed", "the latest attempt is settled: the buyer may retry");
      assert.equal(state.verifying, false);

      // PayTR repeats the notification: nothing new. A later Durum Sorgu has nothing unsettled to ask.
      await withEnv(LIVE, async () => {
        assert.deepEqual((await post(notification(oid, { testMode: "1" }), { executor: tx })).body, "OK");
      });
      assert.equal((await paymentsOf(tx, order.id)).length, 1);
      assert.equal((await eventsOf(tx, order.id)).length, 1, "no second event (and no success-after-failure event)");
      const asked: string[] = [];
      const noFetch = (async (input: string | URL | Request) => {
        asked.push(String(input));
        throw new Error("no inquiry expected");
      }) as typeof fetch;
      assert.equal((await reconcileCardOrder(order.id, { ...NO_EFFECTS, executor: tx, fetch: noFetch })).state, "none");
      assert.deepEqual(asked, []);
    });
  });

  test("unchanged elsewhere: test-mode attempts, the local site, live payments and failures", async () => {
    await inRollback(async (tx) => {
      const testAttempt = await seedOrder(tx, { attempts: [5], attemptTestMode: true });
      const localLive = await seedOrder(tx, { attempts: [5], attemptTestMode: false });
      const live = await seedOrder(tx, { attempts: [5], attemptTestMode: false });
      const liveFailed = await seedOrder(tx, { attempts: [5], attemptTestMode: false });
      await withEnv(LIVE, async () => {
        assert.equal((await post(notification(testAttempt.oids[0], { testMode: "1" }), { executor: tx })).body, "OK");
        assert.equal((await post(notification(live.oids[0], { testMode: "0" }), { executor: tx })).body, "OK");
        assert.equal((await post(notification(liveFailed.oids[0], { status: "failed", testMode: "1" }), { executor: tx })).body, "OK");
      });
      // Locally the payment mock answers test_mode=1 for everything: applied (and flagged) as before.
      assert.equal((await post(notification(localLive.oids[0], { testMode: "1" }), { executor: tx })).body, "OK");

      for (const [seeded, flagged] of [
        [testAttempt, true],
        [localLive, true],
        [live, false],
      ] as const) {
        assert.equal((await orderOf(tx, seeded.id)).status, "paid");
        const [p] = await paymentsOf(tx, seeded.id);
        assert.equal(p.status, "succeeded");
        assert.equal(isTestPayment("paytr", p.raw), flagged, "TEST ÖDEMESİ only for test payments");
        assert.deepEqual((await eventsOf(tx, seeded.id)).map((e) => e.type), ["payment_succeeded", "status_changed"]);
      }
      assert.equal((await orderOf(tx, liveFailed.id)).status, "pending_payment");
      assert.deepEqual((await eventsOf(tx, liveFailed.id)).map((e) => e.type), ["payment_failed"], "a decline is a decline");
    });
  });

  test("an older attempt's refused result gets a row of its own (superseded); an order that no longer waits stays as it is", async () => {
    await inRollback(async (tx) => {
      const order = await seedOrder(tx, { attempts: [20, 3], attemptTestMode: false });
      await withEnv(LIVE, async () => {
        assert.equal((await post(notification(order.oids[0], { testMode: "1" }), { executor: tx })).body, "OK");
      });
      const pays = await paymentsOf(tx, order.id);
      assert.deepEqual(pays.map((p) => [p.status, p.providerRef]), [["initiated", null], ["failed", order.oids[0]]]);
      assert.equal(isSupersededPayment(pays[1].raw), true, "says nothing about the open attempt");
      assert.equal(paytrAttemptState(pays, Date.now()).verifying, true, "the newer attempt is still open");

      const paid = await seedOrder(tx, { attempts: [5], attemptTestMode: false, status: "paid" });
      const refusal = await refuseCardResult(
        { orderId: paid.id, provider: "paytr", providerRef: paid.oids[0], amount: TOTAL, reason: TEST_PAYMENT_ON_LIVE, attemptRef: paid.oids[0] },
        { executor: tx },
      );
      assert.ok(refusal.ok && !refusal.alreadyProcessed);
      const rows = await paymentsOf(tx, paid.id);
      assert.deepEqual(rows.map((p) => p.status), ["initiated", "failed"]);
      assert.deepEqual((rows[1].raw as Record<string, unknown>).late, true);
      assert.equal((await orderOf(tx, paid.id)).status, "paid");
      assert.deepEqual(await refuseCardResult({ orderId: paid.id, provider: "paytr", providerRef: paid.oids[0], amount: TOTAL, reason: TEST_PAYMENT_ON_LIVE }, { executor: tx }), {
        ok: true,
        alreadyProcessed: true,
        orderId: paid.id,
        orderNumber: paid.orderNumber,
      });
      // A reference of another order is refused.
      const other = await seedOrder(tx, { attempts: [5], attemptTestMode: false });
      assert.deepEqual(await refuseCardResult({ orderId: other.id, provider: "paytr", providerRef: paid.oids[0], amount: TOTAL, reason: TEST_PAYMENT_ON_LIVE }, { executor: tx }), { ok: false, code: "invalid_input" });
    });
  });
});

describe("refused notifications for the panel (audit_log, rate-limited)", () => {
  test("bad hash, missing fields and missing keys for one of our stored attempts are recorded: kind, times, count, that merchant_oid", async () => {
    await inRollback(async (tx) => {
      const order = await seedOrder(tx, { attempts: [5] });
      const oid = order.oids[0];
      const forged = notification(oid, { hashKey: "not-the-key" });
      const bad = await post(forged, { executor: tx, effects: true, now: T0 });
      assert.deepEqual([bad.status, bad.body], [400, "PAYTR notification failed: bad hash"]);
      assert.equal((await orderOf(tx, order.id)).status, "pending_payment");

      const warned = mock.method(console, "warn", () => {});
      try {
        // PayTR-fix R5: nothing names a stored attempt here, so these are logged only (the answers are unchanged).
        const notOurs = await post({ merchant_oid: "X-not-ours", status: "success" }, { executor: tx, effects: true, now: T0 + 30_000 });
        assert.equal(notOurs.status, 400);
        const garbage = await post("x", { executor: tx, effects: true, now: T0 + 35_000, contentType: "text/plain" });
        assert.deepEqual([garbage.status, garbage.body], [400, "PAYTR notification failed: bad request"]);
        const empty = await post("", { executor: tx, effects: true, now: T0 + 40_000, contentType: null });
        assert.equal(empty.status, 400);
        const unknownOrder = paytrMerchantOid("PR-9000000999", 1, "ZXCVBN");
        assert.equal((await post(notification(unknownOrder, { hashKey: "not-the-key" }), { executor: tx, effects: true, now: T0 + 45_000 })).status, 400);
        assert.ok(warned.mock.calls.some((c) => String(c.arguments[0]).includes("not a stored payment attempt, not shown in the panel")));
        assert.ok(warned.mock.calls.some((c) => String(c.arguments[0]).includes("unreadable body")));
      } finally {
        warned.mock.restore();
      }
      const missing = await post({ merchant_oid: oid, status: "success" }, { executor: tx, effects: true, now: T0 + 60_000 });
      assert.equal(missing.status, 400);
      await withEnv({ PAYTR_MERCHANT_SALT: undefined }, async () => {
        const notConfigured = await post(notification(oid), { executor: tx, effects: true, now: T0 + 180_000 });
        assert.equal(notConfigured.status, 503);
        // Without keys a made-up merchant_oid is refused as well, and not recorded.
        assert.equal((await post({ merchant_oid: "X-not-ours" }, { executor: tx, effects: true, now: T0 + 200_000 })).status, 503);
      });
      // effects: false (the existing provider tests) records nothing.
      await post(forged, { executor: tx, effects: false, now: T0 + 3_600_000 });

      const rows = await refusalRows(tx);
      assert.deepEqual(
        rows.map((r) => [r.entityId, r.userId, r.before, r.after]),
        [
          ["bad_hash", null, null, { kind: "bad_hash", count: 1, firstAt: new Date(T0).toISOString(), lastAt: new Date(T0).toISOString(), merchantOid: oid }],
          ["missing_fields", null, null, { kind: "missing_fields", count: 1, firstAt: new Date(T0 + 60_000).toISOString(), lastAt: new Date(T0 + 60_000).toISOString(), merchantOid: oid }],
          ["not_configured", null, null, { kind: "not_configured", count: 1, firstAt: new Date(T0 + 180_000).toISOString(), lastAt: new Date(T0 + 180_000).toISOString(), merchantOid: oid }],
        ],
      );
      const dump = JSON.stringify(rows);
      assert.ok(!dump.includes(forged.hash), "never the posted hash");
      assert.ok(!dump.includes("X-not-ours") && !dump.includes("PR9000000999"), "never a merchant_oid that is not a stored attempt");
      assert.ok(!dump.includes("total_amount") && !dump.includes("payment_type"), "never the body");

      // A later refusal of the same kind in the same 10-minute window raises the row's count.
      assert.equal(await recordNotifyRefusal(tx, "missing_fields", oid, T0 + 240_000), "updated");
      const summary = await notifyRefusalSummary(tx, T0 + 300_000);
      assert.deepEqual(summary, {
        count: 4,
        windowHours: 72,
        firstAt: new Date(T0).toISOString(),
        lastAt: new Date(T0 + 240_000).toISOString(),
        kinds: ["bad_hash", "missing_fields", "not_configured"],
        merchantOid: oid,
      });
    });
  });

  test("at most one row per kind per 10 minutes and one write per kind per 10 s; a flood only raises the count", async () => {
    await inRollback(async (tx) => {
      const ours = paytrMerchantOid("PR-9000000123", 1, "ZXCVBN");
      assert.equal(await recordNotifyRefusal(tx, "bad_hash", ours, T0), "inserted");
      const flood = await Promise.all(Array.from({ length: 500 }, (_, i) => recordNotifyRefusal(tx, "bad_hash", "garbage", T0 + 1_000 + i)));
      assert.ok(flood.every((r) => r === "throttled"), "no database write for 500 posts inside 10 s");
      assert.equal(await recordNotifyRefusal(tx, "bad_hash", null, T0 + 15_000), "updated");
      assert.equal(await recordNotifyRefusal(tx, "bad_hash", null, T0 + 9 * MIN), "updated");
      assert.equal(await recordNotifyRefusal(tx, "bad_hash", null, T0 + 11 * MIN), "inserted", "a new 10-minute window");
      const rows = await refusalRows(tx);
      assert.deepEqual(
        rows.map((r) => [r.entityId, (r.after as { count: number }).count, (r.after as { merchantOid: string | null }).merchantOid]),
        [
          ["bad_hash", 503, ours],
          ["bad_hash", 1, null],
        ],
        "the earlier merchant_oid is kept; 'garbage' never stored",
      );
      assert.equal((await notifyRefusalSummary(tx, T0 + 12 * MIN))?.count, 504);
      // A post every 10 s for an hour (each one past the throttle): one row per 10-minute window.
      for (let i = 0; i < 360; i++) await recordNotifyRefusal(tx, "missing_fields", null, T0 + 2 * 3_600_000 + i * 10_000);
      assert.ok((await refusalRows(tx)).filter((r) => r.entityId === "missing_fields").length <= 7);
    });
  });

  test("a writer that finds the kind's lock taken does not wait; its refusal goes into the next write", async () => {
    await inRollback(async (tx) => {
      // Another connection holds the lock for "bad_hash" (namespace "PRPN", kind index 0).
      await db.transaction(async (other) => {
        await other.execute(sql`select pg_advisory_xact_lock(${0x5052504e}::int, 0::int)`);
        const started = Date.now();
        assert.equal(await recordNotifyRefusal(tx, "bad_hash", null, T0), "busy");
        assert.ok(Date.now() - started < 2_000, "no queueing behind the lock");
      });
      assert.equal((await refusalRows(tx)).length, 0);
      assert.equal(await recordNotifyRefusal(tx, "bad_hash", null, T0 + 11_000), "inserted");
      assert.equal(((await refusalRows(tx))[0].after as { count: number }).count, 2);
    });
  });

  test("the summary covers 72 hours (by the last refusal of a row) and is null without refusals", async () => {
    await inRollback(async (tx) => {
      const now = T0 + 100 * 3_600_000;
      assert.equal(await notifyRefusalSummary(tx, now), null);
      const insert = (createdHoursAgo: number, lastHoursAgo: number, count: number) =>
        tx.insert(schema.auditLog).values({
          userId: null,
          action: NOTIFY_REFUSAL_ACTION,
          entity: NOTIFY_REFUSAL_ENTITY,
          entityId: "bad_hash",
          after: { kind: "bad_hash", count, firstAt: new Date(now - createdHoursAgo * 3_600_000).toISOString(), lastAt: new Date(now - lastHoursAgo * 3_600_000).toISOString(), merchantOid: null },
          createdAt: new Date(now - createdHoursAgo * 3_600_000),
        });
      await insert(80, 73, 9); // over
      await insert(72.1, 71.95, 4); // created just before the window, last refusal inside it
      await insert(2, 1, 3);
      const summary = await notifyRefusalSummary(tx, now);
      assert.equal(summary?.count, 7);
      assert.equal(summary?.lastAt, new Date(now - 3_600_000).toISOString());
      assert.equal(await notifyRefusalSummary(tx, now + 72 * 3_600_000), null, "gone 72 hours after the last refusal");
    });
  });
});

describe("C13a: a success after a recorded failure for the same merchant_oid", () => {
  test("one order event and a log line; no state change; replays of unapplied successes are not counted", async () => {
    await inRollback(async (tx) => {
      const order = await seedOrder(tx, { attempts: [5] });
      const oid = order.oids[0];
      const before = await countPaymentEventAlerts(tx);
      const logged = mock.method(console, "error", () => {});
      try {
        assert.equal((await post(notification(oid, { status: "failed" }), { executor: tx })).body, "OK");
        assert.equal((await post(notification(oid, { status: "success" }), { executor: tx })).body, "OK");
        assert.equal((await post(notification(oid, { status: "success" }), { executor: tx })).body, "OK");
        assert.ok(logged.mock.calls.some((c) => String(c.arguments[0]).includes("success after a recorded failure")), "log line");
      } finally {
        logged.mock.restore();
      }
      assert.equal((await orderOf(tx, order.id)).status, "pending_payment", "the first result counts");
      assert.deepEqual((await paymentsOf(tx, order.id)).map((p) => p.status), ["failed"]);
      const events = await eventsOf(tx, order.id);
      assert.deepEqual(events.map((e) => e.type), ["payment_failed", PAYMENT_SUCCESS_AFTER_FAILURE_EVENT], "once per reference");
      assert.deepEqual(events[1].data, { provider: "paytr", providerRef: oid, amount: TOTAL });
      assert.deepEqual(await countPaymentEventAlerts(tx), {
        ...before,
        successAfterFailure: before.successAfterFailure + 1,
        successAfterFailureOrderId: before.successAfterFailure === 0 ? order.id : null,
      });
      await tx.update(schema.orders).set({ paidAt: new Date() }).where(eq(schema.orders.id, order.id));
      assert.deepEqual(await countPaymentEventAlerts(tx), before, "settled once the owner records the payment");

      // A recorded amount mismatch replayed is not "after a failure".
      const short = await seedOrder(tx, { attempts: [5] });
      assert.equal((await post(notification(short.oids[0], { total: TOTAL - 100 }), { executor: tx })).body, "OK");
      assert.equal((await post(notification(short.oids[0], { total: TOTAL - 100 }), { executor: tx })).body, "OK");
      assert.deepEqual((await eventsOf(tx, short.id)).map((e) => e.type), ["payment_amount_mismatch"]);
    });
  });
});

describe("C13b: a notification without a Content-Type", () => {
  test("hand-built: the form body is read and applied", async () => {
    await inRollback(async (tx) => {
      const order = await seedOrder(tx, { attempts: [5] });
      const res = await post(notification(order.oids[0]), { executor: tx, contentType: null });
      assert.equal(res.requestType, null, "really no Content-Type");
      assert.deepEqual([res.status, res.body], [200, "OK"]);
      assert.equal((await orderOf(tx, order.id)).status, "paid");
      // Other types keep their rules (text/plain is not a form).
      const other = await seedOrder(tx, { attempts: [5] });
      assert.equal((await post(notification(other.oids[0]), { executor: tx, contentType: "text/plain" })).status, 400);
    });
  });

  test("sent so by the payment mock after a get-token through the gateway (user_ip converted, token in base64 form)", async () => {
    await withEnv({ PAYTR_BASE_URL: mockServer.url }, async () => {
      await inRollback(
        async (tx) => {
          bridgeExec = tx;
          try {
            await mockPost("/_mock/config", { paytrToken: "base64" });
            const order = await seedOrder(tx, { attempts: [] });
            const started = await gatewayFor(mockServer.url, undefined, true).initiate(gatewayOrder("::ffff:203.0.113.9", order.orderNumber));
            assert.ok(started.iframeUrl && started.attempt, "the mock accepted the get-token hash computed with user_ip 203.0.113.9");
            assert.match(started.iframeUrl, /\/odeme\/guvenli\/[^/]*%3D%3D$/, "a base64 token, URL-encoded into the iframe path");
            assert.equal((await fetch(started.iframeUrl)).status, 200, "the mock finds the session behind the encoded token");
            await attachAttempt(tx, order.id, started.attempt);
            bridgeContentTypes.length = 0;
            const done = await mockPost("/_mock/paytr/complete", { merchantOid: started.attempt.ref, outcome: "success", contentType: "none" });
            assert.deepEqual([(done.notify as { status: number }).status, (done.notify as { body: string }).body], [200, "OK"]);
            assert.deepEqual(bridgeContentTypes, [undefined], "the mock posted without a Content-Type");
            assert.equal((await orderOf(tx, order.id)).status, "paid");
          } finally {
            bridgeExec = null;
            await mockPost("/_mock/config", { paytrToken: "hex" });
          }
        },
        { PAYTR_BASE_URL: mockServer.url },
      );
    });
  });
});

describe("C13c + C8: get-token through the gateway (stubbed HTTP)", () => {
  test("tokens of other shapes are accepted when they fit the iframe path; others are refused with a clear reason", async () => {
    let answer: Record<string, unknown> = {};
    const stub = getTokenStub(() => answer);
    const gateway = gatewayFor(BASE, stub.fetch);
    answer = { status: "success", token: "ab+cd==" };
    const ok = await gateway.initiate(gatewayOrder("85.34.78.112"));
    assert.equal(ok.iframeUrl, `${BASE}/odeme/guvenli/ab%2Bcd%3D%3D`);
    answer = { status: "success", token: "x".repeat(512) };
    assert.ok((await gateway.initiate(gatewayOrder("85.34.78.112"))).iframeUrl);

    const logged = mock.method(console, "error", () => {});
    try {
      for (const token of ["x".repeat(513), "a/b", "a?b", "a b", "", undefined, 42]) {
        answer = { status: "success", token };
        await assert.rejects(gateway.initiate(gatewayOrder("85.34.78.112")), (error: unknown) => {
          assert.ok(error instanceof GatewayRefusedError);
          assert.equal(error.providerMessage, "PayTR ödeme formu anahtarını (token) beklenmeyen biçimde döndürdü; ödeme formu açılmadı.");
          return true;
        });
      }
      const lines = logged.mock.calls.map((c) => JSON.stringify(c.arguments));
      assert.equal(lines.filter((l) => l.includes("unexpected token format")).length, 7);
      assert.ok(!lines.some((l) => l.includes("a?b") || l.includes("x".repeat(513))), "never the token in the log");
    } finally {
      logged.mock.restore();
    }
    // PayTR's own refusal keeps its reason (go-live CF-12).
    answer = { status: "failed", reason: "Gecersiz user_ip" };
    await assert.rejects(gateway.initiate(gatewayOrder("85.34.78.112")), (error: unknown) => error instanceof GatewayRefusedError && error.providerMessage === "Gecersiz user_ip");
    assert.deepEqual(stub.problems, []);
  });

  test("user_ip: IPv4-mapped IPv6 → IPv4, IPv6 compressed, unknown → 127.0.0.1; the hash covers the value sent", async () => {
    const stub = getTokenStub(() => ({ status: "success", token: "0123456789abcdef" }));
    const gateway = gatewayFor(BASE, stub.fetch);
    for (const [clientIp, sent] of [
      ["::ffff:203.0.113.9", "203.0.113.9"],
      ["0000:0000:0000:0000:0000:ffff:255.255.255.255", "255.255.255.255"],
      ["2001:0db8:85a3:0000:0000:8a2e:0370:7334", "2001:db8:85a3::8a2e:370:7334"],
      ["2a02:e0:1234:5678:9abc:def0:1234:5678", "2a02:e0:1234:5678:9abc:def0:1234:5678"],
      ["85.34.78.112", "85.34.78.112"],
      [null, "127.0.0.1"],
      ["unknown", "127.0.0.1"],
    ] as const) {
      await gateway.initiate(gatewayOrder(clientIp));
      assert.equal(stub.forms.at(-1)?.get("user_ip"), sent, String(clientIp));
    }
    assert.deepEqual(stub.problems, [], "every paytr_token matched the user_ip sent");
  });

  test("against the mock: a token with '/' is refused before any iframe is shown", async () => {
    await withEnv({ PAYTR_BASE_URL: mockServer.url }, async () => {
      await mockPost("/_mock/config", { paytrToken: "slash" });
      try {
        const logged = mock.method(console, "error", () => {});
        try {
          await assert.rejects(gatewayFor(mockServer.url, undefined, true).initiate(gatewayOrder("85.34.78.112", "PR-9261002")), GatewayRefusedError);
        } finally {
          logged.mock.restore();
        }
      } finally {
        await mockPost("/_mock/config", { paytrToken: "hex" });
      }
    });
  });
});

describe("C10: refunds (/odeme/iade)", () => {
  const already = "Bu ödeme zaten iade edilmiş olabilir; PayTR panelinden kontrol edin.";
  const balance = "PayTR bakiyesi yetersiz; iadeyi daha sonra tekrar deneyin veya PayTR ile görüşün.";
  const refundInput = (merchantOid: string) => ({ orderId: 1, providerRef: merchantOid, amount: TOTAL, raw: { merchantOid } });

  test("stubbed HTTP: 006 / 009 / 010 mapped, other codes kept, a timeout and a network error explained", async () => {
    let reply: () => Promise<Response> = async () => new Response("{}");
    const calls: URLSearchParams[] = [];
    const stub = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push(new URLSearchParams(String(init?.body ?? "")));
      assert.ok(init?.signal instanceof AbortSignal, "every call has a timeout signal");
      return reply();
    }) as typeof fetch;
    const gateway = gatewayFor(BASE, stub);
    const json = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    reply = json({ status: "success", is_test: 1, merchant_oid: "PR9261001A1ABCDEF", return_amount: "399.70" });
    const ok = await gateway.refund(refundInput("PR9261001A1ABCDEF"));
    assert.ok(ok.ok);
    const form = calls.at(-1)!;
    // dev.paytr.com/iade-api: base64(HMAC-SHA256(merchant_id + merchant_oid + return_amount + merchant_salt, merchant_key))
    const token = createHmac("sha256", KEYS.PAYTR_MERCHANT_KEY).update(`${KEYS.PAYTR_MERCHANT_ID}PR9261001A1ABCDEF399.70${KEYS.PAYTR_MERCHANT_SALT}`).digest("base64");
    assert.equal(form.get("paytr_token"), token);
    assert.equal(form.get("return_amount"), "399.70");

    const errorOf = async () => {
      const r = await gateway.refund(refundInput("PR9261001A1ABCDEF"));
      assert.equal(r.ok, false);
      return r.ok ? "" : r.error;
    };
    reply = json({ status: "error", err_no: "009", err_msg: "Toplam iade tutari odeme tutarindan fazla olamaz" });
    assert.equal(await errorOf(), `${already} (PayTR 009)`);
    reply = json({ status: "error", err_no: "006", err_msg: "Toplam iade tutarı odeme tutarindan fazla olamaz" });
    assert.equal(await errorOf(), `${already} (PayTR 006)`);
    reply = json({ status: "error", err_no: "010", err_msg: "Net bakiyeniz yetersiz" });
    assert.equal(await errorOf(), `${balance} (PayTR 010)`);
    // PayTR-fix R6: 007 tells the admin to restart the stuck notifications; other codes keep PayTR's text.
    reply = json({ status: "error", err_no: "007", err_msg: "merchant_oid bulundu ancak odeme henuz siteye bildirilmemis" });
    assert.equal(
      await errorOf(),
      "PayTR bu ödemenin bildirimini tamamlanmış saymıyor; PayTR Mağaza Paneli › Mağaza Bildirimleri sayfasında duran bildirimleri yeniden başlatın, sonra iadeyi tekrar deneyin. (PayTR 007)",
    );
    reply = json({ status: "error", err_no: "011", err_msg: "Bir yildan eski islemler icin iade islemi yapilamaz." });
    assert.equal(await errorOf(), "PayTR 011: Bir yildan eski islemler icin iade islemi yapilamaz.");
    const logged = mock.method(console, "error", () => {});
    try {
      reply = async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      };
      assert.equal(await errorOf(), "PayTR 90 saniye içinde yanıt vermedi; iade yine de yapılmış olabilir. Tekrar denemeden önce PayTR panelinden kontrol edin.");
      reply = async () => {
        throw new TypeError("fetch failed");
      };
      assert.equal(await errorOf(), "PayTR'ye ulaşılamadı. Bir süre sonra tekrar deneyin.");
    } finally {
      logged.mock.restore();
    }
  });

  test("against the mock: a slow answer still counts; err 009 / 010 from the mock; a second refund gets 006 → 'already refunded?'", async () => {
    await withEnv({ PAYTR_BASE_URL: mockServer.url }, async () => {
      await inRollback(
        async (tx) => {
          bridgeExec = tx;
          try {
            const order = await seedOrder(tx, { attempts: [] });
            const started = await gatewayFor(mockServer.url, undefined, true).initiate(gatewayOrder("85.34.78.112", order.orderNumber));
            assert.ok(started.attempt);
            await attachAttempt(tx, order.id, started.attempt);
            const done = await mockPost("/_mock/paytr/complete", { merchantOid: started.attempt.ref, outcome: "success" });
            assert.equal((done.notify as { body: string }).body, "OK");
            const gateway = gatewayFor(mockServer.url, undefined, true);
            const input = refundInput(started.attempt.ref);

            await mockPost("/_mock/config", { paytrRefund: "err009" });
            const e009 = await gateway.refund(input);
            assert.ok(!e009.ok && e009.error === `${already} (PayTR 009)`);
            await mockPost("/_mock/config", { paytrRefund: "err010" });
            const e010 = await gateway.refund(input);
            assert.ok(!e010.ok && e010.error === `${balance} (PayTR 010)`);

            await mockPost("/_mock/config", { paytrRefund: "ok", paytrRefundDelayMs: 1_500 });
            const t = Date.now();
            const slow = await gateway.refund(input);
            assert.ok(slow.ok, JSON.stringify(slow));
            assert.ok(Date.now() - t >= 1_400, "the answer really was slow");
            await mockPost("/_mock/config", { paytrRefundDelayMs: 0 });
            const again = await gateway.refund(input);
            assert.ok(!again.ok && again.error === `${already} (PayTR 006)`, "the mock answers 006 like the iade page's example");
          } finally {
            bridgeExec = null;
            await mockPost("/_mock/config", { paytrRefund: "ok", paytrRefundDelayMs: 0 });
          }
        },
        { PAYTR_BASE_URL: mockServer.url },
      );
    });
  });

  test("the mock's store test mode: test_mode=1 on notifications and Durum Sorgu for a live request", async () => {
    await withEnv({ PAYTR_BASE_URL: mockServer.url }, async () => {
      await inRollback(
        async (tx) => {
          bridgeExec = tx;
          try {
            await mockPost("/_mock/config", { paytrStoreTestMode: true });
            const order = await seedOrder(tx, { attempts: [] });
            const started = await gatewayFor(mockServer.url, undefined, false).initiate(gatewayOrder("85.34.78.112", order.orderNumber));
            assert.ok(started.attempt && started.attempt.testMode === false, "sent live");
            await attachAttempt(tx, order.id, started.attempt);
            const done = await mockPost("/_mock/paytr/complete", { merchantOid: started.attempt.ref, outcome: "success" });
            assert.equal((done.notify as { fields: Record<string, string> }).fields.test_mode, "1");
            // Locally (the mock is only allowed here) the C5 rule never applies: paid and flagged as a test payment.
            assert.equal((await orderOf(tx, order.id)).status, "paid");
            const [p] = await paymentsOf(tx, order.id);
            assert.equal(isTestPayment("paytr", p.raw), true);
          } finally {
            bridgeExec = null;
            await mockPost("/_mock/config", { paytrStoreTestMode: false });
          }
        },
        { PAYTR_BASE_URL: mockServer.url },
      );
    });
  });
});
