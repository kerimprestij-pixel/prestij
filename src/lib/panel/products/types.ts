// Product editor state shared by the panel page (server), the editor (client) and the service.
// Type-only imports + small pure helpers: safe for client components and unit tests.
//
// Rows that may be new carry a client `key` next to their `id` (null until saved). Existing rows use
// keys derived from their ids ("v12", "ov3"), so the state the server returns after a save and the
// state a fresh page load builds are identical. Variants point to option values, media rows to
// variants, prices to variants — always by key, so unsaved rows can be linked too.
import type { LocalizedText } from "@/db/schema/common";
import type { ProductMediaRole, ProductStatus, ProductType } from "@/db/schema/catalog";
import type { MediaLike } from "@/lib/media/types";
import type { PickerCategory, PickerProduct } from "@/lib/panel/pickers";

export type OptionDisplay = "buttons" | "swatches" | "select";

export type OptionValueState = {
  key: string;
  id: number | null;
  value: LocalizedText;
  /** "#RRGGBB" or "". */
  swatchColor: string;
  swatchMediaId: number | null;
};

export type OptionState = {
  key: string;
  id: number | null;
  name: LocalizedText;
  display: OptionDisplay;
  values: OptionValueState[];
};

export type VariantState = {
  key: string;
  id: number | null;
  sku: string;
  barcode: string;
  /** Kuruş. null only while the field is empty in the editor. */
  price: number | null;
  compareAtPrice: number | null;
  costPrice: number | null;
  vatRate: number;
  stock: number | null;
  /** The stock the editor loaded (null for new variants). The save is refused if it changed meanwhile. */
  stockSeen: number | null;
  trackStock: boolean;
  allowBackorder: boolean;
  lowStockThreshold: number | null;
  volumeMl: number | null;
  weightGrams: number | null;
  /** x10 like the column (125 = 12,5 desi). */
  desi: number | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  imageId: number | null;
  isDefault: boolean;
  isActive: boolean;
  /** One option value key per option axis. */
  optionValueKeys: string[];
};

export type ProductMediaState = {
  key: string;
  id: number | null;
  mediaId: number;
  /** Images: how the storefront uses it. Videos are always stored as "gallery" (no role choice). */
  role: ProductMediaRole;
  /** Variant key when the image belongs to one variant. */
  variantKey: string | null;
  /**
   * Day 6, videos only: play muted and looped on the product page ("Otomatik oynat (sessiz)"); false =
   * a play button. Always false for images (the save normalizes it). Optional so older literals stay valid.
   */
  autoplay?: boolean;
};

export type TierState = {
  key: string;
  /** null = the whole product (every variant). */
  variantKey: string | null;
  /** null = every customer (retail). */
  groupId: number | null;
  minQuantity: number | null;
  discountPercent: number | null;
};

export type GroupPriceState = {
  key: string;
  variantKey: string;
  groupId: number | null;
  price: number | null;
};

export type BundleItemState = { key: string; variantId: number | null; quantity: number | null };

export type SpecState = { label: LocalizedText; value: LocalizedText };

export type SeoState = {
  title: LocalizedText | null;
  description: LocalizedText | null;
  ogImageId: number | null;
  noIndex: boolean;
};

export type ProductEditorState = {
  id: number;
  /** ISO string of products.updated_at (optimistic lock). */
  updatedAt: string;
  slug: string;
  type: ProductType;
  status: ProductStatus;
  name: LocalizedText;
  subtitle: LocalizedText | null;
  shortDescription: LocalizedText | null;
  /** Rich text (HTML) per locale. */
  description: LocalizedText | null;
  categoryId: number | null;
  isFeatured: boolean;
  businessOnly: boolean;
  allowSubscription: boolean;
  /** "#RRGGBB" or "". */
  accentColor: string;
  /** Soft background in light / dark mode ("" = derived from the accent color). */
  tint: string;
  tintDark: string;
  scentTop: LocalizedText | null;
  scentHeart: LocalizedText | null;
  scentBase: LocalizedText | null;
  usage: LocalizedText | null;
  warnings: LocalizedText | null;
  ingredients: string;
  claims: string[];
  specs: SpecState[];
  seo: SeoState;
  options: OptionState[];
  variants: VariantState[];
  media: ProductMediaState[];
  tiers: TierState[];
  groupPrices: GroupPriceState[];
  bundleItems: BundleItemState[];
  relatedIds: number[];
};

/** A variant another product's bundle can contain (editor context for "Set içeriği"). */
export type BundleVariantChoice = {
  id: number;
  productId: number;
  productName: string;
  productStatus: ProductStatus;
  label: string;
  sku: string;
  isActive: boolean;
  thumb: MediaLike | null;
};

export type CustomerGroupOption = { id: number; name: string; isBusiness: boolean; discountPercent: number };

/** Read-only context the editor needs besides its state. */
export type ProductEditorContext = {
  /** Variant ids that orders, carts or bundles reference: removing them deactivates instead of deleting. */
  referencedVariantIds: number[];
  /** Some order contains this product (it can then only be archived, never deleted). */
  inOrders: boolean;
  /** Media objects for every id in the state (no request needed to show them). */
  media: MediaLike[];
  customerGroups: CustomerGroupOption[];
  categories: PickerCategory[];
  bundleChoices: BundleVariantChoice[];
  relatedItems: PickerProduct[];
  /** Bundles (other products) that contain one of this product's variants. */
  usedInBundles: { id: number; name: string }[];
  /** Storefront SEO title template (contains %s) and public site URL for the Google preview. */
  titleTemplate: string;
  siteUrl: string;
  /** Slug of the sample product "<slug>-numune" when one exists. */
  sampleSlug: string | null;
};

// -----------------------------------------------------------------------------------------------
// Labels and pure helpers

export const PRODUCT_TYPE_OPTIONS: { value: ProductType; label: string; help: string }[] = [
  { value: "standard", label: "Ürün", help: "Varyantları olan normal ürün (ör. 500 ml, 5 L, 20 L)." },
  { value: "bundle", label: "Set", help: "Başka ürünlerin varyantlarından oluşan hediye seti." },
  { value: "sample", label: "Numune", help: "Sepete ücretsiz eklenen deneme boyu." },
];

export const PRODUCT_STATUS_OPTIONS: { value: ProductStatus; label: string }[] = [
  { value: "draft", label: "Taslak" },
  { value: "active", label: "Yayında" },
  { value: "archived", label: "Arşivde" },
];

export const MEDIA_ROLE_OPTIONS: { value: ProductMediaRole; label: string; help: string }[] = [
  { value: "packshot", label: "Ürün çekimi", help: "Beyaz zeminde ambalaj; kartlarda ana görsel." },
  { value: "gallery", label: "Galeri", help: "Ürün sayfası galerisi." },
  { value: "lifestyle", label: "Yaşam tarzı", help: "Mekân içinde; kartta üzerine gelince görünür." },
  { value: "hero", label: "Kapak", help: "Geniş kapak görseli." },
];

// -----------------------------------------------------------------------------------------------
// Day 6: videos in the product gallery. The zod schema cannot see media kinds, so these rules run in the
// service (authoritative, with kinds from the database) and in the editor (instant feedback, with the
// media it has loaded), both through productMediaKindErrors.

/** Most videos one product's gallery may hold. */
export const MAX_PRODUCT_VIDEOS = 3;

export const PRODUCT_MEDIA_MESSAGES = {
  firstIsVideo: "İlk sırada bir görsel olmalı: kartlarda, paylaşımlarda ve sayfa açılışında ilk görsel kullanılır. Videoyu aşağı taşıyın.",
  tooManyVideos: `Bir ürüne en fazla ${MAX_PRODUCT_VIDEOS} video eklenebilir.`,
  videoWithoutPoster: "Bu videonun kapak görseli yok. Medya kütüphanesinde videoya bir kapak görseli ekleyin.",
  variantImageIsVideo: "Varyant görseli video olamaz; bir görsel seçin.",
  shareImageIsVideo: "Paylaşım görseli video olamaz; bir görsel seçin.",
  swatchIsVideo: "Kutucuk görseli video olamaz; bir görsel seçin.",
} as const;

/** What the rules need to know about one media row. */
export type ProductMediaFacts = { video: boolean; hasPoster: boolean };

/**
 * Kind rules of the gallery rows, as dotted-path errors: the first row is an image ("media.0.mediaId"),
 * every video has a cover image ("media.<i>.mediaId"), at most MAX_PRODUCT_VIDEOS videos ("media").
 * Rows whose media is unknown (`facts` returns undefined) count as images: the existence check reports them.
 */
export function productMediaKindErrors(
  rows: readonly Pick<ProductMediaState, "mediaId">[],
  facts: (mediaId: number) => ProductMediaFacts | undefined,
): Record<string, string> {
  const errors: Record<string, string> = {};
  let videos = 0;
  rows.forEach((row, i) => {
    const f = facts(row.mediaId);
    if (!f?.video) return;
    videos += 1;
    if (i === 0) errors["media.0.mediaId"] = PRODUCT_MEDIA_MESSAGES.firstIsVideo;
    else if (!f.hasPoster) errors[`media.${i}.mediaId`] = PRODUCT_MEDIA_MESSAGES.videoWithoutPoster;
  });
  if (videos > MAX_PRODUCT_VIDEOS) errors.media = PRODUCT_MEDIA_MESSAGES.tooManyVideos;
  return errors;
}

export const OPTION_DISPLAY_OPTIONS: { value: OptionDisplay; label: string }[] = [
  { value: "buttons", label: "Düğmeler" },
  { value: "swatches", label: "Renk / görsel kutucukları" },
  { value: "select", label: "Açılır liste" },
];

/** KDV rates in Türkiye. */
export const VAT_RATES = [0, 1, 10, 20] as const;

/** Claim badges the storefront knows (labels come from the UI texts "product.claims.*"). */
export const CLAIM_OPTIONS: { key: string; label: string }[] = [
  { key: "effective_cleaning", label: "Etkili Temizlik" },
  { key: "skin_caring", label: "Cildi Koruyan" },
  { key: "fresh_scent", label: "Ferah Koku" },
  { key: "soft_feel", label: "Yumuşak His" },
];

export const keyOf = {
  option: (id: number) => `o${id}`,
  value: (id: number) => `ov${id}`,
  variant: (id: number) => `v${id}`,
  media: (id: number) => `m${id}`,
  tier: (id: number) => `t${id}`,
  groupPrice: (variantId: number, groupId: number) => `g${variantId}-${groupId}`,
  bundle: (id: number) => `b${id}`,
};

/** A fresh client key for an unsaved row. */
export function newKey(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `n${random}`;
}

/** "Pompalı Şişe 500 ml · Cam" from the option values of a variant (Turkish). */
export function variantTitle(variant: Pick<VariantState, "optionValueKeys">, options: readonly OptionState[]): string {
  const parts: string[] = [];
  for (const option of options) {
    const value = option.values.find((v) => variant.optionValueKeys.includes(v.key));
    if (value?.value.tr) parts.push(value.value.tr);
  }
  return parts.join(" · ");
}

/** Every combination of one value per option (cartesian product), as lists of value keys. */
export function optionCombinations(options: readonly OptionState[]): string[][] {
  let combos: string[][] = [[]];
  for (const option of options) {
    if (option.values.length === 0) return [];
    const next: string[][] = [];
    for (const combo of combos) for (const value of option.values) next.push([...combo, value.key]);
    combos = next;
  }
  return options.length === 0 ? [] : combos;
}

/** Stable identity of a combination regardless of order. */
export function comboId(keys: readonly string[]): string {
  return [...keys].sort().join("|");
}
