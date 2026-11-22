// Locale-aware SEO texts for storefront metadata. Pure (unit-tested).
//
// localize() falls back to Turkish, so `localize(seo.title, "en") || name` returned a Turkish SEO title
// on /en and /ar even when the page had an English or Arabic name. Here the visitor's own SEO text
// comes first, then the localized page texts, and the Turkish SEO text only as the last resort.
import type { Locale, LocalizedText } from "@/db/schema/common";

const own = (text: LocalizedText | null | undefined, locale: Locale): string => (text?.[locale] ?? "").trim();

/**
 * `seo[locale]`, else the first non-empty fallback (pass already-localized strings, e.g.
 * `localize(product.name, locale)`), else `seo.tr`, else "".
 */
export function seoText(seo: LocalizedText | null | undefined, locale: Locale, ...fallbacks: (string | null | undefined)[]): string {
  const mine = own(seo, locale);
  if (mine) return mine;
  for (const fallback of fallbacks) {
    const text = fallback?.trim();
    if (text) return text;
  }
  return (seo?.tr ?? "").trim();
}

/** Only the visitor's own language (no Turkish fallback): for text shown on the page itself. */
export function ownLocaleText(text: LocalizedText | null | undefined, locale: Locale): string {
  return own(text, locale);
}
