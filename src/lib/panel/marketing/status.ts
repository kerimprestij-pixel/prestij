// Status of a scheduled marketing record (campaign or coupon) at a moment. Pure.
import { isCampaignLive } from "@/lib/campaigns/pick";

export type ScheduleStatus = "live" | "scheduled" | "ended" | "inactive" | "exhausted";

type Scheduled = { isActive: boolean; startsAt: Date | string | null; endsAt: Date | string | null };

const toDate = (v: Date | string | null): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v));

/** inactive (switched off) → ended → scheduled → live; coupons also "exhausted" when maxUses is reached. */
export function scheduleStatus(row: Scheduled & { maxUses?: number | null; usedCount?: number }, now: number): ScheduleStatus {
  if (!row.isActive) return "inactive";
  const window = { startsAt: toDate(row.startsAt), endsAt: toDate(row.endsAt) };
  if (window.endsAt && now >= window.endsAt.getTime()) return "ended";
  if (row.maxUses != null && row.usedCount != null && !(row.usedCount < row.maxUses)) return "exhausted";
  if (!isCampaignLive(window, now)) return "scheduled";
  return "live";
}

/** A gift wheel prize coupon (day 6): used (once) → deactivated → expired → active. */
export type WheelCouponStatus = "active" | "used" | "expired" | "inactive";

/** Used wins over everything (a used prize stays "used" after its expiry); then switched off, then expired. */
export function wheelCouponStatus(
  row: { isActive: boolean; endsAt: Date | string | null; maxUses: number | null; usedCount: number },
  now: number,
): WheelCouponStatus {
  if (row.maxUses != null && !(row.usedCount < row.maxUses)) return "used";
  if (!row.isActive) return "inactive";
  const end = toDate(row.endsAt);
  if (end && now >= end.getTime()) return "expired";
  return "active";
}

/** Two optional windows overlap (missing bounds are open). */
export function windowsOverlap(
  a: { startsAt: Date | null; endsAt: Date | null },
  b: { startsAt: Date | null; endsAt: Date | null },
): boolean {
  const aStart = a.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const aEnd = a.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bStart = b.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const bEnd = b.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return aStart < bEnd && bStart < aEnd;
}
