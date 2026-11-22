import "server-only";
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import { imageOnly, mediaColumns } from "@/lib/data/media";
import type { MediaLike } from "@/lib/media/types";
import { loadCoupon } from "@/lib/coupons/validate";
import type { DbExecutor } from "./settings";
import type { CouponData, CustomerContext, EngineCampaign, EngineLine, EngineSubscriptionPlan, EngineTier } from "./types";

const { carts, cartItems, productVariants: v, products: p } = schema;

/** Display data for a cart line (not used by the engine). */
export type LineDisplay = {
  productSlug: string;
  name: LocalizedText;
  subtitle: LocalizedText | null;
  accentColor: string | null;
  sku: string;
  barcode: string | null;
  /** Option value labels in option order, e.g. [{ tr: "5 L Bidon", en: "5 L Canister" }]. */
  variantLabels: LocalizedText[];
  image: MediaLike | null;
  volumeMl: number | null;
  lowStockThreshold: number;
};

export type LoadedLine = EngineLine & { display: LineDisplay };

export type SampleOffer = {
  variantId: number;
  productId: number;
  productSlug: string;
  name: LocalizedText;
  subtitle: LocalizedText | null;
  accentColor: string | null;
  image: MediaLike | null;
  inStock: boolean;
};

export type CartRow = { id: string; couponCode: string | null; locale: string; expiresAt: Date | null };

export type LoadedCart = {
  /** null when the cookie names no live cart (none, expired or deleted). */
  cart: CartRow | null;
  /** The pricing context the cart was loaded for. */
  customer: CustomerContext;
  lines: LoadedLine[];
  coupon: CouponData | null;
  campaigns: EngineCampaign[];
  /** Active sample products (only with `withSamples`). */
  sampleOffers: SampleOffer[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export type LoadCartOptions = {
  executor?: DbExecutor;
  /** Also load the sample products on offer (cart views). */
  withSamples?: boolean;
  now?: Date;
};

/** The cart row if it exists and has not expired. */
export async function findCart(cartId: string | null | undefined, executor: DbExecutor = db, now = new Date()): Promise<CartRow | null> {
  if (!isUuid(cartId)) return null;
  const [row] = await executor
    .select({ id: carts.id, couponCode: carts.couponCode, locale: carts.locale, expiresAt: carts.expiresAt })
    .from(carts)
    .where(and(eq(carts.id, cartId), or(isNull(carts.expiresAt), gt(carts.expiresAt, now))))
    .limit(1);
  return row ?? null;
}

/**
 * Reads a cart with everything the engine and the view need in a fixed number of queries (cart,
 * lines, then option labels / group prices / tiers / campaigns / media / coupon / samples in parallel).
 */
export async function loadCart(cartId: string | null | undefined, customer: CustomerContext, options: LoadCartOptions = {}): Promise<LoadedCart> {
  const executor = options.executor ?? db;
  const now = options.now ?? new Date();
  const cart = await findCart(cartId, executor, now);
  const samplesPromise: Promise<SampleOffer[]> = options.withSamples ? loadSampleOffers(executor) : Promise.resolve([]);
  if (!cart) return { cart: null, customer, lines: [], coupon: null, campaigns: [], sampleOffers: await samplesPromise };

  const rows = await executor
    .select({
      lineId: cartItems.id,
      variantId: cartItems.variantId,
      quantity: cartItems.quantity,
      subscriptionPlanId: cartItems.subscriptionPlanId,
      ...lineColumns,
    })
    .from(cartItems)
    .innerJoin(v, eq(v.id, cartItems.variantId))
    .innerJoin(p, eq(p.id, v.productId))
    .where(eq(cartItems.cartId, cart.id))
    .orderBy(asc(cartItems.addedAt), asc(cartItems.id));

  const [lines, campaigns, coupon, sampleOffers] = await Promise.all([
    buildLines(executor, rows, customer),
    rows.length ? loadCampaigns(executor) : Promise.resolve([]),
    cart.couponCode ? loadCoupon(cart.couponCode, executor) : Promise.resolve(null),
    samplesPromise,
  ]);
  return { cart, customer, lines, coupon, campaigns, sampleOffers };
}

/** Product and variant columns every line needs (cart lines and subscription renewals). */
const lineColumns = {
  productId: p.id,
  productSlug: p.slug,
  productType: p.type,
  productStatus: p.status,
  categoryId: p.categoryId,
  businessOnly: p.businessOnly,
  name: p.name,
  subtitle: p.subtitle,
  accentColor: p.accentColor,
  sku: v.sku,
  barcode: v.barcode,
  basePrice: v.price,
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
  variantActive: v.isActive,
  allowSubscription: p.allowSubscription,
};

type LineRow = {
  lineId: number;
  variantId: number;
  quantity: number;
  subscriptionPlanId: number | null;
  productId: number;
  productSlug: string;
  productType: EngineLine["productType"];
  productStatus: EngineLine["productStatus"];
  categoryId: number | null;
  businessOnly: boolean;
  name: LocalizedText;
  subtitle: LocalizedText | null;
  accentColor: string | null;
  sku: string;
  barcode: string | null;
  basePrice: number;
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
  variantActive: boolean;
  allowSubscription: boolean;
};

/**
 * Lines for given variants outside a cart (subscription renewals): the same engine and display data
 * as cart lines, with `lineId` = position (1, 2, …). Unknown variant ids are left out.
 */
export async function loadVariantLines(
  executor: DbExecutor,
  items: readonly { variantId: number; quantity: number; subscriptionPlanId?: number | null }[],
  customer: CustomerContext,
): Promise<LoadedLine[]> {
  const ids = [...new Set(items.map((i) => i.variantId))];
  if (ids.length === 0) return [];
  const found = await executor
    .select({ variantId: v.id, ...lineColumns })
    .from(v)
    .innerJoin(p, eq(p.id, v.productId))
    .where(inArray(v.id, ids));
  const byId = new Map(found.map((r) => [r.variantId, r]));
  const rows: LineRow[] = items.flatMap((item, index) => {
    const r = byId.get(item.variantId);
    return r ? [{ ...r, lineId: index + 1, quantity: item.quantity, subscriptionPlanId: item.subscriptionPlanId ?? null }] : [];
  });
  return buildLines(executor, rows, customer);
}

async function buildLines(executor: DbExecutor, rows: LineRow[], customer: CustomerContext): Promise<LoadedLine[]> {
  if (rows.length === 0) return [];
  const variantIds = rows.map((r) => r.variantId);
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const planIds = [...new Set(rows.map((r) => r.subscriptionPlanId).filter((id): id is number => id != null))];
  const [labels, groupPrices, tiers, images, plans] = await Promise.all([
    loadVariantLabels(executor, variantIds),
    loadGroupPrices(executor, variantIds, customer.groupId),
    loadTiers(executor, variantIds, productIds, customer.groupId),
    loadLineImages(
      executor,
      rows.map((r) => ({ productId: r.productId, variantId: r.variantId, imageId: r.imageId })),
    ),
    loadActivePlans(executor, planIds),
  ]);

  return rows.map((r) => ({
    lineId: r.lineId,
    variantId: r.variantId,
    productId: r.productId,
    categoryId: r.categoryId,
    productType: r.productType,
    productStatus: r.productStatus,
    variantActive: r.variantActive,
    businessOnly: r.businessOnly,
    quantity: r.quantity,
    basePrice: r.basePrice,
    compareAtPrice: r.compareAtPrice,
    groupPrice: groupPrices.get(r.variantId) ?? null,
    tiers: tiers
      .filter((t) => t.variantId === r.variantId || (t.variantId == null && t.productId === r.productId))
      .map(({ minQuantity, discountPercent, groupId }) => ({ minQuantity, discountPercent, groupId })),
    vatRate: r.vatRate,
    weightGrams: r.weightGrams,
    stock: r.stock,
    trackStock: r.trackStock,
    allowBackorder: r.allowBackorder,
    minQuantity: r.minQuantity,
    maxQuantity: r.maxQuantity,
    subscriptionPlanId: r.subscriptionPlanId,
    // Usable only while the plan is active and the product still offers subscriptions.
    subscriptionPlan: r.subscriptionPlanId != null && r.allowSubscription ? (plans.get(r.subscriptionPlanId) ?? null) : null,
    display: {
      productSlug: r.productSlug,
      name: r.name,
      subtitle: r.subtitle,
      accentColor: r.accentColor,
      sku: r.sku,
      barcode: r.barcode,
      variantLabels: labels.get(r.variantId) ?? [],
      image: images.get(r.variantId) ?? null,
      volumeMl: r.volumeMl,
      lowStockThreshold: r.lowStockThreshold,
    },
  }));
}

/** Active subscription plans by id (inactive plans are left out: their lines become one-time). */
async function loadActivePlans(executor: DbExecutor, ids: number[]): Promise<Map<number, EngineSubscriptionPlan>> {
  if (ids.length === 0) return new Map();
  const sp = schema.subscriptionPlans;
  const rows = await executor
    .select({ id: sp.id, name: sp.name, percent: sp.discountPercent, interval: sp.interval, intervalCount: sp.intervalCount })
    .from(sp)
    .where(and(inArray(sp.id, ids), eq(sp.isActive, true)));
  return new Map(rows.map((r) => [r.id, r]));
}

// ---------------------------------------------------------------------------------------------

async function loadVariantLabels(executor: DbExecutor, variantIds: number[]): Promise<Map<number, LocalizedText[]>> {
  const out = new Map<number, LocalizedText[]>();
  if (variantIds.length === 0) return out;
  const { variantOptionValues: vov, productOptionValues: ov, productOptions: o } = schema;
  const rows = await executor
    .select({ variantId: vov.variantId, value: ov.value })
    .from(vov)
    .innerJoin(ov, eq(ov.id, vov.optionValueId))
    .innerJoin(o, eq(o.id, ov.optionId))
    .where(inArray(vov.variantId, variantIds))
    .orderBy(asc(vov.variantId), asc(o.position), asc(o.id));
  for (const r of rows) {
    const list = out.get(r.variantId) ?? [];
    list.push(r.value);
    out.set(r.variantId, list);
  }
  return out;
}

async function loadGroupPrices(executor: DbExecutor, variantIds: number[], groupId: number | null): Promise<Map<number, number>> {
  if (groupId == null || variantIds.length === 0) return new Map();
  const g = schema.groupPrices;
  const rows = await executor
    .select({ variantId: g.variantId, price: g.price })
    .from(g)
    .where(and(eq(g.groupId, groupId), inArray(g.variantId, variantIds)));
  return new Map(rows.map((r) => [r.variantId, r.price]));
}

async function loadTiers(
  executor: DbExecutor,
  variantIds: number[],
  productIds: number[],
  groupId: number | null,
): Promise<(EngineTier & { variantId: number | null; productId: number | null })[]> {
  if (variantIds.length === 0) return [];
  const t = schema.tierPrices;
  return executor
    .select({ variantId: t.variantId, productId: t.productId, groupId: t.groupId, minQuantity: t.minQuantity, discountPercent: t.discountPercent })
    .from(t)
    .where(
      and(
        or(inArray(t.variantId, variantIds), inArray(t.productId, productIds)),
        groupId == null ? isNull(t.groupId) : or(isNull(t.groupId), eq(t.groupId, groupId)),
      ),
    );
}

/** Active campaigns; the engine applies the time window with `now`. */
export async function loadCampaigns(executor: DbExecutor): Promise<EngineCampaign[]> {
  const c = schema.campaigns;
  const rows = await executor
    .select({
      id: c.id,
      percent: c.discountPercent,
      priority: c.priority,
      productIds: c.productIds,
      categoryIds: c.categoryIds,
      customerGroupIds: c.customerGroupIds,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
    })
    .from(c)
    .where(eq(c.isActive, true));
  return rows;
}

/**
 * Variant image, else the product's first packshot/gallery image. Images only (day 6, VIDEO-STORE): a
 * product video never becomes a cart thumbnail or an order snapshot image (snapshots are permanent).
 */
async function loadLineImages(
  executor: DbExecutor,
  lines: { productId: number; variantId: number; imageId: number | null }[],
): Promise<Map<number, MediaLike>> {
  const out = new Map<number, MediaLike>();
  if (lines.length === 0) return out;
  const direct = [...new Set(lines.map((l) => l.imageId).filter((id): id is number => id != null))];
  const missing = [...new Set(lines.filter((l) => l.imageId == null).map((l) => l.productId))];
  const pm = schema.productMedia;
  const [mediaRows, productMedia] = await Promise.all([
    direct.length ? executor.select(mediaColumns).from(schema.media).where(and(inArray(schema.media.id, direct), imageOnly())) : Promise.resolve([]),
    missing.length
      ? executor
          .select({ productId: pm.productId, variantId: pm.variantId, role: pm.role, media: mediaColumns })
          .from(pm)
          .innerJoin(schema.media, eq(schema.media.id, pm.mediaId))
          .where(and(inArray(pm.productId, missing), imageOnly()))
          .orderBy(asc(pm.productId), asc(pm.position), asc(pm.id))
      : Promise.resolve([]),
  ]);
  const byId = new Map(mediaRows.map((m) => [m.id, m]));
  for (const l of lines) {
    if (l.imageId != null && byId.has(l.imageId)) {
      out.set(l.variantId, byId.get(l.imageId)!);
      continue;
    }
    const own = productMedia.filter((m) => m.productId === l.productId && (m.variantId == null || m.variantId === l.variantId));
    const pick = own.find((m) => m.role === "packshot") ?? own.find((m) => m.role === "gallery") ?? own[0];
    if (pick) out.set(l.variantId, pick.media);
  }
  return out;
}

/** Active sample products with their (default) active variant and image. */
export async function loadSampleOffers(executor: DbExecutor = db): Promise<SampleOffer[]> {
  const rows = await executor
    .select({
      variantId: v.id,
      productId: p.id,
      productSlug: p.slug,
      name: p.name,
      subtitle: p.subtitle,
      accentColor: p.accentColor,
      imageId: v.imageId,
      stock: v.stock,
      trackStock: v.trackStock,
      allowBackorder: v.allowBackorder,
      isDefault: v.isDefault,
    })
    .from(p)
    .innerJoin(v, and(eq(v.productId, p.id), eq(v.isActive, true)))
    .where(and(eq(p.type, "sample"), eq(p.status, "active")))
    .orderBy(asc(p.position), asc(p.id), asc(v.position), asc(v.id));
  // One offer per product: its default variant, else the first.
  const chosen = new Map<number, (typeof rows)[number]>();
  for (const r of rows) {
    const current = chosen.get(r.productId);
    if (!current || (!current.isDefault && r.isDefault)) chosen.set(r.productId, r);
  }
  const offers = [...chosen.values()];
  const images = await loadLineImages(
    executor,
    offers.map((o) => ({ productId: o.productId, variantId: o.variantId, imageId: o.imageId })),
  );
  return offers.map((o) => ({
    variantId: o.variantId,
    productId: o.productId,
    productSlug: o.productSlug,
    name: o.name,
    subtitle: o.subtitle,
    accentColor: o.accentColor,
    image: images.get(o.variantId) ?? null,
    inStock: !o.trackStock || o.allowBackorder || o.stock > 0,
  }));
}
