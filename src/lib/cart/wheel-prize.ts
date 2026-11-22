// The cart side of gift wheel prizes (day 6, contract §1.1 "Auto-apply" and "Countdown"). Read-only
// helpers that take an executor and no Next APIs; the writes (auto-apply on addItem, quantity growth
// and removal of another code, dropping a dead prize code) live in mutations.ts.
//
// A prize is a `coupons` row (source "wheel", owned by the account, single use, ends_at = claim +
// validity). The cart holds at most one code, so the prize is either that code ("applied") or kept
// for later, and the CartView says why (minimum basket, another code, no benefit right now, nothing
// to discount yet) with a real countdown to ends_at.
import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import { loadCoupon, normalizeCouponCode } from "@/lib/coupons/validate";
import { findActiveWheelCoupon } from "@/lib/wheel/prize-coupons";
import type { LoadedCart } from "./load";
import type { CommerceSettings, DbExecutor } from "./settings";
import { totalsForLoadedCart } from "./totals";
import type { CartTotals } from "./types";
import type { CartWheelPrizeInput, CartWheelPrizeStatus } from "./view";

/**
 * The contract's `getBestWheelCode(tx, userId, now)`: the code of the account's usable prize that
 * expires first, or null (WHEEL-SERVER's findActiveWheelCoupon decides what "usable" means).
 */
export async function getBestWheelCode(tx: DbExecutor, userId: string | null | undefined, now: Date): Promise<string | null> {
  if (!userId) return null;
  return (await findActiveWheelCoupon(tx, userId, now))?.code ?? null;
}

/** The slice label stored with the spin that issued this coupon (absent when the spin row is gone). */
async function spinLabel(executor: DbExecutor, couponId: number): Promise<LocalizedText | undefined> {
  const s = schema.wheelSpins;
  const [row] = await executor.select({ prize: s.prize }).from(s).where(eq(s.couponId, couponId)).limit(1);
  return row?.prize?.label ?? undefined;
}

const hasPaidLine = (totals: Pick<CartTotals, "lines">) => totals.lines.some((l) => l.included && !l.isSample);

/**
 * What the cart shows about the signed-in buyer's gift wheel prize, or null (guest, no usable prize).
 *
 * - The cart's own code is a working wheel prize → that one, "applied".
 * - Otherwise the account's usable prize that expires first, with the reason it is not on the cart:
 *   "other_code" (the cart holds another code; never overwritten), "no_items" (nothing to discount yet),
 *   "min_order" (below the prize's minimum basket), "no_benefit" (it would not lower what the buyer pays
 *   now, e.g. free shipping on a cart that ships free) or "ready" (it would work now, e.g. the buyer took
 *   it off earlier: the cart offers a button to put it back).
 *
 * `totals` are the cart's totals as computed for the view. The "ready"/"no_benefit" test mirrors
 * applyCouponToCart exactly (same loader output, default payment method, `now`).
 */
export async function cartWheelPrize(
  executor: DbExecutor,
  input: { loaded: LoadedCart; totals: CartTotals; settings: CommerceSettings; now: Date },
): Promise<CartWheelPrizeInput | null> {
  const { loaded, totals, settings, now } = input;
  const userId = loaded.customer.userId;
  if (!userId) return null;

  const onCart = loaded.coupon;
  if (onCart && onCart.source === "wheel" && onCart.endsAt && totals.coupon?.status === "applied") {
    const label = await spinLabel(executor, onCart.id);
    return prizeInput({ code: onCart.code, type: onCart.type, value: onCart.value, minOrderTotal: onCart.minOrderTotal, endsAt: onCart.endsAt, label }, "applied");
  }

  const prize = await findActiveWheelCoupon(executor, userId, now);
  if (!prize) return null;
  const status = await waitingStatus(executor, prize.code, { loaded, totals, settings, now });
  return prizeInput(prize, status);
}

async function waitingStatus(
  executor: DbExecutor,
  code: string,
  { loaded, totals, settings, now }: { loaded: LoadedCart; totals: CartTotals; settings: CommerceSettings; now: Date },
): Promise<CartWheelPrizeStatus> {
  const cartCode = loaded.cart?.couponCode ?? null;
  if (cartCode) {
    if (normalizeCouponCode(cartCode) !== normalizeCouponCode(code)) return "other_code";
    // The prize itself is on the cart: working, or not right now (the next cart read takes it off).
    if (totals.coupon?.status === "applied") return "applied";
    return totals.coupon?.reason === "min_order" ? "min_order" : "no_items";
  }
  if (!loaded.cart || !hasPaidLine(totals)) return "no_items";
  const coupon = await loadCoupon(code, executor);
  if (!coupon) return "no_items";
  const withPrize = totalsForLoadedCart({ ...loaded, coupon }, settings, { now });
  if (withPrize.coupon?.status !== "applied") return withPrize.coupon?.reason === "min_order" ? "min_order" : "no_items";
  const without = totalsForLoadedCart({ ...loaded, coupon: null }, settings, { now });
  return withPrize.grandTotal < without.grandTotal ? "ready" : "no_benefit";
}

function prizeInput(
  p: { code: string; type: CartWheelPrizeInput["type"]; value: number; minOrderTotal: number; endsAt: Date; label?: LocalizedText },
  status: CartWheelPrizeStatus,
): CartWheelPrizeInput {
  return {
    code: p.code,
    type: p.type,
    value: p.value,
    minOrderTotal: p.minOrderTotal,
    endsAt: p.endsAt,
    ...(p.label ? { label: p.label } : {}),
    status,
  };
}
