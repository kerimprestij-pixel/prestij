// Result types of the cart Server Actions (src/lib/cart/actions.ts). Type-only: import freely in
// client components.
import type { Locale } from "@/i18n/config";
import type { CartView } from "./view";

export type CartErrorCode =
  | "invalid_input"
  | "variant_not_found"
  | "unavailable"
  | "out_of_stock"
  | "line_not_found"
  | "cart_full"
  | "sample_not_allowed"
  | "sample_needs_product"
  | "sample_min_order"
  | "sample_limit"
  | "sample_unavailable"
  | "sample_in_cart"
  | "coupon_empty"
  | "coupon_not_found"
  | "coupon_inactive"
  | "coupon_not_started"
  | "coupon_expired"
  | "coupon_exhausted"
  | "coupon_group_not_allowed"
  | "coupon_min_order"
  | "coupon_no_eligible_items"
  | "coupon_per_customer_limit"
  | "coupon_no_benefit"
  | "subscription_unavailable"
  | "rate_limited"
  | "generic";

export type CartNoticeCode =
  | "added"
  | "added_limited"
  | "updated"
  | "updated_limited"
  | "removed"
  | "sample_added"
  | "coupon_applied"
  | "coupon_removed"
  | "samples_removed"
  | "quantities_adjusted";

/**
 * Every cart action resolves to this (it never throws for expected failures).
 * - `error` / `notice` are LOCALIZED strings, ready to show (aria-live). Their message keys are
 *   `cart.errors.<code>` / `cart.notices.<noticeCode>`.
 * - `view` is the fresh cart after the action; on failure it is included whenever the cart could be read.
 */
export type CartActionResult =
  | { ok: true; view: CartView; notice?: string; noticeCode?: CartNoticeCode }
  | { ok: false; error: string; code: CartErrorCode; view?: CartView };

/** subscriptionPlanId: a plan subscribes the line, null = one-time purchase, omitted = keep the line's choice. */
export type AddToCartInput = { variantId: number; quantity?: number; subscriptionPlanId?: number | null; locale: Locale };
export type SetLineSubscriptionInput = { lineId: number; planId: number | null; locale: Locale };
export type SetLineQuantityInput = { lineId: number; quantity: number; locale: Locale };
export type RemoveLineInput = { lineId: number; locale: Locale };
export type AddSampleInput = { variantId: number; locale: Locale };
export type ApplyCouponInput = { code: string; locale: Locale };
export type LocaleInput = { locale: Locale };
