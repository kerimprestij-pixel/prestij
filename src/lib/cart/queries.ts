import "server-only";
import { connection } from "next/server";
import { db } from "@/db";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { getCustomerContext } from "@/lib/customer/context";
import { isCardPaymentReadyFor } from "@/lib/payments/gateway";
import { readCartId } from "./cookie";
import { loadCart } from "./load";
import { releaseDeadWheelCode } from "./mutations";
import { loadCommerceSettings } from "./settings";
import { totalsForLoadedCart } from "./totals";
import type { PaymentMethod } from "./types";
import { buildCartView, type CartView } from "./view";
import { cartWheelPrize } from "./wheel-prize";

/**
 * The visitor's cart as a CartView. Uncached; reads the cart cookie and the session, so call it only
 * inside `<Suspense>` (sepet, ödeme pages) or from Server Actions — never in a "use cache" scope or a
 * static page shell.
 *
 * Read-only but for one server-owned cleanup (day 6): a gift wheel code that the server put on the cart
 * and that stopped working (expired, used up, below its minimum…) is taken off, so the checkout never
 * fails on it. The write is guarded and idempotent, and it never changes the cart revision (an invalid
 * code is not part of it). Quantities and samples are only fixed by the cart actions (getCart).
 */
export async function getCartView(locale: Locale, options: { paymentMethod?: PaymentMethod | null } = {}): Promise<CartView> {
  // Request-time only: the cart depends on the clock (coupon windows, expiry), not just on cookies,
  // so it must not run in a (runtime) prerender.
  await connection();
  const now = new Date();
  const [cartId, customer, settings, messages] = await Promise.all([readCartId(), getCustomerContext(), loadCommerceSettings(), getMessages(locale)]);
  const totalsOptions = { paymentMethod: options.paymentMethod ?? null, cardGatewayReady: await isCardPaymentReadyFor(settings.payments, customer), now };
  let loaded = await loadCart(cartId, customer, { withSamples: true, now });
  let totals = totalsForLoadedCart(loaded, settings, totalsOptions);
  if (await releaseDeadWheelCode(loaded, totals)) {
    loaded = await loadCart(cartId, customer, { withSamples: true, now });
    totals = totalsForLoadedCart(loaded, settings, totalsOptions);
  }
  const wheelPrize = await cartWheelPrize(db, { loaded, totals, settings, now });
  return buildCartView(totals, loaded, locale, messages, { wheelPrize, now });
}
