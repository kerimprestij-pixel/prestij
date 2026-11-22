// Day 6 CORE: account-bound coupons. couponEligibility's "not_owner" rule (first, reveals nothing), the
// money engine's coupon state (endsAt / source for the countdown; nothing passed on for another account's
// code), the CartView fields and the localized refusal in all three languages.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultMessages } from "@/i18n/messages";
import { computeCart } from "@/lib/cart/compute";
import type { LoadedCart } from "@/lib/cart/load";
import { RETAIL_CUSTOMER, type EngineLine } from "@/lib/cart/types";
import { buildCartView, couponReasonMessage } from "@/lib/cart/view";
import { couponEligibility, isForeignCoupon } from "@/lib/coupons/eligibility";
import { BUSINESS, coupon, input, line, NOW } from "./helpers";

const lines = [
  { lineId: 1, productId: 1, categoryId: 1, isSample: false, lineSubtotal: 14990 },
  { lineId: 2, productId: 2, categoryId: 2, isSample: false, lineSubtotal: 44990 },
];
const ctx = (userId: string | null) => ({ lines, subtotal: 59980, customer: { ...RETAIL_CUSTOMER, userId }, now: NOW });
const WINNER = "user-winner";
const ENDS = new Date(NOW.getTime() + 72 * 3600_000);
const wheelCoupon = (over: Parameters<typeof coupon>[0] = {}) =>
  coupon({ code: "CARK-ABC234", source: "wheel", userId: WINNER, maxUses: 1, perCustomerLimit: 1, startsAt: NOW, endsAt: ENDS, ...over });

describe("couponEligibility: owner rule", () => {
  test("a coupon bound to an account is valid only for that account", () => {
    assert.equal(couponEligibility(wheelCoupon(), ctx(WINNER)).valid, true);
    for (const other of ["someone-else", null]) {
      const r = couponEligibility(wheelCoupon(), ctx(other));
      assert.equal(r.valid, false);
      assert.equal(!r.valid && r.reason, "not_owner", String(other));
    }
    const noUserKey = couponEligibility(wheelCoupon(), { lines, subtotal: 59980, customer: { groupId: null }, now: NOW });
    assert.equal(!noUserKey.valid && noUserKey.reason, "not_owner", "a customer without userId is signed out");
  });

  test("the owner check comes first and reports no eligible lines (nothing about the code leaks)", () => {
    const dead = wheelCoupon({ isActive: false, endsAt: new Date(NOW.getTime() - 1), minOrderTotal: 9_999_999 });
    const r = couponEligibility(dead, ctx("intruder"));
    assert.deepEqual(r, { valid: false, reason: "not_owner", eligibleLineIds: [], eligibleSubtotal: 0 });
    const own = couponEligibility(dead, ctx(WINNER));
    assert.equal(!own.valid && own.reason, "inactive", "the owner sees the real reason");
  });

  test("coupons without an owner work for everyone, as before", () => {
    for (const userId of [null, "anyone"]) assert.equal(couponEligibility(coupon(), ctx(userId)).valid, true);
    assert.equal(couponEligibility(coupon({ userId: undefined }), ctx(null)).valid, true);
    assert.equal(isForeignCoupon({ userId: null }, null), false);
    assert.equal(isForeignCoupon({ userId: "" }, null), false, "an empty owner is no owner");
    assert.equal(isForeignCoupon({ userId: "a" }, "a"), false);
    assert.equal(isForeignCoupon({ userId: "a" }, "b"), true);
  });
});

describe("money engine: coupon state", () => {
  test("a wheel prize reports its real expiry and its source", () => {
    const t = computeCart(input([line()], { coupon: wheelCoupon({ value: 10 }), customer: { ...RETAIL_CUSTOMER, userId: WINNER } }));
    assert.equal(t.coupon?.status, "applied");
    assert.equal(t.coupon?.endsAt, ENDS.toISOString());
    assert.equal(t.coupon?.source, "wheel");
    assert.equal(t.discounts.coupon, 1499);
  });

  test("another account's code: invalid, no discount, and no expiry, origin or minimum passed on", () => {
    const t = computeCart(input([line()], { coupon: wheelCoupon({ minOrderTotal: 30000 }), customer: BUSINESS }));
    assert.equal(t.coupon?.status, "invalid");
    assert.equal(t.coupon?.reason, "not_owner");
    assert.equal(t.coupon?.discount, 0);
    assert.equal(t.coupon?.minOrderTotal, 0);
    assert.equal(t.coupon?.endsAt, undefined);
    assert.equal(t.coupon?.source, undefined);
    assert.equal(t.discounts.coupon, 0);
  });

  test("a manual coupon without an end has no endsAt", () => {
    const t = computeCart(input([line()], { coupon: coupon() }));
    assert.equal(t.coupon?.endsAt, undefined);
    assert.equal(t.coupon?.source, "manual");
  });
});

function loaded(engineLines: EngineLine[]): LoadedCart {
  return {
    cart: { id: "00000000-0000-4000-8000-000000000000", couponCode: "CARK-ABC234", locale: "tr", expiresAt: null },
    customer: RETAIL_CUSTOMER,
    lines: engineLines.map((l) => ({
      ...l,
      display: {
        productSlug: "lavanta",
        name: { tr: "Lavanta" },
        subtitle: null,
        accentColor: null,
        sku: `SKU-${l.variantId}`,
        barcode: null,
        variantLabels: [],
        image: null,
        volumeMl: 500,
        lowStockThreshold: 5,
      },
    })),
    coupon: null,
    campaigns: [],
    sampleOffers: [],
  };
}

describe("cart view", () => {
  test("CartView.coupon carries endsAt and source for the countdown", () => {
    const engineLines = [line()];
    const totals = computeCart(input(engineLines, { coupon: wheelCoupon(), customer: { ...RETAIL_CUSTOMER, userId: WINNER } }));
    const view = buildCartView(totals, loaded(engineLines), "tr");
    assert.equal(view.coupon?.endsAt, ENDS.toISOString());
    assert.equal(view.coupon?.source, "wheel");
    assert.equal(view.coupon?.message, defaultMessages.tr.cart.couponApplied);
  });

  test("a foreign code on the cart explains itself in tr/en/ar (cart.errors.coupon_not_owner)", () => {
    const engineLines = [line()];
    const totals = computeCart(input(engineLines, { coupon: wheelCoupon() }));
    for (const locale of ["tr", "en", "ar"] as const) {
      const view = buildCartView(totals, loaded(engineLines), locale);
      assert.equal(view.coupon?.reason, "not_owner");
      assert.equal(view.coupon?.endsAt, undefined);
      assert.equal(view.coupon?.message, defaultMessages[locale].cart.errors.coupon_not_owner);
      assert.ok(view.coupon?.message.length, locale);
      assert.equal(couponReasonMessage("not_owner", defaultMessages[locale], locale), defaultMessages[locale].cart.errors.coupon_not_owner);
    }
  });
});
