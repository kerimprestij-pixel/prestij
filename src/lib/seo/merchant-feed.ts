// Google Merchant Center product feed (RSS 2.0 with the g: namespace; Meta catalogs read the same file).
// Pure: no DB, no Next APIs, no clock (the campaign read time `asOf` is passed in), so every rule is unit-
// tested. src/app/feeds/google-merchant.xml/route.ts loads the cached data and calls buildMerchantFeed().
//
// What goes in (Google "Product data specification", checked 2026-11-10):
//   - one <item> per sellable variant of every active, indexable, retail (not business-only) `standard` or
//     `bundle` product; never samples. Turkish copy, prices in TRY, shipping to TR;
//   - the same data the product page shows: getProduct() (images in gallery order, the retail campaign of
//     pickDisplayCampaign at the campaign read time, availability from stockStatus);
//   - g:price = the regular price, g:sale_price = the campaign price (campaignDisplayPrice, the cart's
//     rounding) with g:sale_price_effective_date when the campaign has an end;
//   - g:shipping = what checkout charges a retail guest for one unit: computeCart() itself, the money
//     engine the cart and checkout use (flat fee, free threshold, heavy-parcel surcharge, campaigns);
//   - images: the largest WebP/JPEG/PNG rendition of each media row (never AVIF), absolute.
// Deliberate differences from docs/DAY5-SEO.md §5.2 (Google's rules win; see the FEED report):
//   - no g:identifier_exists: every item has brand + MPN (Google: a manufacturer's own products without a
//     GTIN send brand + their own part number, e.g. the SKU; "no" is only for products without any identifier);
//   - no g:is_bundle: Google uses it only for a merchant-made bundle of a main product plus add-ons and says not
//     to send it for a manufacturer-defined set (PRESTİJ makes its own sets); bundles get the gift-set category;
//   - dates use Google's documented offset form "+0300" (no colon), e.g. 2026-11-20T00:00+0300.
import { richTextHtml } from "@/components/sections/sanitize-html";
import { formatVolume, stockStatus } from "@/components/store/format";
import type { Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import { campaignDisplayPrice, pickDisplayCampaign, type CampaignRule } from "@/lib/campaigns/pick";
import { computeCart } from "@/lib/cart/compute";
import { RETAIL_CUSTOMER, type EngineCampaign, type EngineLine, type EngineSettings } from "@/lib/cart/types";
import type { ProductDetail, ProductMediaData, ProductVariantData } from "@/lib/data/catalog";
import { variantUrl as mediaFileUrl, type MediaLike } from "@/lib/media/types";
import { isValidEan13 } from "@/lib/panel/format";
import { kurusToDecimal } from "@/lib/pricing/money";
import { GOOGLE_PRODUCT_CATEGORIES, type Settings } from "@/lib/settings/types";
import { productGroupId } from "./structured-data";
import { variantPath } from "./variant-url";

// ---------------------------------------------------------------------------------------------------
// Constants

/** The feed is Turkish and targets Türkiye (choose "Turkish" / "Türkiye" when adding it in Merchant Center). */
export const MERCHANT_FEED_LOCALE: Locale = "tr";
export const MERCHANT_FEED_COUNTRY = "TR";
export const MERCHANT_FEED_CURRENCY = "TRY";
/** The RSS namespace of Google's product attributes. */
export const GOOGLE_FEED_NAMESPACE = "http://base.google.com/ns/1.0";
/** Istanbul time zone (sale dates are written in Turkish time). */
export const FEED_TIME_ZONE = "Europe/Istanbul";

/** Google's limits (characters / counts) for the attributes we send. */
export const FEED_LIMITS = {
  id: 50,
  itemGroupId: 50,
  title: 150,
  description: 5000,
  brand: 70,
  mpn: 70,
  productType: 750,
  size: 100,
  additionalImages: 10,
} as const;

/** Product types that can be listed (samples are free and never for sale). */
const LISTABLE_TYPES: readonly ProductDetail["type"][] = ["standard", "bundle"];

/**
 * Category slugs whose products get a more specific Google category than the store-wide default
 * (settings.seo.merchantCategory, Liquid Hand Soap by default). Bundles always get Bath & Body Gift Sets.
 */
export const CATEGORY_GOOGLE_PRODUCT_CATEGORY: Readonly<Record<string, string>> = {
  "dus-jeli": GOOGLE_PRODUCT_CATEGORIES.bodyWash,
  "hediye-setleri": GOOGLE_PRODUCT_CATEGORIES.bathAndBodyGiftSets,
};

/** The unit the per-liter price on the product page uses (g:unit_pricing_base_measure). */
const UNIT_PRICING_BASE_MEASURE = "1 l";

/** Image formats Google accepts that our pipeline produces (AVIF is not accepted). */
const FEED_IMAGE_FORMATS = ["webp", "jpeg", "png"] as const;
const FEED_IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif)$/i;

// ---------------------------------------------------------------------------------------------------
// Input and output types

/** The parts of getProduct() the feed reads (a full ProductDetail fits). Products must be active. */
export type MerchantFeedProduct = Pick<
  ProductDetail,
  | "id"
  | "slug"
  | "type"
  | "name"
  | "subtitle"
  | "shortDescription"
  | "description"
  | "seo"
  | "businessOnly"
  | "categoryId"
  | "category"
  | "options"
  | "variants"
  | "media"
  | "tiers"
>;

/** A live campaign (getActiveCampaigns().campaigns fits). */
export type MerchantFeedCampaign = CampaignRule & { id: number };

export type MerchantFeedData = {
  /** Active products in display order (getProduct() for every listProductSlugs() slug). */
  products: readonly MerchantFeedProduct[];
  /** getActiveCampaigns(): the live campaigns and when they were read (epoch ms). */
  campaigns: { campaigns: readonly MerchantFeedCampaign[]; asOf: number };
  general: Pick<Settings<"general">, "siteName" | "legalName">;
  seo: Pick<Settings<"seo">, "defaultTitle" | "description" | "merchantCategory">;
  shipping: Pick<Settings<"shipping">, "flatFee" | "freeThreshold" | "heavy" | "estimatedDays">;
};

export type MerchantFeedItem = {
  id: string;
  /** Product group (only when the product has more than one item in the feed). */
  itemGroupId: string | null;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks: string[];
  availability: "in_stock" | "out_of_stock";
  /** "149.90 TRY" */
  price: string;
  salePrice: string | null;
  /** "2026-11-20T10:00+0300/2026-11-27T23:59+0300" */
  salePriceEffectiveDate: string | null;
  brand: string | null;
  gtin: string | null;
  mpn: string;
  condition: "new";
  googleProductCategory: string | null;
  productType: string;
  size: string | null;
  shipping: { country: string; price: string };
  shippingWeight: string | null;
  unitPricingMeasure: string | null;
  unitPricingBaseMeasure: string | null;
  minHandlingTime: number | null;
  maxHandlingTime: number | null;
};

export type MerchantFeedSkipReason =
  /** A sample (free, not for sale) or another non-listable type. */
  | "not_listable"
  /** The product is marked noindex in its SEO settings. */
  | "noindex"
  /** Business-only products are not offered to retail shoppers. */
  | "business_only"
  /** No active variant. */
  | "no_variants"
  /** Price is 0, negative or not an integer (Google refuses a 0 price). */
  | "invalid_price"
  /** Cannot be bought as a single unit (minQuantity > 1), so a per-unit listing would mislead. */
  | "min_quantity"
  /** No image in a format Google accepts. */
  | "no_image";

export type MerchantFeedSkip = { productId: number; slug: string; variantId: number | null; sku: string | null; reason: MerchantFeedSkipReason };

// ---------------------------------------------------------------------------------------------------
// Small helpers (exported for tests and the DB parity checks)

/** Feed price: integer kuruş → "149.90 TRY". */
export function formatFeedPrice(kurus: number): string {
  if (!Number.isSafeInteger(kurus) || kurus < 0) throw new RangeError(`Invalid price in kuruş: ${kurus}`);
  return `${kurusToDecimal(kurus)} ${MERCHANT_FEED_CURRENCY}`;
}

const trimOrigin = (origin: string) => origin.replace(/\/+$/, "");

/** Absolute URL for a site path or media URL (absolute http(s) URLs pass through). */
export function feedAbsoluteUrl(urlOrPath: string, origin: string): string {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  return `${trimOrigin(origin)}${urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`}`;
}

/**
 * The file Google gets for a media row: the largest WebP/JPEG/PNG rendition (largest width; WebP first on
 * a tie), else `media.url` when it is a JPEG/PNG/WebP/GIF file, else null (e.g. AVIF only). Absolute URL.
 */
export function feedImageUrl(media: Pick<MediaLike, "url" | "variants">, origin: string): string | null {
  const rank = (format: string) => (FEED_IMAGE_FORMATS as readonly string[]).indexOf(format);
  const allowed = (media.variants ?? []).filter((v) => rank(v.format) >= 0 && v.key && Number.isFinite(v.width));
  const best = allowed.reduce<(typeof allowed)[number] | null>((a, b) => {
    if (!a) return b;
    if (b.width !== a.width) return b.width > a.width ? b : a;
    return rank(b.format) < rank(a.format) ? b : a;
  }, null);
  if (best) return feedAbsoluteUrl(mediaFileUrl(media, best.key), origin);
  const path = media.url.split(/[?#]/)[0];
  return FEED_IMAGE_EXTENSION.test(path) ? feedAbsoluteUrl(media.url, origin) : null;
}

/** The product images shown for a variant, in gallery order: its own images, then shared ones (ProductGallery). */
export function imagesForVariant(media: readonly ProductMediaData[], variantId: number): ProductMediaData[] {
  const own = media.filter((m) => m.variantId != null && m.variantId === variantId);
  const shared = media.filter((m) => m.variantId == null);
  const list = [...own, ...shared];
  return list.length ? list : [...media];
}

/**
 * Main image + up to 10 additional ones for a variant: the variant's own image first, else the first
 * packshot, else the first image; the rest in gallery order. Images without a usable rendition are left out.
 */
export function feedImages(
  product: Pick<MerchantFeedProduct, "media">,
  variant: Pick<ProductVariantData, "id" | "imageId">,
  origin: string,
): { imageLink: string | null; additionalImageLinks: string[] } {
  const usable = imagesForVariant(product.media, variant.id).flatMap((m) => {
    const url = feedImageUrl(m.media, origin);
    return url ? [{ ...m, url }] : [];
  });
  const main = usable.find((m) => variant.imageId != null && m.media.id === variant.imageId) ?? usable.find((m) => m.role === "packshot") ?? usable[0];
  if (!main) return { imageLink: null, additionalImageLinks: [] };
  const seen = new Set<string>([main.url]);
  const additional: string[] = [];
  for (const m of usable) {
    if (additional.length >= FEED_LIMITS.additionalImages) break;
    if (seen.has(m.url)) continue;
    seen.add(m.url);
    additional.push(m.url);
  }
  return { imageLink: main.url, additionalImageLinks: additional };
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•",
  deg: "°", times: "×", copy: "©", reg: "®", trade: "™",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isInteger(code) && code > 0 && code < 0x110000 && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Plain text of panel rich text (Google: no HTML): sanitized first, then paragraphs and headings become line
 * breaks, list items "- " lines, links their label (no URLs: Google wants product information only),
 * entities decoded, spaces collapsed.
 */
export function feedPlainText(html: string | null | undefined): string {
  return decodeEntities(
    richTextHtml(html)
      .replace(/<li>/g, "\n- ")
      .replace(/<\/?(p|h2|h3|h4|blockquote|ul|ol)>|<br>|<hr>/g, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * At most `max` characters (code points, never a split surrogate pair). Longer text is cut at the last
 * space in the final fifth, else hard, and gets `ellipsis` (counted in `max`).
 */
export function truncateText(text: string, max: number, ellipsis = ""): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const room = max - Array.from(ellipsis).length;
  let cut = chars.slice(0, room).join("");
  const space = cut.search(/\s\S*$/);
  if (space > 0 && space >= Math.floor(room * 0.8)) cut = cut.slice(0, space);
  return `${cut.trimEnd()}${ellipsis}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MINUTE = 60_000;
const floorMinute = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;
const ceilMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE;

/**
 * Istanbul wall-clock time with its UTC offset, in Google's documented form "2026-11-20T10:00+0300"
 * (minute precision: seconds are dropped).
 */
export function feedDateTime(date: Date): string {
  const ms = floorMinute(date.getTime());
  const at = new Date(ms);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: FEED_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const offset = Math.round((wall - ms) / MINUTE);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/**
 * g:sale_price_effective_date for a live campaign: "start/end" when it has an end date, null without one
 * (the sale then applies until the feed changes, which happens when the campaign is edited or ends).
 * The start is the campaign's start rounded up to the minute (or the campaign read time when it has no
 * start), the end its end rounded down, so the published window never exceeds the real one. Null when
 * that leaves less than a minute.
 */
export function salePriceEffectiveDate(campaign: Pick<CampaignRule, "startsAt" | "endsAt">, asOf: number): string | null {
  if (!campaign.endsAt) return null;
  const start = campaign.startsAt ? ceilMinute(campaign.startsAt.getTime()) : floorMinute(asOf);
  const end = floorMinute(campaign.endsAt.getTime());
  return end > start ? `${feedDateTime(new Date(start))}/${feedDateTime(new Date(end))}` : null;
}

/** Payment and sample settings play no part in shipping; the engine just needs values for them. */
const SHIPPING_ONLY: Omit<EngineSettings, "shipping"> = {
  payments: {
    card: { enabled: false, provider: "iyzico", testMode: true, installments: false, maxInstallments: 1 },
    bankTransfer: { enabled: false, discountPercent: 0, accounts: [], instructions: { tr: "" }, paymentDays: 3 },
    cashOnDelivery: { enabled: false, fee: 0, maxOrderTotal: 0 },
  },
  samples: { cartSampleEnabled: false, maxPerOrder: 0, minOrderTotal: 0 },
};

/** Live campaigns in the money engine's shape. */
export function engineCampaigns(campaigns: readonly MerchantFeedCampaign[]): EngineCampaign[] {
  return campaigns.map((c) => ({
    id: c.id,
    percent: c.percent,
    priority: c.priority,
    productIds: c.productIds ? [...c.productIds] : null,
    categoryIds: c.categoryIds ? [...c.categoryIds] : null,
    customerGroupIds: c.customerGroupIds ? [...c.customerGroupIds] : null,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
  }));
}

/**
 * Shipping (kuruş, VAT included) checkout charges a retail guest for one unit of the variant, computed by
 * computeCart() (src/lib/cart/compute.ts, the engine the cart and checkout use) with the variant's retail
 * tiers and the live campaigns, exactly as a cart line would carry them. Stock is ignored here so an
 * out-of-stock item still shows the rate it ships at.
 */
export function feedShippingPrice(
  product: Pick<MerchantFeedProduct, "id" | "type" | "categoryId" | "tiers">,
  variant: Pick<ProductVariantData, "id" | "price" | "compareAtPrice" | "vatRate" | "weightGrams" | "minQuantity" | "maxQuantity">,
  context: { shipping: EngineSettings["shipping"]; campaigns: readonly EngineCampaign[]; asOf: number },
): number {
  const line: EngineLine = {
    lineId: 1,
    variantId: variant.id,
    productId: product.id,
    categoryId: product.categoryId,
    productType: product.type,
    productStatus: "active",
    variantActive: true,
    businessOnly: false,
    quantity: 1,
    basePrice: variant.price,
    compareAtPrice: variant.compareAtPrice,
    groupPrice: null,
    // The cart's tiers for a line: the variant's own rows and the product-wide ones (retail only here).
    tiers: product.tiers
      .filter((t) => t.variantId === variant.id || t.variantId == null)
      .map((t) => ({ minQuantity: t.minQuantity, discountPercent: t.discountPercent, groupId: null })),
    vatRate: variant.vatRate,
    weightGrams: variant.weightGrams,
    stock: 0,
    trackStock: false,
    allowBackorder: true,
    minQuantity: variant.minQuantity,
    maxQuantity: variant.maxQuantity,
  };
  const totals = computeCart({
    lines: [line],
    customer: RETAIL_CUSTOMER,
    coupon: null,
    settings: { ...SHIPPING_ONLY, shipping: context.shipping },
    campaigns: [...context.campaigns],
    now: new Date(context.asOf),
  });
  return totals.shipping.total;
}

/**
 * g:google_product_category for a product: bundles → Bath & Body Gift Sets, categories listed in
 * CATEGORY_GOOGLE_PRODUCT_CATEGORY → their category, else the store-wide setting. An empty setting
 * ("let Google decide") leaves the attribute out for every product.
 */
export function merchantCategoryFor(product: Pick<MerchantFeedProduct, "type" | "category">, setting: string): string | null {
  const storeWide = setting.trim();
  if (!storeWide) return null;
  if (product.type === "bundle") return GOOGLE_PRODUCT_CATEGORIES.bathAndBodyGiftSets;
  return (product.category && CATEGORY_GOOGLE_PRODUCT_CATEGORY[product.category.slug]) || storeWide;
}

/** "500 ml", "5 l", "1.5 l" (g:unit_pricing_measure), or null when the volume is unknown. */
export function unitPricingMeasure(volumeMl: number | null | undefined): string | null {
  if (!volumeMl || !Number.isInteger(volumeMl) || volumeMl <= 0) return null;
  return volumeMl >= 1000 && volumeMl % 10 === 0 ? `${Number((volumeMl / 1000).toFixed(2))} l` : `${volumeMl} ml`;
}

/** The variant's option labels in option order, e.g. "5 L Bidon" (Turkish). */
function optionLabel(product: Pick<MerchantFeedProduct, "options">, variant: Pick<ProductVariantData, "optionValueIds">): string {
  return product.options
    .map((o) => o.values.find((val) => variant.optionValueIds.includes(val.id)))
    .map((val) => (val ? localize(val.value, MERCHANT_FEED_LOCALE) : ""))
    .filter(Boolean)
    .join(" / ");
}

const lower = (s: string) => s.toLocaleLowerCase("tr-TR");

/** Brand + name + type + size, without repeating the brand when the name already has it; ≤ 150. */
function itemTitle(brand: string | null, name: string, subtitle: string, size: string | null): string {
  const parts = [brand && !lower(name).includes(lower(brand)) ? brand : null, name, subtitle, size].filter((p): p is string => Boolean(p && p.trim()));
  return truncateText(parts.join(" ").replace(/\s+/g, " ").trim(), FEED_LIMITS.title);
}

function itemId(variant: Pick<ProductVariantData, "id" | "sku">): string {
  const sku = variant.sku.trim();
  return sku && Array.from(sku).length <= FEED_LIMITS.id ? sku : `V${variant.id}`;
}

function handlingTimes(days: { min: number; max: number } | undefined): { min: number | null; max: number | null } {
  const ok = days && Number.isInteger(days.min) && Number.isInteger(days.max) && days.min >= 0 && days.min <= days.max;
  return ok ? { min: days.min, max: days.max } : { min: null, max: null };
}

// ---------------------------------------------------------------------------------------------------
// Items

/** The feed items (one per sellable variant) and what was left out, with the reason. */
export function collectMerchantFeedItems(data: MerchantFeedData, origin: string): { items: MerchantFeedItem[]; skipped: MerchantFeedSkip[] } {
  const items: MerchantFeedItem[] = [];
  const skipped: MerchantFeedSkip[] = [];
  const locale = MERCHANT_FEED_LOCALE;
  const brand = truncateText((data.general.siteName || data.general.legalName || "").trim(), FEED_LIMITS.brand) || null;
  const { campaigns, asOf } = data.campaigns;
  const engine = engineCampaigns(campaigns);
  const shipping = { flatFee: data.shipping.flatFee, freeThreshold: data.shipping.freeThreshold, heavy: data.shipping.heavy };
  const handling = handlingTimes(data.shipping.estimatedDays);

  for (const product of data.products) {
    const skip = (reason: MerchantFeedSkipReason, variant?: ProductVariantData) =>
      skipped.push({ productId: product.id, slug: product.slug, variantId: variant?.id ?? null, sku: variant?.sku ?? null, reason });
    if (!LISTABLE_TYPES.includes(product.type)) {
      skip("not_listable");
      continue;
    }
    if (product.seo?.noIndex) {
      skip("noindex");
      continue;
    }
    if (product.businessOnly) {
      skip("business_only");
      continue;
    }
    if (product.variants.length === 0) {
      skip("no_variants");
      continue;
    }

    const name = localize(product.name, locale);
    const subtitle = localize(product.subtitle, locale);
    const categoryName = product.category ? localize(product.category.name, locale) : "";
    const description = feedPlainText(localize(product.description, locale)) || feedPlainText(localize(product.shortDescription, locale));
    const productType = truncateText(categoryName ? `${categoryName} > ${name}` : name, FEED_LIMITS.productType);
    const googleCategory = merchantCategoryFor(product, data.seo.merchantCategory);
    const campaign = pickDisplayCampaign(campaigns, { productId: product.id, categoryId: product.categoryId }, asOf);

    const ready: { variant: ProductVariantData; item: Omit<MerchantFeedItem, "itemGroupId" | "link"> }[] = [];
    for (const variant of product.variants) {
      if (!Number.isSafeInteger(variant.price) || variant.price <= 0) {
        skip("invalid_price", variant);
        continue;
      }
      if (variant.minQuantity > 1) {
        skip("min_quantity", variant);
        continue;
      }
      let unitPrice: number;
      try {
        unitPrice = campaignDisplayPrice(variant, campaign?.percent).unitPrice;
      } catch {
        skip("invalid_price", variant);
        continue;
      }
      if (unitPrice <= 0) {
        skip("invalid_price", variant);
        continue;
      }
      const images = feedImages(product, variant, origin);
      if (!images.imageLink) {
        skip("no_image", variant);
        continue;
      }
      const label = optionLabel(product, variant);
      const size = label || (product.variants.length > 1 ? formatVolume(variant.volumeMl, "tr-TR") : null);
      const title = itemTitle(brand, name, subtitle, size);
      const barcode = variant.barcode?.trim() ?? "";
      const onSale = campaign != null && unitPrice < variant.price;
      const measure = unitPricingMeasure(variant.volumeMl);
      ready.push({
        variant,
        item: {
          id: itemId(variant),
          title,
          description: truncateText(description || title, FEED_LIMITS.description, "…"),
          imageLink: images.imageLink,
          additionalImageLinks: images.additionalImageLinks,
          availability: stockStatus(variant) === "out" ? "out_of_stock" : "in_stock",
          price: formatFeedPrice(variant.price),
          salePrice: onSale ? formatFeedPrice(unitPrice) : null,
          salePriceEffectiveDate: onSale && campaign ? salePriceEffectiveDate(campaign, asOf) : null,
          brand,
          gtin: isValidEan13(barcode) ? barcode : null,
          mpn: truncateText(variant.sku.trim(), FEED_LIMITS.mpn) || itemId(variant),
          condition: "new",
          googleProductCategory: googleCategory,
          productType,
          size: size ? truncateText(size, FEED_LIMITS.size) : null,
          shipping: {
            country: MERCHANT_FEED_COUNTRY,
            price: formatFeedPrice(feedShippingPrice(product, variant, { shipping, campaigns: engine, asOf })),
          },
          shippingWeight: variant.weightGrams && variant.weightGrams > 0 ? `${variant.weightGrams} g` : null,
          unitPricingMeasure: measure,
          unitPricingBaseMeasure: measure ? UNIT_PRICING_BASE_MEASURE : null,
          minHandlingTime: handling.min,
          maxHandlingTime: handling.max,
        },
      });
    }

    // Variants share a group and link to their preselected variant; a single item is a plain product.
    const grouped = ready.length > 1;
    for (const { variant, item } of ready) {
      items.push({
        ...item,
        // The product page's ProductGroup productGroupID, so Google ties these items to that page.
        itemGroupId: grouped ? productGroupId(product) : null,
        link: feedAbsoluteUrl(grouped ? variantPath(locale, product.slug, variant.id) : href(locale, "product", { slug: product.slug }), origin),
      });
    }
  }
  return { items, skipped };
}

// ---------------------------------------------------------------------------------------------------
// XML

// XML 1.0 allows tab, LF, CR and U+0020–U+D7FF, U+E000–U+FFFD, U+10000–U+10FFFF; anything else is dropped.
const INVALID_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;

/** Text for an XML element: invalid characters removed, & < > " ' escaped. */
export function xmlEscape(value: string): string {
  return value
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const element = (name: string, value: string | number | null | undefined, indent: string): string[] =>
  value == null || value === "" ? [] : [`${indent}<${name}>${xmlEscape(String(value))}</${name}>`];

function renderItem(item: MerchantFeedItem): string[] {
  const i = "      ";
  return [
    "    <item>",
    ...element("g:id", item.id, i),
    ...element("g:item_group_id", item.itemGroupId, i),
    ...element("title", item.title, i),
    ...element("description", item.description, i),
    ...element("link", item.link, i),
    ...element("g:image_link", item.imageLink, i),
    ...item.additionalImageLinks.flatMap((url) => element("g:additional_image_link", url, i)),
    ...element("g:availability", item.availability, i),
    ...element("g:price", item.price, i),
    ...element("g:sale_price", item.salePrice, i),
    ...element("g:sale_price_effective_date", item.salePriceEffectiveDate, i),
    ...element("g:brand", item.brand, i),
    ...element("g:gtin", item.gtin, i),
    ...element("g:mpn", item.mpn, i),
    ...element("g:condition", item.condition, i),
    ...element("g:google_product_category", item.googleProductCategory, i),
    ...element("g:product_type", item.productType, i),
    ...element("g:size", item.size, i),
    `${i}<g:shipping>`,
    ...element("g:country", item.shipping.country, `${i}  `),
    ...element("g:price", item.shipping.price, `${i}  `),
    `${i}</g:shipping>`,
    ...element("g:shipping_weight", item.shippingWeight, i),
    ...element("g:min_handling_time", item.minHandlingTime, i),
    ...element("g:max_handling_time", item.maxHandlingTime, i),
    ...element("g:unit_pricing_measure", item.unitPricingMeasure, i),
    ...element("g:unit_pricing_base_measure", item.unitPricingBaseMeasure, i),
    "    </item>",
  ];
}

/** The RSS document for already collected items. */
export function renderMerchantFeed(channel: { title: string; link: string; description: string }, items: readonly MerchantFeedItem[]): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:g="${GOOGLE_FEED_NAMESPACE}">`,
    "  <channel>",
    ...element("title", channel.title, "    "),
    ...element("link", channel.link, "    "),
    ...element("description", channel.description, "    "),
    ...element("language", MERCHANT_FEED_LOCALE, "    "),
    ...items.flatMap(renderItem),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/**
 * The whole feed: `buildMerchantFeed(data, siteOrigin())` → RSS 2.0 XML (UTF-8). Deterministic for the same
 * input; serve it as `application/xml; charset=utf-8`.
 */
export function buildMerchantFeed(data: MerchantFeedData, origin: string): string {
  const { items } = collectMerchantFeedItems(data, origin);
  const title = (data.general.siteName || data.general.legalName || "").trim() || localize(data.seo.defaultTitle, MERCHANT_FEED_LOCALE);
  return renderMerchantFeed(
    {
      title,
      link: feedAbsoluteUrl(href(MERCHANT_FEED_LOCALE, "home"), origin),
      description: localize(data.seo.description, MERCHANT_FEED_LOCALE) || title,
    },
    items,
  );
}
