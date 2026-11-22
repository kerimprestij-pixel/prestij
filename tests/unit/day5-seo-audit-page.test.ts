// Day 5 SEO-AUDIT: rules for one page (src/lib/seo/audit/page.ts), on fixture HTML shaped like this site's.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkPage } from "@/lib/seo/audit/page";
import type { Issue } from "@/lib/seo/audit/types";
import { breadcrumbLd, LOCALES, NOW, ORIGIN, PATHS, pageHtml, productLd, url, type PageSpec } from "./day5-seo-audit-fixtures";

function run(spec: PageSpec = {}, opts: { url?: string; xRobotsTag?: string } = {}) {
  const locale = spec.locale ?? "tr";
  return checkPage({
    url: opts.url ?? url((spec.paths ?? PATHS.product)[locale]),
    html: pageHtml(spec),
    xRobotsTag: opts.xRobotsTag ?? null,
    origin: ORIGIN,
    locales: LOCALES,
    defaultLocale: "tr",
    rtlLocales: ["ar"],
    now: NOW,
  });
}

const codes = (issues: Issue[]) => issues.map((i) => i.code).sort();

describe("a correct page", () => {
  test("has no issue in any locale (ar is rtl)", () => {
    for (const locale of LOCALES) {
      const { issues } = run({ locale, jsonLd: locale === "tr" ? [productLd(), breadcrumbLd()] : [] });
      assert.deepEqual(issues, [], `${locale}: ${JSON.stringify(issues, null, 1)}`);
    }
  });

  test("facts: indexable, self-canonical, hreflang map, links, metadata URLs and images", () => {
    const { facts } = run({ jsonLd: [productLd(), breadcrumbLd()] });
    assert.equal(facts.indexable, true);
    assert.equal(facts.selfCanonical, true);
    assert.equal(facts.locale, "tr");
    assert.deepEqual(facts.hreflang, { tr: url(PATHS.product.tr), en: url(PATHS.product.en), ar: url(PATHS.product.ar), "x-default": url(PATHS.product.tr) });
    assert.ok(facts.links.includes(url("/tr")));
    assert.ok(facts.links.includes("https://wa.me/903523533070"));
    assert.ok(!facts.links.some((l) => l.startsWith("tel:") || l.startsWith("mailto:") || l.includes("#")));
    assert.ok(facts.metadataUrls.includes(url(PATHS.product.en)));
    assert.ok(facts.metadataUrls.includes(url("/tr/urunler")), "breadcrumb items are named by JSON-LD");
    assert.ok(facts.imageUrls.includes(url("/media/urunler/lavanta/lavanta-1024.webp")));
    assert.deepEqual(facts.jsonLd.types, ["Product", "BreadcrumbList"]);
    assert.equal(facts.jsonLd.offers.length, 2);
  });
});

describe("language and direction", () => {
  test("missing lang, wrong lang, wrong dir", () => {
    assert.deepEqual(codes(run({ lang: null }).issues), ["html-lang-missing"]);
    assert.deepEqual(codes(run({ locale: "en", lang: "tr" }).issues), ["html-lang-mismatch"]);
    assert.deepEqual(codes(run({ locale: "ar", dir: "ltr" }).issues), ["html-dir-mismatch"]);
    assert.deepEqual(codes(run({ locale: "ar", dir: null }).issues), ["html-dir-mismatch"]);
    assert.deepEqual(codes(run({ locale: "en", dir: null }).issues), [], "ltr is the default for en");
    assert.deepEqual(codes(run({ locale: "en", lang: "en-US" }).issues), [], "a region subtag is fine");
  });
});

describe("title, description, h1", () => {
  test("title missing / too long / too short / twice", () => {
    assert.deepEqual(codes(run({ title: null, ogTitle: "Lavanta" }).issues), ["title-missing"]);
    assert.deepEqual(codes(run({ title: `${"Çok uzun bir başlık ".repeat(4)}| PRESTİJ` }).issues), ["title-too-long"]);
    assert.deepEqual(codes(run({ title: "Blog | PRESTİJ" }).issues), ["title-too-short"]);
    assert.deepEqual(codes(run({ body: "<title>Second</title>" }).issues), ["title-multiple"]);
  });

  test("description missing / outside 120–160 characters / twice (length counts characters, not bytes)", () => {
    assert.deepEqual(codes(run({ description: null }).issues), ["description-missing"]);
    assert.deepEqual(codes(run({ description: "Kısa açıklama." }).issues), ["description-length"]);
    assert.deepEqual(codes(run({ description: "x".repeat(161) }).issues), ["description-length"]);
    assert.deepEqual(codes(run({ description: "ı".repeat(160) }).issues), [], "160 two-byte characters are 160 characters");
    assert.deepEqual(codes(run({ body: '<meta name="description" content="Another one"/>' }).issues), ["description-multiple"]);
  });

  test("h1 missing / several / empty", () => {
    assert.deepEqual(codes(run({ h1: [] }).issues), ["h1-missing"]);
    assert.deepEqual(codes(run({ h1: ["Lavanta", "Ürün özellikleri"] }).issues), ["h1-multiple"]);
    assert.deepEqual(codes(run({ h1: ["<span></span>"] }).issues), ["h1-empty"]);
    assert.deepEqual(run({ h1: ['Lavanta <span class="block text-sm">Sıvı El Sabunu</span>'] }).facts.h1, ["Lavanta Sıvı El Sabunu"]);
  });
});

describe("canonical", () => {
  test("missing, relative, not self, twice", () => {
    assert.deepEqual(codes(run({ canonical: null, ogUrl: null }).issues), ["canonical-missing"]);
    assert.deepEqual(codes(run({ canonical: "/tr/urunler/lavanta", ogUrl: null }).issues), ["canonical-relative"]);
    const other = run({ canonical: url("/tr"), ogUrl: null });
    assert.deepEqual(codes(other.issues), ["canonical-not-self"]);
    assert.equal(other.facts.indexable, false, "content rules are skipped for a page that canonicalizes elsewhere");
    assert.deepEqual(codes(run({ body: `<link rel="canonical" href="${url("/tr")}"/>` }).issues), ["canonical-multiple"]);
  });

  test("a URL with a query string may canonicalize to itself without the query (variant links)", () => {
    const { issues, facts } = run({}, { url: `${url(PATHS.product.tr)}?varyant=11` });
    assert.deepEqual(issues, []);
    assert.equal(facts.indexable, false);
    assert.equal(facts.selfCanonical, false);
    assert.equal(facts.canonical, url(PATHS.product.tr));
    assert.ok(facts.metadataUrls.includes(url(PATHS.product.tr)));
  });

  test("a canonical on a local host other than the audited origin (wrong NEXT_PUBLIC_SITE_URL) is called out", () => {
    const { issues } = run({ canonical: "http://localhost:3000/tr/urunler/lavanta", ogUrl: null });
    assert.deepEqual(codes(issues), ["canonical-not-self", "foreign-origin-url"]);
  });
});

describe("noindex", () => {
  test("a noindex page is not judged on content; a canonical elsewhere is a mixed signal", () => {
    const { issues, facts } = run({ robots: "noindex, follow", title: null, h1: [], description: null, ogTitle: null });
    assert.deepEqual(issues, []);
    assert.equal(facts.noindex, true);
    assert.equal(facts.indexable, false);
    assert.deepEqual(codes(run({ robots: "noindex", canonical: url("/tr") }).issues), ["noindex-foreign-canonical"]);
  });

  test("X-Robots-Tag: noindex counts like the meta tag", () => {
    const { facts } = run({}, { xRobotsTag: "noindex" });
    assert.equal(facts.noindex, true);
  });
});

describe("hreflang", () => {
  const all = { tr: url(PATHS.product.tr), en: url(PATHS.product.en), ar: url(PATHS.product.ar), "x-default": url(PATHS.product.tr) };

  test("none, incomplete, invalid code, relative or foreign URL, two URLs for one language", () => {
    assert.deepEqual(codes(run({ alternates: {} }).issues), ["hreflang-missing"]);
    const incomplete = run({ alternates: { tr: all.tr, en: all.en } });
    assert.deepEqual(codes(incomplete.issues), ["hreflang-incomplete"]);
    assert.match(incomplete.issues[0].message, /ar, x-default/);
    assert.deepEqual(codes(run({ alternates: { ...all, english: all.en } }).issues), ["hreflang-invalid"]);
    assert.deepEqual(codes(run({ alternates: { ...all, en: "/en/products/lavanta" } }).issues), ["hreflang-incomplete", "hreflang-invalid"]);
    assert.deepEqual(codes(run({ alternates: { ...all, en: "http://localhost:3000/en/products/lavanta" } }).issues), ["foreign-origin-url", "hreflang-incomplete", "hreflang-invalid"]);
    const html = pageHtml({ body: `<link rel="alternate" hrefLang="en" href="${url("/en/x")}"/>` });
    const twice = checkPage({ url: all.tr, html, origin: ORIGIN, locales: LOCALES, defaultLocale: "tr", rtlLocales: ["ar"], now: NOW });
    assert.deepEqual(codes(twice.issues), ["hreflang-invalid"]);
  });

  test("the set must include the page itself; x-default should be the default-locale URL", () => {
    assert.deepEqual(codes(run({ alternates: { ...all, tr: url("/tr/urunler/baska") } }).issues), ["hreflang-self-missing", "hreflang-x-default"]);
    assert.deepEqual(codes(run({ alternates: { ...all, "x-default": all.en } }).issues), ["hreflang-x-default"]);
    assert.deepEqual(codes(run({ alternates: { "tr-TR": all.tr, "en-US": all.en, ar: all.ar, "x-default": all.tr } }).issues), [], "region subtags count for their language");
  });
});

describe("Open Graph and images", () => {
  test("og:title missing is an error, og:image missing a warning, a relative og:image an error, og:url ≠ canonical a warning", () => {
    assert.deepEqual(codes(run({ ogTitle: null }).issues), ["og-title-missing"]);
    const noImage = run({ ogImage: null }).issues;
    assert.deepEqual(codes(noImage), ["og-image-missing"]);
    assert.equal(noImage[0].severity, "warning");
    assert.deepEqual(codes(run({ ogImage: "/media/x.webp" }).issues), ["og-image-relative"]);
    assert.deepEqual(codes(run({ ogUrl: url("/tr") }).issues), ["og-url-mismatch"]);
  });

  test("<img> without alt is an error; an empty alt only on the main image outside a link (warning)", () => {
    assert.deepEqual(codes(run({ body: '<img src="/media/a.webp"/>' }).issues), ["img-alt-missing"]);
    assert.deepEqual(codes(run({ body: '<img src="/media/a.webp" alt="" fetchPriority="high"/>' }).issues), ["img-alt-empty-priority"]);
    assert.deepEqual(codes(run({ body: '<a href="/tr/urunler/a"><img src="/media/a.webp" alt="" fetchPriority="high"/><span>A</span></a>' }).issues), []);
    assert.deepEqual(codes(run({ body: '<img src="/media/a.webp" alt="" loading="lazy"/>' }).issues), [], "decorative images may have alt=\"\"");
  });
});

describe("streaming, links and bailouts", () => {
  test("metadata only in <body> is a warning (HTML-limited crawlers read <head>)", () => {
    assert.deepEqual(codes(run({ metadataInBody: true }).issues), ["metadata-outside-head"]);
  });

  test("links to a local host other than the audited origin are reported once per origin", () => {
    const { issues } = run({ body: '<a href="http://localhost:3000/tr/a">a</a><a href="http://localhost:3000/tr/b">b</a>' });
    assert.deepEqual(codes(issues), ["foreign-origin-url"]);
  });

  test("a boundary the server handed to the browser is reported with a readable reason", () => {
    const html = pageHtml().replace("</body>", '<script>$RX("B:9","")</script></body>');
    const { issues } = checkPage({ url: url(PATHS.product.tr), html, origin: ORIGIN, locales: LOCALES, defaultLocale: "tr", rtlLocales: ["ar"], now: NOW });
    assert.deepEqual(codes(issues), ["client-render-bailout"]);
    assert.match(issues[0].message, /B:9/);
  });
});
