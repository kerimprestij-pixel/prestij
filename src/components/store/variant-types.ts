// Serializable, pre-localized, pre-formatted variant data handed to the product page's client
// components (VariantPicker, PackagingExplainer, AddToCartButton).
import type { StockStatus } from "./format";

export type PickerOption = {
  id: number;
  name: string;
  display: "buttons" | "swatches" | "select";
  values: { id: number; label: string; swatchColor: string | null }[];
};

export type PickerVariant = {
  id: number;
  optionValueIds: number[];
  /** Option value labels in option order, e.g. ["5 L"]. */
  optionLabels: string[];
  sku: string;
  barcode: string | null;
  priceLabel: string;
  compareAtLabel: string | null;
  /** Screen-reader words before the struck-through price ("Normal fiyat"), with compareAtLabel. */
  compareAtSrLabel: string | null;
  /** Retail campaign badge text (the same on every variant), null without a campaign. */
  campaignBadge: string | null;
  /** e.g. "179,98 ₺ litre başına" */
  perLiterLabel: string | null;
  volumeLabel: string | null;
  stock: StockStatus;
};

/** The variant matching every chosen value, else the first one containing `preferValueId`. */
export function findVariant(
  variants: PickerVariant[],
  valueIds: number[],
  preferValueId?: number,
): PickerVariant | undefined {
  const exact = variants.find((v) => valueIds.every((id) => v.optionValueIds.includes(id)));
  if (exact) return exact;
  return preferValueId != null ? variants.find((v) => v.optionValueIds.includes(preferValueId)) : undefined;
}
