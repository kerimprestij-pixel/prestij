// The UI strings the cart drawer and the /sepet page need, picked from the (panel-overridable)
// dictionary on the server and passed to the client components. Pure: safe on both sides.
import type { Messages } from "@/i18n/get-messages";

export function cartUiLabels(messages: Messages) {
  const c = messages.cart;
  return {
    title: c.title,
    close: c.close,
    empty: c.empty,
    emptyText: c.emptyText,
    emptyCta: c.emptyCta,
    viewCart: c.viewCart,
    checkout: c.checkout,
    continueShopping: c.continueShopping,
    loading: c.loading,
    loadError: c.loadError,
    retry: c.retry,
    updating: c.updating,
    generic: c.errors.generic,
    itemsHeading: c.itemsHeading,
    subtotal: c.subtotal,
    remove: c.remove,
    removeFor: c.removeFor,
    quantityFor: c.quantityFor,
    increaseFor: c.increaseFor,
    decreaseFor: c.decreaseFor,
    each: c.each,
    maxReached: c.maxReached,
    samplesTitle: c.samplesTitle,
    samplesSelected: c.samplesSelected,
    addSampleFor: c.addSampleFor,
    sampleInCart: c.sampleInCart,
    sampleOutOfStock: c.sampleOutOfStock,
    heavyNote: c.heavyNote,
    summaryTitle: c.summaryTitle,
    vatNote: c.vatNote,
    paymentNote: c.paymentNote,
    checkoutBlocked: c.checkoutBlocked,
    securePayment: c.securePayment,
    /** Subscribe and save: the sign-in link next to the "subscription needs an account" note. */
    subscriptionSignIn: messages.subscriptions.cart.signIn,
    coupon: {
      label: c.couponCode,
      placeholder: c.couponPlaceholder,
      apply: c.applyCoupon,
      applying: c.couponApplying,
      remove: c.couponRemove,
    },
  };
}

export type CartUiLabels = ReturnType<typeof cartUiLabels>;

/** Public links the cart surfaces need (built with href() on the server). */
export type CartLinks = { cart: string; checkout: string; products: string };
