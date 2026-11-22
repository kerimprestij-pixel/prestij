// Pure helpers for the storefront blog (dates, reading time, links inside the article body).
import { intlLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/get-messages";
export { localizeBodyLinks } from "@/components/sections/localize-links";

const dateFormats = new Map<Locale, Intl.DateTimeFormat>();

/** "9 Kasım 2026" / "November 9, 2026" / "٩ نوفمبر ٢٠٢٦" with Latin digits, in Istanbul time. */
export function formatPostDate(iso: string, locale: Locale): string {
  let f = dateFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
    dateFormats.set(locale, f);
  }
  return f.format(new Date(iso));
}

/** "4 dk okuma" (null when the post has no body). */
export function readingLabel(minutes: number | null, locale: Locale, messages: Messages): string | null {
  return minutes ? format(messages.blog.readingTime, { minutes }, locale) : null;
}
