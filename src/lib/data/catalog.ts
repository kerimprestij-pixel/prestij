// Cached catalog reads for the storefront. Everything returned is plain JSON (no Dates, no class
// instances) so it can be passed to client components. Prices are retail; business prices are
// resolved per user at request time, never in here.
//
// Day 6 (videos): `ProductDetail.media` and every card image stay images only (`imageOnly()`), so each
// image consumer (cards, JSON-LD image, merchant feed, og fallback, …) keeps working unchanged. Product
// videos come separately in `ProductDetail.videos`, each with its cover image and its slot in the
// owner's gallery order, so the gallery can interleave them (productGalleryImages).
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import type { CategoryFaqItem, LocalizedText, ProductMediaRole, ProductType, ScentNotes, SeoFields } from "@/db/schema";
import { getActiveCampaigns, type ActiveCampaigns } from "@/lib/campaigns/active";
import { pickDisplayCampaign } from "@/lib/campaigns/pick";
import { TAGS } from "@/lib/cache-tags";
import { isVideoMedia, type MediaLike } from "@/lib/media/types";
import type { Tx } from "@/lib/panel/tx";
import { imageOnly, mediaColumns, normalizeIds } from "./media";

const { products: p, productVariants: v, categories: c } = schema;

/**
 * The retail campaign running for a product (never a customer-group one: static pages are not
 * personalised). Prices in the card/detail stay regular; show them with campaignDisplayPrice.
 */
export type CampaignBadge = { id: number; percent: number; label: LocalizedText | null };

export type ProductCardData = {
  id: number;
  slug: string;
  type: ProductType;
  name: LocalizedText;
  subtitle: LocalizedText | null;
  /** The product's SEO title: the Arabic card image alt takes its noun phrase from it (productPhrase). */
  seoTitle: LocalizedText | null;
  shortDescription: LocalizedText | null;
  accentColor: string | null;
  categoryId: number | null;
  isFeatured: boolean;
  /** Lowest / highest active variant price in kuruş (null when no active variant). */
  minPrice: number | null;
  maxPrice: number | null;
  /** Struck-through price of the cheapest variant, when it has one. */
  compareAtPrice: number | null;
  defaultVariantId: number | null;
  variantCount: number;
  image: MediaLike | null;
  hoverImage: MediaLike | null;
  /** x100, e.g. 470 = 4.70 */
  ratingAverage: number;
  ratingCount: number;
  campaign: CampaignBadge | null;
};

/** A card as the cached query builds it, before the (separately cached) campaigns are attached. */
type BaseCard = Omit<ProductCardData, "campaign">;

export type CategoryData = {
  id: number;
  slug: string;
  name: LocalizedText;
  description: LocalizedText | null;
  /** Editorial text below the grid: panel HTML per locale. Sanitize before rendering (sanitizeHtml). */
  body: LocalizedText | null;
  /** FAQ items (well-formed ones only; [] when none). Answers may hold the Faq section's HTML subset. */
  faq: CategoryFaqItem[];
  parentId: number | null;
  accentColor: string | null;
  image: MediaLike | null;
  seo: SeoFields | null;
  /** Active, listable (non-sample, non-business-only) products directly in this category. */
  productCount: number;
};

export type ProductOptionData = {
  id: number;
  name: LocalizedText;
  display: "buttons" | "swatches" | "select";
  values: { id: number; value: LocalizedText; swatchColor: string | null; swatchMediaId: number | null }[];
};

export type ProductVariantData = {
  id: number;
  sku: string;
  barcode: string | null;
  price: number;
  compareAtPrice: number | null;
  vatRate: number;
  stock: number;
  trackStock: boolean;
  allowBackorder: boolean;
  lowStockThreshold: number;
  volumeMl: number | null;
  weightGrams: number | null;
  minQuantity: number;
  maxQuantity: number | null;
  imageId: number | null;
  isDefault: boolean;
  optionValueIds: number[];
};

export type ProductMediaData = { media: MediaLike; variantId: number | null; role: ProductMediaRole };

/** Day 6: a product video (a `media` row of kind "video" in the product's gallery). Plain JSON. */
export type ProductVideoData = {
  /** The video's media id. */
  id: number;
  /** Public URL of the file (mp4/webm). */
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** product_media.autoplay: a muted loop when shown; otherwise a play button and native controls. */
  autoplay: boolean;
  /** The video's description (media.alt): accessible name, VideoObject name/description. */
  alt: LocalizedText | null;
  /** ISO time of the upload (media.created_at): VideoObject uploadDate, video sitemap publication date. */
  uploadedAt: string;
  /** The cover image (an image row): the slide's picture and thumbnail, VideoObject thumbnailUrl. */
  poster: MediaLike;
  /** Set when the video belongs to one variant. */
  variantId: number | null;
  /** Its index in the gallery order (images and shown videos together, product_media position order). */
  slot: number;
};

export type BundleItemData = {
  variantId: number;
  quantity: number;
  productId: number;
  productSlug: string;
  productName: LocalizedText;
  productSubtitle: LocalizedText | null;
  accentColor: string | null;
  sku: string;
  volumeMl: number | null;
};

export type TierData = { variantId: number | null; minQuantity: number; discountPercent: number };

export type ProductDetail = {
  id: number;
  slug: string;
  type: ProductType;
  name: LocalizedText;
  subtitle: LocalizedText | null;
  shortDescription: LocalizedText | null;
  description: LocalizedText | null;
  accentColor: string | null;
  themeOverrides: { tint?: string; dark?: string } | null;
  scentNotes: ScentNotes | null;
  usage: LocalizedText | null;
  warnings: LocalizedText | null;
  ingredients: string | null;
  claims: string[];
  specs: { label: LocalizedText; value: LocalizedText }[];
  seo: SeoFields | null;
  isFeatured: boolean;
  businessOnly: boolean;
  allowSubscription: boolean;
  ratingAverage: number;
  ratingCount: number;
  /** The product's own category id (what campaigns and coupons match on). */
  categoryId: number | null;
  category: { id: number; slug: string; name: LocalizedText } | null;
  options: ProductOptionData[];
  variants: ProductVariantData[];
  defaultVariantId: number | null;
  /** Every product image in display order; `variantId` set when it belongs to one variant. Images only (day 6). */
  media: ProductMediaData[];
  /**
   * Day 6: the product's videos (with a cover image) in gallery order; `slot` places each among `media`.
   * Optional so older literals stay valid; getProduct always sets it ([] when none).
   */
  videos?: ProductVideoData[];
  /** Retail volume tiers (no customer group). */
  tiers: TierData[];
  bundleItems: BundleItemData[];
  related: ProductCardData[];
  /** Slug of the free sample product ("<slug>-numune") when one is active. */
  sampleProductSlug: string | null;
  /** Retail campaign for every variant (campaigns are per product/category, not per variant). */
  campaign: CampaignBadge | null;
};

type BaseDetail = Omit<ProductDetail, "campaign" | "related"> & { related: BaseCard[] };

export type ListProductsOptions = {
  categorySlug?: string;
  featured?: boolean;
  includeTypes?: ProductType[];
  /** Restrict to these product ids (order of the result is still by position). */
  ids?: number[];
};

const LISTABLE_TYPES: ProductType[] = ["standard", "bundle"];

// ---------------------------------------------------------------------------------------------
// Public cached functions

/** Every visible category in position order, with its body, FAQ and product count (cached). */
export async function listCategories(): Promise<CategoryData[]> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.categories, TAGS.products, TAGS.media);
  return queryCategories();
}

/**
 * The uncached query behind `listCategories` (DB tests read the categories through it, because
 * `cacheLife` only works inside Next; `executor` lets them pass a transaction). Pages and components
 * always call `listCategories`.
 */
export async function queryCategories(executor: Tx = db): Promise<CategoryData[]> {
  const [rows, counts] = await Promise.all([
    executor
      .select({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        body: c.body,
        faq: c.faq,
        parentId: c.parentId,
        accentColor: c.accentColor,
        imageId: c.imageId,
        seo: c.seo,
      })
      .from(c)
      .where(eq(c.isVisible, true))
      .orderBy(asc(c.position), asc(c.id)),
    executor
      .select({ categoryId: p.categoryId })
      .from(p)
      .where(and(eq(p.status, "active"), inArray(p.type, LISTABLE_TYPES), eq(p.businessOnly, false))),
  ]);

  const countBy = new Map<number, number>();
  for (const r of counts) if (r.categoryId != null) countBy.set(r.categoryId, (countBy.get(r.categoryId) ?? 0) + 1);
  const images = await loadMediaMap(
    rows.map((r) => r.imageId),
    executor,
  );

  return rows.map(({ imageId, body, faq, ...r }) => ({
    ...r,
    body: body ?? null,
    faq: wellFormedFaq(faq),
    image: imageId != null ? (images.get(imageId) ?? null) : null,
    productCount: countBy.get(r.id) ?? 0,
  }));
}

const isLocalizedText = (value: unknown): value is LocalizedText =>
  value != null && typeof value === "object" && !Array.isArray(value) && typeof (value as { tr?: unknown }).tr === "string";

/** FAQ items with a localized question and answer; anything malformed in the jsonb is dropped, never thrown. */
function wellFormedFaq(value: unknown): CategoryFaqItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is CategoryFaqItem => item != null && typeof item === "object" && isLocalizedText(item.question) && isLocalizedText(item.answer))
    .map((item) => ({ question: item.question, answer: item.answer }));
}

export async function listProducts(options: ListProductsOptions = {}): Promise<ProductCardData[]> {
  // Normalize so equivalent calls share one cache entry.
  const normalized = {
    categorySlug: options.categorySlug ?? null,
    featured: options.featured ?? false,
    includeTypes: [...new Set(options.includeTypes ?? LISTABLE_TYPES)].sort(),
    ids: options.ids ? normalizeIds(options.ids) : null,
  };
  if (normalized.ids && normalized.ids.length === 0) return [];
  const [cards, active] = await Promise.all([listProductsCached(normalized), getActiveCampaigns()]);
  return cards.map((card) => withCampaign(card, active));
}

/**
 * An active product by slug, with its retail campaign. Not cached itself: it joins two cached reads
 * (the product, tag `products`; the campaigns, tag `campaigns` with a schedule-aware lifetime), so a
 * campaign change never has to re-read the product and the page stays static.
 */
export async function getProduct(slug: string): Promise<ProductDetail | null> {
  const [product, active] = await Promise.all([getProductBase(slug), getActiveCampaigns()]);
  if (!product) return null;
  return {
    ...product,
    campaign: campaignFor(product, product.categoryId, active),
    related: product.related.map((card) => withCampaign(card, active)),
  };
}

function campaignFor(product: { id: number }, categoryId: number | null, active: ActiveCampaigns): CampaignBadge | null {
  const hit = pickDisplayCampaign(active.campaigns, { productId: product.id, categoryId }, active.asOf);
  return hit ? { id: hit.id, percent: hit.percent, label: hit.label } : null;
}

function withCampaign(card: BaseCard, active: ActiveCampaigns): ProductCardData {
  return { ...card, campaign: campaignFor(card, card.categoryId, active) };
}

async function getProductBase(slug: string): Promise<BaseDetail | null> {
  "use cache";
  cacheLife("max");
  // Categories too: the page shows the category's name and links to its slug.
  cacheTag(TAGS.products, TAGS.product(slug), TAGS.categories, TAGS.media);

  const [row] = await db
    .select({
      id: p.id,
      slug: p.slug,
      type: p.type,
      name: p.name,
      subtitle: p.subtitle,
      shortDescription: p.shortDescription,
      description: p.description,
      categoryId: p.categoryId,
      accentColor: p.accentColor,
      themeOverrides: p.themeOverrides,
      scentNotes: p.scentNotes,
      usage: p.usage,
      warnings: p.warnings,
      ingredients: p.ingredients,
      claims: p.claims,
      specs: p.specs,
      seo: p.seo,
      isFeatured: p.isFeatured,
      businessOnly: p.businessOnly,
      allowSubscription: p.allowSubscription,
      ratingAverage: p.ratingAverage,
      ratingCount: p.ratingCount,
    })
    .from(p)
    .where(and(eq(p.slug, slug), eq(p.status, "active")))
    .limit(1);
  if (!row) return null;

  const [category, options, variants, gallery, bundleItems, related, sample] = await Promise.all([
    row.categoryId != null
      ? db
          .select({ id: c.id, slug: c.slug, name: c.name })
          .from(c)
          .where(eq(c.id, row.categoryId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    loadOptions(row.id),
    loadVariants([row.id]),
    loadProductGallery(row.id),
    row.type === "bundle" ? loadBundleItems(row.id) : Promise.resolve([]),
    loadRelated(row.id, row.categoryId),
    db
      .select({ slug: p.slug })
      .from(p)
      .where(and(eq(p.slug, `${slug}-numune`), eq(p.status, "active"), eq(p.type, "sample")))
      .limit(1)
      .then((r) => r[0]?.slug ?? null),
  ]);

  const tiers = await loadTiers(
    row.id,
    variants.map((x) => x.id),
  );

  // Variant images that are not linked through product_media still belong in the gallery (after every
  // product_media item, so the videos' slots stay right).
  const { media, videos } = gallery;
  const known = new Set(media.map((m) => m.media.id));
  const extraIds = variants.map((x) => x.imageId).filter((id): id is number => id != null && !known.has(id));
  if (extraIds.length) {
    const extra = await loadMediaMap(extraIds);
    for (const x of variants) {
      const m = x.imageId != null && !known.has(x.imageId) ? extra.get(x.imageId) : undefined;
      if (m) {
        media.push({ media: m, variantId: x.id, role: "packshot" });
        known.add(m.id);
      }
    }
  }

  return {
    ...row,
    claims: row.claims ?? [],
    specs: row.specs ?? [],
    category,
    options,
    variants,
    defaultVariantId: pickDefaultVariant(variants)?.id ?? null,
    media,
    videos,
    tiers,
    bundleItems,
    related,
    sampleProductSlug: sample,
  };
}

/** Slugs of every active, listable product (for generateStaticParams). */
export async function listProductSlugs(): Promise<string[]> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.products);
  const rows = await db
    .select({ slug: p.slug })
    .from(p)
    .where(and(eq(p.status, "active"), inArray(p.type, LISTABLE_TYPES)))
    .orderBy(asc(p.position), asc(p.id));
  return rows.map((r) => r.slug);
}

// ---------------------------------------------------------------------------------------------
// Internals (uncached; called from the cached functions above)

type NormalizedListOptions = {
  categorySlug: string | null;
  featured: boolean;
  includeTypes: ProductType[];
  ids: number[] | null;
};

// Next registers every "use cache" function as a server reference that anyone can call with any
// arguments, so the cached reads never trust theirs: only listable types, never business-only products.
async function listProductsCached(opts: NormalizedListOptions): Promise<BaseCard[]> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.products, TAGS.categories, TAGS.media);
  const includeTypes = (Array.isArray(opts?.includeTypes) ? opts.includeTypes : []).filter((t) => LISTABLE_TYPES.includes(t));
  if (includeTypes.length === 0) return [];
  return queryCards({ ...opts, includeTypes });
}

/**
 * Product cards for the given options (uncached; listProductsCached and the related products call it).
 * Exported with an executor so DB tests can check it in a rolled-back transaction. Card images are
 * images only (day 6): a product video never becomes a card or hover image.
 */
export async function queryCards(opts: NormalizedListOptions, executor: Tx = db): Promise<BaseCard[]> {
  const conds = [eq(p.status, "active"), inArray(p.type, opts.includeTypes), eq(p.businessOnly, false)];
  if (opts.featured) conds.push(eq(p.isFeatured, true));
  if (opts.ids) conds.push(inArray(p.id, opts.ids));
  if (opts.categorySlug) {
    const [cat] = await executor.select({ id: c.id }).from(c).where(eq(c.slug, opts.categorySlug)).limit(1);
    if (!cat) return [];
    const children = await executor.select({ id: c.id }).from(c).where(eq(c.parentId, cat.id));
    conds.push(inArray(p.categoryId, [cat.id, ...children.map((x) => x.id)]));
  }

  const rows = await executor
    .select({
      id: p.id,
      slug: p.slug,
      type: p.type,
      name: p.name,
      subtitle: p.subtitle,
      seo: p.seo,
      shortDescription: p.shortDescription,
      accentColor: p.accentColor,
      categoryId: p.categoryId,
      isFeatured: p.isFeatured,
      ratingAverage: p.ratingAverage,
      ratingCount: p.ratingCount,
    })
    .from(p)
    .where(and(...conds))
    .orderBy(asc(p.position), asc(p.id));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [variants, media] = await Promise.all([loadVariantsWithProduct(ids, executor), loadProductMedia(ids, executor)]);
  const variantImageIds = variants.map((x) => x.imageId).filter((id): id is number => id != null);
  const variantImages = await loadMediaMap(variantImageIds, executor);

  return rows.map(({ seo, ...r }) => {
    const own = variants.filter((x) => x.productId === r.id);
    const def = pickDefaultVariant(own);
    const prices = own.map((x) => x.price);
    const cheapest = own.reduce<(typeof own)[number] | null>((m, x) => (!m || x.price < m.price ? x : m), null);
    const { image, hoverImage } = pickCardImages(
      media.filter((m) => m.productId === r.id),
      def,
      def?.imageId != null ? (variantImages.get(def.imageId) ?? null) : null,
    );
    return {
      ...r,
      seoTitle: seo?.title ?? null,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      compareAtPrice: cheapest?.compareAtPrice && cheapest.compareAtPrice > cheapest.price ? cheapest.compareAtPrice : null,
      defaultVariantId: def?.id ?? null,
      variantCount: own.length,
      image,
      hoverImage,
    };
  });
}

function pickDefaultVariant<T extends { isDefault: boolean }>(variants: T[]): T | null {
  return variants.find((x) => x.isDefault) ?? variants[0] ?? null;
}

function pickCardImages(
  media: (ProductMediaData & { productId: number })[],
  defaultVariant: { id: number } | null,
  variantImage: MediaLike | null,
): { image: MediaLike | null; hoverImage: MediaLike | null } {
  // The loaders return images only; the filter keeps a video out even if one slipped through.
  const images = media.filter((m) => !isVideoMedia(m.media));
  const shared = images.filter((m) => m.variantId == null || m.variantId === defaultVariant?.id);
  const pool = shared.length ? shared : images;
  const primary =
    (variantImage && !isVideoMedia(variantImage) ? variantImage : null) ??
    (pool.find((m) => m.role === "packshot") ?? pool.find((m) => m.role === "gallery") ?? pool[0])?.media ??
    null;
  const rest = pool.filter((m) => m.media.id !== primary?.id);
  const hover = (rest.find((m) => m.role === "lifestyle") ?? rest[0])?.media ?? null;
  return { image: primary, hoverImage: hover };
}

/** Image rows by id (category images, variant images, video covers); a video id is never returned. */
async function loadMediaMap(ids: (number | null)[], executor: Tx = db): Promise<Map<number, MediaLike>> {
  const wanted = normalizeIds(ids.filter((x): x is number => x != null));
  if (wanted.length === 0) return new Map();
  const rows = await executor
    .select(mediaColumns)
    .from(schema.media)
    .where(and(inArray(schema.media.id, wanted), imageOnly()));
  return new Map(rows.map((r) => [r.id, r]));
}

/** The images of the given products in gallery order (cards and their hover images). Images only. */
export async function loadProductMedia(productIds: number[], executor: Tx = db): Promise<(ProductMediaData & { productId: number })[]> {
  const pm = schema.productMedia;
  const rows = await executor
    .select({ productId: pm.productId, variantId: pm.variantId, role: pm.role, media: mediaColumns })
    .from(pm)
    .innerJoin(schema.media, eq(pm.mediaId, schema.media.id))
    .where(and(inArray(pm.productId, productIds), imageOnly()))
    .orderBy(asc(pm.productId), asc(pm.position), asc(pm.id));
  return rows;
}

/**
 * Day 6: the product page gallery. `media` = the images (what loadProductMedia returns for the product),
 * `videos` = the video rows that have a cover image, each with its `slot` among the shown items in
 * product_media order. A video without a usable cover is left out: the slide, the thumbnail, the
 * VideoObject and the video sitemap entry all need one (the product save refuses such a video).
 */
export async function loadProductGallery(productId: number, executor: Tx = db): Promise<{ media: ProductMediaData[]; videos: ProductVideoData[] }> {
  const pm = schema.productMedia;
  const m = schema.media;
  const rows = await executor
    .select({
      variantId: pm.variantId,
      role: pm.role,
      autoplay: pm.autoplay,
      media: mediaColumns,
      durationMs: m.durationMs,
      posterId: m.posterId,
      createdAt: m.createdAt,
    })
    .from(pm)
    .innerJoin(m, eq(pm.mediaId, m.id))
    .where(eq(pm.productId, productId))
    .orderBy(asc(pm.position), asc(pm.id));
  const posters = await loadMediaMap(
    rows.filter((r) => isVideoMedia(r.media)).map((r) => r.posterId),
    executor,
  );

  const media: ProductMediaData[] = [];
  const videos: ProductVideoData[] = [];
  let slot = 0;
  for (const r of rows) {
    if (!isVideoMedia(r.media)) {
      media.push({ media: r.media, variantId: r.variantId, role: r.role });
      slot += 1;
      continue;
    }
    const poster = r.posterId != null ? posters.get(r.posterId) : undefined;
    if (!poster) continue;
    videos.push({
      id: r.media.id,
      url: r.media.url,
      mime: r.media.mime,
      width: r.media.width,
      height: r.media.height,
      durationMs: r.durationMs,
      autoplay: r.autoplay,
      alt: r.media.alt,
      uploadedAt: r.createdAt.toISOString(),
      poster,
      variantId: r.variantId,
      slot,
    });
    slot += 1;
  }
  return { media, videos };
}

const variantColumns = {
  id: v.id,
  productId: v.productId,
  sku: v.sku,
  barcode: v.barcode,
  price: v.price,
  compareAtPrice: v.compareAtPrice,
  vatRate: v.vatRate,
  stock: v.stock,
  trackStock: v.trackStock,
  allowBackorder: v.allowBackorder,
  lowStockThreshold: v.lowStockThreshold,
  volumeMl: v.volumeMl,
  weightGrams: v.weightGrams,
  minQuantity: v.minQuantity,
  maxQuantity: v.maxQuantity,
  imageId: v.imageId,
  isDefault: v.isDefault,
} as const;

async function loadVariantsWithProduct(productIds: number[], executor: Tx = db) {
  return executor
    .select(variantColumns)
    .from(v)
    .where(and(inArray(v.productId, productIds), eq(v.isActive, true)))
    .orderBy(asc(v.productId), asc(v.position), asc(v.id));
}

async function loadVariants(productIds: number[]): Promise<ProductVariantData[]> {
  const rows = await loadVariantsWithProduct(productIds);
  if (rows.length === 0) return [];
  const links = await db
    .select({ variantId: schema.variantOptionValues.variantId, optionValueId: schema.variantOptionValues.optionValueId })
    .from(schema.variantOptionValues)
    .where(
      inArray(
        schema.variantOptionValues.variantId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => ({
    ...r,
    optionValueIds: links
      .filter((l) => l.variantId === r.id)
      .map((l) => l.optionValueId)
      .sort((a, b) => a - b),
  }));
}

async function loadOptions(productId: number): Promise<ProductOptionData[]> {
  const { productOptions: o, productOptionValues: ov } = schema;
  const opts = await db
    .select({ id: o.id, name: o.name, display: o.display })
    .from(o)
    .where(eq(o.productId, productId))
    .orderBy(asc(o.position), asc(o.id));
  if (opts.length === 0) return [];
  const values = await db
    .select({
      id: ov.id,
      optionId: ov.optionId,
      value: ov.value,
      swatchColor: ov.swatchColor,
      swatchMediaId: ov.swatchMediaId,
    })
    .from(ov)
    .where(
      inArray(
        ov.optionId,
        opts.map((x) => x.id),
      ),
    )
    .orderBy(asc(ov.position), asc(ov.id));
  return opts.map((opt) => ({
    ...opt,
    values: values.filter((val) => val.optionId === opt.id).map((val) => ({ id: val.id, value: val.value, swatchColor: val.swatchColor, swatchMediaId: val.swatchMediaId })),
  }));
}

async function loadTiers(productId: number, variantIds: number[]): Promise<TierData[]> {
  const t = schema.tierPrices;
  const scope = variantIds.length ? or(eq(t.productId, productId), inArray(t.variantId, variantIds)) : eq(t.productId, productId);
  const rows = await db
    .select({ variantId: t.variantId, minQuantity: t.minQuantity, discountPercent: t.discountPercent })
    .from(t)
    .where(and(scope, isNull(t.groupId)))
    .orderBy(asc(t.minQuantity));
  return rows;
}

async function loadBundleItems(bundleProductId: number): Promise<BundleItemData[]> {
  const b = schema.bundleItems;
  return db
    .select({
      variantId: b.variantId,
      quantity: b.quantity,
      productId: p.id,
      productSlug: p.slug,
      productName: p.name,
      productSubtitle: p.subtitle,
      accentColor: p.accentColor,
      sku: v.sku,
      volumeMl: v.volumeMl,
    })
    .from(b)
    .innerJoin(v, eq(b.variantId, v.id))
    .innerJoin(p, eq(v.productId, p.id))
    .where(eq(b.bundleProductId, bundleProductId))
    .orderBy(asc(b.position), asc(b.id));
}

const RELATED_LIMIT = 4;

async function loadRelated(productId: number, categoryId: number | null): Promise<BaseCard[]> {
  const r = schema.productRelations;
  const links = await db
    .select({ id: r.relatedProductId })
    .from(r)
    .where(and(eq(r.productId, productId), eq(r.kind, "related")))
    .orderBy(asc(r.position));

  const base: NormalizedListOptions = {
    categorySlug: null,
    featured: false,
    includeTypes: LISTABLE_TYPES,
    ids: null,
  };

  if (links.length) {
    const cards = await queryCards({ ...base, ids: links.map((l) => l.id) });
    const order = new Map(links.map((l, i) => [l.id, i]));
    return cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).slice(0, RELATED_LIMIT);
  }

  // No curated relations: same category first, then the rest of the catalog.
  const others = await db
    .select({ id: p.id, categoryId: p.categoryId })
    .from(p)
    .where(and(eq(p.status, "active"), inArray(p.type, LISTABLE_TYPES), eq(p.businessOnly, false), ne(p.id, productId)))
    .orderBy(asc(p.position), asc(p.id));
  const ranked = [
    ...others.filter((o) => categoryId != null && o.categoryId === categoryId),
    ...others.filter((o) => categoryId == null || o.categoryId !== categoryId),
  ].slice(0, RELATED_LIMIT);
  if (ranked.length === 0) return [];
  const cards = await queryCards({ ...base, ids: ranked.map((o) => o.id) });
  const order = new Map(ranked.map((o, i) => [o.id, i]));
  return cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
