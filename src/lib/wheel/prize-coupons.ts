// Gift wheel prize coupons: the account's issued prize that can still be used. A prize is a `coupons`
// row with source "wheel", owned by the account (user_id), single use, valid from the claim until
// ends_at. No Next APIs (services take the executor), so DB tests call it with a transaction.
// Created by CORE with a working body; WHEEL-SERVER owns this module from day 6 on (WHEEL-CART uses it
// for auto-apply on addItem, WHEEL-UI/WHEEL-SERVER for the reminder chip and the account card).
import "server-only";
import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { CouponType, LocalizedText } from "@/db/schema";
import type { Tx } from "@/lib/panel/tx";

export type ActiveWheelCoupon = {
  couponId: number;
  code: string;
  /** Real expiry of the prize (coupons.ends_at). */
  endsAt: Date;
  /** The slice label from the spin snapshot (absent when the spin row is gone). */
  label?: LocalizedText;
  type: CouponType;
  /** Percent, kuruş or 0 (free shipping), as on the coupon. */
  value: number;
  /** Minimum basket in kuruş (0 = none). */
  minOrderTotal: number;
};

/**
 * The account's usable gift wheel prize at `now`, or null: source "wheel", owned by `userId`, active,
 * started, not expired (ends_at > now; a wheel prize always has an end), not used up (used_count <
 * max_uses). With several (one per round), the one that expires first. Read-only, no locks: callers
 * that write (auto-apply) re-validate through the coupon engine under the cart lock.
 */
export async function findActiveWheelCoupon(tx: Tx, userId: string, now: Date): Promise<ActiveWheelCoupon | null> {
  if (!userId) return null;
  const c = schema.coupons;
  const s = schema.wheelSpins;
  const [row] = await tx
    .select({
      couponId: c.id,
      code: c.code,
      endsAt: c.endsAt,
      type: c.type,
      value: c.value,
      minOrderTotal: c.minOrderTotal,
      prize: s.prize,
    })
    .from(c)
    .leftJoin(s, eq(s.couponId, c.id))
    .where(
      and(
        eq(c.source, "wheel"),
        eq(c.userId, userId),
        eq(c.isActive, true),
        isNotNull(c.endsAt),
        gt(c.endsAt, now),
        or(isNull(c.startsAt), lte(c.startsAt, now)),
        or(isNull(c.maxUses), sql`${c.usedCount} < ${c.maxUses}`),
      ),
    )
    .orderBy(asc(c.endsAt), desc(c.id))
    .limit(1);
  if (!row || !row.endsAt) return null;
  return {
    couponId: row.couponId,
    code: row.code,
    endsAt: row.endsAt,
    ...(row.prize?.label ? { label: row.prize.label } : {}),
    type: row.type,
    value: row.value,
    minOrderTotal: row.minOrderTotal,
  };
}

/**
 * The code WHEEL-CART auto-applies on addItem (contract §5.2 `getBestWheelCode`): the account's usable
 * prize that expires first, or null.
 */
export async function getBestWheelCode(tx: Tx, userId: string, now: Date): Promise<string | null> {
  return (await findActiveWheelCoupon(tx, userId, now))?.code ?? null;
}
