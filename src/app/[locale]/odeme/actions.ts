"use server";
// Checkout Server Actions. Thin wrappers: every rule (validation, prices, stock, payment method
// availability) lives in the core placeOrder / legal-preview code and runs again on the server.

import { redirect } from "next/navigation";
import type { CheckoutState } from "@/components/checkout/types";
import { isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { saveAddressFromPlacedOrder } from "@/lib/account/checkout";
import { SAVE_ADDRESS_FIELD } from "@/lib/account/checkout-types";
import { readCartId } from "@/lib/cart/cookie";
import { getCartView } from "@/lib/cart/queries";
import { getCustomerContext } from "@/lib/customer/context";
import { safeErrorInfo } from "@/lib/db-errors";
import { previewLegalTexts } from "@/lib/orders/actions";
import { checkoutFormDataToInput } from "@/lib/orders/checkout-schema";
import { localizeCheckoutFailure } from "@/lib/orders/errors";
import type { LegalPreview } from "@/lib/orders/legal-preview";
import { placeOrder } from "@/lib/orders/place";
import { subscribeNewsletterSafely } from "@/lib/newsletter/service";
import type { LimitEntry, RateRule } from "@/lib/rate-limit";
import { checkLimits, consumeLimits } from "@/lib/rate-limit-store";
import { clientIp } from "@/lib/request-ip";
import { getSession } from "@/lib/session";
import { normalizeTrPhone } from "@/lib/validation/tr";

const MAX_VALUE_LENGTH = 600;

const localeOf = (value: unknown): Locale => (isLocale(value) ? value : "tr");

/**
 * Individual invoice with its own billing address: the invoice is made out to the name on that
 * address (placeOrder would otherwise fall back to the delivery name).
 */
function withInvoiceName(input: Record<string, unknown>): Record<string, unknown> {
  const invoice = input.invoice;
  if (!invoice || typeof invoice !== "object") return input;
  const inv = invoice as Record<string, unknown>;
  const address = inv.address && typeof inv.address === "object" ? (inv.address as Record<string, unknown>) : null;
  if (inv.type === "individual" && inv.sameAsShipping === false && !inv.fullName && typeof address?.fullName === "string") {
    inv.fullName = address.fullName;
  }
  return input;
}

/** The submitted text fields, so a no-JS re-render can refill the form. */
function submittedValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string" || key.startsWith("$") || key.length > 64) continue;
    values[key] = value.slice(0, MAX_VALUE_LENGTH);
  }
  return values;
}

/**
 * Orders an anonymous visitor may place per hour (counted on success; durable and shared by all
 * instances, see @/lib/rate-limit-store). Kapıda ödeme orders take stock immediately, so a script must not be able to
 * empty the shelves or fill the "to prepare" queue with invented orders.
 */
const ORDER_RULES = {
  ip: { limit: 10, windowMs: 60 * 60_000 },
  contact: { limit: 5, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateRule>;

function orderLimitKeys(ip: string, input: Record<string, unknown>): LimitEntry[] {
  const contact = input.contact && typeof input.contact === "object" ? (input.contact as Record<string, unknown>) : {};
  const email = typeof contact.email === "string" ? contact.email.trim().toLowerCase().slice(0, 254) : "";
  const phone = typeof contact.phone === "string" ? normalizeTrPhone(contact.phone) : null;
  const keys: LimitEntry[] = [[`order:ip:${ip}`, ORDER_RULES.ip]];
  if (email) keys.push([`order:email:${email}`, ORDER_RULES.contact]);
  if (phone) keys.push([`order:phone:${phone}`, ORDER_RULES.contact]);
  return keys;
}

/** The checkout form's action (useActionState). Redirects on success; returns localized errors otherwise. */
export async function placeOrderAction(prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const input = withInvoiceName(checkoutFormDataToInput(formData));
  const locale = localeOf(input.locale);
  const [cartId, customer, messages, ip] = await Promise.all([readCartId(), getCustomerContext(), getMessages(locale), clientIp()]);
  // ACCOUNTS: a signed-in customer always orders with the account's e-mail (the field is read-only;
  // a posted value is ignored), and the order gets their userId (placeOrder: customer.userId).
  const accountEmail = customer.userId ? ((await getSession())?.user?.email ?? null) : null;
  if (accountEmail) input.contact = { ...(input.contact && typeof input.contact === "object" ? input.contact : {}), email: accountEmail };
  const limitKeys = orderLimitKeys(ip, input);
  const wait = (await checkLimits(limitKeys)).retryAfterMinutes;
  if (wait > 0) {
    return {
      status: "error",
      attempt: (prev?.attempt ?? 0) + 1,
      code: "rate_limited",
      formError: format(messages.checkout.errors.rate_limited, { minutes: wait }, locale),
      fieldErrors: {},
      values: submittedValues(formData),
    };
  }
  const result = await placeOrder(input, { cartId, customer, messages, clientIp: ip });
  if (result.ok) {
    if (!result.existing) await consumeLimits(limitKeys);
    // ACCOUNTS: "Bu adresi kaydet" (signed in, new address): store the order's delivery address.
    if (!result.existing && customer.userId && formData.get(SAVE_ADDRESS_FIELD) === "on") await saveAddressFromPlacedOrder(result.orderId, customer.userId);
    // Optional newsletter opt-in box (NOTIFY): starts the double opt-in for the order's e-mail.
    if (!result.existing && formData.get("marketing.newsletter") === "on") {
      const contact = input.contact && typeof input.contact === "object" ? (input.contact as Record<string, unknown>) : {};
      if (typeof contact.email === "string") await subscribeNewsletterSafely({ email: contact.email, locale, source: "checkout", ip });
    }
    redirect(result.redirectTo); // throws: keep it outside any try/catch
  }

  const { formError, fieldErrors } = localizeCheckoutFailure(result, messages, locale);
  // Re-read the cart: the totals, stock, coupon or method availability may be what changed.
  let view: CheckoutState["view"];
  try {
    view = await getCartView(locale);
  } catch (error) {
    console.error("[checkout] cart refresh failed", safeErrorInfo(error));
  }
  return {
    status: "error",
    attempt: (prev?.attempt ?? 0) + 1,
    code: result.code,
    formError,
    fieldErrors,
    values: submittedValues(formData),
    view,
  };
}

/**
 * The pre-information form and the distance sales agreement rendered with the cart, the chosen
 * payment method and whatever the buyer has typed so far (for the consent modal).
 */
export async function previewLegalAction(locale: string, formData: FormData): Promise<LegalPreview | null> {
  const form = withInvoiceName(checkoutFormDataToInput(formData));
  const method = typeof form.paymentMethod === "string" && form.paymentMethod ? form.paymentMethod : null;
  return previewLegalTexts({ locale: localeOf(locale), paymentMethod: method, form });
}
