// Money formatting. All amounts are integer kuruş (12990 = 129,90 ₺).
import { intlLocale, type Locale } from "@/i18n/config";

const formatters = new Map<Locale, Intl.NumberFormat>();

function formatterFor(locale: Locale): Intl.NumberFormat {
  let f = formatters.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency: "TRY",
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(locale, f);
  }
  return f;
}

/**
 * Formats kuruş as a localized TRY amount: tr "149,90 ₺", en "₺149.90", ar "149.90 ₺" (Latin digits).
 * Turkish convention puts the symbol after the amount, which ICU does not do by default.
 */
export function formatPrice(kurus: number, locale: Locale): string {
  const f = formatterFor(locale);
  const amount = kurus / 100;
  if (locale !== "tr") return f.format(amount);
  const parts = f.formatToParts(amount);
  const number = parts
    .filter((p) => p.type !== "currency" && p.type !== "literal")
    .map((p) => p.value)
    .join("");
  const symbol = parts.find((p) => p.type === "currency")?.value ?? "₺";
  return `${number} ${symbol}`;
}

/** "149,90 ₺" or "149,90 ₺ – 899,90 ₺" when the range is not a single price. */
export function formatPriceRange(min: number, max: number, locale: Locale): string {
  return min === max ? formatPrice(min, locale) : `${formatPrice(min, locale)} – ${formatPrice(max, locale)}`;
}

/** Plain decimal string for machine-readable output (JSON-LD, feeds): 14990 → "149.90". */
export function kurusToDecimal(kurus: number): string {
  return (kurus / 100).toFixed(2);
}
