// Gift wheel reads for the storefront (WHEEL-UI, day 6).
//   getActiveWheelTeaser(locale)  cached, display-only teaser for the locale layout (every page)
//   queryAccountWheelPrize(...)   the account's latest prize for the /hesap card (uncached, per user)
// Cached readers are callable server references (DAY3-CORE-API §16.19): the teaser never carries
// weights, prize values or anything about the visitor. The spin route reads the full config uncached.
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import type { CouponType, LocalizedText } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { TAGS } from "@/lib/cache-tags";
import { campaignCacheProfile, type CampaignCacheProfile } from "@/lib/campaigns/pick";
import type { Tx } from "@/lib/panel/tx";
import { parseSettings } from "@/lib/settings/types";
import { findActiveWheelCoupon } from "@/lib/wheel/prize-coupons";
import type { WheelTeaser } from "@/lib/wheel/types";
import { buildWheelTeaser, wheelScheduleBounds } from "@/components/store/wheel/wheel-teaser";

/**
 * The teaser for the locale layout, or null when the wheel is off or outside its schedule. In the root
 * layout, so its lifetime sets every storefront page's: it follows the schedule like announcements do
 * ("minutes" while a start or end is under an hour away, longer further out, "max" otherwise; never
 * "seconds", which would make the static pages dynamic). Saving the wheel in the panel expires the tag.
 */
export async function getActiveWheelTeaser(locale: Locale): Promise<WheelTeaser | null> {
  "use cache";
  cacheTag(TAGS.wheel, TAGS.settings);

  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, "giftWheel"))
    .limit(1);
  const settings = parseSettings("giftWheel", row?.value);
  const now = Date.now();
  applyScheduleCacheLife(campaignCacheProfile(wheelScheduleBounds(settings), now));
  return buildWheelTeaser(settings, locale, now);
}

/** cacheLife's overloads take one literal profile name each (same helper as src/lib/data/site.ts). */
function applyScheduleCacheLife(profile: CampaignCacheProfile): void {
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

// ---------------------------------------------------------------------------------------------------
// The account card

export type AccountWheelPrizeStatus = "active" | "used" | "expired";

export type AccountWheelPrize = {
  status: AccountWheelPrizeStatus;
  code: string;
  /** The slice label from the spin snapshot (null when the spin row is gone: the card builds one from type/value). */
  label: LocalizedText | null;
  type: CouponType;
  value: number;
  minOrderTotal: number;
  /** ISO expiry (coupons.ends_at). */
  endsAt: string;
};

/** A used or expired prize stays on the card this long after its end, then the card goes away. */
export const ACCOUNT_PRIZE_RECENT_DAYS = 30;

/**
 * The prize the /hesap card shows for `userId` at `now`: the usable one that expires first (the same
 * rule as the cart's auto-apply, findActiveWheelCoupon); else the latest wheel prize when it was used
 * or ran out within the last 30 days; else null. A prize switched off by staff or by account
 * anonymization (is_active = false) is not shown.
 */
export async function queryAccountWheelPrize(executor: Tx, userId: string, now: Date): Promise<AccountWheelPrize | null> {
  if (!userId) return null;
  const active = await findActiveWheelCoupon(executor, userId, now);
  if (active) {
    return {
      status: "active",
      code: active.code,
      label: active.label ?? null,
      type: active.type,
      value: active.value,
      minOrderTotal: active.minOrderTotal,
      endsAt: active.endsAt.toISOString(),
    };
  }

  const c = schema.coupons;
  const s = schema.wheelSpins;
  const [row] = await executor
    .select({
      code: c.code,
      type: c.type,
      value: c.value,
      minOrderTotal: c.minOrderTotal,
      endsAt: c.endsAt,
      usedCount: c.usedCount,
      maxUses: c.maxUses,
      isActive: c.isActive,
      prize: s.prize,
    })
    .from(c)
    .leftJoin(s, eq(s.couponId, c.id))
    .where(and(eq(c.source, "wheel"), eq(c.userId, userId)))
    .orderBy(desc(c.createdAt), desc(c.id))
    .limit(1);
  if (!row || !row.isActive || !row.endsAt) return null;
  const used = row.maxUses !== null && row.usedCount >= row.maxUses;
  const expired = row.endsAt.getTime() <= now.getTime();
  if (!used && !expired) return null; // not started yet, or otherwise not usable: nothing to say
  if (row.endsAt.getTime() < now.getTime() - ACCOUNT_PRIZE_RECENT_DAYS * 86_400_000) return null;
  return {
    status: used ? "used" : "expired",
    code: row.code,
    label: row.prize?.label ?? null,
    type: row.type,
    value: row.value,
    minOrderTotal: row.minOrderTotal,
    endsAt: row.endsAt.toISOString(),
  };
}

/** queryAccountWheelPrize on the shared client (the account page). */
export function getAccountWheelPrize(userId: string, now: Date): Promise<AccountWheelPrize | null> {
  return queryAccountWheelPrize(db as unknown as Tx, userId, now);
}
