// JSON-LD (schema.org structured data) for the storefront. Pure: no DB and no Next request APIs, so
// every builder is unit-testable. The server components in src/components/seo/ load the data, call a
// builder and print the result through <JsonLdScript>, which uses jsonLd() from
// src/components/store/format.ts: the only serializer allowed inside <script type="application/ld+json">.
//
// Rules for every builder:
//   - takes one plain input object (page data + settings) and returns a complete document with "@context"
//     (or null when there is nothing to describe); print each document in its own <script>;
//   - URLs are absolute (siteOrigin() = NEXT_PUBLIC_SITE_URL, baked in at build time);
//   - describe only what the page shows (Google's structured-data policy).
//
// Day 5 (SEO-TECH) follows Google Search Central as read on 2026-11-10:
//   - Organization: the `OnlineStore` subtype Google recommends for online stores; no required properties,
//     every recommended one we have data for (logo ≥ 112 px, telephone with country code, PostalAddress,
//     contactPoint, sameAs, legalName when it differs from name, hasMerchantReturnPolicy).
//   - Return policy: Google recommends one global MerchantReturnPolicy under Organization "instead" of one
//     per offer, so offers carry none (the home page's OnlineStore holds it).
//   - Merchant listings + product variants: a ProductGroup (productGroupID, variesBy size, hasVariant) for
//     products with several sellable variants, a Product for one; offers with price > 0, priceCurrency,
//     availability, itemCondition, priceValidUntil (campaign end) and shippingDetails (shippingRate +
//     shippingDestination + deliveryTime.handlingTime from settings.shipping.estimatedDays, the
//     "kargoya verme süresi"; transitTime is left out because no setting holds it).
//   - BlogPosting: author/publisher as the Organization (by @id, with name and url) unless a person wrote it.
import { campaignDisplayPrice } from "@/lib/campaigns/pick";
import { formatVolume, stockStatus } from "@/components/store/format";
import { productPhrase } from "@/components/store/product-heading";
import { intlLocale, type Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { absoluteUrl, href, siteOrigin } from "@/i18n/paths";
import type { PostDetail } from "@/lib/data/blog";
import type { ProductCardData, ProductDetail, ProductVariantData } from "@/lib/data/catalog";
import type { MediaLike } from "@/lib/media/types";
import { isValidEan13 } from "@/lib/panel/format";
import { kurusToDecimal } from "@/lib/pricing/money";
import { reviewLang } from "@/lib/reviews/display";
import type { ProductReviewsData, PublicReview } from "@/lib/reviews/types";
import type { Settings } from "@/lib/settings/types";
import { ownLocaleText } from "./localized";
import { variantUrl } from "./variant-url";

// ---------------------------------------------------------------------------------------------------
// Types

export const SCHEMA_CONTEXT = "https://schema.org";

/** One schema.org entity: an object with "@type" (and optionally "@id"). */
export type JsonLdNode = { "@type": string; "@id"?: string; [property: string]: unknown };

/** A printable document: a node with "@context". Print each one with <JsonLdScript data={…} />. */
export type JsonLdDocument = JsonLdNode & { "@context": string };

/** A pointer to a node printed elsewhere, e.g. `publisher: { "@id": ORG_ID() }`. */
export type JsonLdRef = { "@id": string };

// ---------------------------------------------------------------------------------------------------
// Ids and small helpers

const trimOrigin = (origin: string) => origin.replace(/\/+$/, "");

/** `@id` of the site's Organization: `ORG_ID()` → `"https://prestij.com.tr/#organization"`. Same on every page and locale. */
export function ORG_ID(origin: string = siteOrigin()): string {
  return `${trimOrigin(origin)}/#organization`;
}

/** `@id` of the site's WebSite: `WEBSITE_ID()` → `"https://prestij.com.tr/#website"`. */
export function WEBSITE_ID(origin: string = siteOrigin()): string {
  return `${trimOrigin(origin)}/#website`;
}

/** BCP 47 tag for `inLanguage`: tr → "tr-TR", en → "en-US", ar → "ar". */
export function jsonLdLanguage(locale: Locale): string {
  return intlLocale(locale).split("-u-")[0];
}

/** Absolute URL for a site path or a media URL; absolute http(s) URLs pass through unchanged. */
export function absoluteLink(urlOrPath: string): string {
  return /^https?:\/\//i.test(urlOrPath) ? urlOrPath : absoluteUrl(urlOrPath);
}

const SCHEMA = (name: string) => `${SCHEMA_CONTEXT}/${name}`;

/** Country the shop sells to, ships to and takes returns in (ISO 3166-1 alpha-2). */
export const SHOP_COUNTRY = "TR";
/** Currency of every price (prices are integer kuruş in the database). */
export const SHOP_CURRENCY = "TRY";

/** Google wants logos of at least 112 × 112 px. Unknown dimensions are accepted (we cannot check them). */
const MIN_LOGO_PX = 112;

/**
 * A phone number in E.164 (`"+903523533070"`), or null when it cannot be read as one. Turkish spellings
 * ("0352 353 30 70", "352 353 30 70", "90 352…") get +90; "+…" and "00…" keep their country code.
 */
export function phoneE164(phone: string | null | undefined): string | null {
  const raw = (phone ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  let e164: string;
  if (raw.startsWith("+")) e164 = `+${digits}`;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else if (digits.startsWith("90") && digits.length === 12) e164 = `+${digits}`;
  else if (digits.startsWith("0") && digits.length === 11) e164 = `+90${digits.slice(1)}`;
  else if (digits.length === 10 && !digits.startsWith("0")) e164 = `+90${digits}`;
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** ISO country code for a stored country name ("Türkiye", "Turkey", "TR", …); null when unknown. */
export function countryCode(country: string | null | undefined): string | null {
  const key = (country ?? "").trim().toLocaleLowerCase("tr-TR");
  return ["türkiye", "turkiye", "turkey", "tr", "türkei", "turquie", "تركيا"].includes(key) ? SHOP_COUNTRY : null;
}

/** Only absolute https URLs with a host (social profile links for `sameAs`). */
export function httpsUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

// ---------------------------------------------------------------------------------------------------
// Organization + WebSite (home page: <SiteStructuredData />)

export type OrganizationJsonLdInput = {
  locale: Locale;
  /** settings.general: site and legal name, phone, e-mail, address, social links. */
  general: Settings<"general">;
  /** settings.seo: `returns` for hasMerchantReturnPolicy. */
  seo: Settings<"seo">;
  /** The light logo (settings.general.logo.lightId), or null when none is set. */
  logo: MediaLike | null;
  /** Languages customer service answers in (contactPoint.availableLanguage): the enabled storefront locales. Default: all three. */
  languages?: readonly Locale[];
  /** Public path of the returns page (merchantReturnLink), or null when that page is not published. */
  returnsPath?: string | null;
};

/** Return policy days → MerchantReturnPolicy (Google's "Option A"; the store-wide policy for every product). */
export function merchantReturnPolicyJsonLd(returns: Settings<"seo">["returns"], returnsUrl?: string | null): JsonLdNode {
  const days = Number.isInteger(returns.days) && returns.days > 0 ? Math.min(returns.days, 365) : 0;
  const link = returnsUrl ? { merchantReturnLink: returnsUrl } : {};
  if (days === 0) {
    return {
      "@type": "MerchantReturnPolicy",
      applicableCountry: SHOP_COUNTRY,
      returnPolicyCategory: SCHEMA("MerchantReturnNotPermitted"),
      ...link,
    };
  }
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: SHOP_COUNTRY,
    returnPolicyCountry: SHOP_COUNTRY,
    returnPolicyCategory: SCHEMA("MerchantReturnFiniteReturnWindow"),
    merchantReturnDays: days,
    // The returns page: unopened, unused items, sent back with the carrier, refunded to the original payment method.
    returnMethod: SCHEMA("ReturnByMail"),
    itemCondition: SCHEMA("NewCondition"),
    refundType: SCHEMA("FullRefund"),
    // null = the shop has not said who pays return shipping: leave it out rather than guess.
    ...(returns.freeReturns === true
      ? { returnFees: SCHEMA("FreeReturn") }
      : returns.freeReturns === false
        ? { returnFees: SCHEMA("ReturnFeesCustomerResponsibility") }
        : {}),
    ...link,
  };
}

/**
 * The shop as Google's recommended Organization subtype for online stores (`OnlineStore`): @id, name,
 * legal name, url, logo, description, telephone (E.164), e-mail, PostalAddress (TR), customer service
 * contactPoint, sameAs (https social links) and the store-wide return policy.
 */
export function organizationJsonLd(input: OrganizationJsonLdInput): JsonLdDocument {
  const { general, locale, logo, seo } = input;
  const name = general.siteName.trim();
  const legalName = general.legalName.trim();
  const telephone = phoneE164(general.phone);
  const email = EMAIL.test(general.email.trim()) ? general.email.trim() : null;
  const description = localize(seo.description, locale);
  const addressCountry = countryCode(general.address.country);
  const address = {
    "@type": "PostalAddress",
    ...(general.address.line.trim() ? { streetAddress: general.address.line.trim() } : {}),
    ...(general.address.district.trim() ? { addressLocality: general.address.district.trim() } : {}),
    ...(general.address.city.trim() ? { addressRegion: general.address.city.trim() } : {}),
    ...(addressCountry ? { addressCountry } : {}),
  };
  const sameAs = [
    ...new Set(
      Object.values(general.social ?? {})
        .map((value) => httpsUrl(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const logoOk = logo && (logo.width == null || logo.width >= MIN_LOGO_PX) && (logo.height == null || logo.height >= MIN_LOGO_PX);
  const languages = [...new Set(input.languages?.length ? input.languages : (["tr", "en", "ar"] as const))].map(jsonLdLanguage);
  const returnsUrl = input.returnsPath ? absoluteUrl(input.returnsPath) : null;

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "OnlineStore",
    "@id": ORG_ID(),
    name,
    ...(legalName && legalName !== name ? { legalName } : {}),
    url: absoluteUrl(href(locale, "home")),
    ...(logoOk ? { logo: absoluteLink(logo.url) } : {}),
    ...(description ? { description } : {}),
    ...(telephone ? { telephone } : {}),
    ...(email ? { email } : {}),
    ...(Object.keys(address).length > 1 ? { address } : {}),
    ...(general.taxNumber.trim() ? { taxID: general.taxNumber.trim() } : {}),
    ...(telephone || email
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer service",
            ...(telephone ? { telephone } : {}),
            ...(email ? { email } : {}),
            areaServed: SHOP_COUNTRY,
            availableLanguage: languages,
          },
        }
      : {}),
    ...(sameAs.length ? { sameAs } : {}),
    hasMerchantReturnPolicy: merchantReturnPolicyJsonLd(seo.returns, returnsUrl),
  };
}

export type WebSiteJsonLdInput = {
  locale: Locale;
  general: Settings<"general">;
  seo: Settings<"seo">;
  /** The enabled languages (settings.locales.enabled) for inLanguage; default tr, en, ar. */
  languages?: readonly Locale[];
};

/**
 * The site (one entity on every locale); its publisher is the Organization (by @id). No SearchAction:
 * the site has no search page. Google reads the site name from the WebSite on the domain's home page and
 * does not support site names for subdirectories, so `url` is the domain root (`/`, which redirects to
 * /tr where this markup is printed) on /tr, /en and /ar alike, and inLanguage lists every enabled language.
 */
export function webSiteJsonLd(input: WebSiteJsonLdInput): JsonLdDocument {
  const { general, locale, seo } = input;
  const description = localize(seo.description, locale);
  const languages = [...new Set(input.languages?.length ? input.languages : (["tr", "en", "ar"] as const))].map(jsonLdLanguage);
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebSite",
    "@id": WEBSITE_ID(),
    name: general.siteName,
    url: `${trimOrigin(siteOrigin())}/`,
    inLanguage: languages.length === 1 ? languages[0] : languages,
    ...(description ? { description } : {}),
    publisher: { "@id": ORG_ID() } satisfies JsonLdRef,
  };
}

// ---------------------------------------------------------------------------------------------------
// Product page (<ProductStructuredData />)

export type ProductJsonLdInput = {
  product: ProductDetail;
  locale: Locale;
  /** The approved reviews the page shows (`loadProductReviewBlock(id).data`); null = none or reviews off. */
  reviews: ProductReviewsData | null;
  /** settings.general (brand and seller name). */
  general: Settings<"general">;
  /** settings.shipping: offers.shippingDetails for one unit of each variant. */
  shipping: Settings<"shipping">;
  /** settings.seo (kept for the signature; the return policy lives on the Organization). */
  seo: Settings<"seo">;
  /** ISO end of the product's running campaign (offers.priceValidUntil); null/absent = no end date. */
  campaignEndsAt?: string | null;
};

/** At most this many reviews go into the markup (the newest ones the page shows). */
export const MAX_JSONLD_REVIEWS = 5;
const MAX_PRODUCT_IMAGES = 6;
const MAX_VARIANT_IMAGES = 5;

/** `productGroupID` of a product (also what the merchant feed should send as `g:item_group_id`). */
export function productGroupId(product: Pick<ProductDetail, "id">): string {
  return `PRD-${product.id}`;
}

/** A barcode that is a valid EAN-13 (check digit included), else null: only those go out as gtin13. */
export function validGtin13(barcode: string | null | undefined): string | null {
  return barcode && isValidEan13(barcode.trim()) ? barcode.trim() : null;
}

type ShippingRules = Pick<Settings<"shipping">, "flatFee" | "freeThreshold" | "heavy">;

const nonNegativeInt = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

/**
 * What the cart charges for shipping when the order is exactly one unit of a variant (kuruş): the
 * money engine's rules (src/lib/cart/compute.ts, step 4) with no coupon: the flat fee unless the unit
 * price reaches the free-shipping threshold, plus the heavy-parcel surcharge per started kilogram above
 * the weight threshold (that one applies even when shipping is free). A unit test pins it to computeCart.
 */
export function oneUnitShippingFee(unitPrice: number, weightGrams: number | null | undefined, rules: ShippingRules): number {
  const threshold = nonNegativeInt(rules.freeThreshold);
  const free = threshold > 0 && nonNegativeInt(unitPrice) >= threshold;
  const flat = free ? 0 : nonNegativeInt(rules.flatFee);
  const weight = nonNegativeInt(weightGrams);
  const heavyThreshold = nonNegativeInt(rules.heavy?.thresholdGrams);
  const heavyKg = rules.heavy?.enabled && weight > heavyThreshold ? Math.ceil((weight - heavyThreshold) / 1000) : 0;
  return flat + heavyKg * nonNegativeInt(rules.heavy?.feePerKg);
}

/** OfferShippingDetails to Türkiye for one unit (rate from the cart's rules; handling time from settings). */
export function offerShippingDetails(unitPrice: number, weightGrams: number | null | undefined, shipping: Settings<"shipping">): JsonLdNode {
  const fee = oneUnitShippingFee(unitPrice, weightGrams, shipping);
  const min = shipping.estimatedDays?.min;
  const max = shipping.estimatedDays?.max;
  const handling = Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min && max > 0;
  return {
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: kurusToDecimal(fee), currency: SHOP_CURRENCY },
    shippingDestination: { "@type": "DefinedRegion", addressCountry: SHOP_COUNTRY },
    ...(handling
      ? {
          deliveryTime: {
            "@type": "ShippingDeliveryTime",
            handlingTime: { "@type": "QuantitativeValue", minValue: min, maxValue: max, unitCode: "DAY" },
          },
        }
      : {}),
  };
}

const TIME_ZONE = "Europe/Istanbul";

/** YYYY-MM-DD of an ISO timestamp in Istanbul time (review dates as the page shows them). */
function istanbulDate(iso: string): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE }).format(date);
}

/** aggregateRating + up to MAX_JSONLD_REVIEWS reviews, exactly what the page's review section shows. */
export function reviewProperties(reviews: ProductReviewsData | null): Record<string, unknown> {
  if (!reviews || reviews.summary.count <= 0) return {};
  const items = reviews.reviews.slice(0, MAX_JSONLD_REVIEWS).filter((r) => r.authorName.trim() && r.rating >= 1 && r.rating <= 5);
  return {
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: Number((reviews.summary.average / 100).toFixed(1)),
      reviewCount: reviews.summary.count,
      ratingCount: reviews.summary.count,
      bestRating: 5,
      worstRating: 1,
    },
    ...(items.length ? { review: items.map(reviewJsonLd) } : {}),
  };
}

function reviewJsonLd(review: PublicReview): JsonLdNode {
  const date = istanbulDate(review.createdAt);
  return {
    "@type": "Review",
    author: { "@type": "Person", name: review.authorName.trim() },
    ...(date ? { datePublished: date } : {}),
    inLanguage: reviewLang(review.locale),
    ...(review.title ? { name: review.title } : {}),
    ...(review.body ? { reviewBody: review.body } : {}),
    reviewRating: { "@type": "Rating", ratingValue: review.rating, bestRating: 5, worstRating: 1 },
  };
}

/** "Lavanta — Sıvı El Sabunu": the name and type line, as the product page and the listings show them. */
function productName(product: Pick<ProductDetail, "name" | "subtitle">, locale: Locale): string {
  return [localize(product.name, locale), localize(product.subtitle, locale)].filter(Boolean).join(" — ");
}

/** The variant's size as the variant picker shows it ("5 L Bidon"), else its volume ("5 L"). */
function variantSize(product: ProductDetail, variant: ProductVariantData, locale: Locale): string | null {
  const labels = product.options
    .map((option) => option.values.find((value) => variant.optionValueIds.includes(value.id)))
    .map((value) => (value ? localize(value.value, locale) : ""))
    .filter(Boolean);
  return labels.length ? labels.join(" / ") : formatVolume(variant.volumeMl, intlLocale(locale));
}

const uniqueUrls = (media: readonly MediaLike[], max: number): string[] => [...new Set(media.map((m) => absoluteLink(m.url)))].slice(0, max);

/** Variant images first, then the images every variant shares (gallery order). */
function variantImages(product: ProductDetail, variant: ProductVariantData): string[] {
  const own = product.media.filter((m) => m.variantId === variant.id).map((m) => m.media);
  const shared = product.media.filter((m) => m.variantId == null).map((m) => m.media);
  const urls = uniqueUrls([...own, ...shared], MAX_VARIANT_IMAGES);
  return urls.length ? urls : uniqueUrls(product.media.map((m) => m.media), MAX_VARIANT_IMAGES);
}

function availability(variant: ProductVariantData): string {
  return stockStatus(variant) === "out" ? SCHEMA("OutOfStock") : SCHEMA("InStock");
}

/** A valid future ISO timestamp, or null. */
function validUntil(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * A ProductGroup (productGroupID, variesBy size, hasVariant: one Product per sellable variant with its
 * size, sku, gtin13 when valid, images, `?varyant=` url and Offer) when the product has several sellable
 * variants, else one Product with its Offer. Offers: the campaign-aware retail price the page shows,
 * TRY, availability, NewCondition, priceValidUntil (campaign end), shippingDetails for one unit. Ratings
 * and up to five reviews go on the group (or the single Product). Null when nothing can be sold and
 * nobody has reviewed it.
 */
export function productGroupJsonLd(input: ProductJsonLdInput): JsonLdDocument | null {
  const { product, locale, reviews, general, shipping } = input;
  const pageUrl = absoluteUrl(href(locale, "product", { slug: product.slug }));
  const name = productName(product, locale);
  const description = localize(product.shortDescription, locale);
  const brand = { "@type": "Brand", name: general.siteName };
  const category = product.category ? localize(product.category.name, locale) : "";
  const percent = product.campaign?.percent ?? null;
  const priceValidUntil = product.campaign ? validUntil(input.campaignEndsAt) : null;
  const groupId = productGroupId(product);

  const offerFor = (variant: ProductVariantData, url: string) => {
    const unitPrice = campaignDisplayPrice(variant, percent).unitPrice;
    return {
      "@type": "Offer",
      url,
      price: kurusToDecimal(unitPrice),
      priceCurrency: SHOP_CURRENCY,
      availability: availability(variant),
      itemCondition: SCHEMA("NewCondition"),
      ...(priceValidUntil ? { priceValidUntil } : {}),
      shippingDetails: offerShippingDetails(unitPrice, variant.weightGrams, shipping),
      seller: { "@type": "Organization", "@id": ORG_ID(), name: general.siteName },
    };
  };

  // Merchant listings need a price above zero: a free variant is not an offer.
  const sellable = product.type === "sample" ? [] : product.variants.filter((v) => campaignDisplayPrice(v, percent).unitPrice > 0);
  const ratings = reviewProperties(reviews);
  if (sellable.length === 0 && !("aggregateRating" in ratings)) return null;

  const common = {
    ...(description ? { description } : {}),
    brand,
    ...(category ? { category } : {}),
  };

  if (sellable.length <= 1) {
    const variant = sellable[0];
    const size = variant ? variantSize(product, variant, locale) : null;
    const gtin13 = variant ? validGtin13(variant.barcode) : null;
    const images = variant ? variantImages(product, variant) : uniqueUrls(product.media.map((m) => m.media), MAX_PRODUCT_IMAGES);
    return {
      "@context": SCHEMA_CONTEXT,
      "@type": "Product",
      "@id": `${pageUrl}#product`,
      name,
      url: pageUrl,
      ...(images.length ? { image: images } : {}),
      ...common,
      ...(variant ? { sku: variant.sku } : {}),
      ...(gtin13 ? { gtin13 } : {}),
      ...(size && product.options.length ? { size } : {}),
      ...ratings,
      ...(variant ? { offers: offerFor(variant, pageUrl) } : {}),
    };
  }

  const images = uniqueUrls(product.media.map((m) => m.media), MAX_PRODUCT_IMAGES);
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "ProductGroup",
    "@id": `${pageUrl}#product`,
    name,
    url: pageUrl,
    ...(images.length ? { image: images } : {}),
    ...common,
    productGroupID: groupId,
    variesBy: [SCHEMA("size")],
    ...ratings,
    hasVariant: sellable.map((variant) => {
      const size = variantSize(product, variant, locale);
      const gtin13 = validGtin13(variant.barcode);
      const url = variantUrl(locale, product.slug, variant.id);
      const images = variantImages(product, variant);
      return {
        "@type": "Product",
        name: size ? `${name} (${size})` : `${name} (${variant.sku})`,
        // Recommended on each variant too (Google's variant example repeats it); the size is in the name.
        ...(description ? { description } : {}),
        sku: variant.sku,
        ...(gtin13 ? { gtin13 } : {}),
        ...(images.length ? { image: images } : {}),
        ...(size ? { size } : {}),
        brand,
        inProductGroupWithID: groupId,
        url,
        offers: offerFor(variant, url),
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Product videos (<ProductStructuredData />, day 6)
//
// Google Search Central, "Video (VideoObject) structured data" (checked 2026-11-12): required name,
// thumbnailUrl and uploadDate (ISO 8601, with a time zone); recommended description, contentUrl (the
// file itself, not the page) or embedUrl, and duration (ISO 8601). Several videos on one page each get
// their own VideoObject. Each one is its own top-level document (one per <script>, like every builder
// here); the audit counts distinct videos as distinct entities, not as a duplicated type. The Product
// output of productGroupJsonLd is unchanged: videos never become Product images.

export type ProductVideosJsonLdInput = {
  product: Pick<ProductDetail, "slug" | "name" | "subtitle" | "shortDescription" | "seo" | "videos">;
  locale: Locale;
  /** The word for a video in the page language (messages.product.video): names a video that has no description. */
  videoLabel: string;
  /** `@id` of the Product/ProductGroup node printed on the page, if any: each video is `about` it. */
  productNodeId?: string | null;
};

/** ISO 8601 duration of a length in ms (rounded to seconds): 42_000 → "PT42S", 75_000 → "PT1M15S", 3_725_000 → "PT1H2M5S"; null when unknown or 0. */
export function isoDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const total = Math.round(ms / 1000);
  if (total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s ? `${s}S` : ""}`;
}

/**
 * The title of a product video in `locale` (VideoObject name, video sitemap title): the video's own
 * description in that language, else "<Video>: <product phrase>", numbered ("Video 2: …") when the
 * product has several videos.
 */
export function productVideoName(
  product: Pick<ProductDetail, "name" | "subtitle" | "seo">,
  video: { alt: ProductVideoAlt },
  position: { index: number; count: number },
  locale: Locale,
  videoLabel: string,
): string {
  const own = ownLocaleText(video.alt, locale);
  if (own) return own;
  const label = videoLabel.trim() || "Video";
  const phrase = productPhrase({ name: product.name, subtitle: product.subtitle, seoTitle: product.seo?.title }, locale);
  return `${position.count > 1 ? `${label} ${position.index + 1}` : label}: ${phrase}`;
}

type ProductVideoAlt = NonNullable<ProductDetail["videos"]>[number]["alt"];

/**
 * One VideoObject per product video the page shows (ProductDetail.videos, gallery order): name =
 * productVideoName, description = the product's short description (else the name), thumbnailUrl = the
 * cover image, uploadDate, contentUrl, duration, inLanguage, `about` the product node. [] without videos.
 */
export function productVideosJsonLd(input: ProductVideosJsonLdInput): JsonLdDocument[] {
  const { product, locale, videoLabel } = input;
  const videos = product.videos ?? [];
  if (videos.length === 0) return [];
  const pageUrl = absoluteUrl(href(locale, "product", { slug: product.slug }));
  const summary = localize(product.shortDescription, locale).trim();
  return videos.map((video, i) => {
    const name = productVideoName(product, video, { index: i, count: videos.length }, locale, videoLabel);
    const duration = isoDuration(video.durationMs);
    return {
      "@context": SCHEMA_CONTEXT,
      "@type": "VideoObject",
      "@id": `${pageUrl}#video-${video.id}`,
      name,
      description: summary || name,
      thumbnailUrl: [absoluteLink(video.poster.url)],
      uploadDate: video.uploadedAt,
      contentUrl: absoluteLink(video.url),
      ...(duration ? { duration } : {}),
      inLanguage: jsonLdLanguage(locale),
      ...(input.productNodeId ? { about: { "@id": input.productNodeId } satisfies JsonLdRef } : {}),
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Listings: category pages and /urunler (<CategoryStructuredData />, <ProductsIndexStructuredData />)

export type CollectionPageJsonLdInput = {
  locale: Locale;
  /** The page name as shown (its H1). */
  name: string;
  description?: string | null;
  /** Public path of the page: href(locale, "category", { slug }) or href(locale, "products"). */
  path: string;
  /** The products in grid order. */
  products: readonly ProductCardData[];
};

/** A CollectionPage (part of the WebSite) whose mainEntity is the ItemList of the products shown (position, url, name). */
export function collectionPageJsonLd(input: CollectionPageJsonLdInput): JsonLdDocument {
  const { locale, name, path, products } = input;
  const description = input.description?.trim();
  const url = absoluteUrl(path);
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "CollectionPage",
    "@id": url,
    name,
    ...(description ? { description } : {}),
    url,
    inLanguage: jsonLdLanguage(locale),
    isPartOf: { "@id": WEBSITE_ID() } satisfies JsonLdRef,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: products.length,
      itemListElement: products.map((product, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: absoluteUrl(href(locale, "product", { slug: product.slug })),
        name: productName(product, locale),
      })),
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Blog post (<BlogPostingStructuredData />)

export type BlogPostingJsonLdInput = {
  post: PostDetail;
  locale: Locale;
  general: Settings<"general">;
  /** The light logo (publisher logo), or null. */
  logo: MediaLike | null;
};

/**
 * Language of blog_posts.tags: a plain text[] (not localized) written in Turkish, the default language
 * (scripts/seed-data/blog.ts, the panel's tag field).
 */
export const POST_TAGS_LOCALE: Locale = "tr";

/** The post's tags as keywords for `locale` (BlogPosting keywords, article:tag): only on the page in the tags' own language. */
export function postKeywords(post: Pick<PostDetail, "tags">, locale: Locale): string[] {
  return locale === POST_TAGS_LOCALE ? post.tags.map((t) => t.trim()).filter(Boolean) : [];
}

/** True when the byline names the shop itself ("PRESTİJ"): the author is then the Organization. */
function isShopName(authorName: string, siteName: string, legalName: string): boolean {
  const fold = (s: string) => s.trim().toLocaleLowerCase("tr-TR");
  const author = fold(authorName);
  return author === fold(siteName) || author === fold(legalName);
}

/**
 * A BlogPosting: headline, description, image, datePublished/dateModified (ISO 8601 with time zone),
 * inLanguage, author (the Organization by @id when the byline is the shop or empty, else the Person),
 * publisher (the Organization by @id, with its logo), mainEntityOfPage, url, keywords (Turkish tags,
 * so on the Turkish page only), timeRequired. dateModified is PostDetail.updatedAt, which is never
 * before the publish date (src/lib/data/blog.ts).
 */
export function blogPostingJsonLd(input: BlogPostingJsonLdInput): JsonLdDocument {
  const { post, locale, general, logo } = input;
  const title = localize(post.title, locale);
  const excerpt = localize(post.excerpt, locale);
  const url = absoluteUrl(href(locale, "post", { slug: post.slug }));
  const organization = {
    "@type": "Organization",
    "@id": ORG_ID(),
    name: general.siteName,
    url: absoluteUrl(href(locale, "home")),
  };
  const author = post.authorName?.trim();
  const keywords = postKeywords(post, locale);
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    headline: title,
    ...(excerpt ? { description: excerpt } : {}),
    ...(post.cover ? { image: [absoluteLink(post.cover.url)] } : {}),
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    inLanguage: jsonLdLanguage(locale),
    author: author && !isShopName(author, general.siteName, general.legalName) ? { "@type": "Person", name: author } : organization,
    publisher: {
      ...organization,
      ...(logo ? { logo: { "@type": "ImageObject", url: absoluteLink(logo.url) } } : {}),
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    isPartOf: { "@id": WEBSITE_ID() } satisfies JsonLdRef,
    ...(keywords.length ? { keywords: keywords.join(", ") } : {}),
    ...(post.readingMinutes ? { timeRequired: `PT${post.readingMinutes}M` } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// FAQ

export type FaqItemText = { question: string; answer: string };

/**
 * FAQPage for already-localized questions and answers (items with an empty question or answer are
 * dropped; null when none is left). Same shape the Faq section prints today
 * (src/components/sections/Faq.tsx keeps its own copy for now).
 */
export function faqPageJsonLd(items: readonly FaqItemText[]): JsonLdDocument | null {
  const kept = items.map((item) => ({ q: item.question.trim(), a: item.answer.trim() })).filter((item) => item.q && item.a);
  if (kept.length === 0) return null;
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "FAQPage",
    mainEntity: kept.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}
