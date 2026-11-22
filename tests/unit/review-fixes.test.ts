// Regression tests for the day-2 review fixes (pure parts): cart revision, shipping wording, hidden
// unconfigured havale, legal texts (product type, masked IDs, binding Turkish text, seller IDs),
// control characters, per-method expected totals, the rate limiter and Arabic plurals.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { format } from "@/i18n/format";
import { defaultMessages } from "@/i18n/messages";
import { computeCart } from "@/lib/cart/compute";
import type { LoadedCart } from "@/lib/cart/load";
import { cartRevision } from "@/lib/cart/totals";
import { RETAIL_CUSTOMER, type EngineLine } from "@/lib/cart/types";
import { buildCartView } from "@/lib/cart/view";
import { validateCheckout } from "@/lib/orders/checkout-schema";
import { legalBuyerFromUnknown, legalOrderData, renderDistanceSales, renderPreInformation } from "@/lib/orders/legal-render";
import { blockedFor, clientIpFrom, recordHit, resetRateLimits } from "@/lib/rate-limit";
import { coupon, input, line, NOW, sample, settings } from "./helpers";

/** formatPrice uses no-break spaces (U+00A0 / U+202F); compare with plain spaces. */
const sp = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");

function loaded(lines: EngineLine[]): LoadedCart {
  return {
    cart: { id: "00000000-0000-4000-8000-000000000000", couponCode: null, locale: "tr", expiresAt: null },
    customer: RETAIL_CUSTOMER,
    lines: lines.map((l) => ({
      ...l,
      display: {
        productSlug: l.productType === "sample" ? "okyanus-numune" : "okyanus",
        name: l.productType === "sample" ? { tr: "Okyanus Numune" } : { tr: "Okyanus", en: "Ocean", ar: "أوكيانوس" },
        subtitle: l.productType === "sample" ? null : { tr: "Duş Jeli", en: "Shower Gel", ar: "جل استحمام" },
        accentColor: "#329BC0",
        sku: `SKU-${l.variantId}`,
        barcode: null,
        variantLabels: l.productType === "sample" ? [] : [{ tr: "20 L Bidon", en: "20 L Canister" }],
        image: null,
        volumeMl: 20000,
        lowStockThreshold: 5,
      },
    })),
    coupon: null,
    campaigns: [],
    sampleOffers: [],
  };
}

describe("cart revision (what the buyer confirms)", () => {
  test("included lines and the applied coupon; excluded lines do not count", () => {
    const a = line({ variantId: 7, quantity: 2 });
    const t = computeCart(input([a]));
    assert.equal(cartRevision(t), "7:2|");
    assert.equal(buildCartView(t, loaded([a]), "tr").revision, "7:2|");
    const withCoupon = computeCart(input([a], { coupon: coupon({ code: "HOSGELDIN" }) }));
    assert.equal(cartRevision(withCoupon), "7:2|HOSGELDIN");
    const three = computeCart(input([line({ variantId: 7, quantity: 3 })]));
    assert.notEqual(cartRevision(three), cartRevision(t));
    // Swapping one scent for another at the same price keeps the total but not the revision.
    const swapped = computeCart(input([line({ variantId: 8, quantity: 2 })]));
    assert.equal(swapped.grandTotal, t.grandTotal);
    assert.notEqual(cartRevision(swapped), cartRevision(t));
    // Order of lines does not matter; a sample over the limit (excluded) is not part of it.
    const s1 = sample({ variantId: 301 });
    const s2 = sample({ variantId: 302 });
    const s3 = sample({ variantId: 303 });
    assert.equal(cartRevision(computeCart(input([s1, a, s2, s3]))), "301:1,302:1,7:2|");
  });
});

describe("cart view wording", () => {
  test("free standard shipping next to a heavy surcharge is never called plain 'free shipping'", () => {
    const heavy = [line({ basePrice: 150000, weightGrams: 21000 })];
    const view = buildCartView(computeCart(input(heavy)), loaded(heavy), "tr");
    const rows = view.summary.map((r) => [r.key, r.label, sp(r.amountLabel)]);
    assert.deepEqual(rows.slice(1, 3), [
      ["shipping", "Standart kargo", "Ücretsiz"],
      ["heavy", "Ağır gönderi ek kargo ücreti (11 kg)", "165,00 ₺"],
    ]);
    assert.equal(view.shipping.message, defaultMessages.tr.cart.freeShippingReachedHeavy);
    const light = [line({ basePrice: 150000, weightGrams: 0 })];
    const lightView = buildCartView(computeCart(input(light)), loaded(light), "tr");
    assert.equal(lightView.summary[1].label, "Kargo");
    assert.equal(lightView.shipping.message, "Kargonuz ücretsiz.");
  });

  test("a free_shipping code is named in the shipping row", () => {
    const lines = [line({ weightGrams: 0 })];
    const view = buildCartView(computeCart(input(lines, { coupon: coupon({ type: "free_shipping", code: "KARGO" }) })), loaded(lines), "tr");
    assert.deepEqual([view.summary[1].label, view.summary[1].amountLabel], ["Kargo (KARGO kodu)", "Ücretsiz"]);
  });

  test("havale without a bank account is hidden from shoppers (store setup gap, not a shopper message)", () => {
    const lines = [line()];
    const noAccount = settings({ payments: { ...settings().payments, bankTransfer: { ...settings().payments.bankTransfer, accounts: [] } } });
    const view = buildCartView(computeCart(input(lines, { settings: noAccount })), loaded(lines), "tr");
    const havale = view.paymentMethods.find((m) => m.method === "bank_transfer")!;
    assert.equal(havale.available, false);
    assert.equal(havale.visible, false);
  });
});

describe("legal texts (review fixes)", () => {
  const lines = [line({ variantId: 12, quantity: 1, basePrice: 149990, weightGrams: 21000 })];
  const totals = computeCart(input(lines, { paymentMethod: "card" }));
  const seller = {
    legalName: "PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ.",
    siteName: "PRESTİJ",
    phone: "0352 353 30 70",
    email: "",
    address: { line: "Cırgalan Mah.", district: "Kocasinan", city: "Kayseri", country: "Türkiye" },
  };
  const base = (locale: "tr" | "en" | "ar") => {
    const data = legalOrderData(totals, loaded(lines), locale, "card");
    return {
      locale,
      seller,
      estimatedDays: { min: 1, max: 3 },
      items: data.items,
      totals: data.totals,
      paymentMethod: "card" as const,
      date: NOW,
      orderNumber: "PR-261001",
    };
  };
  const doc = { key: "distance_sales", version: "v1", title: { tr: "Mesafeli Satış Sözleşmesi", en: "Distance Sales Agreement" }, body: { tr: "<p>Bağlayıcı Türkçe gövde</p>", en: "<p>English summary</p>" } };

  test("product lines carry the product type (essential features)", () => {
    const html = sp(renderPreInformation({ ...base("tr"), buyer: {}, document: null }));
    assert.match(html, /Okyanus — Duş Jeli \(20 L Bidon\) × 1: 1\.499,90 ₺/);
    const en = sp(renderPreInformation({ ...base("en"), buyer: {}, document: null }));
    assert.match(en, /Ocean — Shower Gel \(20 L Canister\) × 1/);
  });

  test("national ID and tax number are masked to the last two digits in the texts", () => {
    const individual = renderDistanceSales({
      ...base("tr"),
      document: null,
      buyer: legalBuyerFromUnknown({ shippingAddress: { fullName: "Ayşe Yılmaz" }, invoice: { type: "individual", nationalId: "10000000146" } }),
    });
    assert.doesNotMatch(individual, /10000000146/);
    assert.match(individual, /T\.C\. kimlik no:<\/strong> •••••••••46/);
    const corporate = renderDistanceSales({
      ...base("tr"),
      document: null,
      buyer: { invoice: { type: "corporate", companyName: "Otel A.Ş.", taxOffice: "Kocasinan", taxNumber: "1234567890", sameAsShipping: true } },
    });
    assert.doesNotMatch(corporate, /1234567890/);
    assert.match(corporate, /••••••••90/);
  });

  test("English and Arabic texts also carry the binding Turkish body; Turkish texts do not repeat it", () => {
    const en = renderDistanceSales({ ...base("en"), buyer: {}, document: doc });
    assert.match(en, /<p>English summary<\/p>/);
    assert.match(en, /<h2>Binding Turkish text<\/h2>/);
    assert.match(en, /<p>Bağlayıcı Türkçe gövde<\/p>/);
    assert.ok(en.indexOf("English summary") < en.indexOf("Bağlayıcı Türkçe gövde"));
    const tr = renderDistanceSales({ ...base("tr"), buyer: {}, document: doc });
    assert.equal(tr.split("Bağlayıcı Türkçe gövde").length - 1, 1);
    assert.doesNotMatch(tr, /Bağlayıcı Türkçe metin/);
    // No Arabic body: the Turkish text is shown once (as the fallback), not twice.
    const ar = renderDistanceSales({ ...base("ar"), buyer: {}, document: doc });
    assert.equal(ar.split("Bağlayıcı Türkçe gövde").length - 1, 1);
  });

  test("seller MERSİS, tax and KEP lines appear only when the settings fill them", () => {
    const plain = renderPreInformation({ ...base("tr"), buyer: {}, document: null });
    assert.doesNotMatch(plain, /MERSİS|KEP/);
    const full = renderPreInformation({ ...base("tr"), seller: { ...seller, mersisNo: "0123456789000015", taxOffice: "Erciyes", taxNumber: "7330012345", kep: "prestij@hs01.kep.tr" }, buyer: {}, document: null });
    assert.match(full, /MERSİS no:<\/strong> 0123456789000015/);
    assert.match(full, /Vergi kimlik no:<\/strong> 7330012345/);
    assert.match(full, /KEP adresi:<\/strong> prestij@hs01\.kep\.tr/);
  });
});

describe("checkout schema (review fixes)", () => {
  const valid = () => ({
    locale: "tr",
    contact: { email: "a@b.co", phone: "0532 123 45 67" },
    shippingAddress: { fullName: "Ayşe Yılmaz", city: "Kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. No: 4" },
    invoice: { type: "individual", sameAsShipping: true },
    paymentMethod: "cash_on_delivery",
    consents: { preInformation: true, distanceSales: true },
  });

  test("control characters (NUL, …) are refused as field errors; line breaks in the note are fine", () => {
    const nul = String.fromCharCode(0);
    const bell = String.fromCharCode(7);
    const r = validateCheckout({ ...valid(), customerNote: `Kapıcıya${nul}bırakın`, shippingAddress: { ...valid().shippingAddress, line1: `Cumhuriyet${bell} Mah. No: 4` } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.fieldErrors, { "shippingAddress.line1": "invalid", customerNote: "invalid" });
    const ok = validateCheckout({ ...valid(), customerNote: "Kat 3\nDaire 7\tzil çalışmıyor" });
    assert.ok(ok.ok);
  });

  test("per-method expected totals and the expected cart revision are read from hidden inputs", () => {
    const r = validateCheckout({ ...valid(), expectedTotals: { card: "24980", cash_on_delivery: "29970", bogus: "1" }, expectedCart: "7:2|" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.data.expectedTotals?.cash_on_delivery, 29970);
    assert.equal(r.data.expectedTotals?.card, 24980);
    assert.equal(r.data.expectedCart, "7:2|");
    // Garbage in these optional hidden fields never blocks the form.
    const junk = validateCheckout({ ...valid(), expectedTotals: "x", expectedCart: 5 });
    assert.ok(junk.ok);
    if (junk.ok) assert.equal(junk.data.expectedTotals, undefined);
  });
});

describe("rate limiting", () => {
  test("the client IP never comes from the client-sent first X-Forwarded-For entry", () => {
    const h = (entries: Record<string, string>) => new Headers(entries);
    const saved = { trusted: process.env.TRUSTED_IP_HEADER, auth: process.env.AUTH_IP_HEADER, vercel: process.env.VERCEL };
    try {
      delete process.env.TRUSTED_IP_HEADER;
      delete process.env.AUTH_IP_HEADER;
      delete process.env.VERCEL;
      assert.equal(clientIpFrom(h({ "x-forwarded-for": "203.0.113.9, 198.51.100.7" })), "198.51.100.7", "the entry the proxy appended");
      assert.equal(clientIpFrom(h({})), "unknown");
      process.env.TRUSTED_IP_HEADER = "x-real-ip";
      assert.equal(clientIpFrom(h({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "10.0.0.5" })), "10.0.0.5");
      delete process.env.TRUSTED_IP_HEADER;
      process.env.VERCEL = "1";
      assert.equal(clientIpFrom(h({ "x-forwarded-for": "1.1.1.1", "x-vercel-forwarded-for": "192.0.2.4" })), "192.0.2.4");
    } finally {
      for (const [k, v] of [["TRUSTED_IP_HEADER", saved.trusted], ["AUTH_IP_HEADER", saved.auth], ["VERCEL", saved.vercel]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("sliding window: blocks at the limit, frees up when the oldest hit leaves the window", () => {
    resetRateLimits();
    const rule = { limit: 3, windowMs: 60_000 };
    const keys = [["test:ip:1", rule]] as const;
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      assert.equal(blockedFor(keys, t0 + i), 0);
      recordHit(keys, t0 + i);
    }
    assert.equal(blockedFor(keys, t0 + 10), 1, "whole minutes to wait");
    assert.equal(blockedFor([["test:ip:2", rule]], t0 + 10), 0, "other keys are independent");
    assert.equal(blockedFor(keys, t0 + 60_001), 0);
    resetRateLimits();
  });
});

describe("Arabic number agreement", () => {
  test("dual and plural forms, percent sign after the number", () => {
    const ar = defaultMessages.ar;
    assert.match(format(ar.cart.samplesHint, { count: 2 }, "ar"), /عينتين مجانيتين/);
    assert.match(format(ar.cart.samplesHint, { count: 3 }, "ar"), /3 عينات مجانية/);
    assert.match(format(ar.cart.errors.sample_limit, { count: 1 }, "ar"), /عينة واحدة/);
    assert.match(format(ar.cart.errors.cart_full, { count: 50 }, "ar"), /50 منتجًا مختلفًا/);
    assert.equal(format(ar.cart.summary.bankTransferDiscount, { percent: 5 }, "ar"), "خصم التحويل البنكي (5%)");
    assert.doesNotMatch(JSON.stringify(ar), /%\{/, "no Turkish-style %{x} left in Arabic");
  });
});
