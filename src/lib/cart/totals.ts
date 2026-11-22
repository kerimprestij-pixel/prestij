// Glue between a loaded cart (load.ts), the commerce settings and the pure engine. No I/O.
import { computeCart } from "./compute";
import type { LoadedCart } from "./load";
import type { CommerceSettings } from "./settings";
import type { CartTotals, PaymentMethod } from "./types";

export type TotalsOptions = {
  paymentMethod?: PaymentMethod | null;
  /** Whether a card gateway is usable (isCardPaymentReady()). Default true. */
  cardGatewayReady?: boolean;
  now?: Date;
};

export function totalsForLoadedCart(loaded: LoadedCart, settings: CommerceSettings, options: TotalsOptions = {}): CartTotals {
  return computeCart({
    lines: loaded.lines,
    customer: loaded.customer,
    coupon: loaded.coupon,
    campaigns: loaded.campaigns,
    settings: {
      shipping: settings.shipping,
      payments: settings.payments,
      samples: settings.samples,
      subscriptions: settings.subscriptions ? { enabled: settings.subscriptions.enabled, allowedMethods: settings.subscriptions.allowedMethods } : undefined,
    },
    paymentMethod: options.paymentMethod ?? null,
    cardGatewayReady: options.cardGatewayReady ?? true,
    now: options.now ?? new Date(),
  });
}

/**
 * A fingerprint of what the buyer is ordering: the included lines (variant:quantity, sorted) and the
 * applied coupon. The checkout posts the revision it showed; placeOrder refuses with "cart_changed"
 * when the cart it reloads under its lock has another one, even if the grand total happens to match
 * (every scent's 500 ml costs the same, so a swapped product would otherwise pass the total check).
 */
export function cartRevision(totals: Pick<CartTotals, "lines" | "coupon">): string {
  // A subscription line also names its plan: switching a line to or from a plan is another order.
  const lines = totals.lines
    .filter((l) => l.included)
    .map((l) => `${l.variantId}:${l.quantity}${l.subscription ? `:s${l.subscription.planId}` : ""}`)
    .sort();
  const coupon = totals.coupon?.status === "applied" ? totals.coupon.code : "";
  return `${lines.join(",")}|${coupon}`;
}
