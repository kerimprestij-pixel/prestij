// Day 6 WHEEL-CART: the cart's gift wheel prize as the CartView carries it (status → localized message,
// label from the spin snapshot or from type/value, the real expiry in Türkiye time, the first countdown
// value) and as the cart UI renders it on the server (the hydration render shows the server's value in a
// non-live timer; "ready" offers to apply; the code on the cart carries the countdown in its own row).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CouponForm from "@/components/cart/CouponForm";
import { cartUiLabels } from "@/components/cart/labels";
import WheelPrizeNote from "@/components/cart/WheelPrizeNote";
import { format } from "@/i18n/format";
import { defaultMessages, type Messages } from "@/i18n/messages";
import { computeCart } from "@/lib/cart/compute";
import type { LoadedCart } from "@/lib/cart/load";
import { RETAIL_CUSTOMER, type EngineLine } from "@/lib/cart/types";
import { buildCartView, buildWheelPrizeView, wheelPrizeFallbackLabel, type CartView, type CartWheelPrizeInput, type CartWheelPrizeStatus } from "@/lib/cart/view";
import { formatPrice } from "@/lib/pricing/money";
import { input, line, NOW } from "./helpers";

const ENDS = new Date("2026-11-15T11:30:00.000Z"); // 14:30 Istanbul
const NOW_2D = new Date(ENDS.getTime() - (2 * 86_400 + 3 * 3_600 + 14 * 60) * 1000);
const LABEL = { tr: "%10 indirim", en: "10% off", ar: "خصم 10%" };

const prize = (over: Partial<CartWheelPrizeInput> = {}): CartWheelPrizeInput => ({
  code: "CARK-ABC234",
  label: LABEL,
  type: "percent",
  value: 10,
  minOrderTotal: 0,
  endsAt: ENDS,
  status: "ready",
  ...over,
});

describe("buildWheelPrizeView", () => {
  test("every status explains itself with the dictionary text (tr)", () => {
    const m = defaultMessages.tr.wheel.cart;
    const view = (status: CartWheelPrizeStatus, over: Partial<CartWheelPrizeInput> = {}) =>
      buildWheelPrizeView(prize({ status, ...over }), "tr", defaultMessages.tr, NOW_2D).message;
    assert.equal(view("applied"), m.applied);
    assert.equal(view("ready"), null, "the row and its button speak for themselves");
    assert.equal(view("other_code"), m.waitingOtherCode);
    assert.equal(view("no_benefit"), format(m.waitingNoBenefit, { prize: "%10 indirim" }, "tr"));
    assert.equal(view("min_order", { minOrderTotal: 75000 }), format(m.waitingMinOrder, { prize: "%10 indirim", amount: formatPrice(75000, "tr") }, "tr"));
    assert.match(view("min_order", { minOrderTotal: 75000 })!, /750,00\s₺/u);
    assert.equal(view("no_items"), null, "an empty cart without a minimum needs no sentence");
    assert.equal(view("no_items", { minOrderTotal: 30000 }), format(m.waitingMinOrder, { prize: "%10 indirim", amount: formatPrice(30000, "tr") }, "tr"));
  });

  test("label from the spin snapshot per language, else built from type and value (never Turkish text on en/ar)", () => {
    assert.equal(buildWheelPrizeView(prize(), "en", defaultMessages.en, NOW_2D).label, "10% off");
    assert.equal(buildWheelPrizeView(prize(), "ar", defaultMessages.ar, NOW_2D).label, "خصم 10%");
    // FIX COR-7: one rule for every prize name (dialog, chip, e-mails, cart, account card).
    assert.equal(buildWheelPrizeView(prize({ label: { tr: "Sürpriz %10" } }), "en", defaultMessages.en, NOW_2D).label, "10% off");
    assert.equal(buildWheelPrizeView(prize({ label: { tr: "Sürpriz %10" } }), "tr", defaultMessages.tr, NOW_2D).label, "Sürpriz %10");
    const cases: [Pick<CartWheelPrizeInput, "type" | "value">, string, string, string][] = [
      [{ type: "percent", value: 15 }, "%15 indirim", "15% off", "خصم 15%"],
      [{ type: "fixed", value: 5000 }, `${formatPrice(5000, "tr")} indirim`, `${formatPrice(5000, "en")} off`, `خصم ${formatPrice(5000, "ar")}`],
      [{ type: "free_shipping", value: 0 }, "Ücretsiz kargo", "Free shipping", "شحن مجاني"],
    ];
    for (const [p, tr, en, ar] of cases) {
      assert.equal(wheelPrizeFallbackLabel(p, defaultMessages.tr, "tr"), tr);
      assert.equal(wheelPrizeFallbackLabel(p, defaultMessages.en, "en"), en);
      assert.equal(wheelPrizeFallbackLabel(p, defaultMessages.ar, "ar"), ar);
      assert.equal(buildWheelPrizeView(prize({ ...p, label: undefined }), "tr", defaultMessages.tr, NOW_2D).label, tr);
    }
  });

  test("real expiry in Türkiye time, the countdown at build time, and the templates the client fills", () => {
    const v = buildWheelPrizeView(prize(), "tr", defaultMessages.tr, NOW_2D);
    assert.equal(v.endsAt, ENDS.toISOString());
    assert.equal(v.expiresAt, "Son kullanım: 15 Kasım 14:30");
    assert.equal(v.timeLeft, "2g 03:14");
    assert.deepEqual(v.text, {
      title: defaultMessages.tr.wheel.cart.title,
      timeLeft: defaultMessages.tr.wheel.cart.timeLeft,
      drawer: defaultMessages.tr.wheel.cart.drawer,
      countdown: defaultMessages.tr.wheel.countdown,
    });
    assert.equal(buildWheelPrizeView(prize(), "tr", defaultMessages.tr, new Date(ENDS.getTime() + 1)).timeLeft, "Süresi doldu");
    const ar = buildWheelPrizeView(prize(), "ar", defaultMessages.ar, NOW_2D);
    assert.equal(ar.timeLeft, "يومان 03:14");
    assert.match(ar.expiresAt, /14:30/);
  });

  test("panel overrides of the texts reach the view", () => {
    const custom: Messages = {
      ...defaultMessages.tr,
      wheel: { ...defaultMessages.tr.wheel, cart: { ...defaultMessages.tr.wheel.cart, drawer: "Hediyen · {time} kaldı" } },
    };
    assert.equal(buildWheelPrizeView(prize(), "tr", custom, NOW_2D).text.drawer, "Hediyen · {time} kaldı");
  });
});

function loaded(engineLines: EngineLine[], couponCode: string | null = null): LoadedCart {
  return {
    cart: { id: "00000000-0000-4000-8000-000000000000", couponCode, locale: "tr", expiresAt: null },
    customer: { ...RETAIL_CUSTOMER, userId: "winner" },
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

describe("buildCartView: wheelPrize", () => {
  test("null without the extras (callers that do not look prizes up), set with them", () => {
    const lines = [line()];
    const totals = computeCart(input(lines));
    assert.equal(buildCartView(totals, loaded(lines), "tr").wheelPrize, null);
    const view = buildCartView(totals, loaded(lines), "tr", defaultMessages.tr, { wheelPrize: prize({ status: "ready" }), now: NOW_2D });
    assert.equal(view.wheelPrize?.status, "ready");
    assert.equal(view.wheelPrize?.code, "CARK-ABC234");
    assert.equal(view.wheelPrize?.timeLeft, "2g 03:14");
  });

  test("the prize never changes the money: totals and revision are the engine's", () => {
    const lines = [line()];
    const totals = computeCart(input(lines));
    const a = buildCartView(totals, loaded(lines), "tr");
    const b = buildCartView(totals, loaded(lines), "tr", defaultMessages.tr, { wheelPrize: prize(), now: NOW });
    assert.equal(b.revision, a.revision);
    assert.deepEqual(b.totals, a.totals);
    assert.deepEqual(b.summary, a.summary);
  });
});

// ---------------------------------------------------------------------------------------------------
// Server render (what the HTML and the hydration render contain)

const labels = cartUiLabels(defaultMessages.tr);
const noop = () => {};
const prizeView = (status: CartWheelPrizeStatus, over: Partial<CartWheelPrizeInput> = {}, locale: "tr" | "ar" = "tr") =>
  buildWheelPrizeView(prize({ status, ...over }), locale, defaultMessages[locale], NOW_2D);
const timer = (html: string) => /<span role="timer"[^>]*>([^<]*)<\/span>/.exec(html)?.[1] ?? null;

describe("WheelPrizeNote (server render)", () => {
  test("page card, ready: label, the server's countdown in a non-live timer, expiry, and an apply button", () => {
    const html = renderToStaticMarkup(
      createElement(WheelPrizeNote, { prize: prizeView("ready"), locale: "tr", variant: "page", applyLabel: labels.coupon.apply, applyingLabel: labels.coupon.applying, onApply: noop }),
    );
    assert.match(html, /data-wheel-prize="ready"/);
    assert.match(html, /%10 indirim/);
    assert.equal(timer(html), "2g 03:14");
    assert.doesNotMatch(html, /aria-live/, "a ticking timer is never a live region");
    assert.match(html, /Kalan süre: /);
    assert.match(html, /Son kullanım: 15 Kasım 14:30/);
    assert.match(html, new RegExp(`<button[^>]*>${labels.coupon.apply}</button>`));
  });

  test("page card, waiting for the minimum: the reason, no button", () => {
    const html = renderToStaticMarkup(
      createElement(WheelPrizeNote, { prize: prizeView("min_order", { minOrderTotal: 75000 }), locale: "tr", variant: "page", applyLabel: "Uygula", applyingLabel: "…", onApply: noop }),
    );
    assert.match(html, /750,00\s₺ ve üzeri sepetlerde otomatik uygulanır/u);
    assert.doesNotMatch(html, /<button/);
  });

  test("drawer row, applied: 'Çark hediyeniz · <timer>', the label with a check, the expiry for screen readers", () => {
    const html = renderToStaticMarkup(
      createElement(WheelPrizeNote, { prize: prizeView("applied"), locale: "tr", variant: "drawer", applyLabel: "Uygula", applyingLabel: "…", onApply: noop }),
    );
    assert.match(html, /Çark hediyeniz · <span role="timer"/);
    assert.equal(timer(html), "2g 03:14");
    assert.match(html, /%10 indirim/);
    assert.match(html, /class="sr-only"> \(Son kullanım: 15 Kasım 14:30\)/);
    assert.doesNotMatch(html, /<button/);
  });

  test("drawer row in Arabic", () => {
    const html = renderToStaticMarkup(
      createElement(WheelPrizeNote, { prize: prizeView("other_code", {}, "ar"), locale: "ar", variant: "drawer", applyLabel: "تطبيق", applyingLabel: "…", onApply: noop }),
    );
    assert.match(html, /هدية العجلة · <span role="timer"/);
    assert.equal(timer(html), "يومان 03:14");
    assert.match(html, new RegExp(defaultMessages.ar.wheel.cart.waitingOtherCode));
  });
});

describe("CouponForm (server render)", () => {
  const appliedCoupon: NonNullable<CartView["coupon"]> = {
    code: "CARK-ABC234",
    type: "percent",
    status: "applied",
    message: defaultMessages.tr.cart.couponApplied,
    discount: { amount: 1499, label: "14,99 ₺" },
    endsAt: ENDS.toISOString(),
    source: "wheel",
  };

  test("the prize on the cart: its row carries the label and the countdown; no separate card", () => {
    const html = renderToStaticMarkup(
      createElement(CouponForm, { coupon: appliedCoupon, wheelPrize: prizeView("applied"), locale: "tr", discountLabel: "-14,99 ₺", labels: labels.coupon, onApply: noop, onRemove: noop }),
    );
    assert.match(html, /CARK-ABC234/);
    assert.match(html, /Çark hediyeniz · %10 indirim/);
    assert.doesNotMatch(html, /truncate[^"]*tracking-\[0\.14em\]/, "FIX UX-6: the code wraps, never cut");
    assert.equal(timer(html), "2g 03:14");
    assert.doesNotMatch(html, /data-wheel-prize/);
    assert.match(html, /-14,99 ₺/);
  });

  test("another code on the cart: that code's row, then the prize card explaining why it waits", () => {
    const typed = { ...appliedCoupon, code: "BAHAR15", source: "manual" as const, endsAt: undefined };
    const html = renderToStaticMarkup(
      createElement(CouponForm, { coupon: typed, wheelPrize: prizeView("other_code"), locale: "tr", discountLabel: null, labels: labels.coupon, onApply: noop, onRemove: noop }),
    );
    assert.match(html, /BAHAR15/);
    assert.match(html, /data-wheel-prize="other_code"/);
    assert.match(html, new RegExp(defaultMessages.tr.wheel.cart.waitingOtherCode));
  });

  test("no code: the prize card above the field; without a prize the form is unchanged", () => {
    const withPrize = renderToStaticMarkup(
      createElement(CouponForm, { coupon: null, wheelPrize: prizeView("ready"), locale: "tr", discountLabel: null, labels: labels.coupon, onApply: noop, onRemove: noop }),
    );
    assert.ok(withPrize.indexOf("data-wheel-prize") < withPrize.indexOf("<form"), "card first");
    const without = renderToStaticMarkup(createElement(CouponForm, { coupon: null, locale: "tr", discountLabel: null, labels: labels.coupon, onApply: noop, onRemove: noop }));
    assert.doesNotMatch(without, /data-wheel-prize|role="timer"/);
    assert.match(without, /<form/);
  });
});
