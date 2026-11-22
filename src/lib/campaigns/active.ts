// Storefront read of the campaigns that run right now (cached, tag `campaigns`). Static pages show
// their badge and price; the cart reads the table itself (src/lib/cart/load.ts) and decides with the
// real clock, so it stays authoritative even when this cache is a minute behind.
import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import { TAGS } from "@/lib/cache-tags";
import { campaignCacheProfile, isCampaignLive, type CampaignCacheProfile, type CampaignRule } from "./pick";

/** A live campaign as the storefront sees it (no internal name). */
export type StorefrontCampaign = CampaignRule & {
  id: number;
  /** Badge text, e.g. { tr: "Bahar İndirimi" }; null = show the percent. */
  label: LocalizedText | null;
  /** Theme to switch on while the campaign runs (THEME-TEXTS: campaign-linked themes). */
  themeId: number | null;
};

export type ActiveCampaigns = {
  /** Active (`isActive`) campaigns inside their window at `asOf`, by priority (high first), then id. */
  campaigns: StorefrontCampaign[];
  /** When the list was read (epoch ms): pass it as `now` to pickDisplayCampaign. */
  asOf: number;
};

/**
 * Live campaigns, including customer-group ones (filter with pickDisplayCampaign, which skips them).
 * The cache lifetime follows the schedule: "minutes" while a start or end is under an hour away,
 * longer profiles further out, "max" when nothing is scheduled (see campaignCacheProfile).
 */
export async function getActiveCampaigns(): Promise<ActiveCampaigns> {
  "use cache";
  cacheTag(TAGS.campaigns);
  const c = schema.campaigns;
  const rows = await db
    .select({
      id: c.id,
      label: c.label,
      percent: c.discountPercent,
      priority: c.priority,
      productIds: c.productIds,
      categoryIds: c.categoryIds,
      customerGroupIds: c.customerGroupIds,
      themeId: c.themeId,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
    })
    .from(c)
    .where(eq(c.isActive, true))
    .orderBy(desc(c.priority), asc(c.id));
  const asOf = Date.now();
  applyCacheLife(campaignCacheProfile(rows, asOf));
  return { campaigns: rows.filter((row) => isCampaignLive(row, asOf)), asOf };
}

/** cacheLife's overloads take one literal profile name each. */
function applyCacheLife(profile: CampaignCacheProfile): void {
  switch (profile) {
    case "minutes":
      return cacheLife("minutes");
    case "hours":
      return cacheLife("hours");
    case "days":
      return cacheLife("days");
    case "weeks":
      return cacheLife("weeks");
    case "max":
      return cacheLife("max");
  }
}
