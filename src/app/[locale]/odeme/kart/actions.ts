"use server";
// The PayTR return page polls this until the notification has changed the order.
import { reconcileCardOrder } from "@/lib/payments/reconcile";
import { getCardReturnState } from "@/lib/payments/card-page";
import { consumeLimits } from "@/lib/rate-limit-store";

export type CardReturnPoll = {
  state: "paid" | "failed" | "waiting" | "closed" | "invalid";
  redirectTo?: string;
  /** waiting: the latest PayTR attempt is inside its window without a result ("Ödemeniz doğrulanıyor"). */
  verifying?: boolean;
};

/** PayTR is asked (Durum Sorgu) per order and hour at most this often; shared with the order page's check. */
const CHECK_RULE = { limit: 60, windowMs: 60 * 60 * 1000 };

/**
 * `r` is the signed return token from merchant_ok_url / merchant_fail_url (verified on every call). The first
 * polls only read the order (the notification usually arrives within seconds). With `inquire` (the slow phase,
 * a few times a minute) a waiting order is also checked with PayTR (reconcileCardOrder: a payment whose
 * notification is lost pays the order), within the same per-order limit as the order page's check.
 */
export async function checkCardReturnAction(r: string, inquire = false): Promise<CardReturnPoll> {
  if (typeof r !== "string" || r.length === 0 || r.length > 2048) return { state: "invalid" };
  let result = await getCardReturnState(r);
  if (result.state === "waiting" && inquire === true) {
    const allowed = await consumeLimits([[`paycheck:order:${result.orderId}`, CHECK_RULE]]);
    if (allowed.allowed) {
      await reconcileCardOrder(result.orderId);
      result = await getCardReturnState(r);
    }
  }
  if (result.state === "invalid") return { state: "invalid" };
  return { state: result.state, redirectTo: result.redirectTo, ...(result.state === "waiting" ? { verifying: result.verifying === true } : {}) };
}
