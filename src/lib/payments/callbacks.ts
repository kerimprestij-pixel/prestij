// Provider callbacks → completeCardPayment. No Next request APIs here (the route handlers in
// src/app/api/payments/** pass plain values), so DB tests call these directly.
//   iyzico: the buyer's browser POSTs `token` to /api/payments/iyzico/callback?o=<order number>; we
//           retrieve the result server-to-server, verify its signature, complete, and send the browser
//           (303) to the order page.
//   PayTR:  PayTR's server POSTs the notification to /api/payments/paytr/notify; we verify the hash,
//           complete, and answer "OK" (also for replays and for results we refuse to apply, e.g. a test payment
//           for an attempt sent live: PayTR-fix C5). Refusals of the notification itself (bad hash, missing
//           fields, keys not configured) are recorded for the panel warning (alerts.ts) only when the posted
//           merchant_oid is a stored attempt of one of our orders (PayTR-fix R5); others are logged only.
import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { href } from "@/i18n/paths";
import type { DbExecutor } from "@/lib/cart/settings";
import { safeErrorInfo } from "@/lib/db-errors";
import { normalizeOrderNumber } from "@/lib/orders/number";
import { orderPageHref } from "@/lib/orders/token";
import { recordNotifyRefusal, type NotifyRefusalKind } from "./alerts";
import { findAttempt, type StoredAttempt } from "./attempts";
import { completeCardPayment, refuseCardResult, type CompleteCardPaymentResult, type RefuseCardResultOutcome } from "./complete";
import { iyzicoEnv, paytrEnv } from "./config";
import { loadPaymentSettings } from "./gateway";
import { retrieveIyzicoCheckout } from "./iyzico-gateway";
import { parsePaytrMerchantOid, parsePaytrNotification, paytrTestResultForLiveAttempt, TEST_PAYMENT_ON_LIVE } from "./paytr-crypto";
import { applyPaytrResult } from "./paytr-result";

type OrderRef = { id: number; orderNumber: string; accessToken: string; locale: Locale; status: string; paymentMethod: string };

async function findOrder(orderNumber: string, exec: DbExecutor = db): Promise<OrderRef | null> {
  const o = schema.orders;
  const [row] = await exec
    .select({ id: o.id, orderNumber: o.orderNumber, accessToken: o.accessToken, locale: o.locale, status: o.status, paymentMethod: o.paymentMethod })
    .from(o)
    .where(eq(o.orderNumber, orderNumber))
    .limit(1);
  return row ? { ...row, locale: isLocale(row.locale) ? row.locale : "tr" } : null;
}

/** payments.raw of the order's rows for one provider, newest first (for the attempt lookup). */
async function paymentRaws(orderId: number, provider: "iyzico" | "paytr", exec: DbExecutor = db): Promise<unknown[]> {
  const p = schema.payments;
  const rows = await exec.select({ raw: p.raw, provider: p.provider }).from(p).where(eq(p.orderId, orderId)).orderBy(desc(p.id));
  return rows.filter((r) => r.provider === provider).map((r) => r.raw);
}

// ---------------------------------------------------------------------------------------------------
// iyzico

export type IyzicoCallbackOutcome = "paid" | "failed" | "pending" | "refused" | "invalid" | "not_configured";

export type IyzicoCallbackResult = {
  outcome: IyzicoCallbackOutcome;
  /** Where to send the browser (303). The order token is only in it when iyzico confirmed the attempt. */
  redirectTo: string;
  /** The completeCardPayment answer, when it ran. */
  completion?: CompleteCardPaymentResult;
  /** Why nothing was applied (logs and tests). */
  reason?: string;
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;

/**
 * Handles the browser POST from iyzico's hosted page. Garbage, unknown orders and results that fail the
 * signature check end on the order lookup page (never with the order token); a verified result ends on
 * the order page: `new=1` after a payment, `payment=failed` after a failure.
 */
export async function handleIyzicoCallback(input: { token: unknown; orderNumber: unknown }, options: { effects?: boolean } = {}): Promise<IyzicoCallbackResult> {
  const number = normalizeOrderNumber(input.orderNumber);
  const lookup = (locale: Locale = "tr") => href(locale, "orderLookup");
  if (typeof input.token !== "string" || !TOKEN_PATTERN.test(input.token) || !number) return { outcome: "invalid", redirectTo: lookup(), reason: "malformed" };
  const token = input.token;
  const order = await findOrder(number);
  if (!order || order.paymentMethod !== "card") return { outcome: "invalid", redirectTo: lookup(), reason: "unknown_order" };

  const attempt: StoredAttempt | null = findAttempt(await paymentRaws(order.id, "iyzico"), token);
  // The attempt tells which iyzico environment issued the token; without it (e.g. storing it failed) use
  // the panel's current mode. Either way iyzico itself confirms the token belongs to this basket.
  const testMode = attempt ? attempt.testMode : (await loadPaymentSettings()).card.testMode;
  const env = iyzicoEnv(testMode);
  if (!env) return { outcome: "not_configured", redirectTo: lookup(order.locale), reason: "not_configured" };
  const config = { ...env, testMode, installments: false, maxInstallments: 1 };

  const back = (flags: { new?: boolean; paymentFailed?: boolean; paymentChecking?: boolean } = {}) => orderPageHref(order.locale, order.orderNumber, order.accessToken, flags);
  const verified = await retrieveIyzicoCheckout(config, { token, orderNumber: order.orderNumber, conversationId: attempt?.conversationId ?? null });
  if (!verified.ok) {
    console.warn(`[payments] iyzico callback not applied order=${order.id} reason=${verified.reason}`);
    // Only a token we issued for this order may lead back to the order page. Without a definite answer
    // the card may have been charged: the order page says "we are confirming your payment" (no retry
    // button while it asks iyzico again; see reconcile.ts), never "declined".
    if (attempt && (verified.reason === "pending" || verified.reason === "retrieve_failed" || verified.reason === "unreachable")) {
      return { outcome: "pending", redirectTo: back({ paymentChecking: true }), reason: verified.reason };
    }
    return { outcome: "refused", redirectTo: lookup(order.locale), reason: verified.reason };
  }

  const completion = await completeCardPayment(
    { orderId: order.id, providerRef: verified.providerRef, success: verified.success, amount: verified.amount, raw: verified.raw, provider: "iyzico", attemptRef: token },
    options,
  );
  if (completion.ok) {
    return completion.status === "paid"
      ? { outcome: "paid", redirectTo: back({ new: !completion.alreadyProcessed }), completion }
      : { outcome: "failed", redirectTo: back({ paymentFailed: true }), completion };
  }
  console.warn(`[payments] iyzico result refused order=${order.id} code=${completion.code}`);
  if (completion.code === "amount_mismatch") return { outcome: "refused", redirectTo: back({ paymentFailed: true }), completion, reason: completion.code };
  return { outcome: "refused", redirectTo: back(), completion, reason: completion.code };
}

// ---------------------------------------------------------------------------------------------------
// PayTR

export type PaytrNotifyResult = {
  /** HTTP status for PayTR: 200 with "OK" when the notification is handled (applied, replayed or refused for good). */
  status: 200 | 400 | 500 | 503;
  body: string;
  completion?: CompleteCardPaymentResult;
  /** PayTR-fix C5: the result was recorded but not applied (a test payment for an attempt sent live). */
  refusal?: RefuseCardResultOutcome;
  reason?: string;
};

export type PaytrNotifyOptions = {
  /** Mails and cache effects of an applied result, and the refused-notification record (default true). */
  effects?: boolean;
  /** Read and write inside this transaction (DB tests roll it back). */
  executor?: DbExecutor;
  /** Clock of the refused-notification record (ms epoch, default now). */
  now?: number;
};

const OK: PaytrNotifyResult = { status: 200, body: "OK" };

/** The posted merchant_oid is one we issued AND a stored PayTR attempt of an existing order (PayTR-fix R5). */
async function isStoredPaytrAttempt(merchantOid: unknown, exec: DbExecutor): Promise<boolean> {
  const parsed = parsePaytrMerchantOid(merchantOid);
  if (!parsed) return false;
  const order = await findOrder(parsed.orderNumber, exec);
  if (!order || order.paymentMethod !== "card") return false;
  return findAttempt(await paymentRaws(order.id, "paytr", exec), String(merchantOid)) !== null;
}

/**
 * The panel warning "PayTR bildirimleri reddediliyor" (alerts.ts): records a refusal of the notification itself
 * (rate-limited there; never the posted body or hash). PayTR-fix R5: only when the posted merchant_oid is a stored
 * attempt of one of our orders, which is what a real misconfiguration produces (PayTR always posts our merchant_oid);
 * an anonymous or hand-made POST (no merchant_oid, a made-up one, an unreadable body) only gets a log line, so a
 * stranger cannot raise the owner's warning. Skipped with effects: false. Never throws.
 */
export async function notePaytrNotifyRefusal(kind: NotifyRefusalKind, merchantOid: unknown, options: PaytrNotifyOptions = {}): Promise<void> {
  if (options.effects === false) return;
  const exec = options.executor ?? db;
  try {
    if (!(await isStoredPaytrAttempt(merchantOid, exec))) {
      console.warn(`[payments] paytr notify refused kind=${kind}: not a stored payment attempt, not shown in the panel`);
      return;
    }
  } catch (error) {
    console.error(`[payments] paytr notify refusal lookup failed kind=${kind}`, safeErrorInfo(error));
    return;
  }
  await recordNotifyRefusal(exec, kind, merchantOid, options.now);
}

/**
 * Handles PayTR's server-to-server notification (form fields as received). A bad hash gets 400 (PayTR
 * retries; a forger gets nothing); missing keys 503 (retry later); a DB error 500 (retry). Everything
 * verified gets "OK", including replays (completeCardPayment is idempotent per merchant_oid), amount
 * mismatches (recorded), notifications for orders that no longer wait, and (PayTR-fix C5) a test payment
 * (test_mode=1) for an attempt we sent live on a public site (or, without a stored attempt, while the panel is
 * live: R7): recorded as refused ("test_payment_on_live", refuseCardResult), never applied. Locally, and for attempts
 * sent in test mode, a test payment is applied and flagged "TEST ÖDEMESİ" as before. Bad hash, missing fields and
 * missing keys are recorded for the panel when the merchant_oid is one of our stored attempts (R5).
 */
export async function handlePaytrNotify(fields: Record<string, string | undefined>, options: PaytrNotifyOptions = {}): Promise<PaytrNotifyResult> {
  const env = paytrEnv();
  if (!env) {
    await notePaytrNotifyRefusal("not_configured", fields.merchant_oid, options);
    return { status: 503, body: "PAYTR notification failed: not configured", reason: "not_configured" };
  }
  const parsed = parsePaytrNotification(fields, env);
  if (!parsed.ok) {
    if (parsed.reason === "bad_hash" || parsed.reason === "missing_fields") {
      console.warn(`[payments] paytr notify refused reason=${parsed.reason}`);
      await notePaytrNotifyRefusal(parsed.reason, fields.merchant_oid, options);
      return { status: 400, body: "PAYTR notification failed: bad hash", reason: parsed.reason };
    }
    // A genuine PayTR message about something we cannot map: acknowledge, and log for a manual check.
    console.error(`[payments] paytr notify unmapped reason=${parsed.reason} oid=${(fields.merchant_oid ?? "").slice(0, 64)}`);
    return { ...OK, reason: parsed.reason };
  }
  const n = parsed.notification;
  const exec = options.executor ?? db;
  try {
    const order = await findOrder(n.orderNumber, exec);
    if (!order || order.paymentMethod !== "card") {
      console.error(`[payments] paytr notify for unknown order oid=${n.merchantOid}`);
      return { ...OK, reason: "unknown_order" };
    }
    const attempt = findAttempt(await paymentRaws(order.id, "paytr", exec), n.merchantOid);
    if (!attempt) console.warn(`[payments] paytr notify without a stored attempt order=${order.id}`);
    // PayTR-fix R7: without a stored attempt (storing it after get-token failed) the panel's current test mode stands
    // in for the attempt's, as for iyzico above, so a test payment on a live site is refused rather than applied
    // (a refused test payment moves no money). Read only for a test-mode success.
    const providerTestMode = n.raw.providerTestMode === true;
    const attemptTestMode = attempt ? attempt.testMode : n.success && providerTestMode ? (await loadPaymentSettings(exec)).card.testMode : undefined;
    if (n.success && paytrTestResultForLiveAttempt(attemptTestMode, providerTestMode)) {
      // PayTR-fix C5 (the rule the Durum Sorgu reconcile shares): a test payment moved no money.
      const requested = typeof attempt?.paymentAmount === "number" ? attempt.paymentAmount : null;
      const refusal = await refuseCardResult(
        {
          orderId: order.id,
          provider: "paytr",
          providerRef: n.merchantOid,
          amount: requested ?? n.totalAmount,
          reason: TEST_PAYMENT_ON_LIVE,
          raw: { ...n.raw, testMode: false, requestedAmount: requested },
          attemptRef: n.merchantOid,
        },
        { executor: options.executor },
      );
      if (!refusal.ok) console.warn(`[payments] paytr test payment for a live attempt not recorded order=${order.id} code=${refusal.code}`);
      return { ...OK, refusal, reason: TEST_PAYMENT_ON_LIVE };
    }
    // The same path as a payment found by the Durum Sorgu reconcile (paytr-result.ts).
    const completion = await applyPaytrResult(
      { orderId: order.id, merchantOid: n.merchantOid, success: n.success, totalAmount: n.totalAmount, raw: n.raw, attempt },
      { effects: options.effects, executor: options.executor },
    );
    if (!completion.ok) {
      if (completion.code === "not_configured") {
        await notePaytrNotifyRefusal("not_configured", n.merchantOid, options);
        return { status: 503, body: "PAYTR notification failed: not configured", completion, reason: completion.code };
      }
      console.warn(`[payments] paytr result refused order=${order.id} code=${completion.code}`);
    }
    return { ...OK, completion };
  } catch (error) {
    console.error("[payments] paytr notify failed", safeErrorInfo(error));
    return { status: 500, body: "PAYTR notification failed: server error", reason: "server_error" };
  }
}
