// One verified PayTR result → completeCardPayment. Shared by the server-to-server notification
// (callbacks.ts) and the Durum Sorgu reconcile (reconcile.ts), so a payment found by the status inquiry has
// exactly the effects of its notification: the same amount check (the payment_amount we requested when the
// buyer paid at least that much), the same idempotency (providerRef = merchant_oid, one row per attempt), the
// same order change, events, subscriptions and e-mails (completeCardPayment), and a later notification or
// inquiry for the same merchant_oid only gets the recorded answer back.
import "server-only";
import type { DbExecutor } from "@/lib/cart/settings";
import type { StoredAttempt } from "./attempts";
import { completeCardPayment, type CompleteCardPaymentResult } from "./complete";
import { paytrChargedAmount } from "./paytr-crypto";

export type PaytrResult = {
  orderId: number;
  merchantOid: string;
  success: boolean;
  /** Kuruş the buyer paid (notification total_amount, Durum Sorgu payment_total). */
  totalAmount: number;
  /** payments.raw of the result (providerTestMode among them). */
  raw: Record<string, unknown>;
  /** Our stored attempt for merchant_oid (null when storing it failed). */
  attempt: Pick<StoredAttempt, "testMode" | "paymentAmount"> | null;
};

export function applyPaytrResult(result: PaytrResult, options: { effects?: boolean; executor?: DbExecutor } = {}): Promise<CompleteCardPaymentResult> {
  const requested = typeof result.attempt?.paymentAmount === "number" ? result.attempt.paymentAmount : null;
  return completeCardPayment(
    {
      orderId: result.orderId,
      providerRef: result.merchantOid,
      success: result.success,
      amount: result.success ? paytrChargedAmount(result.totalAmount, requested) : (requested ?? result.totalAmount),
      raw: { ...result.raw, testMode: result.attempt?.testMode ?? result.raw.providerTestMode === true, requestedAmount: requested },
      provider: "paytr",
      attemptRef: result.merchantOid,
    },
    options,
  );
}
