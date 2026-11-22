"use server";
// Server Actions of the order pages: the lookup form (/siparis) and "retry payment" on the order page.
// Both pass the locale explicitly (root params are not available in actions).

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { localizePath } from "@/i18n/paths";
import { retryCardPayment } from "@/lib/orders/actions";
import { normalizeOrderNumber } from "@/lib/orders/number";
import { lookupOrder } from "@/lib/orders/read";
import { orderPageHref, tokensMatch } from "@/lib/orders/token";
import { reconcileCardOrder } from "@/lib/payments/reconcile";
import { consumeLimits } from "@/lib/rate-limit-store";
import { clientIp } from "@/lib/request-ip";
import { lookupBlockedFor, recordLookupFailure } from "./_lib/throttle";

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const localeOf = (formData: FormData): Locale => {
  const value = field(formData, "locale");
  return isLocale(value) ? value : "tr";
};

// ---------------------------------------------------------------------------------------------
// Order lookup

export type LookupState = {
  status: "idle" | "error";
  /** One generic message (no hint whether the number or the e-mail was wrong), or the throttle message. */
  message?: string;
  /** Format errors only (never about existence). */
  fieldErrors?: { orderNumber?: string; email?: string };
  values?: { orderNumber: string; email: string };
};

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** A short random pause on failures, so failed guesses are slow and their timing tells nothing. */
const failureDelay = () => new Promise((resolve) => setTimeout(resolve, 350 + Math.floor(Math.random() * 300)));

/**
 * Lookup form (fields: locale, orderNumber, email; `website` is a honeypot). On a match it redirects
 * to the order's token link; otherwise it answers with one generic message. Failed attempts are
 * throttled per trusted client IP and per (order number, IP) (see ./_lib/throttle.ts).
 */
export async function lookupOrderAction(_prev: LookupState, formData: FormData): Promise<LookupState> {
  const locale = localeOf(formData);
  const messages = await getMessages(locale);
  const m = messages.order.lookup;
  const values = { orderNumber: field(formData, "orderNumber").slice(0, 40), email: field(formData, "email").slice(0, 254) };

  const orderNumber = normalizeOrderNumber(values.orderNumber);
  const email = emailSchema.safeParse(values.email);
  if (!orderNumber || !email.success) {
    return {
      status: "error",
      fieldErrors: {
        ...(orderNumber ? {} : { orderNumber: m.invalidOrderNumber }),
        ...(email.success ? {} : { email: m.invalidEmail }),
      },
      values,
    };
  }

  const key = { ip: await clientIp(), orderNumber };
  const waitMinutes = await lookupBlockedFor(key);
  if (waitMinutes > 0) return { status: "error", message: format(m.throttled, { minutes: waitMinutes }, locale), values };

  // Bots fill every field; people never see this one. Treated exactly like a miss.
  const isBot = field(formData, "website").trim() !== "";
  const found = isBot ? null : await lookupOrder(orderNumber, email.data);
  if (!found) {
    await recordLookupFailure(key);
    await failureDelay();
    return { status: "error", message: m.notFound, values };
  }
  redirect(orderPageHref(locale, found.orderNumber, found.accessToken));
}

// ---------------------------------------------------------------------------------------------
// Retry card payment

export type RetryPaymentState = { error?: string; code?: "not_found" | "not_pending" | "not_configured" | "gateway_error" | "checking" | "verifying" };

/**
 * "Complete payment" on the order page (card orders in pending_payment). The core action checks the
 * order token and starts a new payment; the buyer is then sent to the payment page in the language
 * they are viewing.
 */
export async function retryPaymentAction(_prev: RetryPaymentState, formData: FormData): Promise<RetryPaymentState> {
  const locale = localeOf(formData);
  const result = await retryCardPayment({ orderNumber: field(formData, "orderNumber"), token: field(formData, "token") });
  if (result.ok) {
    refresh(); // the order page left in the router cache must not come back on Back
    redirect(localizePath(locale, result.redirectTo));
  }
  const messages = await getMessages(locale);
  return { error: messages.order.payment.retryErrors[result.code], code: result.code };
}

// ---------------------------------------------------------------------------------------------
// "We are confirming your card payment" (?payment=checking, or a PayTR attempt inside its window)

export type CardPaymentCheck = { state: "paid" | "failed" | "unpaid" | "waiting" | "closed" | "invalid"; redirectTo?: string };

/** Asks per order and hour at most this often (the page polls a few times a minute for ~2 minutes). */
const CHECK_RULE = { limit: 60, windowMs: 60 * 60 * 1000 };

/**
 * Polled by the order page after the iyzico callback could not confirm a result, and while the latest PayTR
 * attempt is inside its window without a result ("Ödemeniz doğrulanıyor"): verifies the order token, asks the
 * provider about the order's unrecorded attempts (reconcileCardOrder: iyzico retrieve, PayTR Durum Sorgu) and
 * tells the page where to go: the paid order, the "declined" banner, the plain retry panel, or keep waiting.
 * Inside the PayTR window "not paid yet" means keep waiting (the buyer may still be paying; a redirect would
 * only show the same waiting panel again).
 */
export async function checkCardPaymentAction(input: { locale: string; orderNumber: string; token: string }): Promise<CardPaymentCheck> {
  const locale: Locale = isLocale(input?.locale) ? input.locale : "tr";
  const number = normalizeOrderNumber(typeof input?.orderNumber === "string" ? input.orderNumber.slice(0, 40) : "");
  if (!number || typeof input?.token !== "string") return { state: "invalid" };
  const o = schema.orders;
  const [row] = await db.select({ id: o.id, orderNumber: o.orderNumber, accessToken: o.accessToken, status: o.status, paymentMethod: o.paymentMethod }).from(o).where(eq(o.orderNumber, number)).limit(1);
  if (!row || row.paymentMethod !== "card" || !tokensMatch(input.token, row.accessToken)) return { state: "invalid" };
  const page = (flags: { new?: boolean; paymentFailed?: boolean } = {}) => orderPageHref(locale, row.orderNumber, row.accessToken, flags);
  if (row.status !== "pending_payment") return { state: row.status === "paid" ? "paid" : "closed", redirectTo: page({ new: row.status === "paid" }) };
  const allowed = await consumeLimits([[`paycheck:order:${row.id}`, CHECK_RULE]]);
  if (!allowed.allowed) return { state: "waiting" };
  const result = await reconcileCardOrder(row.id);
  const paytr = result.paytr?.attempts;
  if (paytr && result.state !== "paid" && result.state !== "not_pending") {
    if (paytr.verifying) return { state: "waiting" };
    if (paytr.latestResult === "failed" && result.state !== "unknown") return { state: "failed", redirectTo: page({ paymentFailed: true }) };
  }
  switch (result.state) {
    case "paid":
      return { state: "paid", redirectTo: page({ new: true }) };
    case "failed":
      return { state: "failed", redirectTo: page({ paymentFailed: true }) };
    case "not_pending":
      return { state: "closed", redirectTo: page() };
    case "unknown":
    case "pending":
      return { state: "waiting" };
    default:
      return { state: "unpaid", redirectTo: page() };
  }
}
