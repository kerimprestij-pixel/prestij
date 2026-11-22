import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { allocate, computeCart, roundDiv, vatIncluded } from "@/lib/cart/compute";
import { PAYMENT_METHODS, RETAIL_CUSTOMER, type CartTotals, type CouponData, type EngineLine, type MethodTotals } from "@/lib/cart/types";
import { BUSINESS, coupon, input, line, NOW, rng, sample, settings } from "./helpers";

const only = (t: CartTotals) => t.lines[0];
const codes = (t: CartTotals) => t.issues.map((i) => i.code);
const method = (t: CartTotals, m: (typeof PAYMENT_METHODS)[number]) => t.paymentMethods.find((x) => x.method === m)!;

describe("integer helpers", () => {
  test("roundDiv rounds halves up and never goes negative", () => {
    assert.equal(roundDiv(224850, 100), 2249); // 2248.5
    assert.equal(roundDiv(104930, 100), 1049); // 1049.3
    assert.equal(roundDiv(3, 6), 1); // 0.5
    assert.equal(roundDiv(2, 6), 0);
    assert.equal(roundDiv(0, 7), 0);
    assert.equal(roundDiv(-5, 7), 0);
    assert.throws(() => roundDiv(1, 0));
  });
  test("vatIncluded = round(amount × rate / (100 + rate))", () => {
    assert.equal(vatIncluded(14990, 20), 2498);
    assert.equal(vatIncluded(9990, 20), 1665);
    assert.equal(vatIncluded(11000, 10), 1000);
    assert.equal(vatIncluded(12741, 20), 2124); // 2123.5 → 2124
    assert.equal(vatIncluded(5000, 0), 0);
  });
  test("allocate: largest remainder, exact sum, deterministic ties", () => {
    assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(allocate(2, [1, 1, 1]), [1, 1, 0]);
    assert.deepEqual(allocate(1, [1, 2]), [0, 1]);
    assert.deepEqual(allocate(10, [3, 3, 4]), [3, 3, 4]);
    assert.deepEqual(allocate(5, [0, 10]), [0, 5]);
    assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
    assert.deepEqual(allocate(7, [0, 0]), [0, 0]);
    assert.deepEqual(allocate(69290, [14990, 44990, 149990]), [4947, 14847, 49496]);
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const weights = Array.from({ length: 1 + Math.floor(r() * 8) }, () => Math.floor(r() * 2_000_000));
      const total = Math.floor(r() * (weights.reduce((a, b) => a + b, 0) + 1));
      const shares = allocate(total, weights);
      assert.equal(shares.reduce((a, b) => a + b, 0), weights.some((w) => w > 0) ? total : 0);
      shares.forEach((s, j) => assert.ok(s >= 0 && s <= weights[j], `share ${s} > weight ${weights[j]}`));
    }
  });
});

describe("basics", () => {
  test("single line: subtotal, flat shipping, VAT, grand total", () => {
    const t = computeCart(input([line({ quantity: 2 })]));
    assert.equal(t.subtotal, 29980);
    assert.equal(t.shipping.flat, 9990);
    assert.equal(t.shipping.heavy, 0);
    assert.equal(t.shipping.total, 9990);
    assert.equal(t.shipping.remainingForFree, 120020);
    assert.equal(t.paymentFee, 0);
    assert.equal(t.discountTotal, 0);
    assert.equal(t.vatTotal, 4997 + 1665);
    assert.equal(t.grandTotal, 39970);
    assert.equal(t.itemCount, 2);
    assert.equal(t.totalWeightGrams, 1500);
    assert.equal(t.checkoutAllowed, true);
    assert.deepEqual(t.issues, []);
  });

  test("empty cart: blocking 'empty', everything 0, no shipping", () => {
    const t = computeCart(input([]));
    assert.deepEqual(codes(t), ["empty"]);
    assert.equal(t.grandTotal, 0);
    assert.equal(t.shipping.flat, 0);
    assert.equal(t.shipping.free, false);
    assert.equal(t.checkoutAllowed, false);
  });

  test("VAT per line rate plus shipping at 20 %", () => {
    const t = computeCart(input([line({ basePrice: 11000, vatRate: 10 }), line({ basePrice: 14990 }), line({ basePrice: 5000, vatRate: 0 })]));
    assert.equal(t.vatTotal, 1000 + 2498 + 0 + 1665);
  });
});

describe("coupons", () => {
  test("percent with an odd result rounds half up (15 % of 149,90 ₺ = 22,485 → 22,49 ₺)", () => {
    const t = computeCart(input([line()], { coupon: coupon({ value: 15 }) }));
    assert.equal(t.coupon?.status, "applied");
    assert.equal(t.discounts.coupon, 2249);
    assert.equal(only(t).lineTotal, 12741);
    assert.equal(t.vatTotal, 2124 + 1665);
    assert.equal(t.grandTotal, 14990 - 2249 + 9990);
  });

  test("7 % rounds down when below .5", () => {
    assert.equal(computeCart(input([line()], { coupon: coupon({ value: 7 }) })).discounts.coupon, 1049);
  });

  test("33 % over three lines: allocated exactly with largest remainder", () => {
    const lines = [line({ basePrice: 14990, weightGrams: 750 }), line({ basePrice: 44990, weightGrams: 5300 }), line({ basePrice: 149990, weightGrams: 21000 })];
    const t = computeCart(input(lines, { coupon: coupon({ value: 33 }) }));
    assert.equal(t.discounts.coupon, 69290);
    assert.deepEqual(
      t.lines.map((l) => l.couponDiscount),
      [4947, 14847, 49496],
    );
    assert.equal(
      t.lines.reduce((s, l) => s + l.discount, 0),
      t.discountTotal,
    );
    // Merchandise after coupon 140680 < 150000 → flat fee; 27050 g → 18 kg over → 27000.
    assert.equal(t.shipping.flat, 9990);
    assert.equal(t.shipping.heavyKg, 18);
    assert.equal(t.shipping.heavy, 27000);
    assert.equal(t.grandTotal, 209970 - 69290 + 9990 + 27000);
  });

  test("fixed is capped at the eligible total", () => {
    const t = computeCart(input([line()], { coupon: coupon({ type: "fixed", value: 50000 }) }));
    assert.equal(t.discounts.coupon, 14990);
    assert.equal(only(t).lineTotal, 0);
    assert.equal(t.grandTotal, 9990);
    const small = computeCart(input([line()], { coupon: coupon({ type: "fixed", value: 1000 }) }));
    assert.equal(small.discounts.coupon, 1000);
  });

  test("productIds limit eligible lines; fixed capped at the eligible lines only", () => {
    const t = computeCart(
      input([line({ productId: 1, basePrice: 14990 }), line({ productId: 2, basePrice: 44990 })], { coupon: coupon({ type: "fixed", value: 20000, productIds: [1] }) }),
    );
    assert.equal(t.discounts.coupon, 14990);
    assert.deepEqual(
      t.lines.map((l) => [l.couponEligible, l.couponDiscount]),
      [
        [true, 14990],
        [false, 0],
      ],
    );
  });

  test("categoryIds limit eligible lines; no eligible line → invalid", () => {
    const ok = computeCart(input([line({ categoryId: 5 }), line({ categoryId: 1 })], { coupon: coupon({ categoryIds: [5] }) }));
    assert.equal(ok.discounts.coupon, 1499);
    const none = computeCart(input([line({ categoryId: 1 })], { coupon: coupon({ categoryIds: [5] }) }));
    assert.equal(none.coupon?.status, "invalid");
    assert.equal(none.coupon?.reason, "no_eligible_items");
    assert.equal(none.discounts.coupon, 0);
  });

  test("customer groups: retail refused, the listed group accepted", () => {
    const c = coupon({ customerGroupIds: [2] });
    const retail = computeCart(input([line()], { coupon: c }));
    assert.equal(retail.coupon?.reason, "group_not_allowed");
    const business = computeCart(input([line()], { coupon: c, customer: BUSINESS }));
    assert.equal(business.coupon?.status, "applied");
    // 14990 − 15 % group = 12742; 10 % of that = 1274.2 → 1274
    assert.equal(business.discounts.coupon, 1274);
  });

  test("window: starts inclusive, ends exclusive", () => {
    const at = (c: Partial<CouponData>) => computeCart(input([line()], { coupon: coupon(c) })).coupon!;
    assert.equal(at({ startsAt: new Date(NOW.getTime() + 1) }).reason, "not_started");
    assert.equal(at({ startsAt: NOW }).status, "applied");
    assert.equal(at({ endsAt: NOW }).reason, "expired");
    assert.equal(at({ endsAt: new Date(NOW.getTime() + 1) }).status, "applied");
    assert.equal(at({ isActive: false }).reason, "inactive");
  });

  test("maxUses: usedCount must stay below it (null = unlimited)", () => {
    const at = (c: Partial<CouponData>) => computeCart(input([line()], { coupon: coupon(c) })).coupon!;
    assert.equal(at({ maxUses: 5, usedCount: 5 }).reason, "exhausted");
    assert.equal(at({ maxUses: 5, usedCount: 4 }).status, "applied");
    assert.equal(at({ maxUses: 0, usedCount: 0 }).reason, "exhausted");
    assert.equal(at({ maxUses: null, usedCount: 10_000 }).status, "applied");
  });

  test("minOrderTotal is met by the merchandise subtotal (inclusive)", () => {
    assert.equal(computeCart(input([line()], { coupon: coupon({ minOrderTotal: 20000 }) })).coupon?.reason, "min_order");
    assert.equal(computeCart(input([line()], { coupon: coupon({ minOrderTotal: 14990 }) })).coupon?.status, "applied");
    assert.equal(computeCart(input([line({ quantity: 2 })], { coupon: coupon({ minOrderTotal: 20000 }) })).coupon?.status, "applied");
  });

  test("samples are never eligible", () => {
    const t = computeCart(input([line(), sample()], { coupon: coupon({ productIds: [90] }) }));
    assert.equal(t.coupon?.reason, "no_eligible_items");
  });

  test("free_shipping coupon waives the flat fee but not the heavy surcharge", () => {
    const t = computeCart(input([line({ basePrice: 149990, weightGrams: 21000 })], { coupon: coupon({ type: "free_shipping" }) }));
    assert.equal(t.coupon?.status, "applied");
    assert.equal(t.discounts.coupon, 0);
    assert.equal(t.shipping.flat, 0);
    assert.equal(t.shipping.free, true);
    assert.equal(t.shipping.freeReason, "coupon");
    assert.equal(t.shipping.heavyKg, 11);
    assert.equal(t.shipping.heavy, 16500);
    assert.equal(t.grandTotal, 149990 + 16500);
  });

  test("free_shipping coupon on a cart that ships free anyway: the reason is the threshold (the code saved nothing)", () => {
    const t = computeCart(input([line({ basePrice: 150000, weightGrams: 0 })], { coupon: coupon({ type: "free_shipping" }) }));
    assert.equal(t.coupon?.status, "applied");
    assert.equal(t.shipping.free, true);
    assert.equal(t.shipping.freeReason, "threshold");
    assert.equal(t.discounts.coupon, 0);
  });
});

describe("shipping", () => {
  test("free at exactly the threshold, flat fee 1 kuruş below", () => {
    const at = computeCart(input([line({ basePrice: 150000, weightGrams: 0 })]));
    assert.equal(at.shipping.free, true);
    assert.equal(at.shipping.freeReason, "threshold");
    assert.equal(at.shipping.total, 0);
    assert.equal(at.shipping.remainingForFree, 0);
    const below = computeCart(input([line({ basePrice: 149999, weightGrams: 0 })]));
    assert.equal(below.shipping.free, false);
    assert.equal(below.shipping.flat, 9990);
    assert.equal(below.shipping.remainingForFree, 1);
  });

  test("threshold uses the merchandise after the coupon", () => {
    const t = computeCart(input([line({ basePrice: 160000, weightGrams: 0 })], { coupon: coupon({ type: "fixed", value: 10001 }) }));
    assert.equal(t.shipping.flat, 9990);
    assert.equal(t.shipping.remainingForFree, 1);
  });

  test("threshold 0 means never free", () => {
    const t = computeCart(input([line({ basePrice: 900000, weightGrams: 0 })], { settings: settings({ shipping: { freeThreshold: 0 } }) }));
    assert.equal(t.shipping.flat, 9990);
    assert.equal(t.shipping.remainingForFree, 0);
  });

  test("heavy surcharge: none at exactly the threshold, 1 kg at 1 g above, per started kg", () => {
    const heavy = (g: number) => computeCart(input([line({ weightGrams: g })])).shipping;
    assert.equal(heavy(10000).heavy, 0);
    assert.equal(heavy(10001).heavy, 1500);
    assert.equal(heavy(10001).heavyKg, 1);
    assert.equal(heavy(11000).heavy, 1500);
    assert.equal(heavy(11001).heavy, 3000);
  });

  test("heavy surcharge applies even when shipping is free; weight includes samples", () => {
    const t = computeCart(input([line({ basePrice: 149990, weightGrams: 21000, quantity: 2 }), sample({ weightGrams: 1000 })]));
    assert.equal(t.shipping.free, true);
    assert.equal(t.totalWeightGrams, 43000);
    assert.equal(t.shipping.heavyKg, 33);
    assert.equal(t.shipping.total, 49500);
  });

  test("heavy disabled", () => {
    const t = computeCart(input([line({ weightGrams: 50000 })], { settings: settings({ shipping: { heavy: { enabled: false, thresholdGrams: 10000, feePerKg: 1500 } } }) }));
    assert.equal(t.shipping.heavy, 0);
  });
});

describe("payment methods", () => {
  test("havale discount is applied after the coupon, on merchandise only", () => {
    const t = computeCart(input([line({ quantity: 2 })], { coupon: coupon({ value: 10 }), paymentMethod: "bank_transfer" }));
    assert.equal(t.discounts.coupon, 2998);
    assert.equal(t.discounts.bankTransfer, 1349); // 5 % of 26982 = 1349.1
    assert.equal(t.discountTotal, 4347);
    assert.equal(t.grandTotal, 29980 - 4347 + 9990);
    assert.equal(only(t).discount, 4347);
    assert.deepEqual(method(t, "bank_transfer").totals.grandTotal, t.grandTotal);
    assert.equal(method(t, "card").totals.grandTotal, 29980 - 2998 + 9990);
  });

  test("havale does not affect the free-shipping threshold", () => {
    const t = computeCart(input([line({ basePrice: 150000, weightGrams: 0 })], { paymentMethod: "bank_transfer" }));
    assert.equal(t.shipping.free, true);
    assert.equal(t.discounts.bankTransfer, 7500);
    assert.equal(t.grandTotal, 142500);
  });

  test("kapıda ödeme adds its fee; unavailable above maxOrderTotal (before the fee)", () => {
    const at = computeCart(input([line({ basePrice: 500000, weightGrams: 0 })], { paymentMethod: "cash_on_delivery" }));
    assert.equal(method(at, "cash_on_delivery").available, true);
    assert.equal(at.paymentFee, 4990);
    assert.equal(at.grandTotal, 504990);
    assert.equal(at.vatTotal, vatIncluded(500000, 20) + vatIncluded(4990, 20));
    const over = computeCart(input([line({ basePrice: 500001, weightGrams: 0 })]));
    const cod = method(over, "cash_on_delivery");
    assert.equal(cod.available, false);
    assert.equal(cod.reason, "over_limit");
    assert.equal(cod.limit, 500000);
    assert.equal(cod.totals.paymentFee, 4990);
    const unlimited = computeCart(input([line({ basePrice: 900000 })], { settings: settings({ payments: { cashOnDelivery: { enabled: true, fee: 4990, maxOrderTotal: 0 } } }) }));
    assert.equal(method(unlimited, "cash_on_delivery").available, true);
  });

  test("availability reasons", () => {
    const base = settings();
    const t = computeCart(
      input([line()], {
        settings: settings({ payments: { ...base.payments, card: { ...base.payments.card, enabled: false }, bankTransfer: { ...base.payments.bankTransfer, accounts: [] } } }),
      }),
    );
    assert.equal(method(t, "card").reason, "disabled");
    assert.equal(method(t, "bank_transfer").reason, "no_bank_account");
    assert.equal(method(t, "deferred").reason, "not_eligible");
    assert.equal(method(computeCart(input([line()], { cardGatewayReady: false })), "card").reason, "not_configured");
    assert.equal(method(computeCart(input([line()], { customer: BUSINESS })), "deferred").available, true);
    const off = settings({
      payments: {
        card: { ...base.payments.card, enabled: false },
        bankTransfer: { ...base.payments.bankTransfer, enabled: false },
        cashOnDelivery: { ...base.payments.cashOnDelivery, enabled: false },
      },
    });
    const none = computeCart(input([line()], { settings: off }));
    assert.equal(none.paymentMethods.every((m) => !m.available), true);
    assert.equal(none.checkoutAllowed, false);
  });
});

describe("unit prices", () => {
  test("explicit group price skips volume tiers and the group discount", () => {
    const tiers = [{ minQuantity: 6, discountPercent: 10, groupId: null }];
    const explicit = computeCart(input([line({ groupPrice: 10000, tiers, quantity: 10 })], { customer: BUSINESS }));
    assert.equal(only(explicit).unitPrice, 10000);
    assert.deepEqual(only(explicit).appliedRules, [{ kind: "group_price", price: 10000 }]);
    const discount = computeCart(input([line({ tiers, quantity: 10 })], { customer: BUSINESS }));
    assert.equal(only(discount).unitPrice, 11468); // 14990 → 12742 (−15 %) → 11467.8 (−10 %)
    const retail = computeCart(input([line({ groupPrice: 10000, quantity: 1 })]));
    assert.equal(only(retail).unitPrice, 14990, "a group price never applies to retail buyers");
  });

  test("group tiers beat retail tiers (even a bigger retail one)", () => {
    const tiers = [
      { minQuantity: 6, discountPercent: 20, groupId: null },
      { minQuantity: 6, discountPercent: 10, groupId: 2 },
    ];
    assert.equal(only(computeCart(input([line({ tiers, quantity: 6 })], { customer: BUSINESS }))).unitPrice, 11468);
    assert.equal(only(computeCart(input([line({ tiers, quantity: 6 })]))).unitPrice, 11992);
  });

  test("tier quantity is the line quantity", () => {
    const tiers = [{ minQuantity: 6, discountPercent: 10, groupId: null }];
    assert.equal(only(computeCart(input([line({ tiers, quantity: 5 })]))).unitPrice, 14990);
    assert.equal(only(computeCart(input([line({ tiers, quantity: 6 })]))).unitPrice, 13491);
  });

  test("campaigns: active window, highest priority wins", () => {
    const campaigns = [
      { id: 1, percent: 30, priority: 0, productIds: null, categoryIds: null, customerGroupIds: null, startsAt: null, endsAt: null },
      { id: 2, percent: 5, priority: 1, productIds: null, categoryIds: null, customerGroupIds: null, startsAt: null, endsAt: null },
      { id: 3, percent: 50, priority: 9, productIds: null, categoryIds: null, customerGroupIds: null, startsAt: null, endsAt: NOW },
    ];
    assert.equal(only(computeCart(input([line()], { campaigns }))).unitPrice, 14241); // 14990 × 0.95 = 14240.5
    assert.equal(only(computeCart(input([line({ productId: 3 })], { campaigns: [{ ...campaigns[0], productIds: [1] }] }))).unitPrice, 14990);
  });
});

describe("quantities and availability", () => {
  const q = (overrides: Partial<EngineLine>) => only(computeCart(input([line(overrides)])));

  test("NaN, Infinity, 0 and negative quantities are blocking issues, never silently 1", () => {
    for (const quantity of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3, -0.5]) {
      const t = computeCart(input([line({ quantity })]));
      assert.equal(t.lines[0].included, false, `quantity ${quantity}`);
      assert.deepEqual(codes(t), ["invalid_quantity"]);
      assert.equal(t.grandTotal, 0);
      assert.equal(t.checkoutAllowed, false);
    }
  });

  test("fractional quantities are floored and flagged", () => {
    const l = q({ quantity: 2.7 });
    assert.equal(l.quantity, 2);
    assert.equal(l.issues[0].reason, "fraction");
    assert.equal(l.lineSubtotal, 29980);
  });

  test("huge quantities clamp to maxQuantity ?? 99, then to stock", () => {
    const huge = q({ quantity: 1e9 });
    assert.equal(huge.quantity, 99);
    assert.equal(huge.issues[0].reason, "max");
    assert.equal(huge.issues[0].blocking, false);
    const stock = q({ quantity: 150, maxQuantity: 200 });
    assert.equal(stock.quantity, 100);
    assert.equal(stock.issues[0].reason, "stock");
    assert.equal(stock.maxQuantity, 100);
    const min = q({ quantity: 2, minQuantity: 6 });
    assert.equal(min.quantity, 6);
    assert.equal(min.issues[0].reason, "min");
  });

  test("stock below the minimum → out_of_stock (blocking); backorder ignores stock", () => {
    assert.equal(q({ stock: 4, minQuantity: 6 }).issues[0].code, "out_of_stock");
    assert.equal(q({ stock: 0 }).issues[0].code, "out_of_stock");
    const back = q({ stock: 0, allowBackorder: true, quantity: 5 });
    assert.equal(back.included, true);
    assert.equal(back.quantity, 5);
    assert.equal(back.availableStock, null);
    assert.equal(q({ stock: 0, trackStock: false, quantity: 3 }).included, true);
  });

  test("two lines of the same variant share the stock", () => {
    const t = computeCart(input([line({ variantId: 5, stock: 5, quantity: 3 }), line({ variantId: 5, stock: 5, quantity: 3 })]));
    assert.deepEqual(
      t.lines.map((l) => l.quantity),
      [3, 2],
    );
  });

  test("inactive, draft, archived, business-only and unpriceable lines are excluded issues", () => {
    for (const overrides of [
      { productStatus: "draft" as const },
      { productStatus: "archived" as const },
      { variantActive: false },
      { businessOnly: true },
      { basePrice: Number.NaN },
      { basePrice: -1 },
    ]) {
      const t = computeCart(input([line(overrides), line()]));
      assert.equal(t.lines[0].included, false, JSON.stringify(overrides));
      assert.equal(t.lines[0].issues[0].code, "unavailable");
      assert.equal(t.subtotal, 14990, "only the healthy line is counted");
      assert.equal(t.checkoutAllowed, false);
    }
    assert.equal(computeCart(input([line({ businessOnly: true })], { customer: BUSINESS })).lines[0].included, true);
  });
});

describe("samples", () => {
  test("at most maxPerOrder distinct samples; the rest are ignored (non-blocking)", () => {
    const t = computeCart(input([line(), sample({ variantId: 201 }), sample({ variantId: 202 }), sample({ variantId: 203 })]));
    assert.equal(t.samples.used, 2);
    assert.deepEqual(
      t.lines.map((l) => l.included),
      [true, true, true, false],
    );
    assert.equal(t.lines[3].issues[0].code, "sample_limit");
    assert.equal(t.checkoutAllowed, true);
    assert.equal(t.subtotal, 14990);
    assert.equal(t.itemCount, 3);
  });

  test("duplicate sample variant counts as over the limit", () => {
    const t = computeCart(input([line(), sample({ variantId: 201 }), sample({ variantId: 201, lineId: 999 })]));
    assert.equal(t.lines[2].issues[0].code, "sample_limit");
  });

  test("sample quantity is always 1", () => {
    const t = computeCart(input([line(), sample({ quantity: 3 })]));
    assert.equal(t.lines[1].quantity, 1);
    assert.equal(t.lines[1].issues[0].reason, "sample");
    assert.equal(t.lines[1].unitPrice, 0);
  });

  test("minimum order for samples", () => {
    const t = computeCart(input([line({ quantity: 2 }), sample()], { settings: settings({ samples: { minOrderTotal: 50000 } }) }));
    assert.equal(t.samples.allowed, false);
    assert.equal(t.samples.reason, "min_order");
    assert.equal(t.lines[1].issues[0].code, "sample_min_order");
    assert.equal(t.totalWeightGrams, 1500);
    const ok = computeCart(input([line({ basePrice: 50000 }), sample()], { settings: settings({ samples: { minOrderTotal: 50000 } }) }));
    assert.equal(ok.lines[1].included, true);
  });

  test("samples disabled", () => {
    const t = computeCart(input([line(), sample()], { settings: settings({ samples: { cartSampleEnabled: false } }) }));
    assert.equal(t.lines[1].issues[0].code, "sample_not_allowed");
    assert.equal(t.samples.reason, "disabled");
  });

  test("a sold-out or unavailable sample is left out without blocking the paid order", () => {
    const t = computeCart(input([line(), sample({ variantId: 211, stock: 0 }), sample({ variantId: 212, variantActive: false })]));
    assert.deepEqual(
      t.lines.map((l) => l.included),
      [true, false, false],
    );
    assert.deepEqual(
      t.lines.slice(1).map((l) => [l.issues[0].code, l.issues[0].blocking]),
      [
        ["out_of_stock", false],
        ["unavailable", false],
      ],
    );
    assert.equal(t.checkoutAllowed, true);
    assert.equal(t.totalWeightGrams, 750, "excluded samples weigh nothing");
    // A paid line that sold out still blocks.
    const paid = computeCart(input([line({ stock: 0 })]));
    assert.equal(paid.lines[0].issues[0].blocking, true);
  });

  test("a samples-only cart cannot check out", () => {
    const t = computeCart(input([sample()]));
    assert.ok(codes(t).includes("samples_only"));
    assert.equal(t.checkoutAllowed, false);
    assert.equal(t.samples.reason, "no_paid_items");
    assert.equal(t.grandTotal, 0);
  });
});

// ---------------------------------------------------------------------------------------------

function checkInvariants(t: CartTotals | (MethodTotals & { lines?: CartTotals["lines"] }), label: string) {
  assert.equal(t.grandTotal, t.subtotal - t.discountTotal + t.shipping.total + t.paymentFee, `${label}: grand total`);
  assert.equal(t.discountTotal, t.discounts.coupon + t.discounts.bankTransfer, `${label}: discounts`);
  assert.equal(t.shipping.total, t.shipping.flat + t.shipping.heavy, `${label}: shipping`);
  for (const [k, v] of Object.entries({ ...t.discounts, subtotal: t.subtotal, discountTotal: t.discountTotal, flat: t.shipping.flat, heavy: t.shipping.heavy, fee: t.paymentFee, vat: t.vatTotal, grand: t.grandTotal })) {
    assert.ok(Number.isSafeInteger(v) && v >= 0, `${label}: ${k}=${v}`);
  }
  assert.ok(t.discountTotal <= t.subtotal, `${label}: discount ≤ subtotal`);
}

describe("randomized carts", () => {
  test("grand total invariant, exact allocation and non-negative amounts on 3000 random carts", () => {
    const r = rng(20261106);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    for (let i = 0; i < 3000; i++) {
      const lines: EngineLine[] = [];
      const n = Math.floor(r() * 7);
      for (let j = 0; j < n; j++) {
        const kind = r();
        if (kind < 0.15) lines.push(sample({ variantId: 500 + j, quantity: pick([1, 1, 2]) }));
        else
          lines.push(
            line({
              variantId: 600 + j,
              productId: 1 + Math.floor(r() * 4),
              categoryId: 1 + Math.floor(r() * 3),
              basePrice: pick([0, 1, 99, 14990, 44990, 149990, 159990, Math.floor(r() * 3_000_000)]),
              quantity: pick([1, 2, 3, 6, 12, 50, 120, 2.5, Number.NaN, -1, 0]),
              stock: pick([0, 1, 5, 100, 1000]),
              allowBackorder: r() < 0.1,
              vatRate: pick([20, 20, 10, 1, 0]),
              weightGrams: pick([null, 0, 750, 5300, 21000]),
              minQuantity: pick([1, 1, 1, 6]),
              maxQuantity: pick([null, null, 10, 200]),
              productStatus: r() < 0.05 ? "draft" : "active",
              groupPrice: r() < 0.2 ? Math.floor(r() * 100000) : null,
              tiers: r() < 0.3 ? [{ minQuantity: 6, discountPercent: pick([5, 10, 15]), groupId: pick([null, 2]) }] : [],
            }),
          );
      }
      const c: CouponData | null =
        r() < 0.6
          ? coupon({
              type: pick(["percent", "fixed", "free_shipping"] as const),
              value: pick([1, 7, 15, 33, 50, 99, 100, 1000, 50000, 10_000_000]),
              minOrderTotal: pick([0, 0, 20000, 150000]),
              productIds: r() < 0.3 ? [1 + Math.floor(r() * 4)] : null,
              categoryIds: r() < 0.2 ? [1 + Math.floor(r() * 3)] : null,
            })
          : null;
      const s = settings({
        shipping: { flatFee: pick([0, 9990]), freeThreshold: pick([0, 150000, 100]), heavy: { enabled: r() < 0.8, thresholdGrams: pick([0, 10000]), feePerKg: pick([0, 1500]) } },
        samples: { maxPerOrder: pick([0, 1, 2]), minOrderTotal: pick([0, 50000]) },
      });
      s.payments.bankTransfer.discountPercent = pick([0, 3, 5, 50]);
      const customer = r() < 0.3 ? BUSINESS : RETAIL_CUSTOMER;
      const totals = computeCart({ lines, customer, coupon: c, settings: s, now: NOW, paymentMethod: pick([null, ...PAYMENT_METHODS]) });
      checkInvariants(totals, `cart ${i}`);
      const lineDiscounts = totals.lines.reduce((sum, l) => sum + l.discount, 0);
      assert.equal(lineDiscounts, totals.discountTotal, `cart ${i}: Σ line discounts`);
      assert.equal(
        totals.lines.reduce((sum, l) => sum + l.couponDiscount, 0),
        totals.discounts.coupon,
        `cart ${i}: Σ coupon shares`,
      );
      assert.equal(
        totals.lines.reduce((sum, l) => sum + l.lineTotal, 0),
        totals.subtotal - totals.discountTotal,
        `cart ${i}: Σ line totals`,
      );
      for (const l of totals.lines) {
        assert.ok(l.lineTotal >= 0 && l.discount <= l.lineSubtotal, `cart ${i}: line ${l.lineId}`);
        assert.ok(Number.isInteger(l.quantity) && l.quantity >= 0, `cart ${i}: quantity`);
        if (l.isSample) assert.equal(l.lineSubtotal, 0);
      }
      assert.equal(
        totals.vatTotal,
        totals.lines.reduce((sum, l) => sum + l.vat, 0) + vatIncluded(totals.shipping.total, 20) + vatIncluded(totals.paymentFee, 20),
        `cart ${i}: VAT`,
      );
      for (const m of totals.paymentMethods) checkInvariants(m.totals, `cart ${i} ${m.method}`);
      if (totals.paymentMethod) assert.equal(method(totals, totals.paymentMethod).totals.grandTotal, totals.grandTotal);
    }
  });
});
