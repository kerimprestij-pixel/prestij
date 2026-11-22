// Pure price resolution shared by the storefront (display) and checkout (authoritative recompute).
// Order: explicit group price OR group discount → best volume tier → campaign OR subscription plan
// discount (each step stacks multiplicatively; campaign and plan discount never stack: the larger
// percent wins, a tie goes to the plan). Every step rounds to whole kuruş and the price never drops below 0.
// Fails closed: a non-numeric quantity counts as 0 (no tier), an invalid base price throws.

export type TierDiscount = { minQuantity: number; discountPercent: number };

export type PriceInput = {
  /** Retail variant price in kuruş. */
  basePrice: number;
  /** Optional "was" price shown struck through (variant compareAtPrice). */
  compareAtPrice?: number | null;
  /** Explicit price for the customer's group; beats groupDiscountPercent. */
  groupPrice?: number | null;
  groupDiscountPercent?: number | null;
  tierDiscounts?: readonly TierDiscount[] | null;
  campaignPercent?: number | null;
  /** Subscribe-and-save plan discount. Never stacks with the campaign: the larger percent wins (tie: plan). */
  subscriptionPercent?: number | null;
  quantity: number;
};

export type AppliedRule =
  | { kind: "group_price"; price: number }
  | { kind: "group_discount"; percent: number }
  | { kind: "tier"; percent: number; minQuantity: number }
  | { kind: "campaign"; percent: number }
  | { kind: "subscription"; percent: number };

export type ResolvedPrice = {
  unitPrice: number;
  /** Reference price to show struck through, only when higher than unitPrice. */
  compareAt?: number;
  appliedRules: AppliedRule[];
};

const clampPercent = (p: number | null | undefined): number =>
  typeof p === "number" && Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;

// Multiply before dividing so integer percents stay exact (14990 × 85 / 100 = 12741.5 → 12742).
const applyPercent = (price: number, percent: number): number =>
  Math.max(0, Math.round((price * (100 - percent)) / 100));

/** Whole, non-negative quantity; NaN/Infinity/garbage become 0 so no volume tier applies. */
export function normalizeQuantity(quantity: unknown): number {
  return typeof quantity === "number" && Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
}

/** The highest discount among tiers whose minimum quantity is reached. */
export function bestTier(tiers: readonly TierDiscount[] | null | undefined, quantity: number): TierDiscount | null {
  let best: TierDiscount | null = null;
  for (const t of tiers ?? []) {
    // Written so NaN on either side never counts as "reached".
    if (!(quantity >= t.minQuantity)) continue;
    const percent = clampPercent(t.discountPercent);
    if (percent <= 0) continue;
    if (!best || percent > best.discountPercent || (percent === best.discountPercent && t.minQuantity > best.minQuantity)) {
      best = { minQuantity: t.minQuantity, discountPercent: percent };
    }
  }
  return best;
}

export function resolveUnitPrice(input: PriceInput): ResolvedPrice {
  if (typeof input.basePrice !== "number" || !Number.isFinite(input.basePrice) || input.basePrice < 0) {
    throw new RangeError(`Invalid basePrice: ${String(input.basePrice)}`);
  }
  const base = Math.round(input.basePrice);
  const rules: AppliedRule[] = [];
  let price = base;

  if (typeof input.groupPrice === "number" && Number.isFinite(input.groupPrice) && input.groupPrice >= 0) {
    price = Math.round(input.groupPrice);
    rules.push({ kind: "group_price", price });
  } else {
    const groupPercent = clampPercent(input.groupDiscountPercent);
    if (groupPercent > 0) {
      price = applyPercent(price, groupPercent);
      rules.push({ kind: "group_discount", percent: groupPercent });
    }
  }

  const tier = bestTier(input.tierDiscounts, normalizeQuantity(input.quantity));
  if (tier) {
    price = applyPercent(price, tier.discountPercent);
    rules.push({ kind: "tier", percent: tier.discountPercent, minQuantity: tier.minQuantity });
  }

  // Both percents apply to the same price, so the larger one is the lower price.
  const campaign = clampPercent(input.campaignPercent);
  const subscription = clampPercent(input.subscriptionPercent);
  if (subscription > 0 && subscription >= campaign) {
    price = applyPercent(price, subscription);
    rules.push({ kind: "subscription", percent: subscription });
  } else if (campaign > 0) {
    price = applyPercent(price, campaign);
    rules.push({ kind: "campaign", percent: campaign });
  }

  const compareAt = input.compareAtPrice;
  const reference = Math.max(base, typeof compareAt === "number" && Number.isFinite(compareAt) ? compareAt : 0);
  return reference > price ? { unitPrice: price, compareAt: reference, appliedRules: rules } : { unitPrice: price, appliedRules: rules };
}

/** Price per liter in kuruş (rounded), or null when the volume is unknown. */
export function perLiter(kurus: number, volumeMl: number | null | undefined): number | null {
  if (!volumeMl || volumeMl <= 0) return null;
  return Math.round((kurus * 1000) / volumeMl);
}
