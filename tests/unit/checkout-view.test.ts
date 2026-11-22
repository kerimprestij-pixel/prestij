// Checkout schema, CartView building, legal texts and the new paths.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultMessages } from "@/i18n/messages";
import { href, localizePath } from "@/i18n/paths";
import { computeCart } from "@/lib/cart/compute";
import type { LoadedCart } from "@/lib/cart/load";
import { RETAIL_CUSTOMER, type EngineLine } from "@/lib/cart/types";
import { buildCartView } from "@/lib/cart/view";
import { checkoutFormDataToInput, validateCheckout } from "@/lib/orders/checkout-schema";
import { localizeCheckoutFailure } from "@/lib/orders/errors";
import { legalBuyerFromUnknown, legalOrderData, renderDistanceSales, renderPreInformation } from "@/lib/orders/legal-render";
import { flattenMessages } from "@/i18n/format";
import { coupon, input, line, NOW, sample, settings } from "./helpers";

/** formatPrice uses no-break spaces (U+00A0 / U+202F); compare with plain spaces. */
const sp = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");

const valid = () => ({
  locale: "tr",
  contact: { email: "  Ayse.Yilmaz@Example.com ", phone: "0532 123 45 67" },
  shippingAddress: { fullName: "Ayşe Yılmaz", city: "kayseri", district: "Kocasinan", neighbourhood: "", line1: "Cumhuriyet Mah. 12. Sok. No: 4", postalCode: "38010" },
  invoice: { type: "individual", sameAsShipping: true, nationalId: "" },
  paymentMethod: "card",
  consents: { preInformation: true, distanceSales: true },
  customerNote: "  Kapıya bırakabilirsiniz. ",
});

describe("checkout schema", () => {
  test("valid input is normalized", () => {
    const r = validateCheckout(valid());
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.data.contact.email, "ayse.yilmaz@example.com");
    assert.equal(r.data.contact.phone, "+905321234567");
    assert.equal(r.data.shippingAddress.city, "Kayseri");
    assert.equal(r.data.shippingAddress.neighbourhood, undefined);
    assert.equal(r.data.customerNote, "Kapıya bırakabilirsiniz.");
    assert.equal(r.data.invoice.type, "individual");
    if (r.data.invoice.type === "individual") assert.equal(r.data.invoice.nationalId, undefined);
  });

  test("field errors are codes keyed by path", () => {
    const bad = valid() as Record<string, unknown>;
    bad.contact = { email: "nope", phone: "0352 353 30 70" };
    bad.shippingAddress = { fullName: "", city: "Atlantis", district: "K", line1: "x", postalCode: "123" };
    bad.consents = { preInformation: false, distanceSales: "on" };
    bad.customerNote = "a".repeat(501);
    bad.paymentMethod = "bitcoin";
    const r = validateCheckout(bad);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.deepEqual(r.fieldErrors, {
      "contact.email": "invalid_email",
      "contact.phone": "invalid_phone",
      "shippingAddress.fullName": "required",
      "shippingAddress.city": "invalid_province",
      "shippingAddress.district": "too_short",
      "shippingAddress.line1": "too_short",
      "shippingAddress.postalCode": "invalid_postal_code",
      paymentMethod: "required",
      "consents.preInformation": "consent_required",
      customerNote: "too_long",
    });
  });

  test("missing sections", () => {
    const r = validateCheckout({ locale: "xx" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.fieldErrors.contact, "required");
    assert.equal(r.fieldErrors.shippingAddress, "required");
    assert.equal(r.fieldErrors.consents, "consent_required");
  });

  test("individual TCKN optional but checked; corporate needs a valid VKN or TCKN", () => {
    const tckn = { ...valid(), invoice: { type: "individual", nationalId: "10000000147", sameAsShipping: true } };
    assert.deepEqual((validateCheckout(tckn) as { fieldErrors: object }).fieldErrors, { "invoice.nationalId": "invalid_tckn" });
    const corp = { ...valid(), invoice: { type: "corporate", companyName: "Otel A.Ş.", taxOffice: "Kocasinan", taxNumber: "123 456 7890", sameAsShipping: true, eInvoice: "on" } };
    const ok = validateCheckout(corp);
    assert.ok(ok.ok);
    if (ok.ok && ok.data.invoice.type === "corporate") {
      assert.equal(ok.data.invoice.taxNumber, "1234567890");
      assert.equal(ok.data.invoice.eInvoice, true);
    }
    const sole = validateCheckout({ ...corp, invoice: { ...corp.invoice, taxNumber: "10000000146" } });
    assert.ok(sole.ok);
    const badCorp = validateCheckout({ ...corp, invoice: { ...corp.invoice, taxNumber: "1234567891", companyName: "" } });
    assert.deepEqual((badCorp as { fieldErrors: object }).fieldErrors, { "invoice.companyName": "required", "invoice.taxNumber": "invalid_tax_number" });
  });

  test("separate billing address is required only when not same as shipping", () => {
    const r = validateCheckout({ ...valid(), invoice: { type: "individual", sameAsShipping: false } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.fieldErrors["invoice.address.line1"], "required");
    const ignored = validateCheckout({ ...valid(), invoice: { type: "individual", sameAsShipping: true, address: { fullName: "" } } });
    assert.ok(ignored.ok, "hidden billing inputs are ignored when same as shipping");
    const given = validateCheckout({
      ...valid(),
      invoice: { type: "individual", sameAsShipping: false, address: { fullName: "Mehmet Kaya", city: "06", district: "Çankaya", line1: "Atatürk Bulvarı No: 1" } },
    });
    assert.ok(given.ok);
    if (given.ok) assert.equal(given.data.invoice.address?.city, "Ankara");
  });

  test("expectedTotal accepts numeric strings", () => {
    const r = validateCheckout({ ...valid(), expectedTotal: "39970" });
    assert.ok(r.ok && r.data.expectedTotal === 39970);
    assert.equal((validateCheckout({ ...valid(), expectedTotal: "abc" }) as { ok: boolean }).ok, false);
  });

  test("placeOrder failures are localized for the form", () => {
    const m = defaultMessages.tr;
    const fields = localizeCheckoutFailure({ ok: false, code: "invalid_input", fieldErrors: { "contact.phone": "invalid_phone" } }, m, "tr");
    assert.equal(fields.formError, "Lütfen işaretli alanları kontrol edin.");
    assert.equal(fields.fieldErrors["contact.phone"], "Geçerli bir cep telefonu numarası girin (05xx xxx xx xx).");
    const cod = localizeCheckoutFailure({ ok: false, code: "method_unavailable", fieldErrors: {}, reason: "over_limit", limit: 500000 }, m, "tr");
    assert.equal(sp(cod.formError), "Kapıda ödeme 5.000,00 ₺ üzerindeki siparişlerde kullanılamaz.");
    assert.equal(localizeCheckoutFailure({ ok: false, code: "out_of_stock", fieldErrors: {} }, defaultMessages.en, "en").formError, defaultMessages.en.checkout.errors.out_of_stock);
  });

  test("FormData → nested input with checkbox semantics", () => {
    const fd = new FormData();
    fd.set("locale", "en");
    fd.set("contact.email", "a@b.co");
    fd.set("shippingAddress.city", "İzmir");
    fd.set("invoice.type", "individual");
    fd.set("consents.preInformation", "on");
    fd.set("__proto__.polluted", "x");
    fd.set("$ACTION_ID_abc", "x");
    const out = checkoutFormDataToInput(fd);
    assert.deepEqual(out, {
      locale: "en",
      contact: { email: "a@b.co" },
      shippingAddress: { city: "İzmir" },
      invoice: { type: "individual", sameAsShipping: false, eInvoice: false },
      consents: { preInformation: true, distanceSales: false },
    });
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
});

// ---------------------------------------------------------------------------------------------

function loaded(lines: EngineLine[], extra: Partial<LoadedCart> = {}): LoadedCart {
  return {
    cart: { id: "00000000-0000-4000-8000-000000000000", couponCode: null, locale: "tr", expiresAt: null },
    customer: RETAIL_CUSTOMER,
    lines: lines.map((l) => ({
      ...l,
      display: {
        productSlug: l.productType === "sample" ? "lavanta-numune" : "lavanta",
        name: l.productType === "sample" ? { tr: "Lavanta Numune", en: "Lavender Sample" } : { tr: "Lavanta", en: "Lavender", ar: "اللافندر" },
        subtitle: { tr: "Sıvı El Sabunu", en: "Liquid Hand Soap" },
        accentColor: "#8E61B6",
        sku: `SKU-${l.variantId}`,
        barcode: null,
        variantLabels: l.productType === "sample" ? [] : [{ tr: "Pompalı Şişe 500 ml", en: "Pump Bottle 500 ml" }],
        image: null,
        volumeMl: 500,
        lowStockThreshold: 5,
      },
    })),
    coupon: null,
    campaigns: [],
    sampleOffers: [
      { variantId: 301, productId: 91, productSlug: "okyanus-numune", name: { tr: "Okyanus Numune" }, subtitle: null, accentColor: null, image: null, inStock: true },
      { variantId: 302, productId: 92, productSlug: "portakal-numune", name: { tr: "Portakal Numune" }, subtitle: null, accentColor: null, image: null, inStock: false },
    ],
    ...extra,
  };
}

describe("cart view", () => {
  test("Turkish labels, formatted money and summary rows", () => {
    const lines = [line({ quantity: 2 }), sample({ variantId: 301 })];
    const totals = computeCart(input(lines, { coupon: coupon({ code: "HOSGELDIN", value: 10 }) }));
    const view = buildCartView(totals, loaded(lines), "tr");
    assert.equal(view.itemCount, 3);
    assert.equal(view.itemCountLabel, "3 ürün");
    assert.equal(view.lines[0].name, "Lavanta");
    assert.equal(view.lines[0].variantLabel, "Pompalı Şişe 500 ml");
    assert.equal(view.lines[0].href, "/tr/urunler/lavanta");
    assert.equal(sp(view.lines[0].unitPrice.label), "149,90 ₺");
    assert.equal(view.lines[0].lineSubtotal.amount, 29980);
    assert.equal(view.lines[0].canIncrease, true);
    assert.equal(view.lines[0].canDecrease, true);
    assert.equal(view.lines[1].isSample, true);
    assert.equal(view.lines[1].priceNote, "Ücretsiz numune");
    assert.equal(view.lines[1].href, "/tr/urunler/lavanta", "samples link to the parent product");
    assert.deepEqual(
      view.summary.map((r) => [r.key, r.label, sp(r.amountLabel)]),
      [
        ["subtotal", "Ara toplam", "299,80 ₺"],
        ["coupon", "İndirim kodu (HOSGELDIN)", "-29,98 ₺"],
        ["shipping", "Kargo", "99,90 ₺"],
        ["total", "Toplam", "369,72 ₺"],
        ["vat", "Toplama dahil KDV", formatVat(totals.vatTotal)],
      ],
    );
    assert.equal(view.coupon?.message, "İndirim kodu uygulandı.");
    assert.equal(sp(view.shipping.message), "Ücretsiz kargo için 1.230,18 ₺ daha ekleyin.");
    assert.equal(view.availableSamples[0].inCart, true);
    assert.equal(view.availableSamples[0].canAdd, false);
    assert.equal(view.availableSamples[1].canAdd, false, "out of stock");
    assert.equal(view.samples.remaining, 1);
    assert.equal(view.checkoutAllowed, true);
    const card = view.paymentMethods.find((m) => m.method === "card")!;
    assert.equal(card.label, "Kredi / banka kartı");
    assert.equal(card.visible, true);
    const deferred = view.paymentMethods.find((m) => m.method === "deferred")!;
    assert.equal(deferred.visible, false);
    const havale = view.paymentMethods.find((m) => m.method === "bank_transfer")!;
    assert.ok(havale.summary.some((r) => r.key === "bankTransfer" && r.label === "Havale/EFT indirimi (%5)"));
  });

  test("issues and coupon refusals are localized (en plural, amounts)", () => {
    const lines = [line({ quantity: 150, maxQuantity: 200 }), line({ productStatus: "draft" })];
    const totals = computeCart(input(lines, { coupon: coupon({ minOrderTotal: 9_999_999 }) }));
    const view = buildCartView(totals, loaded(lines), "en");
    assert.equal(view.lines[0].issues[0].message, "Only 100 left in stock; the quantity has been updated.");
    assert.equal(view.lines[1].issues[0].message, "This product is no longer available. Remove it to continue.");
    assert.equal(view.blockingIssues.length, 1);
    assert.equal(view.checkoutAllowed, false);
    assert.equal(view.coupon?.status, "invalid");
    assert.equal(sp(view.coupon?.message), "Your cart total must be at least ₺99,999.99 to use this code.");
    assert.equal(view.itemCountLabel, "100 items");
  });

  test("free shipping reached, COD over limit message", () => {
    const lines = [line({ basePrice: 600000, weightGrams: 0 })];
    const view = buildCartView(computeCart(input(lines)), loaded(lines), "tr");
    assert.equal(view.shipping.free, true);
    assert.equal(view.shipping.progress, 1);
    assert.equal(view.shipping.message, "Kargonuz ücretsiz.");
    const cod = view.paymentMethods.find((m) => m.method === "cash_on_delivery")!;
    assert.equal(cod.available, false);
    assert.equal(sp(cod.reasonMessage), "Kapıda ödeme 5.000,00 ₺ üzerindeki siparişlerde kullanılamaz.");
  });

  test("empty cart", () => {
    const view = buildCartView(computeCart(input([])), loaded([]), "ar");
    assert.equal(view.isEmpty, true);
    assert.equal(view.checkoutAllowed, false);
    assert.equal(view.shipping.message, null);
    assert.deepEqual(
      view.summary.map((r) => r.key),
      ["subtotal", "total", "vat"],
    );
  });
});

function formatVat(kurus: number) {
  return `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(kurus / 100)} ₺`.replace(/[  ]/g, " ");
}

describe("legal texts", () => {
  const lines = [line({ quantity: 2 })];
  const totals = computeCart(input(lines, { paymentMethod: "cash_on_delivery" }));
  const data = legalOrderData(totals, loaded(lines), "tr", "cash_on_delivery");
  const base = {
    locale: "tr" as const,
    seller: {
      legalName: "PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ.",
      siteName: "PRESTİJ",
      phone: "0352 353 30 70",
      email: "",
      address: { line: "Cırgalan Mah.", district: "Kocasinan", city: "Kayseri", country: "Türkiye" },
    },
    estimatedDays: { min: 1, max: 3 },
    items: data.items,
    totals: data.totals,
    paymentMethod: "cash_on_delivery" as const,
    date: NOW,
    document: { key: "pre_information", version: "taslak-1", title: { tr: "Ön Bilgilendirme Formu" }, body: { tr: "<p>Gövde <script>alert(1)</script>metni</p>" } },
  };

  test("preview with a half-filled form: placeholders, escaping, sanitized body", () => {
    const buyer = legalBuyerFromUnknown({ contact: { email: "x@y.z" }, shippingAddress: { fullName: "<img src=x onerror=alert(1)>" } });
    const html = sp(renderPreInformation({ ...base, buyer, orderNumber: null }));
    assert.match(html, /Sipariş onaylandığında verilecektir/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img|<script/);
    assert.match(html, /Lavanta — Sıvı El Sabunu \(Pompalı Şişe 500 ml\) × 2: 299,80 ₺ — birim fiyat 149,90 ₺, KDV %20 dahil/);
    assert.match(html, /Kapıda ödeme hizmet bedeli: 49,90 ₺/);
    assert.match(html, /<strong>Toplam: 449,60 ₺<\/strong>/);
    assert.match(html, /1–3 iş günü/);
    assert.match(html, /14 gün/);
    assert.match(html, /<hr>\n<p>Gövde metni<\/p>/);
    assert.match(html, /<strong>Ödeme yöntemi:<\/strong> Kapıda ödeme/);
  });

  test("stored version carries the order number and the full buyer", () => {
    const html = renderDistanceSales({
      ...base,
      orderNumber: "PR-261001",
      document: null,
      buyer: {
        email: "a@b.co",
        phone: "+905321234567",
        shippingAddress: { fullName: "Ayşe Yılmaz", city: "Kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. No: 4" },
        invoice: { type: "corporate", companyName: "Otel A.Ş.", taxOffice: "Kocasinan", taxNumber: "1234567890", sameAsShipping: true },
      },
    });
    assert.match(html, /<h2>Mesafeli Satış Sözleşmesi<\/h2>/);
    assert.match(html, /PR-261001/);
    assert.match(html, /Cumhuriyet Mah\. No: 4, Kocasinan \/ Kayseri/);
    assert.match(html, /Kurumsal fatura/);
    assert.match(html, /Otel A\.Ş\./);
  });

  test("Arabic text isolates Latin values so numbers keep their order", () => {
    const buyer = legalBuyerFromUnknown({ contact: { email: "a@b.co", phone: "0532 123 45 67" }, shippingAddress: { fullName: "Ahmed" } });
    const ar = renderPreInformation({ ...base, locale: "ar", buyer, orderNumber: "PR-261001", document: null });
    assert.match(ar, /⁨0352 353 30 70⁩/);
    assert.match(ar, /⁨PR-261001⁩/);
    const tr = renderPreInformation({ ...base, buyer, orderNumber: "PR-261001", document: null });
    assert.doesNotMatch(tr, /[⁨⁩]/);
  });
});

describe("paths and dictionaries", () => {
  test("order routes in every locale", () => {
    assert.equal(href("tr", "order", { orderNumber: "PR-261001" }), "/tr/siparis/PR-261001");
    assert.equal(href("en", "order", { orderNumber: "PR-261001" }), "/en/order/PR-261001");
    assert.equal(href("ar", "orderLookup"), "/ar/order");
    assert.equal(href("tr", "orderLookup"), "/tr/siparis");
    assert.equal(href("tr", "paymentSimulator"), "/tr/odeme/simulator");
    assert.equal(href("en", "paymentSimulator"), "/en/checkout/simulator");
    assert.equal(localizePath("en", "/siparis/PR-261001?t=x"), "/en/order/PR-261001?t=x");
    assert.equal(localizePath("tr", "/en/order"), "/tr/siparis");
  });

  test("tr, en and ar dictionaries have the same keys", () => {
    const keys = (m: object) => Object.keys(flattenMessages(m)).sort();
    assert.deepEqual(keys(defaultMessages.en), keys(defaultMessages.tr));
    assert.deepEqual(keys(defaultMessages.ar), keys(defaultMessages.tr));
  });

  test("settings helper sanity", () => {
    assert.equal(settings().payments.bankTransfer.accounts.length, 1);
  });
});
