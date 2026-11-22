// Day 5 SEO-PANEL: seoPageInputs (src/lib/panel/seo/pages.ts) builds one row per storefront URL and
// language the way the storefront's generateMetadata / H1 logic does: titles with seoText()/localize()
// fallbacks and the title template, the home page's absolute title, translation gaps, H1 counts from
// hero sections, body words, alt texts, GTINs, share images and which pages exist.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { seoPageInputs, type SeoSource, type SeoSourceMessages } from "@/lib/panel/seo/pages";
import { buildSeoReport, type SeoPageInput } from "@/lib/panel/seo/rules";

const MESSAGES: SeoSourceMessages = {
  navProducts: "Ürünler",
  businessTitle: "Kurumsal",
  sampleTitle: "Numune",
  sampleIntro: "Ücretsiz numune isteyin.",
  contactTitle: "İletişim",
  contactIntro: "Bize ulaşın.",
};
const words = (n: number, word = "kelime") => `<p>${Array.from({ length: n }, () => word).join(" ")}</p>`;
const hero = (headline: string, eyebrow?: string, mediaIds: number[] = []) => ({
  type: "hero",
  content: { headline: { tr: headline, en: `${headline} EN` }, ...(eyebrow ? { eyebrow: { tr: eyebrow } } : {}) },
  mediaIds,
});

function source(overrides: Partial<SeoSource> = {}): SeoSource {
  return {
    locales: ["tr", "en", "ar"],
    site: {
      siteName: "PRESTİJ",
      titleTemplate: "%s | PRESTİJ",
      defaultTitle: { tr: "PRESTİJ — Sıvı El Sabunu ve Duş Jeli", en: "PRESTİJ — Liquid Hand Soap & Shower Gel" },
      description: { tr: "Varsayılan açıklama", en: "Default description" },
      defaultShareImage: true,
    },
    messages: { tr: MESSAGES, en: { ...MESSAGES, navProducts: "Products" }, ar: { ...MESSAGES, navProducts: "المنتجات" } },
    mediaAlt: {
      1: { tr: "Lavanta şişe", en: "Lavender bottle", ar: "زجاجة" },
      2: { tr: "Bidon" },
      3: null,
    },
    home: null,
    productsPage: null,
    pages: [],
    categories: [],
    products: [],
    posts: [],
    ...overrides,
  };
}

const pick = (rows: SeoPageInput[], key: string, locale = "tr") => {
  const found = rows.find((r) => r.key === key && r.locale === locale);
  assert.ok(found, `${key} ${locale}`);
  return found;
};

describe("home and products index", () => {
  test("without a home page row: the layout's default title (absolute), the site description, no H1", () => {
    const rows = seoPageInputs(source());
    const tr = pick(rows, "home");
    assert.equal(tr.path, "/tr");
    assert.equal(tr.title, "PRESTİJ — Sıvı El Sabunu ve Duş Jeli");
    assert.equal(tr.fullTitle, tr.title, "home title is absolute (no template)");
    assert.equal(tr.description, "Varsayılan açıklama");
    assert.equal(tr.h1Count, 0);
    assert.equal(tr.editHref, "/panel/sayfalar");
    assert.equal(tr.shareImage, "default");
    // ar: no Arabic default title/description → Turkish shown.
    assert.deepEqual(pick(rows, "home", "ar").untranslated, ["başlık", "açıklama"]);
    assert.deepEqual(pick(rows, "home", "en").untranslated, []);
  });

  test("home page row: own-language SEO title only (no Turkish fallback), first hero's eyebrow + headline as H1", () => {
    const rows = seoPageInputs(
      source({
        home: {
          id: 1,
          slug: "home",
          kind: "home",
          title: { tr: "Ana Sayfa" },
          seo: { title: { tr: "Sıvı el sabunu ve duş jeli | PRESTİJ Kayseri" }, description: { tr: "Ana sayfa açıklaması" }, ogImageId: 3 },
          sections: [hero("Her dokunuşta prestij.", "Sıvı El Sabunu", [1, 2]), { type: "story", content: { nope: true }, mediaIds: [3] }],
        },
      }),
    );
    const tr = pick(rows, "home");
    assert.equal(tr.title, "Sıvı el sabunu ve duş jeli | PRESTİJ Kayseri");
    assert.equal(tr.h1, "Sıvı El Sabunu Her dokunuşta prestij.");
    assert.equal(tr.h1Count, 1);
    assert.equal(tr.editHref, "/panel/sayfalar/1");
    assert.equal(tr.shareImage, "own");
    // Images of renderable sections only (the invalid story section does not render).
    assert.equal(tr.imagesWithoutAlt, 0);
    assert.equal(pick(rows, "home", "en").imagesWithoutAlt, 1, "media 2 has no English alt");
    const en = pick(rows, "home", "en");
    assert.equal(en.title, "PRESTİJ — Liquid Hand Soap & Shower Gel", "English page falls back to the layout default, not the Turkish SEO title");
    assert.equal(en.description, "Default description");
    // The eyebrow has no English text: localize() shows the Turkish one inside the English H1.
    assert.equal(en.h1, "Sıvı El Sabunu Her dokunuşta prestij. EN");
    assert.deepEqual(en.untranslated, ["ana başlık (H1)"]);
  });

  test("/urunler without its page row: UI text title, no description; with it: seoText fallbacks (own SEO title, then page title)", () => {
    let rows = seoPageInputs(source());
    let tr = pick(rows, "products");
    assert.equal(tr.title, "Ürünler");
    assert.equal(tr.fullTitle, "Ürünler | PRESTİJ");
    assert.equal(tr.description, "");
    assert.equal(tr.h1, "Ürünler");
    assert.equal(tr.h1Count, 1);
    assert.equal(pick(rows, "products", "en").path, "/en/products");
    assert.equal(pick(rows, "products", "en").title, "Products");

    rows = seoPageInputs(
      source({
        productsPage: {
          id: 7,
          slug: "urunler",
          kind: "custom",
          title: { tr: "Tüm Ürünler", en: "All Products" },
          seo: { title: { tr: "Temizlik ürünleri: sıvı sabun ve duş jeli" }, description: { tr: "Açıklama" } },
          sections: [hero("Kapak")],
        },
      }),
    );
    tr = pick(rows, "products");
    assert.equal(tr.title, "Temizlik ürünleri: sıvı sabun ve duş jeli");
    assert.equal(tr.h1, "Tüm Ürünler");
    assert.equal(tr.h1Count, 2, "a hero below the grid adds a second H1");
    assert.equal(tr.editHref, "/panel/sayfalar/7");
    const en = pick(rows, "products", "en");
    assert.equal(en.title, "All Products", "seoText: no English SEO title → page.title.en, not the Turkish SEO title");
    assert.equal(en.h1, "All Products");
    assert.deepEqual(en.untranslated, ["açıklama"]);
    assert.equal(tr.noIndex, false);
    assert.equal(tr.shareImage, "default");
  });

  test("/urunler honours its page row's noindex switch and share image (day 5 FIX, like the route)", () => {
    const rows = seoPageInputs(
      source({
        productsPage: { id: 7, slug: "urunler", kind: "landing", title: { tr: "Tüm Ürünler" }, seo: { noIndex: true, ogImageId: 1 }, sections: [] },
      }),
    );
    const tr = pick(rows, "products");
    assert.equal(tr.noIndex, true);
    assert.equal(tr.shareImage, "own");
    const report = buildSeoReport(rows);
    const row = report.rows.find((r) => r.key === "products" && r.locale === "tr")!;
    assert.ok(row.findings.some((f) => f.code === "noindex" && f.severity === "warning"));
  });
});

describe("categories, products, posts", () => {
  test("category: seoText fallbacks, body words in the visitor's language, Turkish body fallback flagged", () => {
    const rows = seoPageInputs(
      source({
        categories: [
          {
            id: 4,
            slug: "el-sabunu",
            name: { tr: "Sıvı El Sabunu", en: "Liquid Hand Soap" },
            description: { tr: "Kısa açıklama" },
            body: { tr: words(160), en: words(20, "word") },
            imageId: 1,
            seo: { title: { tr: "Sıvı El Sabunu – pompalı şişe, 5 L ve 20 L bidon" } },
          },
        ],
      }),
    );
    const tr = pick(rows, "category:4");
    assert.equal(tr.path, "/tr/kategori/el-sabunu");
    assert.equal(tr.fullTitle, "Sıvı El Sabunu – pompalı şişe, 5 L ve 20 L bidon | PRESTİJ");
    assert.equal(tr.description, "Kısa açıklama");
    assert.equal(tr.h1, "Sıvı El Sabunu");
    assert.deepEqual(tr.body, { words: 160, min: 150, noun: "Kategori metni", shownInTurkish: false });
    assert.equal(tr.shareImage, "own");
    assert.equal(tr.editHref, "/panel/kategoriler/4");

    const en = pick(rows, "category:4", "en");
    assert.equal(en.title, "Liquid Hand Soap", "seoText: own SEO title missing → localized name before the Turkish SEO title");
    assert.equal(en.body?.words, 20);
    assert.equal(en.body?.shownInTurkish, false);
    assert.deepEqual(en.untranslated, ["açıklama"]);

    const ar = pick(rows, "category:4", "ar");
    assert.equal(ar.title, "Sıvı El Sabunu", "no Arabic name either → the Turkish name");
    assert.equal(ar.body?.words, 160);
    assert.equal(ar.body?.shownInTurkish, true);
    assert.deepEqual(ar.untranslated, ["başlık", "açıklama", "kategori adı", "kategori metni"]);
    const report = buildSeoReport(rows);
    const arRow = report.rows.find((r) => r.key === "category:4" && r.locale === "ar")!;
    assert.ok(!arRow.findings.some((f) => f.code === "body_short" || f.code === "body_missing"), "the fallback is reported as a translation gap only");
  });

  test("product: name + type H1, also the title fallback; GTIN check per active variant, first image as share image", () => {
    const rows = seoPageInputs(
      source({
        products: [
          {
            id: 9,
            slug: "lavanta",
            name: { tr: "Lavanta", en: "Lavender" },
            subtitle: { tr: "Sıvı El Sabunu", en: "Liquid Hand Soap" },
            shortDescription: { tr: "Kısa" },
            description: { tr: words(90) },
            seo: null,
            mediaIds: [2, 1],
            variants: [
              { sku: "PR-LAV-500", barcode: null },
              { sku: "PR-LAV-5L", barcode: "8685317540009" },
              { sku: "PR-LAV-20L", barcode: "8685317540031" },
              { sku: "PR-LAV-X", barcode: "  " },
            ],
          },
        ],
      }),
    );
    const tr = pick(rows, "product:9");
    assert.equal(tr.label, "Lavanta · Sıvı El Sabunu");
    assert.equal(tr.title, "Lavanta Sıvı El Sabunu");
    assert.equal(tr.h1, "Lavanta Sıvı El Sabunu");
    assert.deepEqual(tr.variantsWithoutGtin, ["PR-LAV-500", "PR-LAV-20L", "PR-LAV-X"], "8685317540031 has a wrong check digit");
    assert.equal(tr.body?.words, 90);
    assert.equal(tr.shareImage, "own");
    assert.equal(tr.editHref, "/panel/urunler/9");
    assert.equal(tr.imagesWithoutAlt, 0);
    assert.equal(pick(rows, "product:9", "en").title, "Lavender Liquid Hand Soap");
    assert.equal(pick(rows, "product:9", "en").imagesWithoutAlt, 1);
    assert.equal(pick(rows, "product:9", "ar").imagesWithoutAlt, 1);
    assert.equal(pick(rows, "product:9", "en").path, "/en/products/lavanta");
  });

  test("product: a business-only product is noindex (as the product page), with a note instead of a warning", () => {
    const rows = seoPageInputs(
      source({
        products: [
          { id: 5, slug: "otel", name: { tr: "Otel" }, subtitle: null, shortDescription: null, description: null, seo: null, mediaIds: [], variants: [], businessOnly: true },
        ],
      }),
    );
    const tr = pick(rows, "product:5");
    assert.equal(tr.noIndex, true);
    assert.equal(tr.noIndexReason, "business_only");
    const finding = buildSeoReport(rows).rows.find((r) => r.key === "product:5" && r.locale === "tr")!.findings.find((f) => f.code === "noindex");
    assert.equal(finding?.severity, "info");
    assert.match(finding?.message ?? "", /Yalnızca kurumsal/);
  });

  test("product: a name that already contains the type does not repeat it (as productHeading)", () => {
    const rows = seoPageInputs(
      source({
        products: [
          {
            id: 4,
            slug: "x",
            name: { tr: "Lavanta Sıvı El Sabunu" },
            subtitle: { tr: "sıvı el sabunu" },
            shortDescription: null,
            description: null,
            seo: null,
            mediaIds: [],
            variants: [],
          },
        ],
      }),
    );
    assert.equal(pick(rows, "product:4").h1, "Lavanta Sıvı El Sabunu");
    assert.equal(pick(rows, "product:4").title, "Lavanta Sıvı El Sabunu");
  });

  test("post: excerpt as description fallback, 400-word rule, cover as share image", () => {
    const rows = seoPageInputs(
      source({
        posts: [{ id: 3, slug: "sivi-el-sabunu-nasil-secilir", title: { tr: "Sıvı el sabunu nasıl seçilir?" }, excerpt: { tr: "Özet" }, body: { tr: words(10) }, coverId: null, seo: { noIndex: true } }],
      }),
    );
    const tr = pick(rows, "post:3");
    assert.equal(tr.path, "/tr/blog/sivi-el-sabunu-nasil-secilir");
    assert.equal(tr.description, "Özet");
    assert.equal(tr.body?.min, 400);
    assert.equal(tr.noIndex, true);
    assert.equal(tr.shareImage, "default");
    assert.equal(tr.editHref, "/panel/blog/3");
  });

  test("a missing share image everywhere → none; a deleted media id does not count as an image", () => {
    const rows = seoPageInputs(
      source({
        site: { ...source().site, defaultShareImage: false },
        categories: [{ id: 1, slug: "x", name: { tr: "X" }, description: null, body: null, imageId: null, seo: { ogImageId: 999 } }],
      }),
    );
    assert.equal(pick(rows, "category:1").shareImage, "none");
    assert.equal(pick(rows, "category:1").imagesWithoutAlt, 0);
  });
});

describe("pages", () => {
  const page = (slug: string, kind: string, sections: SeoSource["pages"][number]["sections"], seo: SeoSource["pages"][number]["seo"] = null) => ({
    id: slug.length,
    slug,
    kind,
    title: { tr: `${slug} başlık` },
    seo,
    sections,
  });

  test("reserved pages use their own routes; starting with a hero → the hero's headline is the only H1", () => {
    const rows = seoPageInputs(source({ pages: [page("kurumsal", "b2b", [hero("Her misafire özenli bir dokunuş.")])] }));
    const tr = pick(rows, `page:${"kurumsal".length}`);
    assert.equal(tr.path, "/tr/kurumsal");
    assert.equal(pick(rows, `page:${"kurumsal".length}`, "en").path, "/en/business");
    assert.equal(tr.h1, "Her misafire özenli bir dokunuş.");
    assert.equal(tr.h1Count, 1);
  });

  test("reserved page without a hero first: the page title H1 (+1 per hero further down); numune falls back to the UI intro", () => {
    const faq = { type: "faq", content: { items: [{ question: { tr: "Soru?" }, answer: { tr: "Cevap." } }] }, mediaIds: [] };
    const rows = seoPageInputs(source({ pages: [page("numune", "landing", [faq, hero("İkinci")])] }));
    const tr = pick(rows, `page:${"numune".length}`);
    assert.equal(tr.path, "/tr/numune");
    assert.equal(tr.h1, "numune başlık");
    assert.equal(tr.h1Count, 2);
    assert.equal(tr.description, "Ücretsiz numune isteyin.", "cmsPageMetadata: seoText(seo.description, locale, fallback.intro)");
  });

  test("a section whose content does not pass its schema does not render, so the next hero opens the page", () => {
    const broken = { type: "faq", content: { items: [] }, mediaIds: [] };
    const rows = seoPageInputs(source({ pages: [page("numune", "landing", [broken, hero("İlk görünen")])] }));
    const tr = pick(rows, `page:${"numune".length}`);
    assert.equal(tr.h1, "İlk görünen");
    assert.equal(tr.h1Count, 1);
  });

  test("/sayfa/<slug>: a page that starts with a hero has the hero as its only H1; legal pages are low priority", () => {
    const rows = seoPageInputs(
      source({
        pages: [page("hakkimizda", "custom", [hero("Biz kimiz")], { description: { tr: "Hakkımızda açıklaması" } }), page("kvkk", "legal", [])],
      }),
    );
    const about = pick(rows, `page:${"hakkimizda".length}`);
    assert.equal(about.path, "/tr/sayfa/hakkimizda");
    assert.equal(about.h1Count, 1);
    assert.equal(about.h1, "Biz kimiz");
    assert.equal(about.lowPriority, false);
    assert.equal(pick(rows, `page:${"hakkimizda".length}`, "en").path, "/en/page/hakkimizda");
    const legal = pick(rows, `page:${"kvkk".length}`);
    assert.equal(legal.lowPriority, true);
    assert.equal(legal.description, "");
    assert.equal(buildSeoReport([legal]).rows[0].status, "good", "a legal text with a short title and no description is fine");
  });
});

describe("languages and order", () => {
  test("only enabled languages get rows; order: home, products index, categories, products, pages, posts", () => {
    const rows = seoPageInputs(
      source({
        locales: ["tr", "en"],
        categories: [{ id: 1, slug: "a", name: { tr: "A" }, description: null, body: null, imageId: null, seo: null }],
        products: [{ id: 2, slug: "b", name: { tr: "B" }, subtitle: null, shortDescription: null, description: null, seo: null, mediaIds: [], variants: [] }],
        pages: [{ id: 3, slug: "c", kind: "custom", title: { tr: "C" }, seo: null, sections: [] }],
        posts: [{ id: 4, slug: "d", title: { tr: "D" }, excerpt: null, body: null, coverId: null, seo: null }],
      }),
    );
    assert.ok(rows.every((r) => r.locale !== "ar"));
    assert.deepEqual(
      [...new Set(rows.map((r) => r.key))],
      ["home", "products", "category:1", "product:2", "page:3", "post:4"],
    );
    assert.equal(rows.length, 12);
  });

  test("a custom title template without %s falls back to '%s | site name'", () => {
    const rows = seoPageInputs(source({ site: { ...source().site, titleTemplate: "PRESTİJ" } }));
    assert.equal(pick(rows, "products").fullTitle, "Ürünler | PRESTİJ");
  });
});
