import { LOCALES, type Locale } from "@/i18n/locales";

export { type Locale };
export const locales = LOCALES;
export const defaultLocale: Locale = "tr";
export const rtlLocales: readonly Locale[] = ["ar"];

export const localeNames: Record<Locale, string> = {
  tr: "Türkçe",
  en: "English",
  ar: "العربية",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function localeDir(locale: Locale): "ltr" | "rtl" {
  return rtlLocales.includes(locale) ? "rtl" : "ltr";
}

/** BCP-47 tag for Intl formatting. Arabic keeps Latin digits for prices and phone numbers. */
export function intlLocale(locale: Locale): string {
  return locale === "tr" ? "tr-TR" : locale === "en" ? "en-US" : "ar-u-nu-latn";
}
