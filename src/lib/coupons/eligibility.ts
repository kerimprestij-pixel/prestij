// Pure coupon rules (no DB). Used by the money engine and by applyCoupon to explain a refusal.
import type { CouponData, CouponInvalidReason, CustomerContext } from "@/lib/cart/types";

/** Display/canonical form of a typed code: trimmed, inner whitespace removed, upper-cased (ASCII rules). */
export function normalizeCouponCode(code: unknown): string {
  if (typeof code !== "string") return "";
  return code.trim().replace(/\s+/g, "").toUpperCase().slice(0, 64);
}

export type CouponLine = {
  lineId: number;
  productId: number;
  categoryId: number | null;
  isSample: boolean;
  /** unitPrice × quantity of the line (0 for samples). */
  lineSubtotal: number;
};

export type CouponEligibility =
  | { valid: true; eligibleLineIds: number[]; eligibleSubtotal: number }
  | { valid: false; reason: CouponInvalidReason; eligibleLineIds: number[]; eligibleSubtotal: number };

const hasItems = (list: readonly number[] | null | undefined): list is readonly number[] =>
  Array.isArray(list) && list.length > 0;

/** Lines a coupon may discount: never samples; product/category lists (either matches) when set. */
export function eligibleCouponLines<T extends CouponLine>(coupon: Pick<CouponData, "productIds" | "categoryIds">, lines: readonly T[]): T[] {
  const byProduct = hasItems(coupon.productIds) ? new Set(coupon.productIds) : null;
  const byCategory = hasItems(coupon.categoryIds) ? new Set(coupon.categoryIds) : null;
  return lines.filter((line) => {
    if (line.isSample || !(line.lineSubtotal > 0)) return false;
    if (!byProduct && !byCategory) return true;
    return (
      (byProduct?.has(line.productId) ?? false) || (line.categoryId != null && (byCategory?.has(line.categoryId) ?? false))
    );
  });
}

/** Day 6: the coupon is bound to an account and `userId` is not that account (signed out included). */
export function isForeignCoupon(coupon: Pick<CouponData, "userId">, userId: string | null | undefined): boolean {
  return typeof coupon.userId === "string" && coupon.userId !== "" && coupon.userId !== userId;
}

/**
 * Checks every coupon rule that does not need the buyer's e-mail (perCustomerLimit is checked at
 * checkout). Order of checks = order of the reasons reported: owner → inactive → window → maxUses →
 * group → minimum order (merchandise subtotal of paid lines) → eligible lines. The owner check (day 6)
 * comes first and reports no eligible lines, so a code bound to someone else reveals nothing about itself.
 */
export function couponEligibility(
  coupon: CouponData,
  input: {
    lines: readonly CouponLine[];
    subtotal: number;
    /** `userId` (day 6): the buyer's account; absent or null = signed out (fails every owner-bound coupon). */
    customer: Pick<CustomerContext, "groupId"> & Partial<Pick<CustomerContext, "userId">>;
    now: Date;
  },
): CouponEligibility {
  if (isForeignCoupon(coupon, input.customer.userId)) return { valid: false, reason: "not_owner", eligibleLineIds: [], eligibleSubtotal: 0 };
  const eligible = eligibleCouponLines(coupon, input.lines);
  const eligibleLineIds = eligible.map((l) => l.lineId);
  const eligibleSubtotal = eligible.reduce((sum, l) => sum + l.lineSubtotal, 0);
  const fail = (reason: CouponInvalidReason): CouponEligibility => ({ valid: false, reason, eligibleLineIds, eligibleSubtotal });

  if (!coupon.isActive) return fail("inactive");
  const now = input.now.getTime();
  if (coupon.startsAt && now < coupon.startsAt.getTime()) return fail("not_started");
  if (coupon.endsAt && now >= coupon.endsAt.getTime()) return fail("expired");
  if (coupon.maxUses != null && !(coupon.usedCount < coupon.maxUses)) return fail("exhausted");
  if (hasItems(coupon.customerGroupIds) && (input.customer.groupId == null || !coupon.customerGroupIds.includes(input.customer.groupId))) {
    return fail("group_not_allowed");
  }
  if (!(input.subtotal >= Math.max(0, coupon.minOrderTotal || 0))) return fail("min_order");
  if (eligible.length === 0) return fail("no_eligible_items");
  return { valid: true, eligibleLineIds, eligibleSubtotal };
}
