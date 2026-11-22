// Go-live CF-9 (seller identity, RG 32058 m.5) and CF-10 (launch checklist): the settings fields, the rows the
// footer and the contact section render, the panel validation, the messages, and the go-live steps of the
// "Yayına çıkınca" checklist (only whether something is set, never a value).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SellerIdentity from "@/components/store/SellerIdentity";
import { flattenMessages } from "@/i18n/format";
import { defaultMessages } from "@/i18n/messages";
import { adminRecipientsState, cronSecretState, launchChecklist, type LaunchChecklistInput, type LaunchStep } from "@/lib/panel/seo/launch";
import { generalSettingsInput } from "@/lib/panel/settings/schemas";
import { UI_STRING_SUBGROUP_LABELS } from "@/lib/panel/ui-strings/catalog";
import { chamberRulesHref, missingSellerFields, sellerIdentityRows } from "@/lib/settings/seller";
import { parseSettings, type Settings } from "@/lib/settings/types";

const LEGAL = "PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ.";
const labels = defaultMessages.tr.footer.seller;

const filled = (): Settings<"general"> =>
  parseSettings("general", {
    email: "info@prestij.com.tr",
    mersisNo: "0123456789000015",
    taxOffice: "Erciyes",
    taxNumber: "7330012345",
    kep: "prestij@hs01.kep.tr",
    chamber: { name: { tr: "Kayseri Ticaret Odası", en: "Kayseri Chamber of Commerce", ar: "غرفة تجارة قيصري" }, rulesUrl: "https://www.example.org/meslek-kurallari" },
    trademark: "PRESTİJ",
  });

describe("settings: chamber and trademark", () => {
  test("stored rows from before go-live parse with empty defaults", () => {
    const general = parseSettings("general", {});
    assert.deepEqual(general.chamber, { name: { tr: "" }, rulesUrl: "" });
    assert.equal(general.trademark, "");
    assert.equal(general.legalName, LEGAL);
  });

  test("the panel validates the rules link (https) and the lengths; a payload without the fields saves them empty", () => {
    const base = { siteName: "PRESTİJ", legalName: LEGAL, tagline: { tr: "" }, phone: "0352 353 30 70", address: { line: "Cırgalan Mah.", district: "Kocasinan", city: "Kayseri", country: "Türkiye" }, social: {}, logo: { lightId: null, darkId: null } };
    const old = generalSettingsInput.parse(base);
    assert.deepEqual(old.chamber, { name: { tr: "" }, rulesUrl: "" });
    assert.equal(old.trademark, "");
    const ok = generalSettingsInput.parse({ ...base, chamber: { name: { tr: " Kayseri Ticaret Odası " }, rulesUrl: " https://www.example.org/kurallar " }, trademark: " PRESTİJ " });
    assert.deepEqual(ok.chamber, { name: { tr: "Kayseri Ticaret Odası" }, rulesUrl: "https://www.example.org/kurallar" });
    assert.equal(ok.trademark, "PRESTİJ");
    const bad = generalSettingsInput.safeParse({ ...base, chamber: { name: { tr: "Oda" }, rulesUrl: "http://example.org" }, trademark: "x".repeat(121) });
    assert.equal(bad.success, false);
    const paths = bad.success ? [] : bad.error.issues.map((i) => i.path.join("."));
    assert.ok(paths.includes("chamber.rulesUrl"), paths.join(","));
    assert.ok(paths.includes("trademark"), paths.join(","));
  });
});

describe("seller identity rows", () => {
  test("filled fields in order, the chamber in the reader's language with its rules link", () => {
    const rows = sellerIdentityRows(filled(), "tr", labels);
    assert.deepEqual(
      rows.map((r) => [r.key, r.label, r.value, r.href]),
      [
        ["legalName", "Ticari unvan", LEGAL, null],
        ["mersisNo", "MERSİS No", "0123456789000015", null],
        ["kep", "KEP adresi", "prestij@hs01.kep.tr", null],
        ["chamber", "Meslek odası", "Kayseri Ticaret Odası", "https://www.example.org/meslek-kurallari"],
        ["trademark", "Tescilli marka", "PRESTİJ", null],
      ],
    );
    assert.equal(sellerIdentityRows(filled(), "ar", defaultMessages.ar.footer.seller)[3].value, "غرفة تجارة قيصري");
    assert.deepEqual(
      sellerIdentityRows(filled(), "tr", labels, { legalName: false }).map((r) => r.key),
      ["mersisNo", "kep", "chamber", "trademark"],
    );
  });

  test("every field is hidden when empty; a rules link alone shows nothing; unsafe links are dropped", () => {
    assert.deepEqual(sellerIdentityRows(parseSettings("general", {}), "tr", labels).map((r) => r.key), ["legalName"]);
    const onlyLink = parseSettings("general", { chamber: { name: { tr: "" }, rulesUrl: "https://example.org" } });
    assert.equal(sellerIdentityRows(onlyLink, "tr", labels).some((r) => r.key === "chamber"), false);
    assert.equal(chamberRulesHref("javascript:alert(1)"), null);
    assert.equal(chamberRulesHref("http://example.org"), null);
    assert.equal(chamberRulesHref(" https://example.org/a?b=c "), "https://example.org/a?b=c");
  });

  test("rendered markup: visible labels, values bidi-isolated, the rules link opens in a new tab", () => {
    const html = renderToStaticMarkup(
      createElement(SellerIdentity, { rows: sellerIdentityRows(filled(), "ar", defaultMessages.ar.footer.seller), rulesLabel: defaultMessages.ar.footer.seller.chamberRules, newTabHint: "(new tab)" }),
    );
    assert.ok(html.includes(`<bdi>${LEGAL}</bdi>`), html);
    assert.ok(html.includes("<bdi>0123456789000015</bdi>"));
    assert.ok(html.includes("<bdi>prestij@hs01.kep.tr</bdi>"));
    assert.match(html, /<a href="https:\/\/www\.example\.org\/meslek-kurallari" target="_blank" rel="noopener noreferrer"[^>]*>القواعد المهنية<span class="sr-only"> \(new tab\)<\/span><\/a>/);
    assert.equal(renderToStaticMarkup(createElement(SellerIdentity, { rows: [], rulesLabel: "x", newTabHint: "y" })), "");
  });

  test("tr/en/ar labels exist and the panel names their UI-strings group in Turkish", () => {
    for (const locale of ["tr", "en", "ar"] as const) {
      const flat = flattenMessages(defaultMessages[locale]);
      for (const key of ["title", "legalName", "mersisNo", "kep", "chamber", "chamberRules", "trademark"]) assert.ok(flat[`footer.seller.${key}`], `${locale} footer.seller.${key}`);
      for (const key of ["closedTitle", "closedText", "closedContact"]) assert.ok(flat[`checkout.page.${key}`], `${locale} checkout.page.${key}`);
      for (const key of ["mersisNo", "kep"]) assert.ok(flat[`email.layout.${key}`], `${locale} email.layout.${key}`);
      for (const key of ["testPaymentTitle", "testPayment"]) assert.ok(flat[`email.orders.adminNew.${key}`], `${locale} email.orders.adminNew.${key}`);
    }
    assert.ok(UI_STRING_SUBGROUP_LABELS["footer.seller"]);
    assert.equal(defaultMessages.tr.footer.contact, "İletişim");
  });
});

describe("missing seller fields (go-live step)", () => {
  test("everything the regulation lists; the trademark is optional", () => {
    assert.deepEqual(missingSellerFields(filled()), []);
    assert.deepEqual(missingSellerFields({ ...filled(), trademark: "" } as Settings<"general">), []);
    assert.deepEqual(missingSellerFields(parseSettings("general", {})), [
      "MERSİS numarası",
      "vergi dairesi",
      "vergi numarası",
      "KEP adresi",
      "e-posta",
      "meslek odası",
      "meslek kuralları bağlantısı",
    ]);
  });
});

const base: LaunchChecklistInput = {
  origin: "https://prestij.com.tr",
  verification: { google: "", bing: "", yandex: "" },
  socialLinks: 0,
  indexNow: "missing",
  address: "Cırgalan Mah. Engir Gölü Küme Evler No:5/E, Kocasinan / Kayseri",
};
const step = (steps: LaunchStep[], key: string) => {
  const found = steps.find((s) => s.key === key);
  assert.ok(found, key);
  return found;
};
const GO_LIVE = ["seller-identity", "checkout-contracts", "email-sending", "site-url", "cron-secret", "admin-recipients"];

describe("CF-10: go-live steps of the launch checklist", () => {
  test("come right after media storage in the 'before' group, then the sales steps, the wheel and the search engines", () => {
    const steps = launchChecklist(base);
    const keys = steps.map((s) => s.key);
    assert.deepEqual(keys.slice(0, 7), ["media-storage", ...GO_LIVE]);
    // SR-6 sales steps close the "before" group; the wheel steps and the search-engine steps follow (FIX B-F9).
    assert.deepEqual(keys.slice(7, 12), ["real-prices", "shipping-settings", "gift-wheel-slices", "wheel-terms-review", "google-search-console"]);
    for (const key of GO_LIVE) assert.equal(step(steps, key).group, "before", key);
  });

  test("no badge while the panel does not pass the inputs (the site address is always known)", () => {
    const steps = launchChecklist(base);
    for (const key of ["seller-identity", "checkout-contracts", "email-sending", "cron-secret", "admin-recipients"]) assert.equal(step(steps, key).done, null, key);
    assert.equal(step(steps, "site-url").done, true);
  });

  test("done flags and status lines from the inputs", () => {
    const run = (extra: Partial<LaunchChecklistInput>) => launchChecklist({ ...base, ...extra });
    assert.equal(step(run({ sellerMissing: [] }), "seller-identity").done, true);
    const seller = step(run({ sellerMissing: ["MERSİS numarası", "KEP adresi"] }), "seller-identity");
    assert.equal(seller.done, false);
    assert.ok(seller.steps.includes("Eksik: MERSİS numarası, KEP adresi."));
    assert.equal(seller.panelHref, "/panel/ayarlar/genel");

    assert.equal(step(run({ emailDriver: { driver: "smtp", ready: true, problem: null } }), "email-sending").done, true);
    const none = step(run({ emailDriver: { driver: "none", ready: false, problem: "E-posta gönderimi yapılandırılmadı." } }), "email-sending");
    assert.equal(none.done, false);
    assert.ok(none.steps.some((l) => l === "Şu an: E-posta gönderimi yapılandırılmadı."));
    const outbox = step(run({ emailDriver: { driver: "outbox", ready: true, problem: null } }), "email-sending");
    assert.equal(outbox.done, false, "the local outbox sends nothing");
    assert.ok(outbox.steps.some((l) => l.includes("EMAIL_DRIVER=outbox")));

    const local = step(run({ origin: "http://localhost:3000" }), "site-url");
    assert.equal(local.done, false);
    assert.ok(local.steps.some((l) => l.startsWith("Şu an: ")));
    assert.equal(step(run({ origin: "https://localhost:3000" }), "site-url").done, false);

    assert.equal(step(run({ cronSecret: "set" }), "cron-secret").done, true);
    assert.equal(step(run({ cronSecret: "missing" }), "cron-secret").done, false);
    assert.ok(step(run({ cronSecret: "short" }), "cron-secret").steps.some((l) => l.includes("16 karakterden kısa")));

    assert.equal(step(run({ adminRecipients: "set" }), "admin-recipients").done, true);
    assert.equal(step(run({ adminRecipients: "fallback" }), "admin-recipients").done, false);
    assert.ok(step(run({ adminRecipients: "fallback" }), "admin-recipients").steps.some((l) => l.includes("Firma bilgilerindeki e-posta")));
    assert.ok(step(run({ adminRecipients: "missing" }), "admin-recipients").steps.some((l) => l.includes("adres yok")));
  });

  test("state helpers never return a value", () => {
    assert.equal(cronSecretState(undefined), "missing");
    assert.equal(cronSecretState(""), "missing");
    assert.equal(cronSecretState("short-secret"), "short");
    assert.equal(cronSecretState("x".repeat(16)), "set");
    assert.equal(adminRecipientsState(["owner@example.com"], ""), "set");
    assert.equal(adminRecipientsState([" ", "not-an-address"], "info@prestij.com.tr"), "fallback");
    assert.equal(adminRecipientsState([], ""), "missing");
    assert.equal(adminRecipientsState(undefined, undefined), "missing");
  });

  test("plain Turkish without promises or secrets", () => {
    const steps = launchChecklist({
      ...base,
      sellerMissing: ["KEP adresi"],
      emailDriver: { driver: "none", ready: false, problem: "x" },
      cronSecret: "short",
      adminRecipients: "missing",
    }).filter((s) => GO_LIVE.includes(s.key));
    const text = JSON.stringify(steps).toLocaleLowerCase("tr-TR");
    assert.ok(!/garanti|1\. sıra|ilk sıra|birinci/.test(text));
    assert.ok(!/!/.test(text), "no exclamation marks");
    assert.ok(!/smtps?:\/\//.test(text), "no SMTP URL");
    for (const s of steps) {
      assert.ok(s.title && s.steps.length >= 1, s.key);
      for (const link of s.links) assert.match(link.url, /^https:\/\//);
    }
  });
});
