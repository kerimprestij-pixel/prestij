// Cart writes by cart id (no cookies, no Next APIs), so they run the same in Server Actions and tests.
// Each write locks the cart row first (SELECT … FOR UPDATE), the same order placeOrder uses, so a cart
// change can never interleave with an order being placed from that cart.
//
// Day 6 (gift wheel prizes, contract §1.1 "Auto-apply"): a signed-in buyer's usable prize is put on the
// cart automatically, in the same transaction and under the same cart lock, when the cart has no code and
//   - a paid product is added (addItem),
//   - a paid line's quantity grows (setItemQuantity), so "applied automatically from 750 TL" stays true,
//   - the buyer removes another code (removeCouponCode: "remove that code to use your prize").
// It only lands when it is valid now and lowers what the buyer pays (applyCouponToCart "auto"); otherwise
// the prize stays in the account for the next try. A code already on the cart is never replaced, and taking
// the prize itself off the cart is respected until the basket grows again. A wheel code that stopped
// working is taken off by the next cart read (releaseWheelCode, called from the cart actions).
//
// cartRevision: an auto-apply changes the revision (the applied code is part of it). On addItem and
// quantity growth the lines change anyway; a checkout opened before such a change answers "cart_changed"
// once, as for any cart change. Releasing a dead wheel code never changes it (an invalid code is not part
// of the revision).
import "server-only";
import { and, count, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Locale } from "@/i18n/config";
import { loadCoupon, normalizeCouponCode } from "@/lib/coupons/validate";
import { isUniqueViolation, safeErrorInfo } from "@/lib/db-errors";
import type { CartErrorCode, CartNoticeCode } from "./action-types";
import { isUuid, loadCart, type LoadedCart } from "./load";
import { loadCommerceSettings, type CommerceSettings, type DbExecutor } from "./settings";
import { totalsForLoadedCart } from "./totals";
import { DEFAULT_MAX_QUANTITY, type CartTotals, type CouponInvalidReason, type CouponState, type CustomerContext } from "./types";
import { getBestWheelCode } from "./wheel-prize";

const { carts, cartItems, productVariants: v, products: p } = schema;

/** Distinct lines a cart may hold. */
export const MAX_CART_LINES = 50;
const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Refresh the cookie when the cart had less than this left (avoids a Set-Cookie on every click). */
const COOKIE_REFRESH_MS = 25 * 24 * 60 * 60 * 1000;

export type MutationContext = {
  customer: CustomerContext;
  locale: Locale;
  now?: Date;
  settings?: CommerceSettings;
  /**
   * Run inside this transaction (as a savepoint) instead of a transaction of its own: services that
   * already hold one, and DB tests that roll everything back. Default: `db`.
   */
  executor?: DbExecutor;
};

export type CartMutationResult =
  | {
      ok: true;
      cartId: string;
      notice: CartNoticeCode;
      vars?: Record<string, number>;
      created: boolean;
      refreshCookie: boolean;
      /** Day 6: the buyer's gift wheel prize code that this write put on the cart automatically. */
      autoApplied?: string;
    }
  | { ok: false; cartId: string | null; code: CartErrorCode; vars?: Record<string, number> };

class Rollback extends Error {
  constructor(readonly result: Extract<CartMutationResult, { ok: false }>) {
    super(result.code);
  }
}

type LockedCart = { id: string; expiresAt: Date | null; couponCode: string | null };

async function lockCart(tx: DbExecutor, cartId: string | null, now: Date): Promise<LockedCart | null> {
  if (!isUuid(cartId)) return null;
  const [row] = await tx
    .select({ id: carts.id, expiresAt: carts.expiresAt, couponCode: carts.couponCode })
    .from(carts)
    .where(and(eq(carts.id, cartId), or(isNull(carts.expiresAt), gt(carts.expiresAt, now))))
    .for("update")
    .limit(1);
  return row ?? null;
}

async function createCart(tx: DbExecutor, locale: Locale, now: Date, customer: CustomerContext): Promise<LockedCart> {
  const [row] = await tx
    .insert(carts)
    .values({ locale, userId: customer.userId, expiresAt: new Date(now.getTime() + CART_TTL_MS) })
    .returning({ id: carts.id, expiresAt: carts.expiresAt, couponCode: carts.couponCode });
  return row;
}

/** Refreshes the cart's expiry (and its locale, when given) plus any extra column, e.g. the coupon code. */
async function touchCart(tx: DbExecutor, cart: LockedCart, locale: Locale | undefined, now: Date, extra: { couponCode?: string | null } = {}) {
  await tx
    .update(carts)
    .set({ ...(locale ? { locale } : {}), expiresAt: new Date(now.getTime() + CART_TTL_MS), ...extra })
    .where(eq(carts.id, cart.id));
}

const needsCookieRefresh = (cart: LockedCart, now: Date) => !cart.expiresAt || cart.expiresAt.getTime() - now.getTime() < COOKIE_REFRESH_MS;

type VariantRow = {
  id: number;
  allowSubscription: boolean;
  productType: string;
  productStatus: string;
  businessOnly: boolean;
  isActive: boolean;
  stock: number;
  trackStock: boolean;
  allowBackorder: boolean;
  minQuantity: number;
  maxQuantity: number | null;
};

async function readVariant(tx: DbExecutor, variantId: number): Promise<VariantRow | null> {
  const [row] = await tx
    .select({
      id: v.id,
      allowSubscription: p.allowSubscription,
      productType: p.type,
      productStatus: p.status,
      businessOnly: p.businessOnly,
      isActive: v.isActive,
      stock: v.stock,
      trackStock: v.trackStock,
      allowBackorder: v.allowBackorder,
      minQuantity: v.minQuantity,
      maxQuantity: v.maxQuantity,
    })
    .from(v)
    .innerJoin(p, eq(p.id, v.productId))
    .where(eq(v.id, variantId))
    .limit(1);
  return row ?? null;
}

const buyable = (row: VariantRow, customer: CustomerContext) =>
  row.productStatus === "active" && row.isActive && (!row.businessOnly || customer.isBusiness);

/** [min, limit] for a paid variant; limit < min means it cannot be bought now. */
function quantityBounds(row: VariantRow): { min: number; limit: number } {
  const min = Math.max(1, row.minQuantity || 1);
  const max = Math.max(min, row.maxQuantity ?? DEFAULT_MAX_QUANTITY);
  const tracked = row.trackStock && !row.allowBackorder;
  return { min, limit: tracked ? Math.min(max, Math.max(0, row.stock)) : max };
}

async function run(
  work: (tx: DbExecutor) => Promise<CartMutationResult>,
  executor: DbExecutor = db,
): Promise<CartMutationResult> {
  try {
    // On a transaction this is a savepoint: a Rollback undoes only this mutation.
    return await executor.transaction((tx) => work(tx));
  } catch (error) {
    if (error instanceof Rollback) return error.result;
    throw error;
  }
}

export type ApplyBestWheelPrizeInput = {
  cartId: string;
  /** The signed-in buyer (a guest has no prize: nothing happens). */
  customer: CustomerContext;
  now: Date;
  locale?: Locale;
  settings?: CommerceSettings;
};

/**
 * Puts the buyer's usable gift wheel prize (getBestWheelCode) on the cart when it works now
 * (applyCouponToCart "auto": never over another code; "kept" outcomes leave everything as it was).
 * Returns the applied code, else null. Runs in a savepoint of `tx` and never throws: a wheel problem
 * must not fail the cart write it rides on. Used by the cart writes below; WHEEL-SERVER may call it
 * after attaching a cart at sign-in.
 */
export async function applyBestWheelPrize(tx: DbExecutor, input: ApplyBestWheelPrizeInput): Promise<string | null> {
  const { cartId, customer, now } = input;
  const userId = customer.userId;
  if (!userId || !isUuid(cartId)) return null;
  try {
    return await tx.transaction(async (sp) => {
      const code = await getBestWheelCode(sp, userId, now);
      if (!code) return null;
      const result = await applyCouponToCart(sp, { cartId, code, customer, now, mode: "auto", locale: input.locale, settings: input.settings });
      return result.status === "applied" ? result.code : null;
    });
  } catch (error) {
    console.error("[cart] wheel prize auto-apply failed", safeErrorInfo(error));
    return null;
  }
}

const autoApplyWheelPrize = (tx: DbExecutor, cartId: string, ctx: MutationContext, now: Date) =>
  applyBestWheelPrize(tx, { cartId, customer: ctx.customer, now, locale: ctx.locale, settings: ctx.settings });

const withAutoApplied = (code: string | null) => (code ? { autoApplied: code } : {});

// ---------------------------------------------------------------------------------------------

/**
 * Subscribe and save: the plan may be used for this variant now (subscriptions on, plan active, the
 * product offers subscriptions). The engine re-checks the same when the line is priced.
 */
async function subscriptionAllowed(tx: DbExecutor, variant: VariantRow, planId: number, ctx: MutationContext): Promise<boolean> {
  if (!variant.allowSubscription || variant.productType === "sample") return false;
  const settings = ctx.settings ?? (await loadCommerceSettings(tx));
  if (!settings.subscriptions.enabled) return false;
  const sp = schema.subscriptionPlans;
  const [plan] = await tx.select({ id: sp.id }).from(sp).where(and(eq(sp.id, planId), eq(sp.isActive, true))).limit(1);
  return Boolean(plan);
}

/**
 * Adds `quantity` of a paid variant (merging with an existing line), clamped to limits and stock.
 * `subscriptionPlanId`: a plan id subscribes the line, null makes it a one-time purchase, undefined
 * keeps what the line had (callers without a subscription choice).
 */
export async function addItem(
  cartId: string | null,
  input: { variantId: number; quantity: number; subscriptionPlanId?: number | null },
  ctx: MutationContext,
): Promise<CartMutationResult> {
  const now = ctx.now ?? new Date();
  return run(async (tx) => {
    const fail = (code: CartErrorCode, vars?: Record<string, number>): never => {
      throw new Rollback({ ok: false, cartId: isUuid(cartId) ? cartId : null, code, ...(vars ? { vars } : {}) });
    };
    let cart = await lockCart(tx, cartId, now);
    const variant = await readVariant(tx, input.variantId);
    if (!variant) return fail("variant_not_found");
    if (variant.productType === "sample" || !buyable(variant, ctx.customer)) return fail("unavailable");
    const { min, limit } = quantityBounds(variant);
    if (limit < min) return fail("out_of_stock");
    if (input.subscriptionPlanId != null && !(await subscriptionAllowed(tx, variant, input.subscriptionPlanId, ctx))) return fail("subscription_unavailable");

    let existing = 0;
    if (cart) {
      const [line] = await tx
        .select({ quantity: cartItems.quantity })
        .from(cartItems)
        .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, variant.id)))
        .limit(1);
      if (line) existing = line.quantity;
      else {
        const [{ n }] = await tx.select({ n: count() }).from(cartItems).where(eq(cartItems.cartId, cart.id));
        if (n >= MAX_CART_LINES) return fail("cart_full", { count: MAX_CART_LINES });
      }
    }
    const wanted = Math.max(0, existing) + Math.max(1, Math.floor(input.quantity));
    const quantity = Math.min(Math.max(wanted, min), limit);

    const created = !cart;
    const refreshCookie = created || needsCookieRefresh(cart!, now);
    if (!cart) cart = await createCart(tx, ctx.locale, now, ctx.customer);
    else await touchCart(tx, cart, ctx.locale, now);
    const plan = input.subscriptionPlanId === undefined ? {} : { subscriptionPlanId: input.subscriptionPlanId };
    await tx
      .insert(cartItems)
      .values({ cartId: cart.id, variantId: variant.id, quantity, isSample: false, ...plan })
      .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.variantId], set: { quantity, ...plan } });
    // Day 6: a kept gift wheel prize goes on a cart without a code as soon as it works.
    const auto = cart.couponCode ? null : await autoApplyWheelPrize(tx, cart.id, ctx, now);

    return quantity < wanted
      ? { ok: true, cartId: cart.id, notice: "added_limited", vars: { count: quantity }, created, refreshCookie, ...withAutoApplied(auto) }
      : { ok: true, cartId: cart.id, notice: "added", created, refreshCookie, ...withAutoApplied(auto) };
  }, ctx.executor);
}

/** Sets a line's quantity (0 removes it), clamped to limits and stock. Samples stay at 1. */
export async function setItemQuantity(
  cartId: string | null,
  input: { lineId: number; quantity: number },
  ctx: MutationContext,
): Promise<CartMutationResult> {
  if (!(input.quantity > 0)) return removeItem(cartId, { lineId: input.lineId }, ctx);
  const now = ctx.now ?? new Date();
  return run(async (tx) => {
    const fail = (code: CartErrorCode): never => {
      throw new Rollback({ ok: false, cartId: isUuid(cartId) ? cartId : null, code });
    };
    const cart = await lockCart(tx, cartId, now);
    if (!cart) return fail("line_not_found");
    const [line] = await tx
      .select({ id: cartItems.id, variantId: cartItems.variantId, quantity: cartItems.quantity })
      .from(cartItems)
      .where(and(eq(cartItems.id, input.lineId), eq(cartItems.cartId, cart.id)))
      .limit(1);
    if (!line) return fail("line_not_found");
    const variant = await readVariant(tx, line.variantId);
    if (!variant) return fail("variant_not_found");

    const wanted = Math.floor(input.quantity);
    let quantity: number;
    if (variant.productType === "sample") quantity = 1;
    else {
      const { min, limit } = quantityBounds(variant);
      if (limit < min) return fail(buyable(variant, ctx.customer) ? "out_of_stock" : "unavailable");
      quantity = Math.min(Math.max(wanted, min), limit);
    }
    await touchCart(tx, cart, ctx.locale, now);
    await tx.update(cartItems).set({ quantity }).where(eq(cartItems.id, line.id));
    // Day 6: a growing basket may reach a kept prize's minimum ("applied automatically from 750 TL").
    const grew = variant.productType !== "sample" && quantity > line.quantity;
    const auto = grew && !cart.couponCode ? await autoApplyWheelPrize(tx, cart.id, ctx, now) : null;
    const refreshCookie = needsCookieRefresh(cart, now);
    return quantity !== wanted
      ? { ok: true, cartId: cart.id, notice: "updated_limited", vars: { count: quantity }, created: false, refreshCookie, ...withAutoApplied(auto) }
      : { ok: true, cartId: cart.id, notice: "updated", created: false, refreshCookie, ...withAutoApplied(auto) };
  }, ctx.executor);
}

/** Subscribes a cart line to a plan (planId) or makes it a one-time purchase again (null). */
export async function setItemSubscription(
  cartId: string | null,
  input: { lineId: number; planId: number | null },
  ctx: MutationContext,
): Promise<CartMutationResult> {
  const now = ctx.now ?? new Date();
  return run(async (tx) => {
    const fail = (code: CartErrorCode): never => {
      throw new Rollback({ ok: false, cartId: isUuid(cartId) ? cartId : null, code });
    };
    const cart = await lockCart(tx, cartId, now);
    if (!cart) return fail("line_not_found");
    const [line] = await tx
      .select({ id: cartItems.id, variantId: cartItems.variantId, isSample: cartItems.isSample })
      .from(cartItems)
      .where(and(eq(cartItems.id, input.lineId), eq(cartItems.cartId, cart.id)))
      .limit(1);
    if (!line || line.isSample) return fail("line_not_found");
    if (input.planId != null) {
      const variant = await readVariant(tx, line.variantId);
      if (!variant) return fail("variant_not_found");
      if (!(await subscriptionAllowed(tx, variant, input.planId, ctx))) return fail("subscription_unavailable");
    }
    await tx.update(cartItems).set({ subscriptionPlanId: input.planId }).where(eq(cartItems.id, line.id));
    await touchCart(tx, cart, ctx.locale, now);
    return { ok: true, cartId: cart.id, notice: "updated", created: false, refreshCookie: needsCookieRefresh(cart, now) };
  }, ctx.executor);
}

export async function removeItem(cartId: string | null, input: { lineId: number }, ctx: MutationContext): Promise<CartMutationResult> {
  const now = ctx.now ?? new Date();
  return run(async (tx) => {
    const cart = await lockCart(tx, cartId, now);
    if (!cart) throw new Rollback({ ok: false, cartId: null, code: "line_not_found" });
    const deleted = await tx
      .delete(cartItems)
      .where(and(eq(cartItems.id, input.lineId), eq(cartItems.cartId, cart.id)))
      .returning({ id: cartItems.id });
    if (deleted.length === 0) throw new Rollback({ ok: false, cartId: cart.id, code: "line_not_found" });
    await touchCart(tx, cart, ctx.locale, now);
    return { ok: true, cartId: cart.id, notice: "removed", created: false, refreshCookie: needsCookieRefresh(cart, now) };
  }, ctx.executor);
}

/**
 * Adds a free sample (quantity 1). The engine decides whether it is allowed with the cart as it
 * would be: enabled, paid subtotal ≥ samples.minOrderTotal, under maxPerOrder, in stock.
 */
export async function addSampleItem(cartId: string | null, input: { variantId: number }, ctx: MutationContext): Promise<CartMutationResult> {
  const now = ctx.now ?? new Date();
  const settings = ctx.settings ?? (await loadCommerceSettings(ctx.executor));
  try {
    return await run(async (tx) => {
      const fail = (code: CartErrorCode, vars?: Record<string, number>): never => {
        throw new Rollback({ ok: false, cartId: isUuid(cartId) ? cartId : null, code, ...(vars ? { vars } : {}) });
      };
      const cart = await lockCart(tx, cartId, now);
      if (!settings.samples.cartSampleEnabled) return fail("sample_not_allowed");
      if (!cart) return fail("sample_needs_product");
      const variant = await readVariant(tx, input.variantId);
      if (!variant || variant.productType !== "sample") return fail("variant_not_found");
      if (!buyable(variant, ctx.customer)) return fail("sample_unavailable");
      if (variant.trackStock && !variant.allowBackorder && variant.stock < 1) return fail("sample_unavailable");
      const [dupe] = await tx
        .select({ id: cartItems.id })
        .from(cartItems)
        .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, variant.id)))
        .limit(1);
      if (dupe) return fail("sample_in_cart");

      const [inserted] = await tx
        .insert(cartItems)
        .values({ cartId: cart.id, variantId: variant.id, quantity: 1, isSample: true })
        .returning({ id: cartItems.id });
      const loaded = await loadCart(cart.id, ctx.customer, { executor: tx, now });
      const totals = totalsForLoadedCart(loaded, settings, { now });
      const line = totals.lines.find((l) => l.lineId === inserted.id);
      if (!line?.included) {
        const issue = line?.issues[0]?.code;
        if (issue === "sample_limit") return fail("sample_limit", { count: totals.samples.max });
        if (issue === "sample_min_order") return fail("sample_min_order", { amount: totals.samples.minOrderTotal });
        if (issue === "sample_not_allowed") return fail(totals.samples.reason === "no_paid_items" ? "sample_needs_product" : "sample_not_allowed");
        return fail("sample_unavailable");
      }
      await touchCart(tx, cart, ctx.locale, now);
      return { ok: true, cartId: cart.id, notice: "sample_added", created: false, refreshCookie: needsCookieRefresh(cart, now) };
    }, ctx.executor);
  } catch (error) {
    // Two parallel adds of the same sample: the unique (cart, variant) index stops the second one.
    if (isUniqueViolation(error)) return { ok: false, cartId, code: "sample_in_cart" };
    throw error;
  }
}

const COUPON_ERROR: Record<CouponInvalidReason, CartErrorCode> = {
  not_found: "coupon_not_found",
  // Day 6: a code bound to another account answers like an unknown code (its existence is not revealed).
  not_owner: "coupon_not_found",
  inactive: "coupon_inactive",
  not_started: "coupon_not_started",
  expired: "coupon_expired",
  exhausted: "coupon_exhausted",
  group_not_allowed: "coupon_group_not_allowed",
  min_order: "coupon_min_order",
  no_eligible_items: "coupon_no_eligible_items",
  per_customer_limit: "coupon_per_customer_limit",
};

/**
 * "manual": the buyer typed the code (every refusal is an error; it replaces the cart's current code).
 * "auto": the server applies a code for the buyer (day 6: a gift wheel prize). It never replaces a code
 * already on the cart, and "not now" outcomes come back as `kept`, so the caller keeps the prize for later.
 */
export type ApplyCouponMode = "manual" | "auto";

export type ApplyCouponToCartInput = {
  cartId: string | null;
  /** As typed or as stored; normalized here (normalizeCouponCode). */
  code: string;
  customer: CustomerContext;
  now: Date;
  mode: ApplyCouponMode;
  /** Locale written to the cart (as every cart write does); omitted = the cart keeps its locale. */
  locale?: Locale;
  /** Commerce settings when the caller has them already; read with `tx` otherwise. */
  settings?: CommerceSettings;
};

/** Why an "auto" apply left the cart alone; the prize stays with its owner for a later try. */
export type ApplyCouponKeptReason =
  /** No live cart (nothing bought yet). */
  | "no_cart"
  /** The cart already holds another code (never overwritten). */
  | "cart_has_code"
  /** The cart already holds this very code. */
  | "already_applied"
  /** Below the coupon's minimum basket for now. */
  | "min_order"
  /** No paid line the coupon can discount yet. */
  | "no_eligible_items"
  /** It would not lower what the buyer pays right now (e.g. free shipping on a cart that ships free). */
  | "no_benefit";

export type ApplyCouponToCartResult =
  | { status: "applied"; cartId: string; code: string; refreshCookie: boolean }
  /** "auto" mode only. */
  | { status: "kept"; cartId: string | null; reason: ApplyCouponKeptReason }
  /**
   * The code cannot be used on this cart: `code` is the cart error to show (`cart.errors.<code>`), `reason`
   * the engine's reason when there is one (a "not_owner" code reports "coupon_not_found"). In "auto" mode
   * it means the prize itself is unusable now (expired, used up, deactivated, another account's).
   */
  | { status: "refused"; cartId: string | null; code: CartErrorCode; reason?: CouponInvalidReason; vars?: Record<string, number> };

/**
 * Puts `code` on the cart only when it is valid for the cart right now and lowers what the buyer pays.
 * Runs inside the caller's transaction (`tx`) and locks the cart row first (SELECT … FOR UPDATE: cart
 * → order → variants → coupon is the lock order of the code base). Writes nothing unless the result is
 * "applied". The body of `applyCouponCode` (manual mode, behaviour unchanged); WHEEL-SERVER calls it in
 * "auto" mode right after issuing a prize, WHEEL-CART on addItem.
 */
export async function applyCouponToCart(tx: DbExecutor, input: ApplyCouponToCartInput): Promise<ApplyCouponToCartResult> {
  const { now, mode } = input;
  const code = normalizeCouponCode(input.code);
  if (!code) return { status: "refused", cartId: input.cartId, code: "coupon_empty" };
  const cart = await lockCart(tx, input.cartId, now);
  if (mode === "auto") {
    if (!cart) return { status: "kept", cartId: null, reason: "no_cart" };
    if (cart.couponCode) {
      const same = normalizeCouponCode(cart.couponCode) === code;
      return { status: "kept", cartId: cart.id, reason: same ? "already_applied" : "cart_has_code" };
    }
  }
  const coupon = await loadCoupon(code, tx);
  if (!coupon) return { status: "refused", cartId: cart?.id ?? null, code: "coupon_not_found", reason: "not_found" };
  const settings = input.settings ?? (await loadCommerceSettings(tx));
  const loaded = await loadCart(cart?.id ?? null, input.customer, { executor: tx, now });
  const totals = totalsForLoadedCart({ ...loaded, coupon }, settings, { now });
  if (!cart || totals.coupon?.status !== "applied") {
    const reason = totals.coupon?.reason ?? "no_eligible_items";
    if (cart && mode === "auto" && (reason === "min_order" || reason === "no_eligible_items")) {
      return { status: "kept", cartId: cart.id, reason };
    }
    return {
      status: "refused",
      cartId: cart?.id ?? null,
      code: COUPON_ERROR[reason] ?? "coupon_not_found",
      reason,
      ...(reason === "min_order" ? { vars: { amount: coupon.minOrderTotal } } : {}),
    };
  }
  // A code must lower what the buyer pays. A small coupon can push the cart below the free-shipping
  // threshold (shipping is decided after the coupon) and a free_shipping code on a cart that ships
  // free anyway saves nothing; storing either would cost the buyer money or a single-use code.
  const without = totalsForLoadedCart({ ...loaded, coupon: null }, settings, { now });
  if (totals.grandTotal >= without.grandTotal) {
    return mode === "auto" ? { status: "kept", cartId: cart.id, reason: "no_benefit" } : { status: "refused", cartId: cart.id, code: "coupon_no_benefit" };
  }
  await touchCart(tx, cart, input.locale, now, { couponCode: coupon.code });
  return { status: "applied", cartId: cart.id, code: coupon.code, refreshCookie: needsCookieRefresh(cart, now) };
}

/** Stores a coupon on the cart only when it is valid for the cart right now (the buyer typed it). */
export async function applyCouponCode(cartId: string | null, input: { code: string }, ctx: MutationContext): Promise<CartMutationResult> {
  const now = ctx.now ?? new Date();
  const code = normalizeCouponCode(input.code);
  if (!code) return { ok: false, cartId, code: "coupon_empty" };
  const settings = ctx.settings ?? (await loadCommerceSettings(ctx.executor));
  return run(async (tx) => {
    const result = await applyCouponToCart(tx, { cartId, code, customer: ctx.customer, now, mode: "manual", locale: ctx.locale, settings });
    if (result.status === "applied") {
      return { ok: true, cartId: result.cartId, notice: "coupon_applied", created: false, refreshCookie: result.refreshCookie };
    }
    // Manual mode never keeps; anything but "applied" is the refusal to show.
    const failure = result.status === "refused" ? result : { cartId: result.cartId, code: "generic" as const, vars: undefined };
    throw new Rollback({ ok: false, cartId: failure.cartId, code: failure.code, ...(failure.vars ? { vars: failure.vars } : {}) });
  }, ctx.executor);
}

/**
 * Takes the code off the cart. Day 6: when the removed code was not a gift wheel prize, the buyer's
 * usable prize takes its place if it works now (the cart told them "remove that code to use your
 * prize"). Removing a prize itself never brings another prize in.
 */
export async function removeCouponCode(cartId: string | null, ctx: MutationContext): Promise<CartMutationResult> {
  const now = ctx.now ?? new Date();
  return run(async (tx) => {
    const cart = await lockCart(tx, cartId, now);
    if (!cart) throw new Rollback({ ok: false, cartId: null, code: "line_not_found" });
    await touchCart(tx, cart, ctx.locale, now, { couponCode: null });
    const removedOther = cart.couponCode != null && ctx.customer.userId != null && (await loadCoupon(cart.couponCode, tx))?.source !== "wheel";
    const auto = removedOther ? await autoApplyWheelPrize(tx, cart.id, ctx, now) : null;
    return { ok: true, cartId: cart.id, notice: "coupon_removed", created: false, refreshCookie: needsCookieRefresh(cart, now), ...withAutoApplied(auto) };
  }, ctx.executor);
}

/**
 * Takes a gift wheel code that stopped working (expired, used up, deactivated, below its minimum…) off
 * the cart, so it never blocks the checkout and the prize goes back to "kept" while it is still usable.
 * Guarded by the code (a code changed meanwhile in another tab is left alone). True when it was removed.
 * Callers decide that the code is a dead wheel code (the engine's state for it); see actions.ts.
 */
export async function releaseWheelCode(cartId: string, code: string, executor: DbExecutor = db): Promise<boolean> {
  if (!isUuid(cartId) || !code) return false;
  const rows = await executor
    .update(carts)
    .set({ couponCode: null })
    .where(and(eq(carts.id, cartId), eq(carts.couponCode, code)))
    .returning({ id: carts.id });
  return rows.length > 0;
}

/**
 * The cart's code is the buyer's own gift wheel prize and the engine says it does not work now: take it
 * off (releaseWheelCode). Returns the engine's state of the released code (its reason feeds the notice),
 * or null when nothing was released. The caller reloads the cart when it gets a state back.
 */
export async function releaseDeadWheelCode(
  loaded: Pick<LoadedCart, "cart">,
  totals: Pick<CartTotals, "coupon">,
  executor: DbExecutor = db,
): Promise<CouponState | null> {
  const stored = loaded.cart?.couponCode;
  const state = totals.coupon;
  // A foreign code carries no source (compute.ts), so only the viewer's own prizes qualify.
  if (!loaded.cart || !stored || !state || state.source !== "wheel" || state.status !== "invalid") return null;
  return (await releaseWheelCode(loaded.cart.id, stored, executor)) ? state : null;
}

const DROPPED_SAMPLE_ISSUES = new Set(["sample_not_allowed", "sample_min_order", "sample_limit", "unavailable", "out_of_stock"]);

export type SyncResult = {
  changed: boolean;
  samplesRemoved: boolean;
  /** Paid lines whose stored quantity was lowered or raised to what stock and limits allow. */
  adjusted: { lineId: number; from: number; to: number }[];
};

/**
 * Makes the stored cart match what the engine decided: persists clamped quantities and deletes
 * samples that are no longer allowed (or can no longer be sent). `totals` was computed before the
 * lock, so each write is guarded by the quantity it was computed from: a change committed meanwhile
 * (another tab) is never overwritten; the next read clamps it again. Callers reload when `changed`.
 */
export async function syncCart(cartId: string, totals: CartTotals): Promise<SyncResult> {
  const drop = totals.lines.filter((l) => l.isSample && l.issues.some((i) => DROPPED_SAMPLE_ISSUES.has(i.code))).map((l) => l.lineId);
  const clamp = totals.lines.filter((l) => l.included && !l.isSample && l.issues.some((i) => i.code === "quantity_adjusted"));
  const sampleFix = totals.lines.filter((l) => l.included && l.isSample && l.issues.some((i) => i.code === "quantity_adjusted"));
  if (drop.length === 0 && clamp.length === 0 && sampleFix.length === 0) return { changed: false, samplesRemoved: false, adjusted: [] };
  const adjusted: SyncResult["adjusted"] = [];
  let removed = 0;
  await db.transaction(async (tx) => {
    const cart = await lockCart(tx, cartId, new Date());
    if (!cart) return;
    if (drop.length) {
      const rows = await tx.delete(cartItems).where(and(eq(cartItems.cartId, cartId), inArray(cartItems.id, drop))).returning({ id: cartItems.id });
      removed = rows.length;
    }
    for (const l of [...clamp, ...sampleFix]) {
      const rows = await tx
        .update(cartItems)
        .set({ quantity: l.quantity })
        .where(and(eq(cartItems.cartId, cartId), eq(cartItems.id, l.lineId), eq(cartItems.quantity, l.requestedQuantity)))
        .returning({ id: cartItems.id });
      if (rows.length && !l.isSample) adjusted.push({ lineId: l.lineId, from: l.requestedQuantity, to: l.quantity });
    }
  });
  return { changed: true, samplesRemoved: removed > 0, adjusted };
}
