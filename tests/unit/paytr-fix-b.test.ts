// PayTR-fix IMPL-B, pure parts:
//   S7   PayTR's contract notice (Çerçeve Sözleşme Art. 10.2/10.3): the footer rule (card on, provider PayTR, test mode
//        off, keys configured, no simulator), the UI strings footer.paytr.* in tr/en/ar with the {company} link, the
//        server-rendered notice (link to https://www.paytr.com, <bdi>, the optional logo), the settings field
//        payments.paytrLogoImageId (storefront and panel schemas, audit label), and the wiring in the footer, on the
//        card page and in the payment settings form; no client JS.
//   S17  free samples switched off: which links count as the samples page (any language form, hash, query; the same
//        rule as the go-live announcement check), the menu filter, the section filter (main call to action → section
//        left out; other buttons and links → removed; texts untouched; the result still passes the section schemas),
//        and the wiring in the header, the footer and every page that renders page-builder sections; /numune keeps
//        its own sections and shows its closed notice.
//   Panel texts (C9, S8, C1, C11, C12): /panel/ayarlar/odeme names PayTR's current pages and the live-mode order.
// The DB half (the logo reference check on save and in the media usage list): tests/db/paytr-fix-b.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fieldLabel } from "@/components/panel/audit/labels";
import PaymentReadiness, { isVercelAppUrl } from "@/components/panel/settings/PaymentReadiness";
import { sectionMeta, type SectionType } from "@/components/sections/schemas";
import PaytrNotice, { splitPaytrNotice } from "@/components/store/PaytrNotice";
import { flattenMessages } from "@/i18n/format";
import { defaultMessages } from "@/i18n/messages";
import type { NavItem } from "@/lib/data/site";
import type { PageSectionData } from "@/lib/data/pages";
import type { MediaLike } from "@/lib/media/types";
import { paymentSettingsInput } from "@/lib/panel/settings/schemas";
import { findUiString, UI_STRING_SUBGROUP_LABELS } from "@/lib/panel/ui-strings/catalog";
import { analyzeTemplate, validateOverride } from "@/lib/panel/ui-strings/template";
import { PAYTR_WEBSITE_URL, paytrNoticeInFooter, type PaytrNoticeInput } from "@/lib/payments/paytr-notice";
import type { PaymentReadiness as Readiness } from "@/lib/payments/readiness";
import {
  isSamplesHref,
  samplesSwitchedOff,
  SAMPLES_PAGE_SLUG,
  sectionLeadsToSamples,
  withoutSamplesMenuItems,
  withoutSamplesSections,
} from "@/lib/samples/visibility";
import { parseSettings } from "@/lib/settings/types";
import { announcementFeature } from "../../scripts/golive/rules";

const read = (path: string) => readFileSync(path, "utf8");
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const CONTRACT_SENTENCE = "Bu internet sitesindeki ödeme hizmetleri PAYTR Ödeme ve Elektronik Para Kuruluşu A.Ş. tarafından sağlanmaktadır.";
const COMPANY = "PAYTR Ödeme ve Elektronik Para Kuruluşu A.Ş.";

// ---------------------------------------------------------------------------------------------------------------
// S7

describe("S7: when the footer shows the PayTR notice", () => {
  const live: PaytrNoticeInput = { card: { enabled: true, provider: "paytr", testMode: false }, paytrConfigured: true, simulator: false };

  test("only while customers can really pay by card through PayTR", () => {
    assert.equal(paytrNoticeInFooter(live), true);
    assert.equal(paytrNoticeInFooter({ ...live, card: { ...live.card, enabled: false } }), false, "card off (the sales profile)");
    assert.equal(paytrNoticeInFooter({ ...live, card: { ...live.card, provider: "iyzico" } }), false, "another provider");
    assert.equal(paytrNoticeInFooter({ ...live, card: { ...live.card, testMode: true } }), false, "test mode: card hidden from customers (CF-11)");
    assert.equal(paytrNoticeInFooter({ ...live, paytrConfigured: false }), false, "keys missing: card shows as unavailable");
    assert.equal(paytrNoticeInFooter({ ...live, simulator: true }), false, "the local simulator stands in for PayTR");
  });

  test("today's stored settings (card on, iyzico, test mode) and the defaults show nothing", () => {
    const stored = parseSettings("payments", { card: { enabled: true, provider: "iyzico", testMode: true, installments: true } });
    assert.equal(paytrNoticeInFooter({ card: stored.card, paytrConfigured: true, simulator: false }), false);
    assert.equal(paytrNoticeInFooter({ card: parseSettings("payments", {}).card, paytrConfigured: true, simulator: false }), false);
  });

  test("PayTR's website is the link target (Art. 10.3)", () => {
    assert.equal(PAYTR_WEBSITE_URL, "https://www.paytr.com");
  });
});

describe("S7: the UI strings", () => {
  const locales = ["tr", "en", "ar"] as const;

  test("footer.paytr.* exists in tr, en and ar with the same placeholders; the company name is the legal name everywhere", () => {
    for (const locale of locales) {
      const p = defaultMessages[locale].footer.paytr;
      assert.deepEqual(analyzeTemplate(p.notice).simple, ["company"], locale);
      assert.equal(p.company, COMPANY, locale);
      assert.ok(p.logoAlt.trim(), locale);
    }
    const keys = (locale: (typeof locales)[number]) => Object.keys(flattenMessages(defaultMessages[locale])).filter((k) => k.startsWith("footer.paytr."));
    assert.deepEqual(keys("en"), keys("tr"));
    assert.deepEqual(keys("ar"), keys("tr"));
  });

  test("Turkish reads exactly as the contract sentence (website reading of Art. 10.3)", () => {
    const p = defaultMessages.tr.footer.paytr;
    assert.equal(p.notice.replace("{company}", p.company), CONTRACT_SENTENCE);
    assert.match(read("src/i18n/messages/tr.ts"), /Bu internet\s+\/\/ sitesinde\/uygulamadaki ödeme hizmetleri PAYTR Ödeme ve Elektronik Para Kuruluşu A\.Ş\. tarafından/, "the template sentence is quoted next to it");
    assert.match(read("src/i18n/messages/en.ts"), /faithful translation of the Turkish contract sentence/);
    assert.match(read("src/i18n/messages/ar.ts"), /faithful translation of the Turkish contract sentence/);
  });

  test("owner-editable like every UI string, under its own sub-heading; an override must keep {company}", () => {
    for (const key of ["footer.paytr.notice", "footer.paytr.company", "footer.paytr.logoAlt"]) assert.ok(findUiString(key), key);
    assert.ok(UI_STRING_SUBGROUP_LABELS["footer.paytr"]);
    const tr = defaultMessages.tr.footer.paytr.notice;
    assert.equal(validateOverride(tr, "Bu sitedeki ödeme hizmetleri {company} tarafından sağlanır.", "tr"), null);
    assert.match(validateOverride(tr, "Bu sitedeki ödeme hizmetleri PayTR tarafından sağlanır.", "tr") ?? "", /\{company\}/);
  });
});

describe("S7: the notice (server-rendered)", () => {
  const logo: MediaLike = { id: 9001, url: "/media/paytr-logo.png", width: 300, height: 100, alt: null, blurDataUrl: null, dominantColor: null, variants: null };
  const render = (locale: "tr" | "en" | "ar", withLogo: boolean, notice?: string) =>
    renderToStaticMarkup(
      createElement(PaytrNotice, {
        locale,
        labels: notice ? { ...defaultMessages[locale].footer.paytr, notice } : defaultMessages[locale].footer.paytr,
        newTabHint: defaultMessages[locale].common.opensInNewTab,
        logo: withLogo ? logo : null,
      }),
    );

  test("the sentence with the company name as the link to https://www.paytr.com (new tab, isolated)", () => {
    const html = render("tr", false);
    assert.equal(text(html).replace(` ${defaultMessages.tr.common.opensInNewTab}`, ""), CONTRACT_SENTENCE);
    assert.match(html, /<a href="https:\/\/www\.paytr\.com" target="_blank" rel="noopener noreferrer"[^>]*><bdi>PAYTR Ödeme ve Elektronik Para Kuruluşu A\.Ş\.<\/bdi>/);
    assert.ok(html.includes(`<span class="sr-only"> ${defaultMessages.tr.common.opensInNewTab}</span>`));
    assert.ok(!html.includes("<img"), "no logo unless the owner picked one");
  });

  test("the owner's logo when set (PayTR's file, on a white plate); Arabic keeps the Turkish name in <bdi>", () => {
    const html = render("tr", true);
    assert.match(html, /<img[^>]*alt="PayTR"/);
    assert.ok(html.includes("/media/paytr-logo.png"));
    const ar = render("ar", false);
    assert.ok(ar.includes(`<bdi>${COMPANY}</bdi>`));
    assert.ok(text(ar).startsWith("يتم تقديم خدمات الدفع"));
  });

  test("a text without {company} (only by SQL) still links the company after it", () => {
    assert.deepEqual(splitPaytrNotice("A {company} B"), { before: "A ", after: " B" });
    assert.deepEqual(splitPaytrNotice("Ödeme hizmetleri: "), { before: "Ödeme hizmetleri: ", after: "" });
    assert.match(render("tr", false, "Ödeme altyapısı:"), /Ödeme altyapısı: <a href="https:\/\/www\.paytr\.com"/);
  });
});

describe("S7: the logo setting", () => {
  test("storefront schema: a top-level field, null by default; an unusable value is repaired without touching the card settings", () => {
    assert.equal(parseSettings("payments", {}).paytrLogoImageId, null);
    const card = { enabled: true, provider: "paytr", testMode: false, installments: false, maxInstallments: 1 };
    assert.equal(parseSettings("payments", { card }).paytrLogoImageId, null, "rows saved before the field");
    assert.equal(parseSettings("payments", { card, paytrLogoImageId: 42 }).paytrLogoImageId, 42);
    const repaired = parseSettings("payments", { card, paytrLogoImageId: "bad" });
    assert.equal(repaired.paytrLogoImageId, null);
    assert.deepEqual(repaired.card, card);
  });

  test("panel schema: optional media id (empty = none, invalid refused); audit label", () => {
    const base = parseSettings("payments", {});
    const value = (paytrLogoImageId: unknown) => paymentSettingsInput.safeParse({ ...base, paytrLogoImageId });
    for (const empty of [null, undefined, ""]) {
      const r = value(empty);
      assert.ok(r.success && r.data.paytrLogoImageId === null, String(empty));
    }
    const ok = value(7);
    assert.ok(ok.success && ok.data.paytrLogoImageId === 7);
    assert.equal(value(-1).success, false);
    assert.equal(value(1.5).success, false);
    assert.equal(fieldLabel("paytrLogoImageId"), "PayTR logosu");
  });

  test("the key ends in ImageId, so media usage and delete checks find it (src/lib/panel/media/queries.ts)", () => {
    assert.match("paytrLogoImageId", /(image|media)ids?$/i);
    const media = read("src/lib/panel/media/queries.ts");
    assert.match(media, /payments: \{ label: "Ayarlar › Ödeme yöntemleri", href: "\/panel\/ayarlar\/odeme" \}/);
    assert.match(media, /payments: "PayTR logosu"/);
    assert.match(read("src/lib/panel/settings/service.ts"), /ensureMediaExist\(tx, \[\(value as Settings<"payments">\)\.paytrLogoImageId\], "paytrLogoImageId"\)/);
  });
});

describe("S7: wiring (server components only)", () => {
  test("the footer applies the rule from cached settings and the environment, and loads the logo only then", () => {
    const footer = read("src/components/store/Footer.tsx");
    assert.match(footer, /getSettings\("payments"\),/);
    assert.match(footer, /const showPaytr = paytrNoticeInFooter\(\{ card: payments\.card, paytrConfigured: paytrEnv\(\) !== null, simulator: isSimulatorEnabled\(\) \}\);/);
    assert.match(footer, /showPaytr \? getMediaById\(payments\.paytrLogoImageId\) : null/);
    assert.match(footer, /\{showPaytr \? \(\s*<PaytrNotice\s+locale=\{locale\}\s+labels=\{messages\.footer\.paytr\}/);
    assert.doesNotMatch(footer, /from "next\/(headers|server)"/, "no request-time reads in the static footer");
  });

  test("the card page shows the notice and the logo slot under PayTR's form", () => {
    const page = read("src/app/[locale]/odeme/kart/page.tsx");
    assert.match(page, /const paytrLogo = await getMediaById\(\(await getSettings\("payments"\)\)\.paytrLogoImageId\);/);
    const frame = page.indexOf("<CardPaymentFrame");
    const notice = page.indexOf("<PaytrNotice");
    assert.ok(frame > 0 && notice > frame, "after the iframe");
    assert.match(page.slice(notice, notice + 300), /labels=\{messages\.footer\.paytr\}[\s\S]*logo=\{paytrLogo\}/);
  });

  test("no client JS: the notice, its rule and the samples filter are not client modules", () => {
    for (const path of ["src/components/store/PaytrNotice.tsx", "src/lib/payments/paytr-notice.ts", "src/lib/samples/visibility.ts", "src/components/store/Footer.tsx", "src/components/store/Header.tsx"]) {
      assert.doesNotMatch(read(path), /^\s*["']use client["']/m, path);
    }
  });

  test("the payment settings form offers the logo picker and explains where the notice shows", () => {
    const form = read("src/components/panel/settings/PaymentSettingsForm.tsx");
    assert.match(form, /value=\{state\.paytrLogoImageId\}\s+onChange=\{\(id\) => setField\("paytrLogoImageId", id\)\}/);
    assert.match(form, /yalnızca kart açık, kuruluş\s+PayTR, test modu kapalı ve PayTR anahtarları tanımlıyken/);
    assert.match(read("src/app/panel/(dashboard)/ayarlar/odeme/page.tsx"), /const media = logoId \? await getPanelMedia\(\[logoId\]\) : \[\];/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// S17

describe("S17: links to the samples page", () => {
  const yes = ["/numune", "/numune#numune-formu", "/numune?ref=x", "/numune/", "numune", "/tr/numune", "/tr/numune#numune-formu", "/en/samples", "/ar/samples?x=1#a", " /NUMUNE "];
  const no = ["/", "/urunler", "/kurumsal#numune", "/sayfa/numune", "/urunler/numune-seti", "/en/samples-kit", "https://example.com/numune", "//numune", "#numune-formu", "mailto:a@b.c", "", null, undefined, 3];

  test("any language form, with or without a query or #anchor; absolute URLs and anchors are not", () => {
    for (const href of yes) assert.equal(isSamplesHref(href), true, String(href));
    for (const href of no) assert.equal(isSamplesHref(href), false, String(href));
  });

  test("the same rule as the go-live announcement check (scripts/golive/rules.ts)", () => {
    for (const href of [...yes, ...no].filter((h): h is string => typeof h === "string")) {
      assert.equal(isSamplesHref(href), announcementFeature(href) === "samples", href);
    }
  });

  test("samples are off only when both switches are off (the sales profile until ÜTS)", () => {
    assert.equal(samplesSwitchedOff({ cartSampleEnabled: false, requestFormEnabled: false }), true);
    assert.equal(samplesSwitchedOff({ cartSampleEnabled: true, requestFormEnabled: false }), false);
    assert.equal(samplesSwitchedOff({ cartSampleEnabled: false, requestFormEnabled: true }), false);
    assert.equal(samplesSwitchedOff(parseSettings("samples", {})), false);
    assert.equal(SAMPLES_PAGE_SLUG, "numune");
  });
});

describe("S17: menus", () => {
  const item = (label: string, href: string, children: NavItem[] = []): NavItem => ({ label, href, external: false, highlight: false, children });

  test("items linking to /numune (localized hrefs, with a hash) are left out at every level; the rest keeps its order", () => {
    const header = [
      item("Ürünler", "/tr/urunler", [item("El sabunu", "/tr/kategori/el-sabunu"), item("Numune seti", "/tr/numune")]),
      item("Kurumsal", "/tr/kurumsal"),
      item("Numune", "/tr/numune"),
      item("Blog", "/tr/blog"),
    ];
    const footerCorporate = [item("Kurumsal Satış", "/en/business"), item("Ücretsiz Numune", "/en/samples#numune-formu"), item("İletişim", "/en/contact")];
    const before = JSON.stringify(header);
    assert.deepEqual(
      withoutSamplesMenuItems(header).map((i) => [i.label, i.children.map((c) => c.label)]),
      [["Ürünler", ["El sabunu"]], ["Kurumsal", []], ["Blog", []]],
    );
    assert.deepEqual(withoutSamplesMenuItems(footerCorporate).map((i) => i.label), ["Kurumsal Satış", "İletişim"]);
    assert.equal(JSON.stringify(header), before, "the input is not changed");
  });
});

describe("S17: page sections", () => {
  const cta = (href: string) => ({ label: { tr: "Numune talep edin", en: "Request samples" }, href });
  // Shapes as stored today (home section 7, kurumsal 18/20) plus the other link places a section can have, each
  // completed with the section type's panel defaults so that it passes its schema as stored.
  const d = (type: SectionType) => sectionMeta[type].defaults as Record<string, unknown>;
  const pack = (title: string, extra: Record<string, unknown> = {}) => ({ title: { tr: title }, audience: { tr: "Herkes" }, ...extra });
  const sections: PageSectionData[] = [
    { id: 1, type: "hero", audience: "all", content: { ...d("hero"), headline: { tr: "Her elde özen" }, primaryCta: cta("/urunler"), secondaryCta: cta("/numune") } },
    { id: 2, type: "b2b_cta", audience: "all", content: { ...d("b2b_cta"), title: { tr: "Misafirleriniz farkı hisseder." }, cta: cta("/kurumsal"), secondaryCta: cta("/numune#numune-formu") } },
    { id: 7, type: "sample_cta", audience: "all", content: { ...d("sample_cta"), title: { tr: "Kokuları önce deneyin." }, cta: cta("/numune"), imageId: 21 } },
    { id: 20, type: "sample_cta", audience: "business", content: { ...d("sample_cta"), title: { tr: "Kokuları kendi mekânınızda deneyin." }, cta: cta("/numune#numune-formu") } },
    { id: 3, type: "story", audience: "all", content: { ...d("story"), cta: cta("/tr/numune") } },
    { id: 4, type: "hero", audience: "all", content: { ...d("hero"), headline: { tr: "Ücretsiz numune" }, primaryCta: cta("/en/samples") } },
    { id: 5, type: "packaging", audience: "all", content: { ...d("packaging"), items: [pack("5 L", { cta: cta("/numune#numune-formu") }), pack("20 L", { cta: cta("/kurumsal") })] } },
    { id: 6, type: "lifestyle_gallery", audience: "all", content: { ...d("lifestyle_gallery"), items: [{ imageId: 8, href: "/numune" }, { imageId: 9, href: "/urunler" }] } },
    { id: 8, type: "rich_text", audience: "all", content: { ...d("rich_text"), html: { tr: '<p>İşletmelere <a href="/numune">ücretsiz numune</a> gönderiyoruz.</p>' } } },
    { id: 9, type: "faq", audience: "all", content: { ...d("faq"), items: [{ question: { tr: "Numune ücretli mi?" }, answer: { tr: "Hayır." } }] } },
  ];
  const without = (id: number, ...keys: string[]) => {
    const copy = { ...(sections.find((s) => s.id === id)!.content as Record<string, unknown>) };
    for (const key of keys) delete copy[key];
    return copy;
  };

  test("a section whose main call to action is the samples page is left out (cta, a hero's primaryCta)", () => {
    assert.deepEqual(sections.filter(sectionLeadsToSamples).map((s) => s.id), [7, 20, 3, 4]);
    assert.deepEqual(withoutSamplesSections(sections).map((s) => s.id), [1, 2, 5, 6, 8, 9]);
  });

  test("other buttons and links to it are removed, the section stays; texts (rich text, FAQ) are not touched", () => {
    const out = new Map(withoutSamplesSections(sections).map((s) => [s.id, s.content as Record<string, unknown>]));
    assert.deepEqual(out.get(1), without(1, "secondaryCta"));
    assert.deepEqual(out.get(2), without(2, "secondaryCta"));
    assert.deepEqual(out.get(5), { ...without(5), items: [pack("5 L"), pack("20 L", { cta: cta("/kurumsal") })] });
    assert.deepEqual(out.get(6), { ...without(6), items: [{ imageId: 8 }, { imageId: 9, href: "/urunler" }] });
    assert.deepEqual(out.get(8), sections.find((s) => s.id === 8)!.content);
    assert.deepEqual(out.get(9), sections.find((s) => s.id === 9)!.content);
  });

  test("what remains still passes each section's schema (the renderer would otherwise skip it); the input is not changed", () => {
    const before = JSON.stringify(sections);
    for (const s of sections) assert.ok(sectionMeta[s.type as SectionType].schema.safeParse(s.content).success, `fixture ${s.id} (${s.type}) is valid`);
    for (const s of withoutSamplesSections(sections)) {
      assert.ok(sectionMeta[s.type as SectionType].schema.safeParse(s.content).success, `section ${s.id} (${s.type}) still valid`);
    }
    assert.equal(JSON.stringify(sections), before);
  });
});

describe("S17: wiring", () => {
  test("header and footer filter their menus while samples are off (cached settings read)", () => {
    const header = read("src/components/store/Header.tsx");
    assert.match(header, /getSettings\("samples"\),/);
    assert.match(header, /const items = samplesSwitchedOff\(samples\) \? withoutSamplesMenuItems\(menu\) : menu;/);
    const footer = read("src/components/store/Footer.tsx");
    assert.match(footer, /getSettings\("samples"\),/);
    assert.match(footer, /const visible = samplesSwitchedOff\(samples\) \? withoutSamplesMenuItems : \(items: NavItem\[\]\) => items;/);
    for (const name of ["shopMenu", "corporate", "legal"]) assert.match(footer, new RegExp(`const ${name} = visible\\(`), name);
  });

  test("every page that renders page-builder sections reads them through getStorefrontPage; /numune keeps its own", () => {
    const pages = read("src/lib/data/pages.ts");
    assert.match(pages, /const \[page, samples\] = await Promise\.all\(\[getPage\(slug\), getSettings\("samples"\)\]\);/);
    assert.match(pages, /if \(!page \|\| slug === SAMPLES_PAGE_SLUG \|\| !samplesSwitchedOff\(samples\)\) return page;/);
    assert.match(read("src/app/[locale]/page.tsx"), /getStorefrontPage\("home"\),/);
    assert.match(read("src/app/[locale]/sayfa/[slug]/page.tsx"), /const page = await findPage\(slug, getStorefrontPage\);/);
    assert.match(read("src/app/[locale]/urunler/page.tsx"), /getStorefrontPage\(PAGE_SLUG\),/);
    assert.match(read("src/components/store/CmsPage.tsx"), /Promise\.all\(\[getStorefrontPage\(slug\), getMessages\(locale\)\]\)/);
    // Every SectionRenderer use sits in one of these files.
    for (const path of ["src/app/[locale]/page.tsx", "src/app/[locale]/sayfa/[slug]/page.tsx", "src/app/[locale]/urunler/page.tsx", "src/components/store/CmsPage.tsx"]) {
      assert.match(read(path), /<SectionRenderer /, path);
    }
  });

  test("/numune shows its closed notice while the request form is off", () => {
    const form = read("src/components/sections/SampleRequestForm.tsx");
    assert.match(form, /const open = samples\.requestFormEnabled && products\.length > 0;/);
    assert.match(defaultMessages.tr.requests.sample.closed, /^Numune talepleri şu anda alınmıyor\./);
    for (const locale of ["en", "ar"] as const) assert.ok(defaultMessages[locale].requests.sample.closed.trim(), locale);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Panel texts

describe("panel texts: /panel/ayarlar/odeme (C9, S8, C1, C11, C12)", () => {
  const readiness = (paytrNotify: string): Readiness => ({
    cardEnabled: true,
    simulator: false,
    selected: "paytr",
    testMode: true,
    testModeStaffOnly: true,
    checkoutClosedByContracts: false,
    active: "paytr",
    providers: [],
    iyzicoKeyMismatch: null,
    notifyRefusals: null,
    urls: { siteOrigin: new URL(paytrNotify).origin, siteOriginProblem: null, iyzicoCallback: `${new URL(paytrNotify).origin}/api/payments/iyzico/callback`, paytrNotify },
  });
  const page = (url = "https://www.prestij.example/api/payments/paytr/notify") => text(renderToStaticMarkup(createElement(PaymentReadiness, { readiness: readiness(url) })));

  test("current PayTR page names: keys under Destek & Kurulum › Entegrasyon Bilgileri; the Bildirim URL with HTTPS, as shown", () => {
    const t = page();
    assert.match(t, /Destek & Kurulum › Entegrasyon Bilgileri \(eski adı: Bilgi\) sayfasındaki mağaza no/);
    // PayTR-fix R-UX4: no official page names user roles for this page.
    assert.match(t, /Bu sayfayı göremiyorsanız mağazanın ana kullanıcısıyla girin ya da PayTR’ye sorun\./);
    assert.doesNotMatch(t, /teknik kullanıcı/);
    assert.doesNotMatch(t, /› Bilgi sayfası/);
    assert.match(t, /Destek & Kurulum › Ayarlar › Bildirim URL Ayarları bölümüne bu adresi aynen yapıştırın\. Protokolü HTTPS seçin\. Sonuna “\/” eklemeyin/);
    assert.match(t, /Sanal POS, şirket türü olarak Limited Şirket/);
    assert.match(t, /kendi yazılımımız, iFrame API/);
  });

  test("the live-mode order: test payment → Evet, Entegrasyonu Tamamladım → Canlı Moda Geçiş Talebi Gönder → SMS/e-mail → test mode off → small real payment and refund", () => {
    const t = page();
    const steps = ["“Ödendi” görününce", "Destek & Kurulum › Canlı Mod sayfasında", "Evet, Entegrasyonu Tamamladım", "Canlı Moda Geçiş Talebi Gönder", "SMS ve e-postayla haber verir", "test modunu kapatıp kaydedin", "küçük tutarlı gerçek bir sipariş"];
    let at = -1;
    for (const step of steps) {
      const next = t.indexOf(step, at + 1);
      assert.ok(next > at, `${step} after the previous step`);
      at = next;
    }
    assert.match(t, /PayTR 010” \(bakiye yetersiz\) hatası verebilir\. Bu bir site hatası değildir/);
    assert.doesNotMatch(t, /mağazanızı Canlı Mod/);
    assert.match(t, /Havale\/EFT ürününü açmayın ve ara bildirim adresi tanımlamayın/);
  });

  test("a *.vercel.app notify URL gets a warning not to register it", () => {
    assert.equal(isVercelAppUrl("https://prestij-abc.vercel.app/api/payments/paytr/notify"), true);
    assert.equal(isVercelAppUrl("https://www.prestij.com.tr/api/payments/paytr/notify"), false);
    assert.equal(isVercelAppUrl("not a url"), false);
    assert.match(page("https://prestij-abc.vercel.app/api/payments/paytr/notify"), /Bu adresi PayTR’ye girmeyin\./);
    assert.doesNotMatch(page(), /Bu adresi PayTR’ye girmeyin/);
  });

  test("the test-mode switch says to wait for PayTR's confirmation; installments stay off without lawyer texts", () => {
    const form = read("src/components/panel/settings/PaymentSettingsForm.tsx");
    assert.match(form, /PayTR'de bunu ancak PayTR canlı moda geçiş talebinizi onaylayıp SMS veya e-postayla bildirince kapatın/);
    assert.match(form, /Avukatınızın onayladığı sözleşmeler taksiti anlatmıyorsa kapalı tutun/);
  });
});
