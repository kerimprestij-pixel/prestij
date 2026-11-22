// Day 5 FIX2 (second review, REVIEW2): R2-1 the footer company name is bidi-isolated (its final period
// stays after "ŞTİ" on the Arabic pages); R2-2 Arabic product image alts are one noun phrase (the idafa of
// the product's SEO title, else "name — type"), not name + type read as a sentence; R2-3 the /kurumsal hero
// subline no longer repeats the <h1> keyword line word for word, and the /en/samples sentence reads
// correctly (round-3 correction records).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FooterCopyright, { withPeriod } from "@/components/store/FooterCopyright";
import { productCardImageAlt, productGalleryImages, productPhrase } from "@/components/store/product-heading";
import type { MediaLike } from "@/lib/media/types";
import { earlierVersions, roundOf, undoLocalizedFixes } from "../../scripts/seed-data/content-fixes";
import { BUNDLE, SCENTS } from "../../scripts/seed-data/products";
import { SECTION_COPY_FIXES, SITE_PAGES } from "../../scripts/seed-data/site-pages";

const LOCALES = ["tr", "en", "ar"] as const;
type L = (typeof LOCALES)[number];
const t = (tr: string, en?: string, ar?: string) => ({ tr, ...(en ? { en } : {}), ...(ar ? { ar } : {}) });

describe("R2-1: the footer copyright line", () => {
  const LEGAL = "PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ.";

  test("the company name (with its final period) sits in its own <bdi>, the year in a left-to-right span", () => {
    const html = renderToStaticMarkup(createElement(FooterCopyright, { year: 2026, holder: LEGAL, rights: "جميع الحقوق محفوظة." }));
    assert.ok(html.includes(`<bdi>${LEGAL}</bdi>`), html);
    assert.ok(html.includes('<span dir="ltr">2026</span>'), html);
    assert.ok(html.startsWith("<p>© "), html);
    assert.ok(html.endsWith("جميع الحقوق محفوظة.</p>"), html);
    // Nothing of the name stands outside the isolate (the period was the part that jumped in RTL).
    assert.equal(html.replace(`<bdi>${LEGAL}</bdi>`, "").includes("ŞTİ"), false);
  });

  test("withPeriod: one final period, never two", () => {
    assert.equal(withPeriod(LEGAL), LEGAL);
    assert.equal(withPeriod("  PRESTİJ "), "PRESTİJ.");
    const html = renderToStaticMarkup(createElement(FooterCopyright, { year: 2026, holder: "PRESTİJ", rights: "Tüm hakları saklıdır." }));
    assert.ok(html.includes("<bdi>PRESTİJ.</bdi>"), html);
  });

  test("the footer renders the line through FooterCopyright (legal name, else the site name)", () => {
    const footer = readFileSync("src/components/store/Footer.tsx", "utf8");
    assert.match(footer, /<FooterCopyright year=\{year\} holder=\{general\.legalName \|\| general\.siteName\} rights=\{messages\.footer\.rights\} \/>/);
    assert.doesNotMatch(footer, /withPeriod\(/, "no unisolated copy of the name left in the footer");
  });
});

describe("R2-2: the product as one noun phrase (image alts)", () => {
  const lavanta = { name: t("Lavanta", "Lavender", "اللافندر"), subtitle: t("Sıvı El Sabunu", "Liquid Hand Soap", "صابون سائل لليدين") };
  const okyanus = { name: t("Okyanus", "Ocean", "المحيط"), subtitle: t("Duş Jeli", "Shower Gel", "جل الاستحمام") };
  const bundle = { name: t("Dört Koku Koleksiyonu", "Four-Scent Collection", "مجموعة الروائح الأربع"), subtitle: t("4 × 5 L Bidon Seti", "4 × 5 L Canister Set", "طقم 4 عبوات × 5 لترات") };
  const titled = <T extends object>(p: T, ar: string) => ({ ...p, seoTitle: t("TR başlık", "EN title", ar) });

  test("Turkish and English: the heading as one line, whatever the SEO title says", () => {
    const p = titled(lavanta, "صابون اللافندر السائل لليدين — زجاجة بمضخة");
    assert.equal(productPhrase(p, "tr"), "Lavanta Sıvı El Sabunu");
    assert.equal(productPhrase(p, "en"), "Lavender Liquid Hand Soap");
    assert.equal(productCardImageAlt(p, "tr"), "Lavanta Sıvı El Sabunu");
  });

  test("Arabic: the SEO title's phrase before the dash (idafa), when it names the product and says more", () => {
    assert.equal(productPhrase(titled(lavanta, "صابون اللافندر السائل لليدين — زجاجة بمضخة و5 و20 لترًا"), "ar"), "صابون اللافندر السائل لليدين");
    assert.equal(productPhrase(titled(okyanus, "جل الاستحمام المحيط — زجاجة بمضخة وعبوات 5 و20 لترًا"), "ar"), "جل الاستحمام المحيط");
    assert.equal(productPhrase(titled(lavanta, "صابون اللافندر السائل لليدين | عبوات كبيرة"), "ar"), "صابون اللافندر السائل لليدين", "other separators");
    assert.equal(productPhrase(titled(lavanta, "صابون اللافندر السائل لليدين"), "ar"), "صابون اللافندر السائل لليدين", "a title without a separator");
  });

  test("Arabic fallback: 'name — type' (never 'name type', which reads as a sentence)", () => {
    assert.equal(productPhrase(lavanta, "ar"), "اللافندر — صابون سائل لليدين", "no SEO title");
    assert.equal(productPhrase(titled(lavanta, "عروض الصابون — PRESTİJ"), "ar"), "اللافندر — صابون سائل لليدين", "a title that does not name the product");
    assert.equal(productPhrase(titled(bundle, "مجموعة الروائح الأربع — طقم 4 × 5 لترات صابون وجل استحمام"), "ar"), "مجموعة الروائح الأربع — طقم 4 عبوات × 5 لترات", "a title phrase that is only the name");
    assert.equal(productPhrase({ name: t("Okyanus Duş Jeli", "x", "جل الاستحمام المحيط"), subtitle: t("Duş Jeli", "x", "جل الاستحمام") }, "ar"), "جل الاستحمام المحيط", "a name that already says the type");
    assert.equal(productPhrase({ ...lavanta, seoTitle: t("Lavanta Sıvı El Sabunu — Pompalı Şişe") }, "ar"), "اللافندر — صابون سائل لليدين", "never the Turkish title on /ar");
  });

  test("the seed's own Arabic SEO titles give every listed product a natural card alt", () => {
    const products = [...SCENTS, BUNDLE];
    const alts = Object.fromEntries(products.map((p) => [p.slug, productCardImageAlt({ name: p.name, subtitle: p.subtitle, seoTitle: p.seo.title }, "ar")]));
    assert.deepEqual(alts, {
      "lavanta-latte": "صابون لاتيه اللافندر السائل لليدين",
      lavanta: "صابون اللافندر السائل لليدين",
      portakal: "صابون البرتقال السائل لليدين",
      okyanus: "جل الاستحمام المحيط",
      "dort-koku-koleksiyonu": "مجموعة الروائح الأربع — طقم 4 عبوات × 5 لترات",
    });
    for (const p of products) assert.equal(productCardImageAlt({ name: p.name, subtitle: p.subtitle, seoTitle: p.seo.title }, "tr"), `${p.name.tr} ${p.subtitle.tr}`, p.slug);
  });

  test("gallery fallback alt (image without an Arabic alt): the phrase plus the size", () => {
    const media: MediaLike = { id: 1, url: "/media/x-1.webp", width: 1200, height: 1500, alt: t("Lavanta"), blurDataUrl: null, dominantColor: null, variants: null };
    const product = {
      ...lavanta,
      category: null,
      seo: { title: t("Lavanta Sıvı El Sabunu — Pompalı Şişe", "x", "صابون اللافندر السائل لليدين — زجاجة بمضخة") },
      options: [{ id: 1, name: t("Ambalaj"), display: "buttons", values: [{ id: 11, value: t("5 L Bidon", "5 L Canister", "عبوة 5 لترات"), swatchColor: null, swatchMediaId: null }] }],
      variants: [{ id: 5, optionValueIds: [11] }],
      media: [{ media, variantId: 5 }],
    } as unknown as Parameters<typeof productGalleryImages>[0];
    assert.equal(productGalleryImages(product, "ar")[0].alt, "صابون اللافندر السائل لليدين، عبوة 5 لترات");
    assert.equal(productGalleryImages(product, "tr")[0].alt, "Lavanta", "the image's own alt still comes first");
    assert.equal(productGalleryImages({ ...product, seo: null } as typeof product, "ar")[0].alt, "اللافندر — صابون سائل لليدين، عبوة 5 لترات");
  });

  test("wired up: cards carry the SEO title; the product page's share alt and title fallback use the phrase", () => {
    const catalog = readFileSync("src/lib/data/catalog.ts", "utf8");
    assert.match(catalog, /seoTitle: LocalizedText \| null;/);
    assert.match(catalog, /seo: p\.seo,/);
    assert.match(catalog, /seoTitle: seo\?\.title \?\? null,/);
    const page = readFileSync("src/app/[locale]/urunler/[slug]/page.tsx", "utf8");
    assert.match(page, /const phrase = productPhrase\(\{ \.\.\.product, seoTitle: product\.seo\?\.title \}, locale\);/);
    assert.match(page, /seoText\(product\.seo\?\.title, locale, phrase\)/);
    assert.match(page, /imageAlt: phrase \}/);
  });
});

describe("R2-3: /kurumsal hero subline and the /en/samples sentence (round 3)", () => {
  const LOCAL = { tr: "tr-TR", en: "en-US", ar: "ar" } as const;
  const lower = (s: string, l: L) => s.toLocaleLowerCase(LOCAL[l]);
  const sectionOf = (page: string, type: string) => SITE_PAGES.find((p) => p.slug === page)!.sections.find((s) => s.type === type)!.content as Record<string, Record<L, string>>;
  const hero = sectionOf("kurumsal", "hero");
  const samples = sectionOf("numune", "hero");

  test("the subline names the keyword in its own words: no copy of the <h1> keyword line, and not its opening", () => {
    const keyword = { tr: "toptan sıvı sabun", en: "bulk liquid soap", ar: "صابون سائل بالجملة" };
    for (const l of LOCALES) {
      const subline = lower(hero.subline[l], l);
      const eyebrow = lower(hero.eyebrow[l], l);
      assert.ok(!subline.includes(eyebrow), `${l}: the subline repeats the <h1> line "${hero.eyebrow[l]}"`);
      assert.ok(!subline.startsWith(eyebrow.split(" ").slice(0, 3).join(" ")), `${l}: the subline opens like the <h1> line`);
      assert.ok(subline.includes(keyword[l]), `${l}: the first paragraph still names the keyword: ${hero.subline[l]}`);
    }
    // Supporting terms from the keyword map (docs/DAY5-SEO.md §1) instead of the repeat.
    assert.ok(hero.subline.tr.includes("tedariki") && hero.subline.tr.includes("20 litrelik bidon") && hero.subline.tr.includes("el sabunu"));
    assert.ok(hero.subline.en.includes("20-litre canister") && hero.subline.ar.includes("عبوة 20 لترًا"));
    assert.equal(hero.eyebrow.tr, "Toptan Sıvı Sabun ve Duş Jeli", "the <h1> keyword line is unchanged");
  });

  test("/en/samples: '…to your business, so you can experience…'", () => {
    assert.ok(samples.subline.en.includes("Let us send free liquid soap samples to your business, so you can experience the scent, the lather and the texture"), samples.subline.en);
    assert.ok(!samples.subline.en.includes(", and experience"));
  });

  test("round-3 records: exactly these two texts, each undoing to the version the live database holds (round 2)", () => {
    const round3 = SECTION_COPY_FIXES.filter((f) => Object.values(f.fixes).some((list) => list?.some((fix) => roundOf(fix) === 3)));
    assert.deepEqual(round3.map((f) => `${f.page} ${f.type} ${f.path.join(".")}`), ["kurumsal hero subline", "numune hero subline"]);
    const [kurumsal, numune] = round3;
    const beforeRound3 = undoLocalizedFixes(hero.subline, kurumsal.fixes, 3);
    assert.ok(beforeRound3.tr.startsWith("Oteller, spa merkezleri, ofisler ve restoranlar için toptan sıvı sabun ve duş jeli. Pompalı şişeden 5 L ve 20 L bidona,"));
    assert.ok(beforeRound3.en.startsWith("Bulk liquid soap and shower gel for hotels, spas, offices and restaurants."));
    assert.ok(beforeRound3.ar.startsWith("صابون سائل لليدين وجل استحمام بالجملة للفنادق"));
    assert.deepEqual(earlierVersions(hero.subline, [{ path: [], fixes: kurumsal.fixes }])[0], beforeRound3, "newest earlier version first");
    assert.equal(earlierVersions(hero.subline, [{ path: [], fixes: kurumsal.fixes }]).length, 2, "rounds 2 and 3");
    const samplesBefore = undoLocalizedFixes(samples.subline, numune.fixes, 3);
    assert.ok(samplesBefore.en.includes("to your business, and experience the scent"));
    assert.deepEqual([samplesBefore.tr, samplesBefore.ar], [samples.subline.tr, samples.subline.ar], "round 3 touches only the English sentence");
  });
});
