// Local fake 3-D Secure gateway. Enabled ONLY when process.env.PAYMENT_SIMULATOR === "true" (set in
// .env.local, never in production). Every entry point fails closed when the flag is off.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { normalizeOrderNumber } from "@/lib/orders/number";
import { orderPageHref, tokensMatch } from "@/lib/orders/token";
import { completeCardPayment } from "./complete";
import { isSimulatorEnabled, simulatorGateway } from "./simulator-gateway";

export { isSimulatorEnabled, simulatorGateway };

export type SimulatorSession =
  | {
      ok: true;
      orderId: number;
      orderNumber: string;
      /** Amount to show on the fake bank page (kuruş). */
      amount: number;
      locale: Locale;
      status: string;
      /** Link back to the order page (no payment). */
      orderHref: string;
    }
  | { ok: false; code: "disabled" | "not_found" | "not_pending" };

async function findOrder(orderNumber: unknown, token: unknown) {
  const number = normalizeOrderNumber(orderNumber);
  if (!number) return null;
  const o = schema.orders;
  const [row] = await db
    .select({
      id: o.id,
      orderNumber: o.orderNumber,
      accessToken: o.accessToken,
      status: o.status,
      paymentMethod: o.paymentMethod,
      grandTotal: o.grandTotal,
      locale: o.locale,
    })
    .from(o)
    .where(eq(o.orderNumber, number))
    .limit(1);
  return row && tokensMatch(token, row.accessToken) ? row : null;
}

/** Data for the simulator page (`/odeme/simulator?order=…&t=…`). */
export async function getSimulatorSession(input: { orderNumber: unknown; token: unknown }): Promise<SimulatorSession> {
  if (!isSimulatorEnabled()) return { ok: false, code: "disabled" };
  const order = await findOrder(input.orderNumber, input.token);
  if (!order || order.paymentMethod !== "card") return { ok: false, code: "not_found" };
  const locale = isLocale(order.locale) ? order.locale : "tr";
  if (order.status !== "pending_payment") return { ok: false, code: "not_pending" };
  return {
    ok: true,
    orderId: order.id,
    orderNumber: order.orderNumber,
    amount: order.grandTotal,
    locale,
    status: order.status,
    orderHref: orderPageHref(locale, order.orderNumber, order.accessToken),
  };
}

export type SimulateResult =
  | { ok: true; status: "paid" | "failed"; redirectTo: string }
  | { ok: false; code: "disabled" | "not_found" | "not_pending" | "amount_mismatch" | "order_cancelled" | "not_configured"; redirectTo: string | null };

/**
 * The simulator page's success/failure buttons call this (from a Server Action), then redirect to
 * `redirectTo` (the order page; `new=1` after success, `payment=failed` after a failure).
 */
export async function simulateCardPayment(
  input: { orderNumber: unknown; token: unknown; outcome: "success" | "failure"; locale?: Locale },
  options: { effects?: boolean } = {},
): Promise<SimulateResult> {
  if (!isSimulatorEnabled()) return { ok: false, code: "disabled", redirectTo: null };
  const order = await findOrder(input.orderNumber, input.token);
  if (!order || order.paymentMethod !== "card") return { ok: false, code: "not_found", redirectTo: null };
  const locale = input.locale && isLocale(input.locale) ? input.locale : isLocale(order.locale) ? order.locale : "tr";
  const back = (flags: { new?: boolean; paymentFailed?: boolean } = {}) => orderPageHref(locale, order.orderNumber, order.accessToken, flags);
  if (order.status !== "pending_payment") return { ok: false, code: "not_pending", redirectTo: back() };

  const callback = await simulatorGateway.handleCallback({ orderId: order.id, outcome: input.outcome, amount: order.grandTotal });
  if (!callback) return { ok: false, code: "disabled", redirectTo: null };
  const result = await completeCardPayment({ ...callback, provider: "simulator" }, options);
  if (!result.ok) return { ok: false, code: result.code === "invalid_input" || result.code === "not_card" ? "not_found" : result.code, redirectTo: back() };
  return result.status === "paid"
    ? { ok: true, status: "paid", redirectTo: back({ new: true }) }
    : { ok: true, status: "failed", redirectTo: back({ paymentFailed: true }) };
}
