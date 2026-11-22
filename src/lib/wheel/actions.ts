"use server";
// Gift wheel Server Actions (storefront). Every action is a public POST endpoint: the input is only a
// locale; the session, the spin cookie and the cart cookie are read here, never taken from the client.
//   loadWheel({ locale })  → WheelState        lazy: the island calls it when a trigger fires / the dialog opens
//   claimWheel({ locale }) → WheelClaimResult  signed-in visitor with a held spin: issue the prize, auto-apply it
// Spinning is the Route Handler POST /api/wheel/spin (it sets the httpOnly spin cookie; a cookie write in
// a Server Action would re-render the current page). Neither action writes a cookie.
import { z } from "zod";
import { db } from "@/db";
import { LOCALES, type Locale } from "@/i18n/locales";
import { getMessages, type Messages } from "@/i18n/get-messages";
import { readCartId } from "@/lib/cart/cookie";
import { getCartView } from "@/lib/cart/queries";
import { loadCommerceSettings } from "@/lib/cart/settings";
import type { CartView } from "@/lib/cart/view";
import { safeErrorInfo } from "@/lib/db-errors";
import { checkLimits } from "@/lib/rate-limit-store";
import { getSession } from "@/lib/session";
import { readWheelSpinId } from "./cookie";
import { wheelScheduleState } from "./eligibility";
import { requestIp, wheelClaimLimiter, wheelSpinLimitKey } from "./hooks";
import { wheelLegalLinks } from "./links";
import { generatedPrizeLabel, prizeLabel, prizeSummary, prizeView } from "./prize";
import { findActiveWheelCoupon } from "./prize-coupons";
import { autoApplyWheelPrize, claimSpinForAccount, heldSliceIndex, holdUntilOf, isSpinPendingVerification, readWheelConfig, resolveWheelVisitor, type WheelConfig } from "./service";
import { WHEEL_RATE_LIMITS, wheelDisplaySlices, wheelText, type WheelActivePrize, type WheelClaimResult, type WheelEligibilityReason, type WheelErrorCode, type WheelState, type WheelTexts } from "./types";

const input = z.object({ locale: z.enum(LOCALES).catch("tr") }).catch({ locale: "tr" });

function resolveTexts(config: WheelConfig | null, locale: Locale, m: Messages["wheel"]): WheelTexts {
  const t = config?.wheel.texts ?? {};
  return {
    title: wheelText(t.title, locale, m.dialog.title),
    subtitle: wheelText(t.subtitle, locale, m.dialog.subtitle),
    teaser: wheelText(t.teaser, locale, m.teaser.label),
    claimCta: wheelText(t.claimCta, locale, m.claim.claimCta),
    registerCta: wheelText(t.registerCta, locale, m.claim.registerCta),
    signInCta: wheelText(t.signInCta, locale, m.claim.signInCta),
  };
}

/** The visitor's wheel state for `locale` (eligibility, held spin, active prize, display slices, texts, links). */
export async function loadWheel(raw: { locale: string }): Promise<WheelState> {
  const { locale } = input.parse(raw);
  const messages = await getMessages(locale);
  const m = messages.wheel;
  try {
    const now = new Date();
    const [config, session, cookieSpinId] = await Promise.all([readWheelConfig(db), getSession(), readWheelSpinId()]);
    const userId = session?.user?.id ?? null;
    const commerce = userId ? await loadCommerceSettings() : undefined;
    const [visitor, links] = await Promise.all([
      resolveWheelVisitor(db, { config, userId, cookieSpinId, now, commerce }),
      config.wheel.enabled ? wheelLegalLinks(db, locale) : Promise.resolve({ terms: null, privacy: null }),
    ]);
    // A signed-in customer's usable prize feeds the reminder chip even when the wheel itself is closed now.
    // (Not for banned or deleted accounts: "unavailable".)
    const active = userId && visitor.reason !== "unavailable" ? await findActiveWheelCoupon(db, userId, now) : null;
    const activePrize: WheelActivePrize | null = active
      ? { code: active.code, label: prizeLabel({ type: active.type, value: active.value, label: active.label }, locale, m), endsAt: active.endsAt.toISOString() }
      : null;
    const held = visitor.held;
    // A new spin would hit the per-IP spin limit: say so before the visitor presses the button (read-only).
    let reason: WheelEligibilityReason = visitor.reason;
    if (reason === "eligible" && !held && !(await checkLimits([[wheelSpinLimitKey(await requestIp()), WHEEL_RATE_LIMITS.spinsPerIp]])).allowed) reason = "spin_limit";
    const showSlices = config.wheel.enabled && (held != null || (reason === "eligible" && wheelScheduleState(config.wheel, now) === "live"));
    return {
      eligible: reason === "eligible",
      reason,
      signedIn: Boolean(userId),
      spin: held
        ? {
            sliceIndex: heldSliceIndex(held, config.wheel),
            prize: prizeView(held.prize, { validityHours: config.wheel.validityHours, heavySurcharge: config.heavySurcharge }, locale, m),
            holdUntil: holdUntilOf(held, config.wheel).toISOString(),
            claim: visitor.account ? "claim" : "register",
            ...(isSpinPendingVerification(held, Boolean(visitor.account)) ? { pending: true } : {}),
          }
        : null,
      activePrize,
      slices: showSlices ? wheelDisplaySlices(config.wheel.slices, locale, (slice) => generatedPrizeLabel(slice, locale, m)) : [],
      texts: resolveTexts(config, locale, m),
      links,
      validityHours: config.wheel.validityHours,
    };
  } catch (error) {
    console.error("[wheel] load failed", safeErrorInfo(error));
    return {
      eligible: false,
      reason: "unavailable",
      signedIn: false,
      spin: null,
      activePrize: null,
      slices: [],
      texts: resolveTexts(null, locale, m),
      links: { terms: null, privacy: null },
      validityHours: 72,
    };
  }
}

/**
 * Claims the signed-in visitor's held spin: the account rules, the per-IP claim limit, bind, issue (coupon
 * + wheel_prize mail), then auto-apply the new code to the account's cart. Returns the fresh cart view
 * when the cart changed (the island calls publishCartView).
 */
export async function claimWheel(raw: { locale: string }): Promise<WheelClaimResult> {
  const { locale } = input.parse(raw);
  const m = (await getMessages(locale)).wheel;
  const fail = (error: WheelErrorCode): WheelClaimResult => ({ ok: false, error, message: m.errors[error] });
  try {
    const session = await getSession();
    const userId = session?.user?.id;
    if (!userId) return fail("sign_in_required");
    const now = new Date();
    const [config, cookieSpinId, cartId, ip, commerce] = await Promise.all([readWheelConfig(db), readWheelSpinId(), readCartId(), requestIp(), loadCommerceSettings()]);
    const outcome = await db.transaction(async (tx) => {
      const claim = await claimSpinForAccount(tx, { userId, cookieSpinId, via: "signed_in", config, now, commerce, consumeClaimLimit: wheelClaimLimiter(ip) });
      if (!claim.ok) return { claim, applied: false };
      let applied = false;
      try {
        // Savepoint: a cart problem never undoes the prize.
        const result = await tx.transaction((sp) =>
          autoApplyWheelPrize(sp, { userId, cartId, now, code: claim.issued.code, customer: claim.account.customer, commerce }),
        );
        applied = result?.status === "applied";
      } catch (error) {
        console.error("[wheel] auto-apply after claim failed", safeErrorInfo(error));
      }
      return { claim, applied };
    });
    if (!outcome.claim.ok) return fail(outcome.claim.error);
    const { issued } = outcome.claim;
    let cart: CartView | undefined;
    if (outcome.applied) {
      try {
        cart = await getCartView(locale);
      } catch (error) {
        console.error("[wheel] cart view after claim failed", safeErrorInfo(error));
      }
    }
    return {
      ok: true,
      prize: {
        code: issued.code,
        label: prizeLabel(issued.prize, locale, m),
        endsAt: issued.endsAt.toISOString(),
        summary: prizeSummary(issued.prize, { validityHours: config.wheel.validityHours, heavySurcharge: config.heavySurcharge }, locale, m),
      },
      applied: outcome.applied,
      ...(cart ? { cart } : {}),
    };
  } catch (error) {
    console.error("[wheel] claim failed", safeErrorInfo(error));
    return fail("unavailable");
  }
}
