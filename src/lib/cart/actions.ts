"use server";
// Cart Server Actions. Each one validates its input with zod, reads the cart from the httpOnly cookie,
// re-reads prices/stock on the server and returns a fresh CartView. The client never sends prices.

import { z } from "zod";
import { LOCALES } from "@/db/schema/common";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { defaultMessages, type Messages } from "@/i18n/messages";
import { getCustomerContext } from "@/lib/customer/context";
import { safeErrorInfo } from "@/lib/db-errors";
import { CONTROL_CHARS } from "@/lib/orders/checkout-schema";
import type { LimitEntry, RateRule } from "@/lib/rate-limit";
import { checkLimits, consumeLimits } from "@/lib/rate-limit-store";
import { clientIp } from "@/lib/request-ip";
import { isCardPaymentReadyFor } from "@/lib/payments/gateway";
import { formatPrice } from "@/lib/pricing/money";
import type {
  AddSampleInput,
  AddToCartInput,
  ApplyCouponInput,
  CartActionResult,
  CartErrorCode,
  CartNoticeCode,
  LocaleInput,
  RemoveLineInput,
  SetLineQuantityInput,
  SetLineSubscriptionInput,
} from "./action-types";
import { readCartId, writeCartId } from "./cookie";
import { loadCart } from "./load";
import { db } from "@/db";
import {
  addItem,
  addSampleItem,
  applyCouponCode,
  releaseDeadWheelCode,
  removeCouponCode,
  removeItem,
  setItemQuantity,
  setItemSubscription,
  syncCart,
  type CartMutationResult,
  type MutationContext,
} from "./mutations";
import { loadCommerceSettings } from "./settings";
import { totalsForLoadedCart } from "./totals";
import type { CouponState, CustomerContext } from "./types";
import { buildCartView, couponReasonMessage, type CartView } from "./view";
import { cartWheelPrize } from "./wheel-prize";

export type { CartActionResult } from "./action-types";

const locale = z.enum(LOCALES);
const id = z.coerce.number().int().positive().max(2_147_483_647);
const schemas = {
  add: z.object({ variantId: id, quantity: z.coerce.number().int().min(1).max(999).default(1), subscriptionPlanId: id.nullable().optional(), locale }),
  subscription: z.object({ lineId: id, planId: id.nullable(), locale }),
  setQuantity: z.object({ lineId: id, quantity: z.coerce.number().int().min(0).max(999), locale }),
  remove: z.object({ lineId: id, locale }),
  sample: z.object({ variantId: id, locale }),
  coupon: z.object({ code: z.string().max(64).refine((v) => !CONTROL_CHARS.test(v)), locale }),
  locale: z.object({ locale }),
};

const fallbackLocale = (input: unknown): Locale => {
  const l = (input as { locale?: unknown } | null)?.locale;
  return (LOCALES as readonly string[]).includes(l as string) ? (l as Locale) : "tr";
};

function fill(template: string, vars: Record<string, number> | undefined, loc: Locale): string {
  if (!vars) return template;
  const strings: Record<string, string | number> = { ...vars };
  if (typeof vars.amount === "number") strings.amount = formatPrice(vars.amount, loc);
  return format(template, strings, loc);
}

type CurrentView = {
  view: CartView;
  samplesRemoved: boolean;
  quantitiesAdjusted: boolean;
  /** Day 6: why a gift wheel code that stopped working was taken off the cart (localized), or null. */
  wheelReleased: string | null;
};

/** What the buyer is told when their dead wheel code leaves the cart. */
function releasedWheelNotice(state: CouponState, view: CartView, messages: Messages, loc: Locale): string | null {
  if (state.reason === "expired") return messages.wheel.cart.expired;
  // Below its minimum / nothing to discount: the prize is kept, and the prize row says when it applies.
  if (state.reason === "min_order" || state.reason === "no_eligible_items") return view.wheelPrize?.message ?? null;
  return couponReasonMessage(state.reason ?? "inactive", messages, loc, state.minOrderTotal);
}

async function currentView(cartId: string | null, customer: CustomerContext, loc: Locale, messages: Messages): Promise<CurrentView> {
  const now = new Date();
  const settings = await loadCommerceSettings();
  const cardGatewayReady = await isCardPaymentReadyFor(settings.payments, customer);
  const reload = () => loadCart(cartId, customer, { withSamples: true, now });
  let loaded = await reload();
  let totals = totalsForLoadedCart(loaded, settings, { cardGatewayReady, now });
  let samplesRemoved = false;
  let quantitiesAdjusted = false;
  let released: CouponState | null = null;
  if (loaded.cart) {
    const sync = await syncCart(loaded.cart.id, totals);
    if (sync.changed) {
      samplesRemoved = sync.samplesRemoved;
      quantitiesAdjusted = sync.adjusted.length > 0;
      loaded = await reload();
      totals = totalsForLoadedCart(loaded, settings, { cardGatewayReady, now });
    }
    // Day 6: a wheel code that stopped working never stays on the cart (it would block the checkout).
    released = await releaseDeadWheelCode(loaded, totals);
    if (released) {
      loaded = await reload();
      totals = totalsForLoadedCart(loaded, settings, { cardGatewayReady, now });
    }
  }
  const wheelPrize = await cartWheelPrize(db, { loaded, totals, settings, now });
  const view = buildCartView(totals, loaded, loc, messages, { wheelPrize, now });
  return { view, samplesRemoved, quantitiesAdjusted, wheelReleased: released ? releasedWheelNotice(released, view, messages, loc) : null };
}

/** Joins the action's own message with what happened on the side (syncCart, wheel prize), announced together. */
function withSideEffects(text: string, side: Omit<CurrentView, "view">, messages: Messages, extra: (string | null)[] = []): string {
  const parts = [
    text,
    ...extra,
    side.wheelReleased,
    side.quantitiesAdjusted ? messages.cart.notices.quantities_adjusted : null,
    side.samplesRemoved ? messages.cart.notices.samples_removed : null,
  ];
  return parts.filter(Boolean).join(" ");
}

async function respond(
  loc: Locale,
  cartIdBefore: string | null,
  customer: CustomerContext,
  messages: Messages,
  result: CartMutationResult,
): Promise<CartActionResult> {
  if (result.ok && (result.created || result.refreshCookie || result.cartId !== cartIdBefore)) await writeCartId(result.cartId);
  const current = await currentView(result.cartId ?? cartIdBefore, customer, loc, messages);
  const { view } = current;
  if (!result.ok) return { ok: false, code: result.code, error: withSideEffects(fill(messages.cart.errors[result.code], result.vars, loc), current, messages), view };
  // Stock-driven changes to other lines are never silent: they are announced with the action's notice.
  const noticeCode: CartNoticeCode = current.samplesRemoved ? "samples_removed" : current.quantitiesAdjusted ? "quantities_adjusted" : result.notice;
  // Day 6: a gift wheel prize that this write put on the cart is announced with it.
  const autoApplied = result.autoApplied && view.coupon?.status === "applied" ? messages.wheel.cart.applied : null;
  return { ok: true, view, noticeCode, notice: withSideEffects(fill(messages.cart.notices[result.notice], result.vars, loc), current, messages, [autoApplied]) };
}

async function failure(input: unknown, code: CartErrorCode, error?: unknown): Promise<CartActionResult> {
  if (error) console.error("[cart] action failed", safeErrorInfo(error)); // never the message: SQL params
  const loc = fallbackLocale(input);
  let messages: Messages | null = null;
  try {
    messages = await getMessages(loc);
  } catch {
    // fall through to the built-in dictionary below
  }
  return { ok: false, code, error: (messages ?? defaultMessages[loc]).cart.errors[code] };
}

type Mutation<T> = (cartId: string | null, data: T, ctx: MutationContext) => Promise<CartMutationResult>;

async function runAction<S extends z.ZodType<{ locale: Locale }>>(schema: S, input: unknown, mutate: Mutation<z.output<S>>): Promise<CartActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure(input, "invalid_input");
  const data = parsed.data;
  try {
    const [cartId, customer, messages] = await Promise.all([readCartId(), getCustomerContext(), getMessages(data.locale)]);
    const result = await mutate(cartId, data, { customer, locale: data.locale });
    return await respond(data.locale, cartId, customer, messages, result);
  } catch (error) {
    return failure(input, "generic", error);
  }
}

/** Adds a paid variant (merged with an existing line). quantity defaults to 1. */
export async function addToCart(input: AddToCartInput): Promise<CartActionResult> {
  return runAction(schemas.add, input, (cartId, d, ctx) =>
    addItem(cartId, { variantId: d.variantId, quantity: d.quantity, ...(d.subscriptionPlanId !== undefined ? { subscriptionPlanId: d.subscriptionPlanId } : {}) }, ctx),
  );
}

/** Subscribe and save: puts a cart line on a plan (planId) or back to a one-time purchase (null). */
export async function setLineSubscription(input: SetLineSubscriptionInput): Promise<CartActionResult> {
  return runAction(schemas.subscription, input, (cartId, d, ctx) => setItemSubscription(cartId, { lineId: d.lineId, planId: d.planId }, ctx));
}

/** Sets a line's quantity; 0 removes the line. */
export async function setLineQuantity(input: SetLineQuantityInput): Promise<CartActionResult> {
  return runAction(schemas.setQuantity, input, (cartId, d, ctx) => setItemQuantity(cartId, { lineId: d.lineId, quantity: d.quantity }, ctx));
}

export async function removeLine(input: RemoveLineInput): Promise<CartActionResult> {
  return runAction(schemas.remove, input, (cartId, d, ctx) => removeItem(cartId, { lineId: d.lineId }, ctx));
}

/** Adds a free sample (quantity 1) when samples are allowed for this cart. */
export async function addSample(input: AddSampleInput): Promise<CartActionResult> {
  return runAction(schemas.sample, input, (cartId, d, ctx) => addSampleItem(cartId, { variantId: d.variantId }, ctx));
}

/** Failed coupon attempts per client before applyCoupon pauses (guessing codes). Durable, all instances. */
const COUPON_GUESS_RULE: RateRule = { limit: 15, windowMs: 15 * 60_000 };
const COUPON_FAILURES = new Set<CartErrorCode>(["coupon_not_found", "coupon_inactive", "coupon_expired", "coupon_not_started", "coupon_exhausted"]);

/** Validates the code against the cart and stores it only when it applies now. */
export async function applyCoupon(input: ApplyCouponInput): Promise<CartActionResult> {
  const key: LimitEntry[] = [[`coupon:ip:${await clientIp()}`, COUPON_GUESS_RULE]];
  const wait = (await checkLimits(key)).retryAfterMinutes;
  if (wait > 0) {
    const loc = fallbackLocale(input);
    const messages = await getMessages(loc).catch(() => defaultMessages[loc]);
    return { ok: false, code: "rate_limited", error: format(messages.cart.errors.rate_limited, { minutes: wait }, loc) };
  }
  const result = await runAction(schemas.coupon, input, (cartId, d, ctx) => applyCouponCode(cartId, { code: d.code }, ctx));
  if (!result.ok && COUPON_FAILURES.has(result.code)) await consumeLimits(key);
  return result;
}

export async function removeCoupon(input: LocaleInput): Promise<CartActionResult> {
  const parsed = schemas.locale.safeParse(input);
  if (!parsed.success) return failure(input, "invalid_input");
  const loc = parsed.data.locale;
  try {
    const [cartId, customer, messages] = await Promise.all([readCartId(), getCustomerContext(), getMessages(loc)]);
    if (!cartId) {
      const { view } = await currentView(null, customer, loc, messages);
      return { ok: true, view, noticeCode: "coupon_removed", notice: messages.cart.notices.coupon_removed };
    }
    return await respond(loc, cartId, customer, messages, await removeCouponCode(cartId, { customer, locale: loc }));
  } catch (error) {
    return failure(input, "generic", error);
  }
}

/**
 * The current cart (also prunes samples that are no longer allowed, persists clamped quantities and
 * takes a gift wheel code that stopped working off the cart).
 */
export async function getCart(input: LocaleInput): Promise<CartActionResult> {
  const parsed = schemas.locale.safeParse(input);
  if (!parsed.success) return failure(input, "invalid_input");
  const loc = parsed.data.locale;
  try {
    const [cartId, customer, messages] = await Promise.all([readCartId(), getCustomerContext(), getMessages(loc)]);
    const current = await currentView(cartId, customer, loc, messages);
    const notice = withSideEffects("", current, messages);
    if (!notice) return { ok: true, view: current.view };
    const noticeCode: CartNoticeCode | null = current.samplesRemoved ? "samples_removed" : current.quantitiesAdjusted ? "quantities_adjusted" : null;
    return { ok: true, view: current.view, notice, ...(noticeCode ? { noticeCode } : {}) };
  } catch (error) {
    return failure(input, "generic", error);
  }
}
