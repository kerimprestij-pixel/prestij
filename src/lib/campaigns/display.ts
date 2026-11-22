// Storefront wording for a campaign badge. Pure (server or client).
import type { LocalizedText } from "@/db/schema/common";
import { intlLocale, type Locale } from "@/i18n/config";

const percentFormats = new Map<Locale, Intl.NumberFormat>();

/** "−%15" (tr), "−15%" (en), "‎−15%" (ar, Latin digits): the discount as a signed, localized percent. */
export function formatPercentOff(percent: number, locale: Locale): string {
  let f = percentFormats.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(intlLocale(locale), { style: "percent", maximumFractionDigits: 0 });
    percentFormats.set(locale, f);
  }
  // A real minus sign reads better than the hyphen ICU emits.
  return f.format(-Math.abs(percent) / 100).replace("-", "−");
}

/**
 * The badge text: the campaign's label in this locale when the panel filled it in, otherwise the
 * percent. (No fallback to the Turkish label on /en or /ar: the percent is universal.)
 */
export function campaignBadgeText(campaign: { percent: number; label: LocalizedText | null }, locale: Locale): string {
  const own = campaign.label?.[locale]?.trim();
  return own || formatPercentOff(campaign.percent, locale);
}
