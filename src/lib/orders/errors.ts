// Localizes placeOrder failures for the checkout form (pure).
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { formatPrice } from "@/lib/pricing/money";
import type { PlaceOrderFailure } from "./place";

export type LocalizedCheckoutErrors = {
  /** Message for the whole form (aria-live), from checkout.errors.<code>. */
  formError: string;
  /** Field path → localized message, from checkout.errors.<fieldCode>. */
  fieldErrors: Record<string, string>;
};

export function localizeCheckoutFailure(result: PlaceOrderFailure, messages: Messages, locale: Locale): LocalizedCheckoutErrors {
  const e = messages.checkout.errors;
  const fieldErrors: Record<string, string> = {};
  for (const [path, code] of Object.entries(result.fieldErrors)) fieldErrors[path] = e[code] ?? e.invalid;
  const formError =
    result.code === "method_unavailable" && result.reason
      ? format(messages.checkout.paymentUnavailable[result.reason], { amount: formatPrice(result.limit ?? 0, locale) }, locale)
      : (e[result.code] ?? e.generic);
  return { formError, fieldErrors };
}
