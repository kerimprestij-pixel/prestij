// Which automatic campaign applies to a product, and what that does to the price. Shared by the
// money engine (src/lib/cart/compute.ts, authoritative) and the storefront display (cards, product
// page), so the price a visitor sees is the unit price the cart charges (tests/unit/campaign-*.test.ts).
// Pure: no DB, no clock (`now` is passed in), safe in client components.
//
// Semantics (unchanged from day 2):
// - live when startsAt ≤ now < endsAt (a missing bound is open);
// - a campaign with customer groups applies only to buyers in one of those groups;
// - no product and no category list = every product; otherwise the product id is listed OR the
//   product's own category id is listed (direct category only, sub-categories are not included);
// - the highest priority wins, then the highest percent; on a full tie the earlier one in the list.
//
// Rounding: the campaign step is applied by resolveUnitPrice (src/lib/pricing/resolve.ts), the single
// implementation of the price steps; campaignDisplayPrice calls it exactly like the cart does for a
// retail buyer, so both sides round the same way.
import { resolveUnitPrice, type ResolvedPrice } from "@/lib/pricing/resolve";

/** The fields of a campaign row the choice needs (EngineCampaign and StorefrontCampaign fit). */
export type CampaignRule = {
  percent: number;
  priority: number;
  productIds: readonly number[] | null;
  categoryIds: readonly number[] | null;
  customerGroupIds: readonly number[] | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

/** What a campaign is matched against: a product and its own (direct) category. */
export type CampaignTarget = { productId: number; categoryId: number | null };

export type CampaignContext = {
  /** The buyer's customer group (null = retail guest or a customer without a group). */
  groupId: number | null;
  /** Epoch milliseconds. */
  now: number;
};

const listed = (list: readonly number[] | null | undefined): list is readonly number[] => Array.isArray(list) && list.length > 0;

/** Inside its schedule window at `now` (start inclusive, end exclusive). */
export function isCampaignLive(campaign: Pick<CampaignRule, "startsAt" | "endsAt">, now: number): boolean {
  if (campaign.startsAt && now < campaign.startsAt.getTime()) return false;
  if (campaign.endsAt && now >= campaign.endsAt.getTime()) return false;
  return true;
}

/** True when the campaign is limited to customer groups (cart only, never shown on static pages). */
export function hasCustomerGroups(campaign: Pick<CampaignRule, "customerGroupIds">): boolean {
  return listed(campaign.customerGroupIds);
}

/** The buyer's group may use the campaign (campaigns without groups are for everyone). */
export function campaignAllowsGroup(campaign: Pick<CampaignRule, "customerGroupIds">, groupId: number | null): boolean {
  const groups = campaign.customerGroupIds;
  if (!listed(groups)) return true;
  return groupId != null && groups.includes(groupId);
}

/** The campaign's product/category scope covers the target. */
export function campaignCovers(campaign: Pick<CampaignRule, "productIds" | "categoryIds">, target: CampaignTarget): boolean {
  const { productIds, categoryIds } = campaign;
  const scoped = listed(productIds) || listed(categoryIds);
  return (
    !scoped ||
    (listed(productIds) && productIds.includes(target.productId)) ||
    (listed(categoryIds) && target.categoryId != null && categoryIds.includes(target.categoryId))
  );
}

/** Highest-priority campaign (then highest percent) that applies to the target now, or null. */
export function pickCampaign<C extends CampaignRule>(campaigns: readonly C[], target: CampaignTarget, context: CampaignContext): C | null {
  let best: C | null = null;
  for (const c of campaigns) {
    if (!isCampaignLive(c, context.now)) continue;
    if (!campaignAllowsGroup(c, context.groupId)) continue;
    if (!campaignCovers(c, target)) continue;
    if (!best || c.priority > best.priority || (c.priority === best.priority && c.percent > best.percent)) best = c;
  }
  return best;
}

/**
 * The campaign a static storefront page shows for a product: the cart's choice for a retail buyer
 * (no customer group), so group-only campaigns never appear on cards or product pages.
 */
export function pickDisplayCampaign<C extends CampaignRule>(campaigns: readonly C[], target: CampaignTarget, now: number): C | null {
  return pickCampaign(campaigns, target, { groupId: null, now });
}

/**
 * The retail price of one unit with the campaign applied (null/0 = no campaign): `unitPrice` is what
 * the cart charges a retail buyer for quantity 1, `compareAt` the reference price to strike through
 * (max of the regular and compare-at price), present only when higher.
 */
export function campaignDisplayPrice(variant: { price: number; compareAtPrice?: number | null }, percent: number | null | undefined): ResolvedPrice {
  return resolveUnitPrice({ basePrice: variant.price, compareAtPrice: variant.compareAtPrice ?? null, campaignPercent: percent ?? null, quantity: 1 });
}

// ---------------------------------------------------------------------------------------------
// Cache lifetime for getActiveCampaigns (schedule-aware)

/** Named cacheLife profiles we use, with their server revalidate interval in seconds (NEXT16-NOTES §1). */
export const CAMPAIGN_CACHE_PROFILES = [
  { profile: "minutes", revalidate: 60 },
  { profile: "hours", revalidate: 60 * 60 },
  { profile: "days", revalidate: 24 * 60 * 60 },
  { profile: "weeks", revalidate: 7 * 24 * 60 * 60 },
  { profile: "max", revalidate: 30 * 24 * 60 * 60 },
] as const;

export type CampaignCacheProfile = (typeof CAMPAIGN_CACHE_PROFILES)[number]["profile"];

/** Epoch ms of the next start or end after `now` among the campaigns, or null when none is upcoming. */
export function nextCampaignChange(campaigns: readonly Pick<CampaignRule, "startsAt" | "endsAt">[], now: number): number | null {
  let next: number | null = null;
  for (const c of campaigns) {
    for (const bound of [c.startsAt, c.endsAt]) {
      const t = bound ? bound.getTime() : Number.NaN;
      if (Number.isFinite(t) && t > now && (next === null || t < next)) next = t;
    }
  }
  return next;
}

/**
 * The longest cacheLife profile whose revalidate interval still ends before the next scheduled
 * change, so a campaign starts or ends on time: "minutes" when a change is less than an hour away,
 * "max" when nothing is scheduled within 30 days. The entry is refreshed on the first request after
 * each interval, picking a shorter profile as the change comes closer.
 */
export function campaignCacheProfile(campaigns: readonly Pick<CampaignRule, "startsAt" | "endsAt">[], now: number): CampaignCacheProfile {
  const next = nextCampaignChange(campaigns, now);
  if (next === null) return "max";
  const seconds = (next - now) / 1000;
  let chosen: CampaignCacheProfile = "minutes";
  for (const { profile, revalidate } of CAMPAIGN_CACHE_PROFILES) if (revalidate <= seconds) chosen = profile;
  return chosen;
}
