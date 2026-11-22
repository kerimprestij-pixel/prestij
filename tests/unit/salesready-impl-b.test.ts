// Sales-ready IMPL-B (pure parts):
//   SR-2  the havale payment deadline: settings.payments.bankTransfer.paymentDays (1–14, default 3), the end of
//         the last day in Türkiye time, the overdue cutoff the panel queries use, the order block line of the
//         sales contracts, the checkout hint and the messages in tr/en/ar.
//   SR-3  the go-live "sales" profile: settings it forces, what it keeps, its readiness refusals (legal drafts and
//         [placeholders], seller details, payment methods, Day-1 placeholder prices with the --allow-prices
//         override) and the announcement rule of both profiles.
//   SR-6  the launch checklist's sales steps (real prices with the same rule, havale only while on and never an
//         IBAN, shipping "kontrol et").
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { format } from "@/i18n/format";
import { defaultMessages } from "@/i18n/messages";
import { computeCart } from "@/lib/cart/compute";
import type { LoadedCart } from "@/lib/cart/load";
import { RETAIL_CUSTOMER, type EngineLine } from "@/lib/cart/types";
import { buildCartView } from "@/lib/cart/view";
import {
  BANK_TRANSFER_PAYMENT_DAYS,
  bankTransferDeadline,
  bankTransferOverdueCutoff,
  isBankTransferOverdue,
  normalizePaymentDays,
} from "@/lib/orders/bank-transfer-deadline";
import { legalOrderData, renderDistanceSales, renderPreInformation } from "@/lib/orders/legal-render";
import { paymentSettingsInput } from "@/lib/panel/settings/schemas";
import { DAY1_SHIPPING_DEFAULTS, launchChecklist, shippingStillDefault, type LaunchChecklistInput } from "@/lib/panel/seo/launch";
import {
  DAY1_PLACEHOLDER_PRICES,
  DAY1_PLACEHOLDER_STOCK,
  formatKurusTl,
  placeholderPriceCheck,
  type PriceCheckRow,
} from "@/lib/pricing/placeholder-prices";
import { parseSettings, settingsSchemas, type Settings, type SettingsKey } from "@/lib/settings/types";
import { isUsableBankAccount } from "@/lib/validation/tr";
import {
  PROFILES,
  checkSourceUrl,
  checkTargetUrl,
  sameDatabase,
  SALES_EXPECTED_FLAGS,
  SALES_LEGAL_KEYS,
  SALES_SETTINGS,
  SHOWCASE_SETTINGS,
  announcementFeature,
  announcementsToDeactivate,
  buildSettingsChanges,
  featureSettingsAfter,
  featuresOff,
  legalPlaceholders,
  legalProblems,
  paymentProblems,
  priceProblems,
  readPath,
  resolveProfile,
  salesReadiness,
  sellerProblems,
  type LegalDocRow,
} from "../../scripts/golive/rules";
import { input, line, NOW } from "./helpers";

const IBAN = "TR330006100519786457841326";
const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------------
// SR-2

describe("SR-2 havale payment deadline", () => {
  test("the deadline is the end of the last day in Türkiye time, counted from the order's Istanbul day", () => {
    // 10 Nov 22:30 Istanbul + 3 days -> 13 Nov 23:59:59.999 Istanbul (= 20:59:59.999Z)
    assert.equal(bankTransferDeadline(new Date("2026-11-10T19:30:00Z"), 3).toISOString(), "2026-11-13T20:59:59.999Z");
    // 00:30 Istanbul is already 11 Nov there (21:30Z on the 10th): one day later than a UTC calendar would say
    assert.equal(bankTransferDeadline(new Date("2026-11-10T21:30:00Z"), 3).toISOString(), "2026-11-14T20:59:59.999Z");
    // the last millisecond of the Istanbul day still belongs to it
    assert.equal(bankTransferDeadline(new Date("2026-11-10T20:59:59.999Z"), 3).toISOString(), "2026-11-13T20:59:59.999Z");
    assert.equal(bankTransferDeadline(new Date("2026-11-10T21:00:00.000Z"), 3).toISOString(), "2026-11-14T20:59:59.999Z");
    // no daylight saving in Türkiye since 2016: summer and winter give the same 23:59 Istanbul
    assert.equal(bankTransferDeadline(new Date("2030-07-01T09:00:00Z"), 1).toISOString(), "2030-07-02T20:59:59.999Z");
    // month and year ends
    assert.equal(bankTransferDeadline(new Date("2026-12-30T10:00:00Z"), 3).toISOString(), "2027-01-02T20:59:59.999Z");
    assert.equal(bankTransferDeadline(new Date("2028-02-27T10:00:00Z"), 14).toISOString(), "2028-03-12T20:59:59.999Z");
  });

  test("day counts are whole numbers inside 1–14 (anything unusable reads the default 3)", () => {
    assert.deepEqual(BANK_TRANSFER_PAYMENT_DAYS, { min: 1, max: 14, default: 3 });
    assert.equal(normalizePaymentDays(0), 1);
    assert.equal(normalizePaymentDays(20), 14);
    assert.equal(normalizePaymentDays(2.6), 3);
    assert.equal(normalizePaymentDays(Number.NaN), 3);
    assert.equal(normalizePaymentDays("5"), 3);
    assert.equal(normalizePaymentDays(undefined), 3);
  });

  test("overdue only for an unpaid awaiting_transfer havale order, strictly after the deadline", () => {
    const order = { paymentMethod: "bank_transfer" as const, status: "awaiting_transfer" as const, createdAt: "2026-11-10T19:30:00Z", paidAt: null };
    const deadline = bankTransferDeadline(new Date(order.createdAt), 3).getTime();
    assert.equal(isBankTransferOverdue(order, 3, new Date(deadline)), false, "at the deadline itself");
    assert.equal(isBankTransferOverdue(order, 3, new Date(deadline + 1)), true, "one millisecond later");
    assert.equal(isBankTransferOverdue(order, 5, new Date(deadline + 1)), false, "a longer payment period");
    assert.equal(isBankTransferOverdue({ ...order, paidAt: "2026-11-11T08:00:00Z" }, 3, new Date(deadline + DAY)), false, "paid");
    assert.equal(isBankTransferOverdue({ ...order, status: "cancelled" }, 3, new Date(deadline + DAY)), false, "cancelled");
    assert.equal(isBankTransferOverdue({ ...order, status: "paid" }, 3, new Date(deadline + DAY)), false, "paid status");
    assert.equal(isBankTransferOverdue({ ...order, paymentMethod: "card", status: "pending_payment" }, 3, new Date(deadline + DAY)), false, "card");
    assert.equal(isBankTransferOverdue({ ...order, createdAt: "not a date" }, 3, new Date(deadline + DAY)), false, "broken date");
  });

  test("the cutoff of the panel queries agrees with the deadline for every order time and clock (Istanbul days)", () => {
    let seed = 7;
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const base = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 4000; i++) {
      const created = new Date(base + Math.floor(next() * 400 * DAY));
      const now = new Date(created.getTime() + Math.floor((next() * 20 - 2) * DAY));
      const days = 1 + Math.floor(next() * 14);
      const byCutoff = created.getTime() < bankTransferOverdueCutoff(now, days).getTime();
      const byDeadline = now.getTime() > bankTransferDeadline(created, days).getTime();
      assert.equal(byCutoff, byDeadline, `${created.toISOString()} ${now.toISOString()} ${days}`);
    }
    // midnight edges
    const created = new Date("2026-11-10T20:59:59.999Z"); // 23:59:59.999 Istanbul, 10 Nov
    assert.equal(created < bankTransferOverdueCutoff(new Date("2026-11-13T20:59:59.999Z"), 3), false);
    assert.equal(created < bankTransferOverdueCutoff(new Date("2026-11-13T21:00:00.000Z"), 3), true);
  });

  test("settings: stored rows without the field read 3; the panel accepts 1–14 whole days only", () => {
    const old = { enabled: true, discountPercent: 0, accounts: [], instructions: { tr: "x" } };
    assert.equal(parseSettings("payments", { bankTransfer: old }).bankTransfer.paymentDays, 3);
    assert.equal(parseSettings("payments", {}).bankTransfer.paymentDays, 3);
    assert.equal(parseSettings("payments", { bankTransfer: { ...old, paymentDays: 7 } }).bankTransfer.paymentDays, 7);
    // an out-of-range stored value falls back per field (the rest of the bank settings survive)
    const repaired = parseSettings("payments", { bankTransfer: { ...old, accounts: [{ bank: "B", holder: "H", iban: IBAN }], paymentDays: 40 } });
    assert.equal(repaired.bankTransfer.accounts.length, 1);
    assert.equal(repaired.bankTransfer.paymentDays, 3);

    const panel = (paymentDays: unknown) =>
      paymentSettingsInput.safeParse({
        card: { enabled: false, provider: "paytr", testMode: true, installments: false, maxInstallments: 1 },
        bankTransfer: { enabled: true, discountPercent: 0, accounts: [], instructions: { tr: "" }, paymentDays },
        cashOnDelivery: { enabled: true, fee: 0, maxOrderTotal: 0 },
      });
    for (const ok of [1, 3, 14]) assert.equal(panel(ok).success, true, String(ok));
    for (const bad of [0, 15, 2.5, "3", null, undefined]) assert.equal(panel(bad).success, false, String(bad));
    const issue = panel(15);
    assert.ok(!issue.success && issue.error.issues.some((i) => i.path.join(".") === "bankTransfer.paymentDays" && /en fazla 14/.test(i.message)));
  });

  const lines: EngineLine[] = [line({ quantity: 2 })];
  const loaded = (): LoadedCart => ({
    cart: { id: "00000000-0000-4000-8000-000000000000", couponCode: null, locale: "tr", expiresAt: null },
    customer: RETAIL_CUSTOMER,
    lines: lines.map((l) => ({
      ...l,
      display: {
        productSlug: "lavanta",
        name: { tr: "Lavanta", en: "Lavender", ar: "اللافندر" },
        subtitle: { tr: "Sıvı El Sabunu" },
        accentColor: null,
        sku: `SKU-${l.variantId}`,
        barcode: null,
        variantLabels: [{ tr: "500 ml" }],
        image: null,
        volumeMl: 500,
        lowStockThreshold: 5,
      },
    })),
    coupon: null,
    campaigns: [],
    sampleOffers: [],
  });

  const legalBase = (method: "bank_transfer" | "cash_on_delivery", locale: "tr" | "en" | "ar" = "tr") => {
    const totals = computeCart(input(lines, { paymentMethod: method }));
    const data = legalOrderData(totals, loaded(), locale, method);
    return {
      locale,
      seller: { legalName: "PRESTİJ", siteName: "PRESTİJ", phone: "0352 353 30 70", email: "", address: { line: "Cırgalan", district: "Kocasinan", city: "Kayseri", country: "Türkiye" } },
      estimatedDays: { min: 1, max: 3 },
      buyer: {},
      items: data.items,
      totals: data.totals,
      paymentMethod: method,
      orderNumber: null,
      date: NOW, // 6 Nov 2026 15:00 Istanbul
      document: null,
    };
  };

  test("the order block of both contracts states the havale deadline (and nothing for other methods)", () => {
    const tr = renderPreInformation({ ...legalBase("bank_transfer"), bankTransferDays: 3 });
    // FIX F9: only the date and the day count; the consequence (cancellation) is left to the lawyer-approved body.
    assert.match(tr, /<p>Havale\/EFT ile ödemede son ödeme tarihi: 9 Kasım 2026 \(sipariş tarihinden itibaren 3 gün\)\.<\/p>/);
    assert.doesNotMatch(tr, /iptal edilebilir/);
    assert.doesNotMatch(renderPreInformation({ ...legalBase("bank_transfer", "en"), bankTransferDays: 3 }), /cancelled/);
    assert.doesNotMatch(renderPreInformation({ ...legalBase("bank_transfer", "ar"), bankTransferDays: 3 }), /تُلغى/);
    assert.match(renderDistanceSales({ ...legalBase("bank_transfer"), bankTransferDays: 5 }), /son ödeme tarihi: 11 Kasım 2026 \(sipariş tarihinden itibaren 5 gün\)/);
    assert.doesNotMatch(renderPreInformation({ ...legalBase("cash_on_delivery"), bankTransferDays: 3 }), /son ödeme tarihi/);
    assert.doesNotMatch(renderPreInformation(legalBase("bank_transfer")), /son ödeme tarihi/, "without the setting (older callers): no line");
    assert.match(renderPreInformation({ ...legalBase("bank_transfer", "en"), bankTransferDays: 1 }), /Payment deadline for bank transfer \(havale\/EFT\): November 7, 2026 \(1 day from the order date\)/);
    const ar = renderPreInformation({ ...legalBase("bank_transfer", "ar"), bankTransferDays: 3 });
    assert.match(ar, /آخر موعد للدفع بالتحويل البنكي/);
    assert.match(ar, /⁨[^⁩]+⁩ \(3 أيام من تاريخ الطلب\)/, "the date is isolated in RTL, Arabic plural for 3");
  });

  test("the checkout shows 'pay within N days' under the havale option only", () => {
    const totals = computeCart(input(lines, { settings: { ...input([]).settings, payments: { ...input([]).settings.payments, bankTransfer: { ...input([]).settings.payments.bankTransfer, paymentDays: 5 } } } }));
    const byMethod = new Map(totals.paymentMethods.map((m) => [m.method, m]));
    assert.equal(byMethod.get("bank_transfer")?.paymentDays, 5);
    for (const m of ["card", "cash_on_delivery", "deferred"] as const) assert.equal(byMethod.get(m)?.paymentDays, undefined, m);
    const view = buildCartView(totals, loaded(), "tr");
    assert.equal(view.paymentMethods.find((m) => m.method === "bank_transfer")?.paymentDays, 5);
    assert.equal(format(defaultMessages.tr.checkout.form.methodBankDays, { days: 5 }, "tr"), "Ödemeyi sipariş tarihinden itibaren 5 gün içinde göndermeniz gerekir.");
    assert.equal(format(defaultMessages.en.checkout.form.methodBankDays, { days: 1 }, "en"), "Please send the payment within 1 day of placing the order.");
    assert.equal(format(defaultMessages.ar.checkout.form.methodBankDays, { days: 2 }, "ar"), "يُرجى إرسال المبلغ خلال يومين من تاريخ الطلب.");
    assert.equal(format(defaultMessages.ar.checkout.form.methodBankDays, { days: 11 }, "ar"), "يُرجى إرسال المبلغ خلال 11 يومًا من تاريخ الطلب.");
  });

  test("the order page strings exist in every language", () => {
    for (const locale of ["tr", "en", "ar"] as const) {
      const p = defaultMessages[locale].order.payment;
      assert.ok(p.bankDeadline.trim() && p.bankDeadlineNote.trim() && p.bankDeadlinePassed.trim(), locale);
      assert.ok(defaultMessages[locale].checkout.legal.bankTransferTerm.includes("{date}"), locale);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// SR-3 / SR-6 shared: placeholder prices

/** The catalog as it is today: 13 priced variants on Day-1 prices with stock 100, 4 free samples. */
function todaysCatalog(): PriceCheckRow[] {
  const prices = [14990, 44990, 149990];
  const rows: PriceCheckRow[] = [];
  for (const scent of ["LVL", "LAV", "POR", "OKY"]) {
    ["500", "5L", "20L"].forEach((size, i) =>
      rows.push({ sku: `PR-${scent}-${size}`, price: prices[i], stock: 100, variantActive: true, productStatus: "active", productType: "standard" }),
    );
    rows.push({ sku: `PR-${scent}-NUM`, price: 0, stock: 500, variantActive: true, productStatus: "active", productType: "sample" });
  }
  rows.push({ sku: "PR-SET-4X5L", price: 159990, stock: 100, variantActive: true, productStatus: "active", productType: "bundle" });
  return rows;
}

describe("placeholder prices (one rule for the go-live script and the panel)", () => {
  test("today's catalog still has the Day-1 set: 13/13 priced variants, samples left out", () => {
    const check = placeholderPriceCheck(todaysCatalog());
    assert.equal(check.considered, 13);
    assert.equal(check.matches.length, 13);
    assert.equal(check.placeholder, true);
    assert.deepEqual([...DAY1_PLACEHOLDER_PRICES], [14990, 44990, 149990, 159990]);
    assert.equal(DAY1_PLACEHOLDER_STOCK, 100);
  });

  test("a Day-1 price matches whatever the stock (FIX F2), only for active, priced, non-sample variants", () => {
    const real = todaysCatalog().map((r) => (r.price > 0 ? { ...r, price: r.price + 1000 } : r));
    assert.equal(placeholderPriceCheck(real).placeholder, false);
    assert.equal(placeholderPriceCheck(real).matches.length, 0);
    const restocked = todaysCatalog().map((r) => ({ ...r, stock: r.price > 0 ? 37 : r.stock }));
    assert.equal(placeholderPriceCheck(restocked).matches.length, 13, "updating the stock first never hides a seed price");
    assert.equal(placeholderPriceCheck(restocked).placeholder, true);
    const archived = todaysCatalog().map((r) => ({ ...r, productStatus: "archived" }));
    assert.equal(placeholderPriceCheck(archived).considered, 0);
    assert.equal(placeholderPriceCheck(archived).placeholder, false);
    const inactive = todaysCatalog().map((r) => ({ ...r, variantActive: false }));
    assert.equal(placeholderPriceCheck(inactive).considered, 0);
  });

  test("the panel's 'Yapılacak' set: half or more of the priced variants (and at least two); fewer is 'Kontrol et'", () => {
    const rows = todaysCatalog();
    const keep = (n: number) => {
      let left = n;
      return rows.map((r) => (r.price > 0 && left-- > 0 ? r : r.price > 0 ? { ...r, price: r.price + 500 } : r));
    };
    assert.equal(placeholderPriceCheck(keep(1)).placeholder, false, "1/13");
    assert.equal(placeholderPriceCheck(keep(6)).placeholder, false, "6/13 < 50%");
    assert.equal(placeholderPriceCheck(keep(7)).placeholder, true, "7/13 >= 50%");
    const single = [{ sku: "A", price: 14990, stock: 100, variantActive: true, productStatus: "active", productType: "standard" }];
    assert.equal(placeholderPriceCheck(single).placeholder, false, "a single variant is never 'the set'");
    assert.equal(placeholderPriceCheck([...single, { ...single[0], sku: "B", price: 44990 }]).placeholder, true, "2/2");
    assert.equal(placeholderPriceCheck([]).placeholder, false);
  });

  test("formatKurusTl prints Turkish lira without Intl", () => {
    assert.equal(formatKurusTl(14990), "149,90 TL");
    assert.equal(formatKurusTl(159990), "1.599,90 TL");
    assert.equal(formatKurusTl(150000), "1.500,00 TL");
    assert.equal(formatKurusTl(5), "0,05 TL");
  });
});

// ---------------------------------------------------------------------------------------------------
// SR-3

const filledGeneral = (): Settings<"general"> => ({
  ...parseSettings("general", {}),
  legalName: "PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ.",
  email: "satis@prestij.example",
  phone: "0352 353 30 70",
  mersisNo: "0123456789012345",
  taxOffice: "Kocasinan",
  taxNumber: "1234567890",
  kep: "prestij@hs01.kep.tr",
  chamber: { name: { tr: "Kayseri Ticaret Odası" }, rulesUrl: "https://www.example.org/meslek-kurallari" },
});

const payments = (patch: { cod?: boolean; bank?: boolean; accounts?: { bank: string; holder: string; iban: string }[] } = {}): Settings<"payments"> => {
  const p = parseSettings("payments", {});
  return {
    ...p,
    cashOnDelivery: { ...p.cashOnDelivery, enabled: patch.cod ?? true },
    bankTransfer: { ...p.bankTransfer, enabled: patch.bank ?? true, accounts: patch.accounts ?? [{ bank: "Ziraat", holder: "PRESTİJ", iban: IBAN }] },
  };
};

const approvedDocs = (): LegalDocRow[] =>
  SALES_LEGAL_KEYS.map((key) => ({ key, version: "2026-11 v1", body: { tr: `<h2>Madde 1</h2><p>Onaylı metin [1] ${key}.</p>`, en: "<p>Summary.</p>" } }));

describe("SR-3 sales profile: settings", () => {
  const stored = (): Partial<Record<SettingsKey, unknown>> => ({
    payments: { card: { enabled: true, provider: "paytr", testMode: false, installments: true }, bankTransfer: { enabled: true, discountPercent: 3, accounts: [{ bank: "Z", holder: "H", iban: IBAN }], instructions: { tr: "x" }, paymentDays: 5 }, cashOnDelivery: { enabled: true, fee: 4990, maxOrderTotal: 0 } },
    samples: { cartSampleEnabled: true, requestFormEnabled: false, maxPerOrder: 2, minOrderTotal: 0 },
    newsletter: { enabled: true, popupEnabled: true, popupDelaySeconds: 20, incentive: { tr: "x" } },
    giftWheel: { ...settingsSchemas.giftWheel.parse({}), enabled: true, reminderEnabled: true },
  });

  test("forces card, wheel, newsletter, free samples (FIX F1) and subscriptions off; keeps kapıda ödeme and havale as configured", () => {
    const changes = new Map(buildSettingsChanges(SALES_SETTINGS, stored()).map((c) => [c.key, c]));
    assert.deepEqual([...changes.keys()].sort(), ["giftWheel", "newsletter", "payments", "samples", "subscriptions"]);
    const samples = changes.get("samples")!.value as Settings<"samples">;
    assert.deepEqual([samples.cartSampleEnabled, samples.requestFormEnabled, samples.maxPerOrder], [false, false, 2], "only the two switches change");
    const p = changes.get("payments")!.value as Settings<"payments">;
    assert.equal(p.card.enabled, false);
    assert.equal(p.cashOnDelivery.enabled, true);
    assert.equal(p.bankTransfer.enabled, true);
    assert.equal(p.bankTransfer.paymentDays, 5);
    assert.equal(p.bankTransfer.discountPercent, 3);
    assert.deepEqual(changes.get("payments")!.fields.map((f) => f.path), ["card.enabled"]);
    for (const flag of SALES_EXPECTED_FLAGS) {
      assert.equal(readPath(changes.get(flag.key)!.value, flag.path), flag.expected, `${flag.key}.${flag.path}`);
    }
    assert.equal(PROFILES.sales.settings, SALES_SETTINGS);
    assert.equal(PROFILES.showcase.settings, SHOWCASE_SETTINGS);
    assert.deepEqual(PROFILES.sales.unpublishPageSlugs, PROFILES.showcase.unpublishPageSlugs);
    assert.deepEqual(PROFILES.sales.hideSectionTypes, ["newsletter"]);
  });

  test("is idempotent", () => {
    const once = buildSettingsChanges(SALES_SETTINGS, stored());
    for (const c of buildSettingsChanges(SALES_SETTINGS, Object.fromEntries(once.map((x) => [x.key, x.value])))) assert.deepEqual(c.fields, [], c.key);
  });
});

describe("SR-3 sales readiness", () => {
  test("legal texts: a taslak label, the draft notice, [placeholders] or a missing text each refuse", () => {
    assert.deepEqual(legalProblems(approvedDocs()), [], "short [1] style brackets are not placeholders");
    const docs = approvedDocs();
    docs[0] = { ...docs[0], version: "taslak-2" };
    docs[1] = { ...docs[1], body: { tr: '<aside class="legal-draft" role="note"><p>TASLAK</p></aside><p>Metin</p>' } };
    docs[2] = { ...docs[2], body: { tr: "<p>E-posta: [e-posta adresi]</p>", en: "<p>[<strong>company e-mail</strong>]</p>" } };
    const problems = legalProblems(docs.slice(0, 5));
    assert.deepEqual(
      problems.map((p) => p.code),
      ["legal-draft:pre_information", "legal-notice:distance_sales", "legal-placeholder:kvkk", "legal-missing:membership"],
    );
    for (const p of problems) assert.ok(p.tr.trim() && p.en.trim(), p.code);
    assert.match(problems[2].tr, /\[e-posta adresi\], \[company e-mail\]/);
  });

  test("placeholders: the legal editor's rule (2–120 characters between brackets, FIX F8), tags ignored, every language", () => {
    assert.deepEqual(legalPlaceholders({ tr: "<p>[a] [ab] [abc] [MERSİS numarası]</p>" }), ["[ab]", "[abc]", "[MERSİS numarası]"]);
    assert.deepEqual(legalPlaceholders({ tr: `<p>[${"x".repeat(120)}]</p>` }), [`[${"x".repeat(120)}]`]);
    assert.deepEqual(legalPlaceholders({ tr: `<p>[${"x".repeat(121)}]</p>` }), []);
    assert.deepEqual(legalPlaceholders({ tr: "<p>[Sipariş özeti ödeme adımında otomatik eklenir.]</p>" }), ["[Sipariş özeti ödeme adımında otomatik eklenir.]"]);
    assert.deepEqual(legalPlaceholders({ ar: "<p>[حقل فارغ]</p>" }), ["[حقل فارغ]"]);
    assert.deepEqual(legalPlaceholders(null), []);
  });

  test("seller details: the panel's rule (missingSellerFields: incl. KEP, chamber and its rules link; FIX F3)", () => {
    assert.deepEqual(sellerProblems(filledGeneral()), []);
    const [problem] = sellerProblems(parseSettings("general", {}));
    assert.match(problem.tr, /MERSİS numarası, vergi dairesi, vergi numarası, KEP adresi, e-posta, meslek odası, meslek kuralları bağlantısı/);
    assert.match(problem.en, /MERSİS number, tax office, tax number, KEP address, e-mail, professional chamber/);
    const noAddress = { ...filledGeneral(), address: { line: "", district: "Kocasinan", city: "Kayseri", country: "Türkiye" } };
    assert.match(sellerProblems(noAddress)[0].tr, /adres/);
  });

  test("payments: kapıda ödeme and/or havale; havale needs a valid IBAN with a holder", () => {
    assert.deepEqual(paymentProblems(payments()), []);
    assert.deepEqual(paymentProblems(payments({ bank: false })), [], "kapıda ödeme alone");
    assert.deepEqual(paymentProblems(payments({ cod: false })), [], "havale alone");
    assert.deepEqual(paymentProblems(payments({ cod: false, bank: false })).map((p) => p.code), ["payments-none"]);
    assert.deepEqual(paymentProblems(payments({ accounts: [] })).map((p) => p.code), ["payments-bank-account"]);
    assert.deepEqual(paymentProblems(payments({ accounts: [{ bank: "Z", holder: "H", iban: "TR000000000000000000000000" }] })).map((p) => p.code), ["payments-bank-account"]);
    assert.deepEqual(paymentProblems(payments({ accounts: [{ bank: "Z", holder: " ", iban: IBAN }] })).map((p) => p.code), ["payments-bank-account"]);
    assert.equal(isUsableBankAccount({ iban: "tr33 0006 1005 1978 6457 8413 26", holder: "PRESTİJ" }), true);
    assert.equal(isUsableBankAccount(null), false);
  });

  test("prices: the placeholder set refuses; --allow-prices turns it into a warning", () => {
    const check = placeholderPriceCheck(todaysCatalog());
    const refused = priceProblems(check, false);
    assert.equal(refused.problems.length, 1);
    assert.match(refused.problems[0].tr, /13\/13 fiyatlı varyant hâlâ örnek fiyatta/);
    assert.match(refused.problems[0].tr, /PR-LVL-500 149,90 TL/, "the SKUs are listed");
    assert.match(refused.problems[0].en, /--allow-prices/);
    const allowed = priceProblems(check, true);
    assert.deepEqual(allowed.problems, []);
    assert.equal(allowed.warnings.length, 1);
    assert.deepEqual(priceProblems(placeholderPriceCheck([]), false), { problems: [], warnings: [] });
  });

  test("today's data is refused on every rule; fake-but-valid data passes", () => {
    const today = salesReadiness({
      legal: SALES_LEGAL_KEYS.map((key) => ({ key, version: "taslak-1", body: { tr: "<p>[e-posta adresi]</p>" } })),
      general: parseSettings("general", {}),
      payments: payments({ accounts: [] }),
      prices: placeholderPriceCheck(todaysCatalog()),
      allowPrices: false,
    });
    const codes = new Set(today.problems.map((p) => p.code.split(":")[0]));
    assert.deepEqual([...codes].sort(), ["legal-draft", "legal-placeholder", "payments-bank-account", "prices", "seller"]);
    const ready = salesReadiness({
      legal: approvedDocs(),
      general: filledGeneral(),
      payments: payments(),
      prices: placeholderPriceCheck(todaysCatalog().map((r) => (r.price > 0 ? { ...r, price: r.price + 1000, stock: 25 } : r))),
      allowPrices: false,
    });
    assert.deepEqual(ready, { problems: [], warnings: [] });
  });
});

describe("SR-3 rehearsal source", () => {
  test("a rehearsal database may be the source only of another local rehearsal database", () => {
    const rehearsalA = "postgres://postgres:postgres@127.0.0.1:54329/prestij_golive_a";
    assert.equal(checkSourceUrl(rehearsalA).ok, false, "default: never");
    assert.equal(checkSourceUrl(rehearsalA, { rehearsalTarget: false }).ok, false, "production target: never");
    assert.equal(checkSourceUrl(rehearsalA, { rehearsalTarget: true }).ok, true);
    assert.equal(checkSourceUrl("postgres://postgres:postgres@127.0.0.1:54329/prestij_golive_A", { rehearsalTarget: true }).ok, false, "the rehearsal name rule still applies");
    assert.equal(checkSourceUrl(`${rehearsalA}?database=prestij`, { rehearsalTarget: true }).ok, false, "no URL parameters");
    assert.equal(checkSourceUrl("postgres://postgres:postgres@db.example.com:5432/prestij_golive_a", { rehearsalTarget: true }).ok, false, "local only");
    const target = checkTargetUrl(rehearsalA);
    assert.equal(sameDatabase(checkSourceUrl(rehearsalA, { rehearsalTarget: true }), target), true, "the scripts then refuse source = target");
  });
});

describe("SR-3 announcements linking to a switched-off feature (both profiles)", () => {
  test("links are recognised in every language form; absolute URLs and other pages are left alone", () => {
    const cases: [string | null, string | null][] = [
      ["/numune", "samples"],
      ["/tr/numune", "samples"],
      ["/en/samples", "samples"],
      ["/ar/samples?ref=bar", "samples"],
      ["numune", "samples"],
      ["/sayfa/hediye-carki-kampanya-kosullari", "giftWheel"],
      ["/en/page/hediye-carki-kampanya-kosullari", "giftWheel"],
      ["/#hediye-carki", "giftWheel"],
      ["#bulten", "newsletter"],
      ["/bulten/onay", "newsletter"],
      ["/en/newsletter/confirm", "newsletter"],
      ["/hesap/abonelikler", "subscriptions"],
      ["/en/account/subscriptions", "subscriptions"],
      ["/urunler", null],
      ["/numuneler-hakkinda", null],
      ["https://example.com/numune", null],
      ["//example.com/numune", null],
      ["mailto:info@prestij.example", null],
      ["", null],
      [null, null],
    ];
    for (const [href, feature] of cases) assert.equal(announcementFeature(href), feature, String(href));
  });

  test("both profiles turn samples off, so the /numune announcement goes; with --keep-samples sales keeps it while a sample option is on", () => {
    const stored: Partial<Record<SettingsKey, unknown>> = {
      samples: { cartSampleEnabled: true, requestFormEnabled: true, maxPerOrder: 2, minOrderTotal: 0 },
      giftWheel: { ...settingsSchemas.giftWheel.parse({}), enabled: true },
      newsletter: { enabled: true, popupEnabled: false, popupDelaySeconds: 20, incentive: { tr: "x" } },
    };
    const rows = [
      { id: 1, href: null, isActive: true },
      { id: 2, href: "/numune", isActive: true },
      { id: 3, href: "#bulten", isActive: true },
      { id: 4, href: "/numune", isActive: false },
    ];
    const showcase = featuresOff(featureSettingsAfter(buildSettingsChanges(SHOWCASE_SETTINGS, stored), stored));
    assert.deepEqual([...showcase].sort(), ["giftWheel", "newsletter", "samples", "subscriptions"]);
    assert.deepEqual(announcementsToDeactivate(rows, showcase).map((a) => [a.id, a.feature]), [[2, "samples"], [3, "newsletter"]]);

    const sales = featuresOff(featureSettingsAfter(buildSettingsChanges(SALES_SETTINGS, stored), stored));
    assert.deepEqual([...sales].sort(), ["giftWheel", "newsletter", "samples", "subscriptions"]);
    assert.deepEqual(announcementsToDeactivate(rows, sales).map((a) => a.id), [2, 3], "the /numune announcement goes with the samples (FIX F1)");

    const kept = resolveProfile("sales", { keepSamples: true });
    const salesKept = featuresOff(featureSettingsAfter(buildSettingsChanges(kept.settings, stored), stored));
    assert.deepEqual([...salesKept].sort(), ["giftWheel", "newsletter", "subscriptions"]);
    assert.deepEqual(announcementsToDeactivate(rows, salesKept).map((a) => a.id), [3], "--keep-samples (ÜTS confirmed) keeps /numune");

    const noSamples = { ...stored, samples: { cartSampleEnabled: false, requestFormEnabled: false, maxPerOrder: 2, minOrderTotal: 0 } };
    const keptNoSamples = featuresOff(featureSettingsAfter(buildSettingsChanges(kept.settings, noSamples), noSamples));
    assert.deepEqual(announcementsToDeactivate(rows, keptNoSamples).map((a) => a.id), [2, 3], "the owner switched both sample options off");
    const formOnly = { ...stored, samples: { cartSampleEnabled: false, requestFormEnabled: true, maxPerOrder: 2, minOrderTotal: 0 } };
    assert.equal(featuresOff(featureSettingsAfter([], formOnly)).has("samples"), false, "the request form alone keeps /numune useful");
  });
});

// ---------------------------------------------------------------------------------------------------
// SR-6

describe("SR-6 launch checklist: sales steps", () => {
  const base: LaunchChecklistInput = {
    origin: "https://prestij.com.tr",
    verification: { google: "", bing: "", yandex: "" },
    socialLinks: 0,
    indexNow: "missing",
    address: "",
  };
  const step = (input: LaunchChecklistInput, key: string) => launchChecklist(input).find((s) => s.key === key);
  const shipping = { flatFee: 9990, freeThreshold: 150000, heavy: { enabled: true, thresholdGrams: 10000, feePerKg: 1500 } };

  test("follow the go-live steps; havale only while it is on", () => {
    const keys = launchChecklist({ ...base, bankTransfer: { enabled: true, accounts: 1, usableAccounts: 1, paymentDays: 3 } }).map((s) => s.key);
    assert.deepEqual(keys.slice(keys.indexOf("admin-recipients") + 1, keys.indexOf("gift-wheel-slices")), ["real-prices", "bank-transfer", "shipping-settings"]);
    for (const key of ["real-prices", "bank-transfer", "shipping-settings"]) assert.equal(step({ ...base, bankTransfer: { enabled: true, accounts: 1, usableAccounts: 1, paymentDays: 3 } }, key)?.group, "before", key);
    assert.equal(step({ ...base, bankTransfer: { enabled: false, accounts: 0, usableAccounts: 0, paymentDays: 3 } }, "bank-transfer"), undefined);
    assert.equal(step(base, "bank-transfer"), undefined);
  });

  test("Fiyatlar gerçek: Tamam only with no Day-1 price; Yapılacak for the set; Kontrol et with the SKUs in between (FIX F2)", () => {
    assert.equal(step(base, "real-prices")?.done, null);
    assert.equal(step(base, "real-prices")?.review, false);
    const todays = step({ ...base, prices: placeholderPriceCheck(todaysCatalog()) }, "real-prices")!;
    assert.equal(todays.done, false);
    assert.equal(todays.review, false);
    assert.ok(todays.steps.some((l) => /13\/13 varyant örnek fiyatta/.test(l) && l.includes("PR-LVL-500")));
    assert.equal(todays.panelHref, "/panel/urunler");
    const one = todaysCatalog().map((r) => (r.sku === "PR-LVL-500" || r.price === 0 ? r : { ...r, price: r.price + 100 }));
    const kept = step({ ...base, prices: placeholderPriceCheck(one) }, "real-prices")!;
    assert.equal(kept.done, null, "one kept seed price is never a green Tamam");
    assert.equal(kept.review, true, "Kontrol et");
    assert.ok(kept.steps.some((l) => l.includes("PR-LVL-500") && /doğruysa sorun değil/.test(l)));
    const six = todaysCatalog().map((r, i) => (r.price === 0 || i < 8 ? r : { ...r, price: r.price + 100 }));
    const partly = step({ ...base, prices: placeholderPriceCheck(six) }, "real-prices")!;
    assert.equal(placeholderPriceCheck(six).placeholder, false, "6/13: below half");
    assert.deepEqual([partly.done, partly.review], [null, true]);
    const none = step({ ...base, prices: placeholderPriceCheck(todaysCatalog().map((r) => (r.price > 0 ? { ...r, price: r.price + 100 } : r))) }, "real-prices")!;
    assert.deepEqual([none.done, none.review], [true, false]);
    assert.ok(!JSON.stringify(none.steps).includes("çeşit"), "the panel's own word: varyant");
  });

  test("Havale: IBAN and payment days as counts, never the IBAN itself", () => {
    const missing = step({ ...base, bankTransfer: { enabled: true, accounts: 0, usableAccounts: 0, paymentDays: 3 } }, "bank-transfer")!;
    assert.equal(missing.done, false);
    assert.ok(missing.steps.some((l) => /banka hesabı yok/.test(l)));
    const invalid = step({ ...base, bankTransfer: { enabled: true, accounts: 2, usableAccounts: 0, paymentDays: 3 } }, "bank-transfer")!;
    assert.ok(invalid.steps.some((l) => /geçerli bir IBAN/.test(l)));
    const ok = step({ ...base, bankTransfer: { enabled: true, accounts: 1, usableAccounts: 1, paymentDays: 7 } }, "bank-transfer")!;
    assert.equal(ok.done, true);
    assert.ok(ok.steps.some((l) => /şu an 7 gün/.test(l)));
    assert.equal(ok.panelHref, "/panel/ayarlar/odeme");
    assert.ok(!JSON.stringify(launchChecklist({ ...base, bankTransfer: { enabled: true, accounts: 1, usableAccounts: 1, paymentDays: 7 } })).includes("TR33"));
  });

  test("Kargo ayarları: 'kontrol et' (not a blocker) while a fee is still on its Day-1 value", () => {
    const parsed = parseSettings("shipping", {});
    assert.deepEqual(DAY1_SHIPPING_DEFAULTS, { flatFee: parsed.flatFee, freeThreshold: parsed.freeThreshold, heavy: parsed.heavy });
    const unknown = step(base, "shipping-settings")!;
    assert.equal(unknown.done, null);
    assert.equal(unknown.review, false);
    const day1 = step({ ...base, shipping }, "shipping-settings")!;
    assert.equal(day1.done, null, "never 'Yapılacak'");
    assert.equal(day1.review, true);
    assert.ok(day1.steps.some((l) => /Şu an: kargo 99,90 TL, ücretsiz kargo 1\.500,00 TL ve üzeri, ağır paket farkı 10 kg üzerinde kg başına 15,00 TL\./.test(l)));
    assert.ok(day1.steps.some((l) => /Kargoya verme süresini de kontrol edin/.test(l)), "the shipping lead time printed in the contracts (FIX B-F8)");
    assert.equal(day1.panelLabel, "Ayarlar › Kargo", "the settings page is called Kargo");
    const withLead = step({ ...base, shipping: { ...shipping, estimatedDays: { min: 1, max: 3 } } }, "shipping-settings")!;
    assert.ok(withLead.steps.some((l) => /şu an 1–3 iş günü/.test(l)));
    assert.deepEqual(shippingStillDefault(shipping), ["kargo ücreti", "ücretsiz kargo sınırı", "ağır paket farkı"]);
    const partly = { ...shipping, flatFee: 12990 };
    assert.deepEqual(shippingStillDefault(partly), ["ücretsiz kargo sınırı", "ağır paket farkı"]);
    assert.equal(step({ ...base, shipping: partly }, "shipping-settings")!.review, true);
    const changed = { flatFee: 12990, freeThreshold: 200000, heavy: { enabled: false, thresholdGrams: 10000, feePerKg: 1500 } };
    const done = step({ ...base, shipping: changed }, "shipping-settings")!;
    assert.equal(done.done, true);
    assert.equal(done.review, false);
    assert.ok(done.steps.some((l) => /ücretsiz kargo 2\.000,00 TL ve üzeri, ağır paket farkı kapalı\./.test(l)));
  });
});
