import "server-only";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CouponData } from "@/lib/cart/types";
import type { DbExecutor } from "@/lib/cart/settings";

export {
  couponEligibility,
  eligibleCouponLines,
  isForeignCoupon,
  normalizeCouponCode,
  type CouponEligibility,
  type CouponLine,
} from "./eligibility";

const c = schema.coupons;

/** The columns of a CouponData (every reader of a coupon for the engine selects exactly these). */
export const couponColumns = {
  id: c.id,
  code: c.code,
  type: c.type,
  value: c.value,
  minOrderTotal: c.minOrderTotal,
  maxUses: c.maxUses,
  usedCount: c.usedCount,
  perCustomerLimit: c.perCustomerLimit,
  productIds: c.productIds,
  categoryIds: c.categoryIds,
  customerGroupIds: c.customerGroupIds,
  isActive: c.isActive,
  startsAt: c.startsAt,
  endsAt: c.endsAt,
  // Day 6
  userId: c.userId,
  source: c.source,
} as const;

/** The coupon for a typed code (trimmed, case-insensitive), or null. Does not judge validity. */
export async function loadCoupon(code: string, executor: DbExecutor = db): Promise<CouponData | null> {
  const wanted = typeof code === "string" ? code.trim() : "";
  if (!wanted || wanted.length > 64) return null;
  const [row] = await executor
    .select(couponColumns)
    .from(c)
    .where(sql`upper(${c.code}) = upper(${wanted})`)
    .limit(1);
  return row ?? null;
}

/**
 * Orders (not cancelled) that used this coupon with this e-mail, for perCustomerLimit. Call it inside
 * the order transaction after lockCouponForEmail() so two parallel checkouts cannot both pass.
 */
export async function countCouponUsesByEmail(couponId: number, email: string, executor: DbExecutor = db): Promise<number> {
  const o = schema.orders;
  const [row] = await executor
    .select({ n: count() })
    .from(o)
    .where(and(eq(o.couponId, couponId), sql`lower(${o.email}) = lower(${email})`, ne(o.status, "cancelled")));
  return row?.n ?? 0;
}

/** Transaction-scoped advisory lock on (coupon, e-mail). */
export async function lockCouponForEmail(couponId: number, email: string, executor: DbExecutor): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(${couponId}, hashtext(lower(${email})))`);
}
