// A prize's display label (pure: unit-tested). The slice label in the reader's language wins (Turkish
// readers: the Turkish label); otherwise the label is built from the coupon: "%10 indirim", "₺50.00 off",
// "Ücretsiz kargo" through the dictionary's `wheel.prize` templates. The same rule as the dialog, the
// chip, the cart and the e-mails (src/lib/wheel/prize.ts prizeLabel): never Turkish text on /en or /ar.
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { LocalizedText } from "@/i18n/locales";
import { formatPrice } from "@/lib/pricing/money";

export type PrizeLabelTemplates = { percent: string; fixed: string; freeShipping: string };

export function wheelPrizeLabel(
  prize: { label?: LocalizedText | null; type: string; value: number },
  locale: Locale,
  templates: PrizeLabelTemplates,
): string {
  const own = prize.label ? (prize.label[locale] ?? "").trim() || (locale === "tr" ? (prize.label.tr ?? "").trim() : "") : "";
  if (own) return own;
  if (prize.type === "percent") return format(templates.percent, { value: prize.value }, locale);
  if (prize.type === "fixed") return format(templates.fixed, { amount: formatPrice(prize.value, locale) }, locale);
  return templates.freeShipping;
}
