// Shared subscription types and the display price rule (pure: safe in client components and tests).
import type { SubscriptionStatus } from "@/db/schema/commerce";
import type { LocalizedText } from "@/i18n/locales";
import { resolveUnitPrice } from "@/lib/pricing/resolve";

export type { SubscriptionStatus };

export const SUBSCRIPTION_STATUSES = ["active", "paused", "past_due", "cancelled"] as const satisfies readonly SubscriptionStatus[];

/** An active plan as the storefront shows it (product page choice, account plan change). */
export type StorefrontPlan = {
  id: number;
  name: LocalizedText;
  interval: "week" | "month";
  intervalCount: number;
  /** Plan discount, whole percent (0 = no subscriber discount). */
  percent: number;
};

/** What the cart, the order and the renewals store per subscribed line (order item snapshot extension). */
export type SubscriptionLineSnapshot = {
  planId: number;
  percent: number;
  /** Which discount the line carried when it was ordered. */
  discount: "subscription" | "campaign" | "none";
};

/**
 * The unit price a retail buyer pays for one unit on subscription: the plan discount instead of the
 * campaign when it is at least as large (the cart's rule, resolveUnitPrice). `compareAt` is the price to
 * strike through when higher. The product page, the cart, the checkout and the renewal all price with
 * resolveUnitPrice, so they show the same amount.
 */
export function subscriptionDisplayPrice(
  variant: { price: number; compareAtPrice?: number | null },
  campaignPercent: number | null | undefined,
  planPercent: number,
): { unitPrice: number; compareAt: number | null; discount: "subscription" | "campaign" | "none" } {
  const resolved = resolveUnitPrice({
    basePrice: variant.price,
    compareAtPrice: variant.compareAtPrice ?? null,
    campaignPercent: campaignPercent ?? null,
    subscriptionPercent: planPercent,
    quantity: 1,
  });
  const won = resolved.appliedRules.find((r) => r.kind === "subscription" || r.kind === "campaign");
  return {
    unitPrice: resolved.unitPrice,
    compareAt: resolved.compareAt ?? null,
    discount: won?.kind === "subscription" ? "subscription" : won?.kind === "campaign" ? "campaign" : "none",
  };
}
