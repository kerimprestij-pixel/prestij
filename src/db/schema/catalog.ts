// Catalog: categories, products, options (packaging, size, scent, bottle type), variants (the
// sellable SKUs with price/stock/barcode), media links, bundles (gift sets), B2B prices,
// volume tiers, subscription plans and reviews.
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { id, timestamps, type Kurus, type LocalizedText, type SeoFields } from "./common";
import { media } from "./site";

/** One question of a category page's FAQ (day 5). Answers use the Faq section's rich-text subset. */
export type CategoryFaqItem = { question: LocalizedText; answer: LocalizedText };

export const categories = pgTable(
  "categories",
  {
    id: id(),
    slug: text().notNull().unique(),
    name: jsonb().$type<LocalizedText>().notNull(),
    description: jsonb().$type<LocalizedText>(),
    /** Editorial text below the product grid: sanitized HTML subset per locale, same rules as blog bodies (day 5). */
    body: jsonb().$type<LocalizedText>(),
    /** Questions and answers on the category page (FAQ section + FAQPage JSON-LD); [] = none (day 5). */
    faq: jsonb().$type<CategoryFaqItem[]>().notNull().default([]),
    parentId: integer(),
    imageId: integer().references(() => media.id, { onDelete: "set null" }),
    accentColor: text(),
    position: integer().notNull().default(0),
    isVisible: boolean().notNull().default(true),
    seo: jsonb().$type<SeoFields>(),
    ...timestamps,
  },
  (t) => [index().on(t.parentId, t.position)],
).enableRLS();

export type ProductType = "standard" | "bundle" | "sample";
export type ProductStatus = "draft" | "active" | "archived";
/** Claim badges shown on product pages; the icon + label for each key live in the UI. */
export type ClaimKey = "effective_cleaning" | "skin_caring" | "fresh_scent" | "soft_feel" | string;
export type ScentNotes = { top?: LocalizedText; heart?: LocalizedText; base?: LocalizedText };

export const products = pgTable(
  "products",
  {
    id: id(),
    slug: text().notNull().unique(),
    type: text().$type<ProductType>().notNull().default("standard"),
    status: text().$type<ProductStatus>().notNull().default("draft"),
    name: jsonb().$type<LocalizedText>().notNull(), // "Lavanta Latte"
    subtitle: jsonb().$type<LocalizedText>(), // "Sıvı El Sabunu"
    shortDescription: jsonb().$type<LocalizedText>(),
    description: jsonb().$type<LocalizedText>(), // rich text (HTML subset) per locale
    categoryId: integer().references(() => categories.id, { onDelete: "set null" }),
    /** Product color. The product page, buttons and highlights take this color (per-product theming). */
    accentColor: text(),
    /** Optional fine-tuning of the per-product theme (e.g. a softer background tint). */
    themeOverrides: jsonb().$type<{ tint?: string; dark?: string }>(),
    scentNotes: jsonb().$type<ScentNotes>(),
    usage: jsonb().$type<LocalizedText>(),
    warnings: jsonb().$type<LocalizedText>(),
    /** INCI ingredient list exactly as on the label (not translated). */
    ingredients: text(),
    claims: jsonb().$type<ClaimKey[]>().default([]),
    /** Free-form spec rows, e.g. [{label:{tr:"Menşei"}, value:{tr:"Türkiye"}}]. */
    specs: jsonb().$type<{ label: LocalizedText; value: LocalizedText }[]>().default([]),
    seo: jsonb().$type<SeoFields>(),
    isFeatured: boolean().notNull().default(false),
    /** Hidden from retail customers; visible to approved business accounts only. */
    businessOnly: boolean().notNull().default(false),
    allowSubscription: boolean().notNull().default(false),
    position: integer().notNull().default(0),
    ratingAverage: integer().notNull().default(0), // x100, e.g. 470 = 4.70
    ratingCount: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [index().on(t.status, t.position), index().on(t.categoryId)],
).enableRLS();

/** An option axis of a product, e.g. "Ambalaj" (Pompalı şişe / 5 L / 20 L) or "Şişe" (Cam / Seramik). */
export const productOptions = pgTable(
  "product_options",
  {
    id: id(),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: jsonb().$type<LocalizedText>().notNull(),
    display: text().$type<"buttons" | "swatches" | "select">().notNull().default("buttons"),
    position: integer().notNull().default(0),
  },
  (t) => [index().on(t.productId)],
).enableRLS();

export const productOptionValues = pgTable(
  "product_option_values",
  {
    id: id(),
    optionId: integer()
      .notNull()
      .references(() => productOptions.id, { onDelete: "cascade" }),
    value: jsonb().$type<LocalizedText>().notNull(),
    /** Color hex or media id for swatch display. */
    swatchColor: text(),
    swatchMediaId: integer().references(() => media.id, { onDelete: "set null" }),
    position: integer().notNull().default(0),
  },
  (t) => [index().on(t.optionId)],
).enableRLS();

/** A sellable SKU: one combination of option values with its own price, stock and barcode. */
export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text().notNull().unique(),
    barcode: text(),
    price: integer().$type<Kurus>().notNull(),
    compareAtPrice: integer().$type<Kurus>(),
    costPrice: integer().$type<Kurus>(),
    /** KDV rate in percent (cosmetics are usually 20). */
    vatRate: smallint().notNull().default(20),
    stock: integer().notNull().default(0),
    trackStock: boolean().notNull().default(true),
    allowBackorder: boolean().notNull().default(false),
    lowStockThreshold: integer().notNull().default(5),
    volumeMl: integer(),
    weightGrams: integer(), // shipping weight incl. packaging
    desi: integer(), // x10, e.g. 125 = 12.5 desi
    minQuantity: integer().notNull().default(1),
    maxQuantity: integer(),
    imageId: integer().references(() => media.id, { onDelete: "set null" }),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index().on(t.productId),
    index().on(t.barcode),
    // SKUs are unique case-insensitively ("ll-500" and "LL-500" are the same code).
    uniqueIndex("product_variants_sku_upper_unique").on(sql`upper(${t.sku})`),
    // A barcode (EAN) identifies one variant; empty means "none" (several variants may have none).
    uniqueIndex("product_variants_barcode_unique").on(t.barcode).where(sql`${t.barcode} is not null and ${t.barcode} <> ''`),
  ],
).enableRLS();

export const variantOptionValues = pgTable(
  "variant_option_values",
  {
    variantId: integer()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    optionValueId: integer()
      .notNull()
      .references(() => productOptionValues.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.optionValueId] })],
).enableRLS();

export type ProductMediaRole = "gallery" | "lifestyle" | "hero" | "packshot";

export const productMedia = pgTable(
  "product_media",
  {
    id: id(),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    mediaId: integer()
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    /** When set, the image belongs to one variant (e.g. the 5 L bidon). */
    variantId: integer().references(() => productVariants.id, { onDelete: "set null" }),
    role: text().$type<ProductMediaRole>().notNull().default("gallery"),
    position: integer().notNull().default(0),
    /** Day 6, video rows only: play muted, looped and inline when the slide is shown ("Otomatik oynat (sessiz)"). */
    autoplay: boolean().notNull().default(false),
  },
  (t) => [index().on(t.productId, t.position)],
).enableRLS();

/** Contents of a bundle product (gift set). */
export const bundleItems = pgTable(
  "bundle_items",
  {
    id: id(),
    bundleProductId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: integer()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: integer().notNull().default(1),
    position: integer().notNull().default(0),
  },
  (t) => [index().on(t.bundleProductId)],
).enableRLS();

/** Customer groups drive pricing: retail (default), business, hotel partners, etc. */
export const customerGroups = pgTable("customer_groups", {
  id: id(),
  slug: text().notNull().unique(),
  name: jsonb().$type<LocalizedText>().notNull(),
  isBusiness: boolean().notNull().default(false),
  /** Blanket discount applied when a variant has no explicit group price. */
  discountPercent: smallint().notNull().default(0),
  /** Prices shown without VAT for this group (common for B2B). */
  showPricesExVat: boolean().notNull().default(false),
  ...timestamps,
}).enableRLS();

/** Explicit price for a variant in a customer group (overrides the group discount). */
export const groupPrices = pgTable(
  "group_prices",
  {
    variantId: integer()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    groupId: integer()
      .notNull()
      .references(() => customerGroups.id, { onDelete: "cascade" }),
    price: integer().$type<Kurus>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.groupId] })],
).enableRLS();

/** Volume discounts: buy at least `minQuantity` and pay `discountPercent` less (optionally per group). */
export const tierPrices = pgTable(
  "tier_prices",
  {
    id: id(),
    variantId: integer().references(() => productVariants.id, { onDelete: "cascade" }),
    productId: integer().references(() => products.id, { onDelete: "cascade" }),
    groupId: integer().references(() => customerGroups.id, { onDelete: "cascade" }),
    minQuantity: integer().notNull(),
    discountPercent: smallint().notNull(),
  },
  (t) => [index().on(t.variantId), index().on(t.productId)],
).enableRLS();

/** Delivery rhythms customers can subscribe to, with an optional subscriber discount. */
export const subscriptionPlans = pgTable("subscription_plans", {
  id: id(),
  name: jsonb().$type<LocalizedText>().notNull(),
  interval: text().$type<"week" | "month">().notNull().default("month"),
  intervalCount: smallint().notNull().default(1),
  discountPercent: smallint().notNull().default(0),
  isActive: boolean().notNull().default(true),
  position: integer().notNull().default(0),
  ...timestamps,
}).enableRLS();

export type ReviewStatus = "pending" | "approved" | "rejected";

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text(),
    orderId: integer(),
    authorName: text().notNull(),
    rating: smallint().notNull(),
    title: text(),
    body: text(),
    locale: text().notNull().default("tr"),
    status: text().$type<ReviewStatus>().notNull().default("pending"),
    isVerifiedPurchase: boolean().notNull().default(false),
    adminReply: text(),
    approvedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index().on(t.productId, t.status),
    // One review per customer and product, and one per order line product (guest review links).
    uniqueIndex("reviews_product_user_unique").on(t.productId, t.userId).where(sql`${t.userId} is not null`),
    uniqueIndex("reviews_product_order_unique").on(t.productId, t.orderId).where(sql`${t.orderId} is not null`),
  ],
).enableRLS();

export const productRelations = pgTable(
  "product_relations",
  {
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    relatedProductId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: text().$type<"related" | "upsell" | "crosssell">().notNull().default("related"),
    position: integer().notNull().default(0),
  },
  (t) => [uniqueIndex().on(t.productId, t.relatedProductId, t.kind)],
).enableRLS();
