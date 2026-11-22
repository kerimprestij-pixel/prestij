// Field error codes (src/lib/account/schemas.ts) → localized texts. Pure.
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { PASSWORD_MAX, PASSWORD_MIN } from "./schemas";

/** One auth/profile field code → its text (messages.auth.errors). */
export function authFieldMessage(code: string, messages: Messages, locale: Locale): string {
  const e = messages.auth.errors;
  switch (code) {
    case "required":
      return e.required;
    case "invalid_email":
      return e.invalidEmail;
    case "too_short":
      return e.nameTooShort;
    case "too_long":
      return e.tooLong;
    case "invalid":
      return e.invalidValue;
    case "invalid_phone":
      return e.invalidPhone;
    case "password_too_short":
      return format(e.passwordTooShort, { min: PASSWORD_MIN }, locale);
    case "password_too_long":
      return format(e.passwordTooLong, { max: PASSWORD_MAX }, locale);
    case "password_mismatch":
      return e.passwordMismatch;
    case "password_same":
      return e.passwordSame;
    case "terms_required":
      return e.termsRequired;
    case "confirm_required":
      return e.confirmRequired;
    default:
      return e.generic;
  }
}

/** Address / invoice field code → the checkout's text for it (same rules as the checkout form). */
export function addressFieldMessage(code: string, messages: Messages): string {
  const errors = messages.checkout.errors as Record<string, string>;
  return errors[code] ?? messages.auth.errors.generic;
}

/** { path: code } → { path: text }. Address paths ("address.*", "invoice.*") use the checkout texts. */
export function localizeFieldCodes(codes: Record<string, string>, messages: Messages, locale: Locale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, code] of Object.entries(codes)) {
    out[path] = path.startsWith("address.") || path.startsWith("invoice.") || path === "title" ? addressFieldMessage(code, messages) : authFieldMessage(code, messages, locale);
  }
  return out;
}
