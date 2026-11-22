// The cart at sign-in: the browser's guest cart (cookie) is attached to the account; when the account
// already has a cart from an earlier visit, the two are merged into the browser's cart, keeping the
// larger quantity per variant, and the older cart is deleted. Prices are not stored on cart lines, so
// the next cart read prices everything for the signed-in customer's group. No Next APIs: the action
// (src/lib/account/auth-actions.ts) reads and writes the cookie.
import "server-only";
import { and, desc, eq, gt, isNull, ne, or } from "drizzle-orm";
import { schema } from "@/db";
import { isUuid } from "@/lib/cart/load";
import { MAX_CART_LINES } from "@/lib/cart/mutations";
import type { Tx } from "@/lib/panel/tx";

const c = schema.carts;
const ci = schema.cartItems;

export type AttachCartResult = {
  /** The cart the browser should use from now on (write it to the cookie), or null for none. */
  cartId: string | null;
  /** True when lines of an older account cart were merged in. */
  merged: boolean;
  /** True when the cookie should point somewhere else than before. */
  changed: boolean;
};

const live = (now: Date) => or(isNull(c.expiresAt), gt(c.expiresAt, now));

/**
 * Attaches the cookie's cart (`cartId`, may be null) to `userId` and merges the user's other live carts
 * into it. A cookie cart that belongs to ANOTHER account (a shared browser) is left alone: the user
 * gets their own cart back instead (or none).
 */
export async function attachCartToUser(tx: Tx, input: { cartId: string | null; userId: string; now?: Date }): Promise<AttachCartResult> {
  const now = input.now ?? new Date();
  const { userId } = input;
  let guest: { id: string; userId: string | null; couponCode: string | null } | null = null;
  if (isUuid(input.cartId)) {
    const [row] = await tx
      .select({ id: c.id, userId: c.userId, couponCode: c.couponCode })
      .from(c)
      .where(and(eq(c.id, input.cartId), live(now)))
      .for("update")
      .limit(1);
    guest = row && (row.userId === null || row.userId === userId) ? row : null;
  }

  const own = await tx
    .select({ id: c.id, couponCode: c.couponCode })
    .from(c)
    .where(and(eq(c.userId, userId), live(now), guest ? ne(c.id, guest.id) : undefined))
    .orderBy(desc(c.updatedAt), desc(c.createdAt))
    .for("update");

  if (!guest) {
    const restored = own[0]?.id ?? null;
    return { cartId: restored, merged: false, changed: restored !== null && restored !== input.cartId };
  }

  if (own.length === 0) {
    if (guest.userId !== userId) await tx.update(c).set({ userId }).where(eq(c.id, guest.id));
    return { cartId: guest.id, merged: false, changed: false };
  }

  const lines = await tx
    .select({ id: ci.id, variantId: ci.variantId, quantity: ci.quantity, isSample: ci.isSample, subscriptionPlanId: ci.subscriptionPlanId })
    .from(ci)
    .where(eq(ci.cartId, guest.id));
  const byVariant = new Map(lines.map((l) => [l.variantId, l]));
  let couponCode = guest.couponCode;

  for (const old of own) {
    const oldLines = await tx
      .select({ variantId: ci.variantId, quantity: ci.quantity, isSample: ci.isSample, subscriptionPlanId: ci.subscriptionPlanId })
      .from(ci)
      .where(eq(ci.cartId, old.id))
      .orderBy(ci.id);
    for (const line of oldLines) {
      const current = byVariant.get(line.variantId);
      if (current) {
        const quantity = current.isSample ? 1 : Math.max(current.quantity, line.quantity);
        const subscriptionPlanId = current.subscriptionPlanId ?? line.subscriptionPlanId;
        if (quantity !== current.quantity || subscriptionPlanId !== current.subscriptionPlanId) {
          await tx.update(ci).set({ quantity, subscriptionPlanId }).where(eq(ci.id, current.id));
          byVariant.set(line.variantId, { ...current, quantity, subscriptionPlanId });
        }
      } else if (byVariant.size < MAX_CART_LINES) {
        const [inserted] = await tx
          .insert(ci)
          .values({ cartId: guest.id, variantId: line.variantId, quantity: line.isSample ? 1 : line.quantity, isSample: line.isSample, subscriptionPlanId: line.subscriptionPlanId })
          .onConflictDoNothing()
          .returning({ id: ci.id });
        if (inserted) byVariant.set(line.variantId, { id: inserted.id, ...line });
      }
    }
    couponCode = couponCode ?? old.couponCode;
    await tx.delete(c).where(eq(c.id, old.id)); // its lines cascade
  }

  await tx.update(c).set({ userId, couponCode }).where(eq(c.id, guest.id));
  return { cartId: guest.id, merged: true, changed: false };
}
