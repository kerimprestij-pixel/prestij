// What happens right after a sign-in (the sign-in form, and the automatic sign-in of e-mail
// verification): the browser cart is attached to the account (merged with an older account cart),
// the cookie points at the right cart, and guest orders with the (verified) address are linked.
// Gift wheel (day 6): a held spin is claimed for the account (when it may take part and has no prize this
// round) and the account's prize is auto-applied to the cart; a claimed spin's cookie is cleared.
// Server-only and NOT a Server Action: callers pass the user of the session they just created.
import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { clearCartId, readCartId, writeCartId } from "@/lib/cart/cookie";
import { safeErrorInfo } from "@/lib/db-errors";
import { clearWheelSpinCookie, readWheelSpinId } from "@/lib/wheel/cookie";
import { requestIp, wheelClaimLimiter } from "@/lib/wheel/hooks";
import { wheelSignInEffects } from "@/lib/wheel/service";
import { attachCartToUser } from "./cart-merge";
import { linkGuestOrders } from "./orders";

async function cartItemCount(cartId: string | null): Promise<number> {
  if (!cartId) return 0;
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${schema.cartItems.quantity}), 0)::int` })
    .from(schema.cartItems)
    .where(eq(schema.cartItems.cartId, cartId));
  return row?.n ?? 0;
}

/** Never throws: the sign-in already succeeded. Returns the items in the cart for the header badge. */
export async function afterSignIn(user: { id: string; email: string }): Promise<{ cartCount: number }> {
  try {
    const [cookieCart, wheelSpinId, ip] = await Promise.all([readCartId(), readWheelSpinId(), requestIp()]);
    const result = await db.transaction(async (tx) => {
      const cart = await attachCartToUser(tx, { cartId: cookieCart, userId: user.id });
      await linkGuestOrders(tx, user);
      // Never throws (savepoints): the cart attach and order linking above always survive.
      const wheel = await wheelSignInEffects(tx, { userId: user.id, cartId: cart.cartId, cookieSpinId: wheelSpinId, now: new Date(), consumeClaimLimit: wheelClaimLimiter(ip) });
      return { ...cart, wheel };
    });
    if (result.changed && result.cartId) await writeCartId(result.cartId);
    else if (!result.cartId && cookieCart) await clearCartId(); // the cookie pointed at another account's cart
    if (result.wheel.clearCookie) await clearWheelSpinCookie();
    return { cartCount: await cartItemCount(result.cartId) };
  } catch (error) {
    console.error("[account] after sign-in failed", { userId: user.id, ...safeErrorInfo(error) });
    return { cartCount: 0 };
  }
}
