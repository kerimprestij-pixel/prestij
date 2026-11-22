// Locale helpers for the panel's localized inputs. Pure and client-safe (no drizzle import).
import type { Locale, LocalizedText } from "@/db/schema/common";
import { LOCALE_CODES } from "@/i18n/paths";

export type { Locale, LocalizedText };

export const PANEL_LOCALES = LOCALE_CODES;

export const LOCALE_LABELS: Record<Locale, { short: string; name: string; lang: string; dir: "ltr" | "rtl" }> = {
  tr: { short: "TR", name: "Türkçe", lang: "tr", dir: "ltr" },
  en: { short: "EN", name: "İngilizce", lang: "en", dir: "ltr" },
  ar: { short: "AR", name: "Arapça", lang: "ar", dir: "rtl" },
};

/** Per-locale errors: a plain string applies to the whole field. */
export type LocalizedErrors = string | Partial<Record<Locale, string>> | null | undefined;

export function localeError(errors: LocalizedErrors, locale: Locale): string | undefined {
  if (!errors) return undefined;
  return typeof errors === "string" ? undefined : errors[locale];
}

export function generalError(errors: LocalizedErrors): string | undefined {
  return typeof errors === "string" ? errors : undefined;
}

/** True when the text has visible content (HTML tags and &nbsp; ignored). */
export function hasText(value: string | null | undefined, html = false): boolean {
  if (!value) return false;
  const text = html ? value.replace(/<[^>]*>/g, "").replace(/&nbsp;| /g, " ") : value;
  return text.trim().length > 0;
}

/** Sets one locale; empty en/ar keys are removed, tr is always kept. */
export function setLocale(value: LocalizedText | null | undefined, locale: Locale, text: string): LocalizedText {
  const next: LocalizedText = { ...(value ?? { tr: "" }), tr: value?.tr ?? "" };
  if (locale === "tr") next.tr = text;
  else if (text === "") delete next[locale];
  else next[locale] = text;
  return next;
}
