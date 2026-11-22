// Turns a ProductDetail into the localized, pre-formatted, serializable props used by the product
// page's client components. Pure (server or client). (Day 5: its JSON-LD moved to src/lib/seo/structured-data.ts,
// the gallery images with their alt fallbacks to productGalleryImages in ./product-heading.ts.)
import { intlLocale, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { campaignBadgeText } from "@/lib/campaigns/display";
import { campaignDisplayPrice } from "@/lib/campaigns/pick";
import type { ProductDetail } from "@/lib/data/catalog";
import { formatPrice } from "@/lib/pricing/money";
import { perLiter } from "@/lib/pricing/resolve";
import { formatVolume, stockStatus } from "./format";
import type { PickerOption, PickerVariant } from "./variant-types";

export function pickerData(product: ProductDetail, locale: Locale, messages: Messages) {
  const numberLocale = intlLocale(locale);
  const options: PickerOption[] = product.options.map((o) => ({
    id: o.id,
    name: localize(o.name, locale),
    display: o.display,
    values: o.values.map((v) => ({ id: v.id, label: localize(v.value, locale), swatchColor: v.swatchColor })),
  }));

  const percent = product.campaign?.percent;
  const campaignBadge = product.campaign ? campaignBadgeText(product.campaign, locale) : null;
  const variants: PickerVariant[] = product.variants.map((v) => {
    // What the cart charges a retail buyer for one unit (campaign applied with the cart's rounding).
    const shown = campaignDisplayPrice(v, percent);
    const liter = perLiter(shown.unitPrice, v.volumeMl);
    return {
      id: v.id,
      optionValueIds: v.optionValueIds,
      optionLabels: options
        .map((o) => o.values.find((val) => v.optionValueIds.includes(val.id))?.label)
        .filter((label): label is string => Boolean(label)),
      sku: v.sku,
      barcode: v.barcode,
      priceLabel: formatPrice(shown.unitPrice, locale),
      compareAtLabel: shown.compareAt != null ? formatPrice(shown.compareAt, locale) : null,
      compareAtSrLabel: shown.compareAt != null ? messages.campaign.regularPrice : null,
      campaignBadge,
      perLiterLabel: liter != null ? `${formatPrice(liter, locale)} ${messages.product.perLiter}` : null,
      volumeLabel: formatVolume(v.volumeMl, numberLocale),
      stock: stockStatus(v),
    };
  });

  return { options, variants };
}
