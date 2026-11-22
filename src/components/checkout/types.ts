// Shared types of the checkout UI (pure, type-level only: safe in server and client code).
import type { Messages } from "@/i18n/messages";
import type { CartView } from "@/lib/cart/view";
import type { CheckoutErrorCode } from "@/lib/orders/place";

/** useActionState state of placeOrderAction. */
export type CheckoutState = {
  status: "idle" | "error";
  /** Increments on every failed submit, so the form can react (focus the error summary) each time. */
  attempt: number;
  code?: CheckoutErrorCode;
  /** Localized message for the whole form. */
  formError?: string;
  /** Field path ("shippingAddress.city") → localized message. */
  fieldErrors?: Record<string, string>;
  /** What was submitted (flat field path → value), to refill the form when it renders without JS. */
  values?: Record<string, string>;
  /** The cart re-read after the failure (prices, stock or the coupon may have changed). */
  view?: CartView;
};

/** Everything of messages.checkout the client needs (the long legal block stays on the server). */
export type CheckoutLabels = Omit<Messages["checkout"], "legal">;

export type CommonLabels = Pick<Messages["common"], "optional" | "close" | "opensInNewTab" | "free">;

/** Checkout failure codes that mean "the cart changed": the message links back to the cart. */
export const CART_CHANGE_CODES: readonly CheckoutErrorCode[] = [
  "cart_empty",
  "cart_has_issues",
  "samples_only",
  "out_of_stock",
  "coupon_unavailable",
  "price_changed",
];
