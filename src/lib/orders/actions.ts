"use server";
// Storefront order Server Actions that need the cart cookie or an order token. (placeOrderAction lives
// with the checkout UI and wraps placeOrder; see docs/DAY2-CORE-API.md.)

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { LOCALES } from "@/db/schema/common";
import { getMessages } from "@/i18n/get-messages";
import { readCartId } from "@/lib/cart/cookie";
import { PAYMENT_METHODS } from "@/lib/cart/types";
import { getCustomerContext } from "@/lib/customer/context";
import { initiateCardPayment } from "@/lib/payments/complete";
import { cardTestModeHidden, loadPaymentSettings } from "@/lib/payments/gateway";
import { checkBeforeCardRetry } from "@/lib/payments/reconcile";
import { clientIp } from "@/lib/request-ip";
import { renderCheckoutLegalPreview, type LegalPreview } from "./legal-preview";
import { normalizeOrderNumber } from "./number";
import { orderPageHref, tokensMatch } from "./token";

const previewSchema = z.object({
  locale: z.enum(LOCALES),
  paymentMethod: z.enum(PAYMENT_METHODS).nullish(),
  /** The checkout form state as a nested object (checkoutFormDataToInput output works); only strings are read. */
  form: z.unknown().optional(),
});

/**
 * Renders the pre-information form and the distance sales agreement for the checkout preview modal
 * with the buyer's current (possibly partial) form data. Returns null for invalid input.
 */
export async function previewLegalTexts(input: { locale: string; paymentMethod?: string | null; form?: unknown }): Promise<LegalPreview | null> {
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return null;
  const { locale, paymentMethod, form } = parsed.data;
  const [cartId, customer, messages] = await Promise.all([readCartId(), getCustomerContext(), getMessages(locale)]);
  return renderCheckoutLegalPreview({ locale, form, paymentMethod: paymentMethod ?? null }, { cartId, customer, messages });
}

const retrySchema = z.object({ orderNumber: z.string().max(32), token: z.string().max(64) });

export type RetryCardPaymentResult =
  | { ok: true; redirectTo: string }
  | { ok: false; code: "not_found" | "not_pending" | "not_configured" | "gateway_error" | "checking" | "verifying" };

/**
 * "Retry payment" on the order page (card orders in pending_payment). Verifies the order token. Before a
 * new provider session is opened, earlier attempts are asked about (checkBeforeCardRetry: iyzico retrieve,
 * PayTR Durum Sorgu): a charge that never reached us completes the order instead of charging the card twice.
 * While the latest PayTR attempt is inside its window without a result the retry is refused ("verifying",
 * PayTR may still accept that payment), and while a provider cannot be reached too ("checking").
 */
export async function retryCardPayment(input: { orderNumber: string; token: string }): Promise<RetryCardPaymentResult> {
  const parsed = retrySchema.safeParse(input);
  const number = parsed.success ? normalizeOrderNumber(parsed.data.orderNumber) : null;
  if (!parsed.success || !number) return { ok: false, code: "not_found" };
  const o = schema.orders;
  const [row] = await db.select({ id: o.id, orderNumber: o.orderNumber, accessToken: o.accessToken, locale: o.locale }).from(o).where(eq(o.orderNumber, number)).limit(1);
  if (!row || !tokensMatch(parsed.data.token, row.accessToken)) return { ok: false, code: "not_found" };
  const earlier = await checkBeforeCardRetry(row.id);
  if (!earlier.ok) {
    if (earlier.code !== "paid") return { ok: false, code: earlier.code };
    const locale = (LOCALES as readonly string[]).includes(row.locale) ? (row.locale as (typeof LOCALES)[number]) : "tr";
    return { ok: true, redirectTo: orderPageHref(locale, row.orderNumber, row.accessToken, { new: true }) };
  }
  // Go-live CF-11: while the test mode is on on a live site, only staff may start a (test) card payment.
  const [payments, customer] = await Promise.all([loadPaymentSettings(), getCustomerContext()]);
  if (cardTestModeHidden(payments, customer)) return { ok: false, code: "not_configured" };
  const result = await initiateCardPayment(row.id, { clientIp: await clientIp(), payments, notWhileVerifying: true });
  if (result.ok) return { ok: true, redirectTo: result.redirectUrl };
  return { ok: false, code: result.code === "not_card" ? "not_found" : result.code };
}
