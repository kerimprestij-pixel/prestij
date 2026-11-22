// Card results that never reached us. Before anything acts on "unpaid" (the buyer's retry button, the expiry
// job) and while the order pages say "we are confirming your payment", we ask the provider about the order's
// attempts whose result we have not recorded and apply what it confirms through completeCardPayment.
//   iyzico: the Checkout Form has no server-to-server notification: the only signal is the buyer's browser
//           POSTing the token to our callback, and when that retrieve fails (timeout, iyzico 5xx) or the browser
//           never comes back, the card may be charged while the order still says pending_payment.
//   PayTR:  the result arrives only as the server-to-server notification. PayTR repeats an unanswered one "after
//           a minute", but documents no retry count, and stuck notifications wait in the merchant panel for
//           "Duran Bildirimleri Yeniden Başlat" (dev.paytr.com FAQ). So we ask Durum Sorgu (queryPaytrStatus) about
//           the unsettled attempts: "paid" is applied exactly as its notification would be (applyPaytrResult: same
//           amount check, idempotent per merchant_oid, same events, stock and e-mails); "not paid" and "unknown"
//           change nothing. A test payment for an attempt we sent live is never applied (C5 rule).
//           PayTR-fix R1: an inquiry never writes a final failure. A "paid" answer whose amount does not give the
//           order's total (less than we asked for, e.g. "1.500" read in a tr-TR format) changes nothing and counts as
//           unknown (the expiry never cancels it, a retry answers "checking", and after 24 h the dashboard to-do
//           "Kart ödemesi doğrulanamadı" appears). Only PayTR's hash-verified notification may record a short payment.
import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DbExecutor } from "@/lib/cart/settings";
import { safeErrorInfo } from "@/lib/db-errors";
import { attemptsOf } from "./attempts";
import { completeCardPayment } from "./complete";
import { iyzicoEnv, paytrEnv } from "./config";
import { retrieveIyzicoCheckout } from "./iyzico-gateway";
import { paytrChargedAmount, paytrTestResultForLiveAttempt } from "./paytr-crypto";
import { queryPaytrStatus, STATUS_TIMEOUT_MS } from "./paytr-gateway";
import { applyPaytrResult } from "./paytr-result";
import { paytrAttemptState, type PaytrAttemptState } from "./paytr-window";

/**
 * paid: the order is (now) paid. failed: iyzico declined the latest attempt (recorded). pending: an iyzico
 * attempt is still in 3-D Secure (or its form was opened and abandoned). unpaid: no attempt was charged.
 * unknown: the provider could not be reached (or gave no clear answer) for at least one attempt, so the payment
 * may have gone through. none: no open attempt to ask about. not_pending: the order left pending_payment some
 * other way.
 */
export type ReconcileState = "paid" | "failed" | "pending" | "unpaid" | "unknown" | "none" | "not_pending";

/** The PayTR side of a reconcile (present when the order has PayTR attempts). */
export type PaytrReconcile = {
  /** Where the order's PayTR attempts stood before asking (paytr-window.ts): `verifying` drives the order pages. */
  attempts: PaytrAttemptState;
  /** Unsettled attempts answered "no successful payment" (err 004), or a test payment for a live attempt. */
  notPaid: number;
  /** Unsettled attempts without a clear answer (or not asked: no time left, too many attempts), or a "paid" answer whose amount does not match (R1). */
  unknown: number;
};

export type ReconcileResult = { state: ReconcileState; checked: number; paytr?: PaytrReconcile };

/** Newest attempts asked about per provider and call (a retry loop must not turn into a request flood). */
export const RECONCILE_MAX_ATTEMPTS = 5;

const PAID = new Set(["paid", "processing", "shipped", "delivered"]);

/**
 * Bounds the provider inquiries of one call or one expiry run: no inquiry starts after `deadline` (ms epoch), each
 * waits at most min(`timeoutMs`, time left), and after `maxFailures` unanswered ones (timeout, network, HTTP error)
 * the rest are "unknown" without asking, so a provider outage never makes a request or the cron job run long.
 */
export type InquiryBudget = { deadline: number; timeoutMs: number; maxFailures: number; failures: number };
/** The PayTR Durum Sorgu budget (an InquiryBudget). */
export type PaytrInquiryBudget = InquiryBudget;

export function inquiryBudget(options: { budgetMs: number; timeoutMs: number; maxFailures: number }, now: number = Date.now()): InquiryBudget {
  return { deadline: now + options.budgetMs, timeoutMs: options.timeoutMs, maxFailures: options.maxFailures, failures: 0 };
}

export function paytrInquiryBudget(options: { budgetMs?: number; timeoutMs?: number; maxFailures?: number } = {}, now: number = Date.now()): PaytrInquiryBudget {
  return inquiryBudget({ budgetMs: options.budgetMs ?? 8_000, timeoutMs: options.timeoutMs ?? STATUS_TIMEOUT_MS, maxFailures: options.maxFailures ?? 1 }, now);
}

/** Time an inquiry may take under `budget` now, or null when it must not start (deadline passed, breaker open). */
function inquiryTimeout(budget: InquiryBudget): number | null {
  const remaining = budget.deadline - Date.now();
  if (remaining <= 0 || budget.failures >= budget.maxFailures) return null;
  return Math.min(budget.timeoutMs, remaining);
}

export type ReconcileOptions = {
  /** Mails and cache effects of a confirmed result (default true). */
  effects?: boolean;
  /** Record a declined latest iyzico attempt (default true). The expiry job passes false: it cancels anyway. */
  applyFailures?: boolean;
  /** Tests inject a fetch (both providers). */
  fetch?: typeof fetch;
  /** Read and write inside this transaction (DB tests roll it back). */
  executor?: DbExecutor;
  /** PayTR inquiry bounds shared across calls (the expiry job); a fresh 8 s / one-failure budget otherwise. */
  paytrBudget?: PaytrInquiryBudget;
  /**
   * PayTR-fix R4: iyzico retrieve bounds shared across calls (the expiry job: its run deadline, a shorter timeout and a
   * breaker); skipped retrieves count as unknown. Without it each retrieve may wait up to 20 s (iyzico-gateway.ts).
   */
  iyzicoBudget?: InquiryBudget;
  /** Clock for the PayTR window (ms epoch, default now). */
  now?: number;
};

/** Asks the providers about the order's unrecorded attempts (newest first) and applies confirmed results. Never throws. */
export async function reconcileCardOrder(orderId: number, options: ReconcileOptions = {}): Promise<ReconcileResult> {
  const exec = options.executor ?? db;
  try {
    const o = schema.orders;
    const p = schema.payments;
    const [order] = await exec
      .select({ id: o.id, orderNumber: o.orderNumber, status: o.status, paymentMethod: o.paymentMethod, grandTotal: o.grandTotal })
      .from(o)
      .where(eq(o.id, orderId))
      .limit(1);
    if (!order || order.paymentMethod !== "card") return { state: "none", checked: 0 };
    if (order.status !== "pending_payment") return { state: PAID.has(order.status) ? "paid" : "not_pending", checked: 0 };

    const all = await exec
      .select({ status: p.status, provider: p.provider, providerRef: p.providerRef, raw: p.raw, updatedAt: p.updatedAt })
      .from(p)
      .where(eq(p.orderId, orderId))
      .orderBy(desc(p.id));
    const paytrState = paytrAttemptState(all, options.now ?? Date.now());
    const paytr: PaytrReconcile | undefined = paytrState.attempts.length > 0 ? { attempts: paytrState, notPaid: 0, unknown: 0 } : undefined;

    // ---- iyzico
    const rows = all.filter((r) => r.provider === "iyzico");
    // Tokens whose result is recorded already: a failure row (FAIL-<token>) or a row holding the answer.
    const settled = new Set<string>();
    for (const r of rows) {
      if (r.providerRef?.startsWith("FAIL-")) settled.add(r.providerRef.slice("FAIL-".length));
      const token = (r.raw as { token?: unknown } | null)?.token;
      if (r.status !== "initiated" && typeof token === "string") settled.add(token);
    }
    const attempts = rows.flatMap((r) => attemptsOf(r.raw));
    const latest = attempts.reduce((n, a) => Math.max(n, a.n), 0);
    const candidates = attempts
      .filter((a) => !settled.has(a.ref))
      .sort((a, b) => b.n - a.n)
      .slice(0, RECONCILE_MAX_ATTEMPTS);
    const paytrCandidates = paytrState.unsettled.slice(0, RECONCILE_MAX_ATTEMPTS);
    if (candidates.length === 0 && paytrCandidates.length === 0) return { state: "none", checked: 0, paytr };

    let checked = 0;
    let unknown = 0;
    let declined = false;
    let pending = 0;
    for (const attempt of candidates) {
      const env = iyzicoEnv(attempt.testMode);
      if (!env) continue; // keys of that environment are gone: nothing we can ask
      checked++;
      const timeoutMs = options.iyzicoBudget ? inquiryTimeout(options.iyzicoBudget) : undefined;
      if (timeoutMs === null) {
        // No time left in this run (or iyzico stopped answering): not known to be unpaid.
        unknown++;
        continue;
      }
      const verified = await retrieveIyzicoCheckout(
        { ...env, testMode: attempt.testMode, installments: false, maxInstallments: 1, fetch: options.fetch, timeoutMs },
        { token: attempt.ref, orderNumber: order.orderNumber, conversationId: attempt.conversationId ?? null },
      );
      if (!verified.ok) {
        // Error answers mean "not charged"; pending is 3-D Secure in progress (or an abandoned form); no answer means unknown.
        if (verified.reason === "unreachable" && options.iyzicoBudget) options.iyzicoBudget.failures++;
        if (verified.reason === "unreachable") unknown++;
        else if (verified.reason === "pending") pending++;
        continue;
      }
      // A decline of an older attempt changes nothing; only the latest one is worth recording.
      if (!verified.success && (options.applyFailures === false || attempt.n !== latest)) continue;
      const completion = await completeCardPayment(
        { orderId, providerRef: verified.providerRef, success: verified.success, amount: verified.amount, raw: verified.raw, provider: "iyzico", attemptRef: attempt.ref },
        { effects: options.effects, executor: options.executor },
      );
      if (completion.ok && completion.status === "paid") return { state: "paid", checked, paytr };
      if (completion.ok && completion.status === "failed") declined = true;
      if (!completion.ok && (completion.code === "not_pending" || completion.code === "order_cancelled")) return { state: "not_pending", checked, paytr };
    }

    // ---- PayTR (Durum Sorgu)
    const env = paytrCandidates.length > 0 ? paytrEnv() : null;
    if (paytr && env) {
      // Unsettled attempts beyond the ones asked are not known to be unpaid.
      paytr.unknown += paytrState.unsettled.length - paytrCandidates.length;
      const budget = options.paytrBudget ?? paytrInquiryBudget();
      for (const attempt of paytrCandidates) {
        checked++;
        const timeoutMs = inquiryTimeout(budget);
        if (timeoutMs === null) {
          paytr.unknown++;
          continue;
        }
        const answer = await queryPaytrStatus({ ...env, fetch: options.fetch }, attempt.ref, { timeoutMs });
        if (answer.kind === "unknown") {
          if (answer.reason === "unreachable") budget.failures++;
          else console.warn(`[payments] paytr status unclear order=${orderId} reason=${answer.reason}`);
          paytr.unknown++;
          continue;
        }
        if (answer.kind === "not_paid") {
          paytr.notPaid++;
          continue;
        }
        if (paytrTestResultForLiveAttempt(attempt.testMode, answer.testMode)) {
          // A PayTR test payment for an attempt we sent live moved no money: never mark the order paid.
          console.warn(`[payments] paytr status: test payment for a live attempt not applied order=${orderId}`);
          paytr.notPaid++;
          continue;
        }
        // PayTR-fix R1: what we asked PayTR for (the attempt's payment_amount; the order total for an attempt stored
        // without it). An answer that does not give exactly the order total under the notification's rule
        // (paytrChargedAmount: the requested amount when the buyer paid at least that much) is not applied and records
        // nothing: it may be a misread amount ("1.500"), and only the hash-verified notification settles a short payment.
        const requested = typeof attempt.paymentAmount === "number" ? attempt.paymentAmount : order.grandTotal;
        if (paytrChargedAmount(answer.totalAmount, requested) !== order.grandTotal) {
          console.warn(`[payments] paytr status: amount not applied order=${orderId} requested=${requested} total=${order.grandTotal} reported=${answer.totalAmount}: left for the notification`);
          paytr.unknown++;
          continue;
        }
        const completion = await applyPaytrResult(
          { orderId, merchantOid: attempt.ref, success: true, totalAmount: answer.totalAmount, raw: answer.raw, attempt: { testMode: attempt.testMode, paymentAmount: requested } },
          { effects: options.effects, executor: options.executor },
        );
        if (completion.ok && completion.status === "paid") return { state: "paid", checked, paytr };
        if (!completion.ok && (completion.code === "not_pending" || completion.code === "order_cancelled")) return { state: "not_pending", checked, paytr };
        // Anything else (the order total changed meanwhile, a result recorded meanwhile): not known to be unpaid.
        paytr.unknown++;
      }
    }

    if (unknown > 0 || (paytr?.unknown ?? 0) > 0) return { state: "unknown", checked, paytr };
    return { state: declined ? "failed" : pending > 0 ? "pending" : "unpaid", checked, paytr };
  } catch (error) {
    console.error(`[payments] reconcile failed order=${orderId}`, safeErrorInfo(error));
    return { state: "unknown", checked: 0 };
  }
}

export type CardRetryCheck = { ok: true } | { ok: false; code: "paid" | "not_pending" | "verifying" | "checking" };

/**
 * Before the buyer's retry opens a new provider session: earlier attempts are asked about first (a charge that
 * never reached us pays the order instead of charging the card twice). Then a retry is refused while the
 * latest PayTR attempt is inside its window without a result ("verifying": PayTR may still accept that payment,
 * see paytr-window.ts) and while a provider cannot be reached ("checking").
 */
export async function checkBeforeCardRetry(orderId: number, options: ReconcileOptions = {}): Promise<CardRetryCheck> {
  const earlier = await reconcileCardOrder(orderId, options);
  if (earlier.state === "paid") return { ok: false, code: "paid" };
  if (earlier.state === "not_pending") return { ok: false, code: "not_pending" };
  if (earlier.paytr?.attempts.verifying) return { ok: false, code: "verifying" };
  if (earlier.state === "unknown") return { ok: false, code: "checking" };
  return { ok: true };
}
