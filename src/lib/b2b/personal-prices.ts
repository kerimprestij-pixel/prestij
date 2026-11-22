// Personal (group) unit prices for the storefront's business price islands. Static product pages and
// cards only show retail prices; after hydration a signed-in buyer's island asks loadPersonalPrices()
// (src/lib/customer/price-actions.ts), which calls this.
//
// Parity: the prices come from computeCart, the cart's own engine, fed with one line per variant (at
// the variant's minimum quantity) built from the same tables loadCart reads (group prices, the buyer's
// and retail tiers, active campaigns). The buyer's line price is compared with the same line priced for
// RETAIL_CUSTOMER; only variants whose price differs are returned. So the island, the cart and the
// checkout show the same unit price. Money code is not changed here, only called.
import "server-only";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { computeCart } from "@/lib/cart/compute";
import { loadCommerceSettings, type CommerceSettings, type DbExecutor } from "@/lib/cart/settings";
import { RETAIL_CUSTOMER, type CustomerContext, type EngineCampaign, type EngineLine, type EngineSubscriptionPlan } from "@/lib/cart/types";

/** Variants (or products) one call may price; the islands batch everything on a page into one call. */
export const MAX_PERSONAL_PRICE_IDS = 120;

export type PersonalUnitPrice = {
  variantId: number;
  productId: number;
  /** What the cart charges this buyer per unit (VAT included, kuruş). */
  unitPrice: number;
  /** What the cart charges a retail buyer for the same line. */
  retailUnitPrice: number;
  vatRate: number;
  /**
   * Subscribe and save: what the cart charges this buyer per unit with each active plan (plan id →
   * kuruş, VAT included), for products that allow subscriptions while subscriptions are on. The plan
   * discount applies to the buyer's resolved price, so it differs from the retail figure the static
   * page shows.
   */
  subscriptionUnitPrices?: Record<number, number>;
};

type Options = { executor?: DbExecutor; now?: Date; settings?: CommerceSettings };

const { productVariants: v, products: p } = schema;

async function loadLines(executor: DbExecutor, where: ReturnType<typeof and>, customer: CustomerContext): Promise<PricedLine[]> {
  const rows = await executor
    .select({
      variantId: v.id,
      productId: p.id,
      categoryId: p.categoryId,
      productType: p.type,
      productStatus: p.status,
      variantActive: v.isActive,
      businessOnly: p.businessOnly,
      allowSubscription: p.allowSubscription,
      basePrice: v.price,
      compareAtPrice: v.compareAtPrice,
      vatRate: v.vatRate,
      weightGrams: v.weightGrams,
      stock: v.stock,
      trackStock: v.trackStock,
      allowBackorder: v.allowBackorder,
      minQuantity: v.minQuantity,
      maxQuantity: v.maxQuantity,
    })
    .from(v)
    .innerJoin(p, eq(p.id, v.productId))
    .where(where);
  if (rows.length === 0) return [];

  const variantIds = rows.map((r) => r.variantId);
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const gp = schema.groupPrices;
  const t = schema.tierPrices;
  const [groupPrices, tiers] = await Promise.all([
    customer.groupId == null
      ? Promise.resolve([] as { variantId: number; price: number }[])
      : executor.select({ variantId: gp.variantId, price: gp.price }).from(gp).where(and(eq(gp.groupId, customer.groupId), inArray(gp.variantId, variantIds))),
    executor
      .select({ variantId: t.variantId, productId: t.productId, groupId: t.groupId, minQuantity: t.minQuantity, discountPercent: t.discountPercent })
      .from(t)
      .where(
        and(
          or(inArray(t.variantId, variantIds), inArray(t.productId, productIds)),
          customer.groupId == null ? isNull(t.groupId) : or(isNull(t.groupId), eq(t.groupId, customer.groupId)),
        ),
      ),
  ]);
  const priceByVariant = new Map(groupPrices.map((r) => [r.variantId, r.price]));

  return rows.map((r, i) => ({
    allowSubscription: r.allowSubscription,
    lineId: i + 1,
    variantId: r.variantId,
    productId: r.productId,
    categoryId: r.categoryId,
    productType: r.productType,
    productStatus: r.productStatus,
    variantActive: r.variantActive,
    businessOnly: r.businessOnly,
    // One sellable unit as the product page offers it: the variant's minimum order quantity.
    quantity: Math.max(1, r.minQuantity ?? 1),
    basePrice: r.basePrice,
    compareAtPrice: r.compareAtPrice,
    groupPrice: priceByVariant.get(r.variantId) ?? null,
    tiers: tiers
      .filter((x) => x.variantId === r.variantId || (x.variantId == null && x.productId === r.productId))
      .map(({ minQuantity, discountPercent, groupId }) => ({ minQuantity, discountPercent, groupId })),
    vatRate: r.vatRate,
    weightGrams: r.weightGrams,
    stock: r.stock,
    trackStock: r.trackStock,
    allowBackorder: r.allowBackorder,
    minQuantity: r.minQuantity,
    maxQuantity: r.maxQuantity,
  }));
}

/** Active subscription plans (the engine applies one per line; inactive plans never price anything). */
async function loadActivePlans(executor: DbExecutor): Promise<EngineSubscriptionPlan[]> {
  const sp = schema.subscriptionPlans;
  return executor
    .select({ id: sp.id, percent: sp.discountPercent, interval: sp.interval, intervalCount: sp.intervalCount })
    .from(sp)
    .where(eq(sp.isActive, true));
}

async function loadActiveCampaigns(executor: DbExecutor): Promise<EngineCampaign[]> {
  const c = schema.campaigns;
  return executor
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
}

type PricedLine = EngineLine & { allowSubscription?: boolean };

/**
 * Prices `lines` for the buyer and for a retail buyer with the cart engine; returns one entry per line.
 * With `plans`, each line that may be subscribed is also priced for the buyer once per plan.
 */
function priceLines(
  lines: PricedLine[],
  customer: CustomerContext,
  campaigns: EngineCampaign[],
  settings: CommerceSettings,
  now: Date,
  plans: readonly EngineSubscriptionPlan[] = [],
): PersonalUnitPrice[] {
  if (lines.length === 0) return [];
  const engineSettings = { shipping: settings.shipping, payments: settings.payments, samples: settings.samples, subscriptions: settings.subscriptions };
  const run = (who: CustomerContext, input: EngineLine[] = lines) =>
    computeCart({ lines: input, customer: who, coupon: null, settings: engineSettings, campaigns, cardGatewayReady: true, now });
  const mine = run(customer);
  const retail = run({ ...RETAIL_CUSTOMER, userId: customer.userId });
  const retailByLine = new Map(retail.lines.map((l) => [l.lineId, l]));
  const subscribable = settings.subscriptions.enabled ? lines.filter((l) => l.allowSubscription) : [];
  const perPlan = subscribable.length
    ? plans.map((plan) => ({
        plan,
        byLine: new Map(run(customer, subscribable.map((l) => ({ ...l, subscriptionPlanId: plan.id, subscriptionPlan: plan }))).lines.map((l) => [l.lineId, l.unitPrice])),
      }))
    : [];
  const out: PersonalUnitPrice[] = [];
  for (const line of mine.lines) {
    const source = lines[line.lineId - 1];
    const base = retailByLine.get(line.lineId);
    if (!source || !base || line.isSample) continue;
    const subscriptionUnitPrices: Record<number, number> = {};
    for (const { plan, byLine } of perPlan) {
      const price = byLine.get(line.lineId);
      if (price != null) subscriptionUnitPrices[plan.id] = price;
    }
    out.push({
      variantId: line.variantId,
      productId: line.productId,
      unitPrice: line.unitPrice,
      retailUnitPrice: base.unitPrice,
      vatRate: line.vatRate,
      ...(Object.keys(subscriptionUnitPrices).length ? { subscriptionUnitPrices } : {}),
    });
  }
  return out;
}

const cleanIds = (ids: readonly number[]) => [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, MAX_PERSONAL_PRICE_IDS);

/**
 * The buyer's unit price per variant where it differs from the retail price (empty without a pricing
 * group: no group price, group discount, group tier or group campaign can apply then).
 */
export async function computePersonalPrices(customer: CustomerContext, variantIds: readonly number[], options: Options = {}): Promise<Map<number, PersonalUnitPrice>> {
  const ids = cleanIds(variantIds);
  if (customer.groupId == null || ids.length === 0) return new Map();
  const executor = options.executor ?? db;
  const [settings, campaigns, lines, plans] = await Promise.all([
    options.settings ? Promise.resolve(options.settings) : loadCommerceSettings(executor),
    loadActiveCampaigns(executor),
    loadLines(executor, and(inArray(v.id, ids), eq(v.isActive, true), eq(p.status, "active")), customer),
    loadActivePlans(executor),
  ]);
  const priced = priceLines(lines.filter((l) => l.productType !== "sample"), customer, campaigns, settings, options.now ?? new Date(), plans);
  return new Map(priced.filter((x) => x.unitPrice !== x.retailUnitPrice).map((x) => [x.variantId, x]));
}

/**
 * For product cards: the buyer's lowest unit price per product (over its active variants) where it
 * differs from the lowest retail price, plus whether the variants' personal prices differ (a range).
 */
export async function computePersonalCardPrices(
  customer: CustomerContext,
  productIds: readonly number[],
  options: Options = {},
): Promise<Map<number, { productId: number; minPrice: number; retailMinPrice: number; vatRate: number; hasRange: boolean }>> {
  const ids = cleanIds(productIds);
  if (customer.groupId == null || ids.length === 0) return new Map();
  const executor = options.executor ?? db;
  const [settings, campaigns, lines] = await Promise.all([
    options.settings ? Promise.resolve(options.settings) : loadCommerceSettings(executor),
    loadActiveCampaigns(executor),
    loadLines(executor, and(inArray(p.id, ids), eq(v.isActive, true), eq(p.status, "active")), customer),
  ]);
  const priced = priceLines(lines.filter((l) => l.productType !== "sample"), customer, campaigns, settings, options.now ?? new Date());
  const byProduct = new Map<number, PersonalUnitPrice[]>();
  for (const x of priced) byProduct.set(x.productId, [...(byProduct.get(x.productId) ?? []), x]);
  const out = new Map<number, { productId: number; minPrice: number; retailMinPrice: number; vatRate: number; hasRange: boolean }>();
  for (const [productId, list] of byProduct) {
    const cheapest = list.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a));
    const retailMin = Math.min(...list.map((x) => x.retailUnitPrice));
    if (cheapest.unitPrice === retailMin && list.every((x) => x.unitPrice === x.retailUnitPrice)) continue;
    out.set(productId, {
      productId,
      minPrice: cheapest.unitPrice,
      retailMinPrice: retailMin,
      vatRate: cheapest.vatRate,
      hasRange: list.some((x) => x.unitPrice !== cheapest.unitPrice),
    });
  }
  return out;
}

/** VAT-included kuruş → the net amount (rounded half up), for groups that see prices without VAT. */
export function withoutVat(grossKurus: number, vatRate: number): number {
  const rate = Number.isFinite(vatRate) ? Math.min(100, Math.max(0, Math.round(vatRate))) : 20;
  return Math.round((grossKurus * 100) / (100 + rate));
}
