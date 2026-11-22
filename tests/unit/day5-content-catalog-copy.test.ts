// Day 5 CONTENT-CATALOG: the catalog and site copy written for search visibility (docs/DAY5-SEO.md §1, §2,
// §5.5), checked as data: compliance (no medical claims, superlatives, prices, pump volume or delivery
// promises), the eye-contact caution for hand soaps, title / description lengths and uniqueness, category
// body length and structure, complete and well-formed translations (Arabic punctuation, Western digits),
// sanitizer-clean HTML with valid internal links, sections that the panel can open and save, menus, and the
// product photo alt texts (incl. the recorded day-1 values the content script compares against).
//   npx tsx --test tests/unit/day5-content-catalog-copy.test.ts
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { sectionMeta, type SectionType } from "@/components/sections/schemas";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import type { LocalizedText } from "@/db/schema/common";
import { normalizeSectionContent } from "@/lib/panel/content/sections";
import { MENU_DEFS } from "@/lib/panel/content/menus";
import { isSafeHref } from "@/lib/safe-href";
import { seoSettings } from "@/lib/settings/types";
import { CATEGORY_COPY, PRODUCT_DETAILS, PRODUCT_SEO, type ProductCopySlug } from "../../scripts/seed-data/catalog-copy";
import { CATALOG_SEO_PREVIOUS, stemOf } from "../../scripts/seed-data/catalog-seo";
import { HOME_FAQ_SECTION, homePageMeta, homeSections } from "../../scripts/seed-data/home-page";
import { readImageList, SOURCE_ROOT } from "../../scripts/seed-data/image-list";
import { altFor, legacyAltFor, MEDIA_ALT } from "../../scripts/seed-data/media-alt";
import { DAY1_MEDIA_ALT } from "../../scripts/seed-data/media-alt-day1";
import { BUNDLE, SCENTS } from "../../scripts/seed-data/products";
import { CATEGORIES, MENUS, SEO_SETTINGS_TEXT } from "../../scripts/seed-data/site";
import { SITE_PAGES } from "../../scripts/seed-data/site-pages";

const LOCALES = ["tr", "en", "ar"] as const;
type Seo = { title: LocalizedText; description: LocalizedText };

const NEW_PAGES = ["urunler", "hakkimizda"] as const;
const page = (slug: string) => {
  const found = SITE_PAGES.find((p) => p.slug === slug);
  assert.ok(found, `seed page ${slug}`);
  return found;
};

/** Seed references ("@media:…", "@product:…") become ids, like scripts/seed.ts does. */
function withIds(value: unknown): unknown {
  if (typeof value === "string") return /^@(media|product):/.test(value) ? 1 : value;
  if (Array.isArray(value)) return value.map(withIds);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withIds(v)]));
  return value;
}

/** Every localized text ({ tr, … }) in a tree. */
function texts(value: unknown, out: LocalizedText[] = []): LocalizedText[] {
  if (Array.isArray(value)) value.forEach((v) => texts(v, out));
  else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.tr === "string") out.push(obj as LocalizedText);
    else Object.values(obj).forEach((v) => texts(v, out));
  }
  return out;
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const words = (html: string) => plain(html).split(" ").filter(Boolean).length;
const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).sort();
const count = (html: string, tag: string) => (html.match(new RegExp(`<${tag}>`, "g")) ?? []).length;
const len = (s: string | undefined) => [...(s ?? "")].length;

/** Everything day 5 writes, per area (the texts the client will see). */
const productSeo: Seo[] = Object.values(PRODUCT_SEO);
const categorySeo: Seo[] = Object.values(CATEGORY_COPY).map((c) => c.seo);
const pageSeo: Seo[] = SITE_PAGES.map((p) => p.seo as Seo);
const ALL_SEO: Seo[] = [...productSeo, ...categorySeo, ...pageSeo, homePageMeta.seo];
const ALL_COPY: LocalizedText[] = [
  ...texts(ALL_SEO),
  SEO_SETTINGS_TEXT.description,
  ...texts(PRODUCT_DETAILS),
  ...texts(CATEGORY_COPY),
  ...texts(HOME_FAQ_SECTION.content),
  ...texts(NEW_PAGES.map((slug) => page(slug).sections)),
  ...texts(MENUS),
  ...Object.values(MEDIA_ALT),
];

/** Internal paths the copy may link to (canonical Turkish paths without a locale). */
const PRODUCT_SLUGS = [...SCENTS.map((s) => s.slug), BUNDLE.slug];
const VALID_LINK = new RegExp(
  `^/(urunler|kurumsal|numune|iletisim|blog|sayfa/hakkimizda|urunler/(${PRODUCT_SLUGS.join("|")})|kategori/(el-sabunu|dus-jeli|hediye-setleri))(#[a-z-]+)?$`,
);

describe("copy compliance (§2)", () => {
  const RULES: [string, RegExp][] = [
    ["medical / biocidal claims", /antibakter|antibacter|mikrop|germ|bakteri|bacteri|dezenfekt|disinfect|steril|hastal[ıi]k|disease|illness|enfeksiyon|infection|vir[üu]s|tedavi|\btreat|heals?\b|iyile[şs]|جراثيم|بكتيري|مطهّ?ر|معقّ?م|مرض/i],
    ["percent / pH claims", /%\s?\d|\d\s?%|99[.,]9|\bph\b/i],
    ["unprovable label claims", /dermatolog|hipoalerjen|hypoallergen|organi[kc]|vegan|paraben|%100 doğal|100% natural|doğal (içerik|formül|ürün)|natural (ingredient|formula|product)/i],
    ["superlatives", /\ben (iyi|ucuz|kaliteli|avantajlı|ekonomik|güvenilir)\b|bir numara|1 numara|numara 1|\bbest\b|cheapest|number one|#1|الأفضل|الأرخص|رقم 1/i],
    ["prices", /₺|\bTL\b|\bTRY\b|\b[Ll]ira\b|ليرة|\d+[.,]\d{2}\s?(TL|₺)/],
    ["pump bottle volume", /\d+\s?ml\b|mililitre|millilit|\d+\s?مل\b/i],
    ["delivery or time promises", /\d+\s?(gün|saat|iş günü|days?|hours?|أيام|يوم|ساعة)/i],
    ["invented facts", /yıl(lık|dır) tecrübe|since \d{4}|years of experience|ISO|sertifika|certified|müşteri(miz)? sayısı|customers? served|\d+\s?\+?\s?(müşteri|customers?)/i],
  ];
  for (const [label, rule] of RULES) {
    test(`no ${label} in any locale`, () => {
      for (const text of ALL_COPY) for (const locale of LOCALES) assert.doesNotMatch(plain(text[locale] ?? ""), rule, `${label}: ${text[locale]}`);
    });
  }

  test("hand soaps carry the eye-contact caution in their usage section (tr/en/ar)", () => {
    for (const scent of SCENTS.filter((s) => s.category === "el-sabunu")) {
      assert.ok(scent.description.tr.includes("Göz ile temasından kaçının; temas hâlinde bol suyla durulayın."), scent.slug);
      assert.ok(scent.description.en!.includes("Avoid contact with the eyes; in case of contact, rinse with plenty of water."), scent.slug);
      assert.ok(scent.description.ar!.includes("تجنّب ملامسة العينين"), scent.slug);
    }
    const usageFaq = CATEGORY_COPY["el-sabunu"].faq[0].answer;
    assert.ok(usageFaq.tr.includes("Göz ile temasından kaçının; temas hâlinde bol suyla durulayın."));
  });

  test("samples are always free and not for sale where the copy mentions them", () => {
    const answer = (HOME_FAQ_SECTION.content.items as { answer: LocalizedText }[])[2].answer;
    assert.match(answer.tr, /ücretsizdir ve satılmaz/);
    assert.match(answer.en!, /free and not for sale/);
    assert.match(answer.ar!, /مجانية وليست للبيع/);
  });

  test("Arabic uses Arabic punctuation and Western digits; tr/en never use Arabic punctuation", () => {
    for (const text of ALL_COPY) {
      const ar = plain(text.ar ?? "");
      assert.doesNotMatch(ar, /[,;?]/, `ASCII punctuation in Arabic: ${ar}`);
      assert.doesNotMatch(ar, /[٠-٩۰-۹]/, `Eastern Arabic digits: ${ar}`);
      for (const locale of ["tr", "en"] as const) assert.doesNotMatch(text[locale] ?? "", /[،؛؟]/, `Arabic punctuation in ${locale}: ${text[locale]}`);
    }
  });

  test("every text is complete in tr, en and ar", () => {
    for (const text of ALL_COPY) for (const locale of LOCALES) assert.ok((text[locale] ?? "").trim().length > 0, `${JSON.stringify(text).slice(0, 80)} lacks ${locale}`);
  });
});

describe("titles and meta descriptions (§1)", () => {
  test("titles are at most 60 characters in tr and en (the home title is printed without the suffix)", () => {
    for (const seo of ALL_SEO) for (const locale of ["tr", "en"] as const) assert.ok(len(seo.title[locale]) <= 60, `${len(seo.title[locale])}: ${seo.title[locale]}`);
    for (const seo of ALL_SEO) assert.ok(len(seo.title.ar) <= 65, `ar ${len(seo.title.ar)}: ${seo.title.ar}`);
  });

  test("descriptions are 120–155 characters in tr and en (Arabic is denser: 100–155)", () => {
    for (const desc of [...ALL_SEO.map((s) => s.description), SEO_SETTINGS_TEXT.description]) {
      for (const locale of ["tr", "en"] as const) {
        const n = len(desc[locale]);
        assert.ok(n >= 120 && n <= 155, `${locale} ${n}: ${desc[locale]}`);
      }
      const n = len(desc.ar);
      assert.ok(n >= 100 && n <= 155, `ar ${n}: ${desc.ar}`);
    }
  });

  test("every title and description is unique per locale", () => {
    for (const locale of LOCALES) {
      const all = [...ALL_SEO.flatMap((s) => [s.title[locale], s.description[locale]]), SEO_SETTINGS_TEXT.description[locale]];
      assert.equal(new Set(all).size, all.length, `duplicates in ${locale}`);
    }
  });

  test("fits the panel limits (product / category title 70, description 170; page title 120, description 320)", () => {
    for (const seo of [...productSeo, ...categorySeo]) for (const locale of LOCALES) assert.ok(len(seo.title[locale]) <= 70 && len(seo.description[locale]) <= 170);
    for (const seo of pageSeo) for (const locale of LOCALES) assert.ok(len(seo.title[locale]) <= 120 && len(seo.description[locale]) <= 320);
  });

  test("the keyword map: one primary target per page, in the title", () => {
    assert.match(homePageMeta.seo.title.tr, /^Sıvı El Sabunu ve Duş Jeli/);
    assert.match(page("urunler").seo.title!.tr, /^Temizlik Ürünleri/);
    assert.match(CATEGORY_COPY["el-sabunu"].seo.title.tr, /^Sıvı El Sabunu/);
    assert.match(CATEGORY_COPY["dus-jeli"].seo.title.tr, /^Duş Jeli/);
    assert.match(CATEGORY_COPY["hediye-setleri"].seo.title.tr, /^Sabun Hediye Seti/);
    assert.match(page("kurumsal").seo.title!.tr, /^Toptan Sıvı Sabun/);
    assert.match(page("numune").seo.title!.tr, /^Ücretsiz Sıvı Sabun Numunesi/);
    assert.match(page("hakkimizda").seo.title!.tr, /Kayseri/);
    for (const scent of SCENTS) assert.ok(scent.seo.title.tr.startsWith(`${scent.name.tr} ${scent.subtitle.tr}`), scent.seo.title.tr);
    // The site description names "temizlik", the title names both product types.
    assert.match(SEO_SETTINGS_TEXT.description.tr, /temizlik/);
    assert.match(SEO_SETTINGS_TEXT.defaultTitle.tr, /Sıvı El Sabunu ve Duş Jeli/);
  });

  test("the site settings with the new texts still validate", () => {
    assert.ok(seoSettings.safeParse({ titleTemplate: "%s | PRESTİJ", ...SEO_SETTINGS_TEXT, ogImageId: 49 }).success);
  });
});

describe("HTML copy: category bodies and product sections", () => {
  const bodies = Object.entries(CATEGORY_COPY).map(([slug, c]) => [slug, c.body] as const);
  const details = Object.entries(PRODUCT_DETAILS) as [ProductCopySlug, LocalizedText][];

  test("category bodies: 300–600 Turkish words with h2 subheadings and links to products, /kurumsal and /numune", () => {
    for (const [slug, body] of bodies) {
      const n = words(body.tr);
      assert.ok(n >= 300 && n <= 600, `${slug}: ${n} words`);
      assert.ok(count(body.tr, "h2") >= 4, `${slug}: h2 subheadings`);
      const links = hrefsOf(body.tr);
      assert.ok(links.includes("/kurumsal") && links.includes("/numune"), `${slug}: /kurumsal and /numune`);
      assert.ok(links.some((h) => h.startsWith("/urunler/")), `${slug}: a product link`);
      for (const locale of ["en", "ar"] as const) assert.ok(words(body[locale]!) >= 250, `${slug} ${locale}: ${words(body[locale]!)} words`);
    }
  });

  test("translations keep the structure: same links and the same number of h2/ul/li/p as Turkish", () => {
    for (const [slug, html] of [...bodies, ...details]) {
      for (const locale of ["en", "ar"] as const) {
        assert.deepEqual(hrefsOf(html[locale]!), hrefsOf(html.tr), `${slug} ${locale}: links`);
        for (const tag of ["h2", "ul", "li", "p", "strong"]) assert.equal(count(html[locale]!, tag), count(html.tr, tag), `${slug} ${locale}: <${tag}>`);
      }
    }
  });

  test("the HTML is already sanitizer-clean (nothing is dropped on save or render) and links are valid internal paths", () => {
    for (const [slug, html] of [...bodies, ...details]) {
      for (const locale of LOCALES) {
        assert.equal(sanitizeHtml(html[locale]), html[locale], `${slug} ${locale}`);
        for (const href of hrefsOf(html[locale]!)) assert.match(href, VALID_LINK, `${slug} ${locale}: ${href}`);
      }
    }
  });

  test("category FAQs: 4–6 plain-text items, questions within the panel limit", () => {
    for (const [slug, copy] of Object.entries(CATEGORY_COPY)) {
      assert.ok(copy.faq.length >= 4 && copy.faq.length <= 6, slug);
      for (const item of copy.faq) {
        for (const locale of LOCALES) {
          assert.ok(len(item.question[locale]) <= 160, item.question[locale]);
          assert.doesNotMatch(item.answer[locale] ?? "", /</, "answers are plain text");
        }
      }
    }
  });

  test("product descriptions: the day-1 story first, then the day-5 sections (no pump volume)", () => {
    for (const product of [...SCENTS, BUNDLE]) {
      for (const locale of LOCALES) {
        const html = product.description[locale]!;
        assert.ok(html.startsWith(product.story[locale]!), `${product.slug} ${locale}: story first`);
        assert.ok(html.length > product.story[locale]!.length);
      }
      assert.ok(product.description.tr.includes(product.slug === BUNDLE.slug ? "<h2>Sette neler var?</h2>" : "<h2>Ürün özellikleri</h2>"));
      assert.ok(product.description.tr.includes("<h2>Günlük kullanım</h2>"), "usage section (not the accordion's “Kullanım” title)");
      assert.deepEqual(product.seo, PRODUCT_SEO[product.slug as ProductCopySlug]);
    }
    for (const scent of SCENTS) assert.ok(scent.description.tr.includes("<h2>Bidonlar ve yeniden doldurma</h2>"), scent.slug);
  });

  test("the bundle section lists and links all four products", () => {
    const links = hrefsOf(PRODUCT_DETAILS["dort-koku-koleksiyonu"].tr);
    for (const scent of SCENTS) assert.ok(links.includes(`/urunler/${scent.slug}`), scent.slug);
  });
});

describe("pages and sections", () => {
  const sections: { where: string; type: SectionType; content: Record<string, unknown> }[] = [
    { where: "home faq", type: HOME_FAQ_SECTION.type, content: HOME_FAQ_SECTION.content },
    ...NEW_PAGES.flatMap((slug) => page(slug).sections.map((s, i) => ({ where: `${slug} #${i}`, type: s.type, content: s.content }))),
  ];

  test("every new section parses with its schema and passes the panel's save rules", () => {
    for (const s of sections) {
      const content = withIds(s.content);
      const parsed = sectionMeta[s.type].schema.safeParse(content);
      assert.ok(parsed.success, `${s.where}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
      const panel = normalizeSectionContent(s.type, content);
      assert.ok(panel.ok, `${s.where}: ${panel.ok ? "" : JSON.stringify(panel.issues)}`);
    }
  });

  test("rich-text sections are sanitizer-clean with valid links", () => {
    for (const s of sections.filter((x) => x.type === "rich_text")) {
      const html = s.content.html as LocalizedText;
      for (const locale of LOCALES) {
        assert.equal(sanitizeHtml(html[locale]), html[locale], s.where);
        for (const href of hrefsOf(html[locale]!)) assert.match(href, VALID_LINK, `${s.where}: ${href}`);
      }
      assert.deepEqual(hrefsOf(html.en!), hrefsOf(html.tr));
      assert.deepEqual(hrefsOf(html.ar!), hrefsOf(html.tr));
    }
  });

  test("home: 4–6 FAQ items near the end (after the story, before the newsletter)", () => {
    const items = HOME_FAQ_SECTION.content.items as unknown[];
    assert.ok(items.length >= 4 && items.length <= 6);
    const types = homeSections.map((s) => s.type);
    assert.equal(types.indexOf("faq"), types.indexOf("story") + 1);
    assert.equal(types.indexOf("newsletter"), types.indexOf("faq") + 1);
    homeSections.forEach((s, i) => assert.equal(s.position, i));
  });

  test("/urunler: title “Tüm Ürünler”, a guide linking the three categories, then an FAQ", () => {
    const products = page("urunler");
    assert.equal(products.title.tr, "Tüm Ürünler");
    assert.deepEqual(products.sections.map((s) => s.type), ["rich_text", "faq"]);
    const links = hrefsOf((products.sections[0].content.html as LocalizedText).tr);
    for (const slug of ["el-sabunu", "dus-jeli", "hediye-setleri"]) assert.ok(links.includes(`/kategori/${slug}`), slug);
  });

  test("/sayfa/hakkimizda: published custom page without a hero (the route prints the h1), contact data from settings", () => {
    const about = page("hakkimizda");
    assert.equal(about.kind, "custom");
    assert.ok(!about.sections.some((s) => s.type === "hero"), "only one h1");
    assert.ok(about.sections.some((s) => s.type === "contact_info"));
    const text = JSON.stringify(about);
    assert.doesNotMatch(text, /353\s?30\s?70|Cırgalan/);
    assert.match(text, /Kayseri/);
  });
});

describe("categories and menus", () => {
  test("the seed categories carry the day-5 names, SEO, body and FAQ", () => {
    for (const [slug, copy] of Object.entries(CATEGORY_COPY)) {
      const category = CATEGORIES.find((c) => c.slug === slug);
      assert.ok(category);
      assert.deepEqual({ name: category.name, seo: category.seo, body: category.body, faq: category.faq }, copy);
    }
    assert.equal(CATEGORY_COPY["el-sabunu"].name.tr, "Sıvı El Sabunu");
    assert.equal(CATEGORY_COPY["dus-jeli"].name.tr, "Duş Jeli");
    assert.equal(CATEGORY_COPY["hediye-setleri"].name.tr, "Hediye Setleri");
  });

  test("footer: keyword links to Sıvı El Sabunu, Duş Jeli, Toptan Sıvı Sabun, Ücretsiz Numune, Blog and Hakkımızda", () => {
    const footer = [...MENUS.footer_shop, ...MENUS.footer_corporate];
    const find = (labelTr: string) => footer.find((i) => i.label.tr === labelTr);
    assert.equal(find("Sıvı El Sabunu")?.href, "/kategori/el-sabunu");
    assert.equal(find("Duş Jeli")?.href, "/kategori/dus-jeli");
    assert.match(find("Toptan Sıvı Sabun")?.href ?? "", /^\/kurumsal/);
    assert.match(find("Ücretsiz Numune")?.href ?? "", /^\/numune/);
    assert.equal(find("Blog")?.href, "/blog");
    assert.equal(find("Hakkımızda")?.href, "/sayfa/hakkimizda");
    // Tidy: no target linked twice in a column; the same items in every locale.
    for (const key of ["header", "footer_shop", "footer_corporate"] as const) {
      const hrefs = MENUS[key].map((i) => i.href);
      assert.equal(new Set(hrefs).size, hrefs.length, key);
      assert.ok(MENUS[key].length <= MENU_DEFS.find((d) => d.key === key)!.maxItems, key);
      for (const i of MENUS[key].flatMap((x) => [x, ...(x.children ?? [])])) {
        assert.ok(isSafeHref(i.href), i.href);
        for (const locale of LOCALES) assert.ok(i.label[locale]?.trim(), `${i.href} ${locale}`);
      }
    }
  });

  test("the step's previous menus differ from the new ones only by the planned changes", () => {
    const [day4] = CATALOG_SEO_PREVIOUS.menus.footer_corporate;
    assert.deepEqual(
      day4.map((i) => i.href).sort(),
      MENUS.footer_corporate.map((i) => i.href).filter((h) => h !== "/sayfa/hakkimizda" && h !== "/blog").sort(),
    );
    assert.equal(CATALOG_SEO_PREVIOUS.menus.footer_shop[0][1].label.tr, "El Sabunu");
    assert.equal(CATALOG_SEO_PREVIOUS.menus.header[0][0].children?.[0].label.tr, "El Sabunu");
  });

  test("the previous product SEO is the seed's “<name> <subtitle>” + short description", () => {
    const seo = CATALOG_SEO_PREVIOUS.productSeo(SCENTS[0]);
    assert.deepEqual(seo.title, { tr: "Lavanta Latte Sıvı El Sabunu", en: "Lavender Latte Liquid Hand Soap", ar: "صابون سائل لليدين لاتيه اللافندر" });
    assert.deepEqual(seo.description, SCENTS[0].shortDescription);
  });
});

describe("product photo alt texts", () => {
  test("49 written descriptions, complete, within the panel limit and unique per locale", () => {
    const entries = Object.entries(MEDIA_ALT);
    assert.equal(entries.length, 49);
    for (const locale of LOCALES) {
      const values = entries.map(([, alt]) => alt[locale] ?? "");
      assert.equal(new Set(values).size, values.length, `unique ${locale}`);
      for (const v of values) assert.ok(v.length > 20 && v.length <= 250, v);
    }
  });

  test("each alt names the product type where true (sıvı el sabunu / duş jeli)", () => {
    for (const [stem, alt] of Object.entries(MEDIA_ALT)) {
      if (stem.includes("Okyanus")) {
        assert.match(alt.tr, /duş jeli/, stem);
        assert.match(alt.en!, /shower gel/, stem);
      } else {
        assert.match(alt.tr, /sıvı el sabunu/, stem);
        assert.match(alt.en!, /liquid hand soap/, stem);
      }
      assert.match(alt.tr, stem.includes("_5L_") ? /5 L/ : stem.includes("_20L_") ? /20 L/ : /pompalı şişe|şişeden/, stem);
    }
  });

  test("the recorded day-1 alts cover the same 49 images", () => {
    assert.deepEqual(Object.keys(DAY1_MEDIA_ALT).sort(), Object.keys(MEDIA_ALT).sort());
    for (const [stem, alt] of Object.entries(DAY1_MEDIA_ALT)) assert.notDeepEqual(alt, MEDIA_ALT[stem], stem);
  });

  test("storage keys map to stems the way the seed names files", () => {
    assert.equal(stemOf("urunler/okyanus/PRESTIJ_Okyanus_5L_spa_dus-1024.webp"), "PRESTIJ_Okyanus_5L_spa_dus");
    assert.equal(stemOf("urunler/collection/PRESTIJ_Koleksiyon_5L_yatay_koleksiyon-1536.webp"), "PRESTIJ_Koleksiyon_5L_yatay_koleksiyon");
    assert.equal(stemOf("marka/prestij-logo-original.png"), null);
  });

  const csv = path.join(SOURCE_ROOT, "Gorsel_Listesi.csv");
  test("against the client's image list: every image has an alt, altFor uses it, and day 1 equals legacyAltFor", { skip: !existsSync(csv) && "image list not available" }, async () => {
    const rows = await readImageList();
    assert.equal(rows.length, 49);
    for (const row of rows) {
      assert.ok(MEDIA_ALT[row.stem], `alt for ${row.stem}`);
      assert.deepEqual(altFor(row), MEDIA_ALT[row.stem]);
      assert.deepEqual(DAY1_MEDIA_ALT[row.stem], legacyAltFor(row), `recorded day-1 alt of ${row.stem}`);
    }
  });
});
