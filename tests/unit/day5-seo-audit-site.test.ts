// Day 5 SEO-AUDIT: cross-page rules (src/lib/seo/audit/site.ts): sitemap ↔ pages, duplicates,
// hreflang reciprocity, canonical targets, links, and the merchant feed against the pages.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkFeed, parseMerchantFeed } from "@/lib/seo/audit/feed";
import { checkPage, type PageFacts } from "@/lib/seo/audit/page";
import { checkFeedAgainstSite, checkSite, type FetchOutcome } from "@/lib/seo/audit/site";
import type { SitemapUrl } from "@/lib/seo/audit/sitemap";
import type { Issue } from "@/lib/seo/audit/types";
import { feedItem, feedXml, LOCALES, NOW, ORIGIN, PATHS, pageHtml, productGroupLd, productLd, url, type Locale, type PageSpec } from "./day5-seo-audit-fixtures";

const codes = (issues: Issue[]) => issues.map((i) => i.code).sort();

const TITLES: Record<Locale, string> = { tr: "Lavanta Sıvı El Sabunu | PRESTİJ", en: "Lavender Liquid Hand Soap | PRESTİJ", ar: "صابون اللافندر السائل لليدين | PRESTİJ" };
const pad = (s: string) => `${s} ${"ve bu açıklama arama sonuçlarında görünecek kadar uzun, doğal ve bilgilendirici olmalıdır. ".repeat(3)}`.slice(0, 140).trim();

function page(locale: Locale, spec: PageSpec = {}, at?: string): PageFacts {
  const pageUrl = at ?? url((spec.paths ?? PATHS.product)[locale]);
  return checkPage({
    url: pageUrl,
    html: pageHtml({ locale, title: TITLES[locale], description: pad(`${locale} ürün açıklaması`), ...spec }),
    origin: ORIGIN,
    locales: LOCALES,
    defaultLocale: "tr",
    rtlLocales: ["ar"],
    now: NOW,
  }).facts;
}

function ok(pageUrl: string, extra: Partial<FetchOutcome> = {}): FetchOutcome {
  return { url: pageUrl, blocked: false, status: 200, finalUrl: pageUrl, redirects: [], error: null, contentType: "text/html; charset=utf-8", linkedFrom: [], namedBy: [], ...extra };
}

function sitemapEntry(locale: Locale, paths: Record<Locale, string> = PATHS.product): SitemapUrl {
  return { loc: url(paths[locale]), lastmod: null, images: [], alternates: [...LOCALES.map((l) => ({ hreflang: l, href: url(paths[l]) })), { hreflang: "x-default", href: url(paths.tr) }] };
}

/** The three language versions of the product page, all fetched and in the sitemap. */
function cluster() {
  const pages = LOCALES.map((l) => page(l));
  return { pages, outcomes: pages.map((p) => ok(p.url)), sitemap: LOCALES.map((l) => sitemapEntry(l)) };
}

describe("a consistent site", () => {
  test("no issue when pages, sitemap and hreflang agree", () => {
    const { pages, outcomes, sitemap } = cluster();
    assert.deepEqual(checkSite({ origin: ORIGIN, outcomes, pages, sitemap }), []);
  });
});

describe("sitemap ↔ pages", () => {
  test("a sitemap URL that is noindex, canonicalizes elsewhere, redirects, fails or is blocked", () => {
    const { pages, outcomes, sitemap } = cluster();
    const noindex = [page("tr", { robots: "noindex" }), pages[1], pages[2]];
    assert.deepEqual(codes(checkSite({ origin: ORIGIN, outcomes, pages: noindex, sitemap })), ["hreflang-target-bad", "hreflang-target-bad", "hreflang-target-bad", "hreflang-target-bad", "sitemap-noindex"], "en and ar list it as tr and x-default");

    const elsewhere = [page("tr", { canonical: url("/tr") }), pages[1], pages[2]];
    assert.deepEqual(codes(checkSite({ origin: ORIGIN, outcomes, pages: elsewhere, sitemap })), ["hreflang-target-bad", "hreflang-target-bad", "hreflang-target-bad", "hreflang-target-bad", "sitemap-non-canonical"]);

    const tr = url(PATHS.product.tr);
    const redirected = [ok(tr, { finalUrl: `${tr}-yeni`, redirects: [{ status: 308, from: tr, to: `${tr}-yeni` }] }), ...outcomes.slice(1)];
    assert.deepEqual(codes(checkSite({ origin: ORIGIN, outcomes: redirected, pages: pages.slice(1), sitemap })), ["hreflang-target-bad", "hreflang-target-bad", "hreflang-target-bad", "hreflang-target-bad", "sitemap-url-redirect"]);

    const missing = [ok(tr, { status: 404 }), ...outcomes.slice(1)];
    assert.deepEqual(codes(checkSite({ origin: ORIGIN, outcomes: missing, pages: pages.slice(1), sitemap })), ["hreflang-target-bad", "hreflang-target-bad", "hreflang-target-bad", "hreflang-target-bad", "sitemap-url-not-200"]);

    const blocked = [ok(tr, { blocked: true, status: null, finalUrl: null }), ...outcomes.slice(1)];
    assert.deepEqual(codes(checkSite({ origin: ORIGIN, outcomes: blocked, pages: pages.slice(1), sitemap })), ["hreflang-target-bad", "hreflang-target-bad", "hreflang-target-bad", "hreflang-target-bad", "sitemap-url-blocked"]);
  });

  test("an indexable page that the sitemap forgot (a warning), unless it is noindex or a query variant", () => {
    const { pages, outcomes, sitemap } = cluster();
    const issues = checkSite({ origin: ORIGIN, outcomes, pages, sitemap: sitemap.slice(1) });
    assert.deepEqual(codes(issues), ["sitemap-missing-page"]);
    assert.equal(issues[0].severity, "warning");
    const variant = page("tr", {}, `${url(PATHS.product.tr)}?varyant=11`);
    assert.deepEqual(checkSite({ origin: ORIGIN, outcomes: [...outcomes, ok(variant.url)], pages: [...pages, variant], sitemap }), []);
  });

  test("sitemap alternates that differ from the page's hreflang", () => {
    const { pages, outcomes, sitemap } = cluster();
    const changed = [{ ...sitemap[0], alternates: sitemap[0].alternates.filter((a) => a.hreflang !== "ar") }, ...sitemap.slice(1)];
    const issues = checkSite({ origin: ORIGIN, outcomes, pages, sitemap: changed });
    assert.deepEqual(codes(issues), ["sitemap-alternates-mismatch"]);
    assert.match(issues[0].message, /ar: sitemap \(none\)/);
  });
});

describe("duplicates", () => {
  test("the same title on two different products is an error; across one page's languages a warning", () => {
    const other = { tr: "/tr/urunler/portakal", en: "/en/products/portakal", ar: "/ar/products/portakal" };
    const { pages, outcomes, sitemap } = cluster();
    const portakal = LOCALES.map((l) => page(l, { paths: other, description: pad(`${l} portakal açıklaması`) }));
    const all = { origin: ORIGIN, outcomes: [...outcomes, ...portakal.map((p) => ok(p.url))], pages: [...pages, ...portakal], sitemap: [...sitemap, ...LOCALES.map((l) => sitemapEntry(l, other))] };
    assert.deepEqual(codes(checkSite(all)), ["title-duplicate", "title-duplicate", "title-duplicate"]);

    const untranslated = [pages[0], page("en", { title: TITLES.tr }), pages[2]];
    const issues = checkSite({ origin: ORIGIN, outcomes, pages: untranslated, sitemap });
    assert.deepEqual(codes(issues), ["title-untranslated"]);
    assert.equal(issues[0].severity, "warning");
  });

  test("duplicate descriptions are warnings (cross-page and untranslated)", () => {
    const { pages, outcomes, sitemap } = cluster();
    const same = [pages[0], page("en", { description: pad("tr ürün açıklaması") }), pages[2]];
    assert.deepEqual(codes(checkSite({ origin: ORIGIN, outcomes, pages: same, sitemap })), ["description-untranslated"]);
  });
});

describe("hreflang across pages", () => {
  test("an alternate that does not link back", () => {
    const { pages, outcomes, sitemap } = cluster();
    const en = page("en", { alternates: { tr: url("/tr/urunler/baska"), en: url(PATHS.product.en), ar: url(PATHS.product.ar), "x-default": url("/tr/urunler/baska") } });
    const issues = checkSite({ origin: ORIGIN, outcomes: [...outcomes, ok(url("/tr/urunler/baska"), { status: 404 })], pages: [pages[0], en, pages[2]], sitemap: sitemap.filter((e) => !e.loc.includes("/en/")) });
    assert.ok(codes(issues).includes("hreflang-not-reciprocal"), JSON.stringify(issues, null, 1));
    assert.ok(issues.some((i) => i.code === "hreflang-target-bad" && /answers 404/.test(i.message)));
  });

  test("an alternate in the wrong language, or noindex", () => {
    const { pages, outcomes, sitemap } = cluster();
    const wrongLang = page("en", { lang: "tr" }, url(PATHS.product.en));
    const issues = checkSite({ origin: ORIGIN, outcomes, pages: [pages[0], { ...wrongLang, locale: null }, pages[2]], sitemap });
    assert.ok(issues.some((i) => i.code === "hreflang-target-bad" && /"tr" page/.test(i.message)), JSON.stringify(issues, null, 1));
    const noindex = checkSite({ origin: ORIGIN, outcomes, pages: [pages[0], page("en", { robots: "noindex" }), pages[2]], sitemap });
    assert.ok(noindex.some((i) => i.code === "hreflang-target-bad" && /noindex/.test(i.message)));
  });
});

describe("canonical targets and links", () => {
  test("a variant URL whose canonical page is broken", () => {
    const { pages, outcomes, sitemap } = cluster();
    const variant = page("tr", {}, `${url(PATHS.product.tr)}?varyant=11`);
    const noindexTarget = [page("tr", { robots: "noindex" }), pages[1], pages[2], variant];
    const issues = checkSite({ origin: ORIGIN, outcomes: [...outcomes, ok(variant.url)], pages: noindexTarget, sitemap });
    assert.ok(issues.some((i) => i.code === "canonical-target-bad" && i.url === variant.url));
  });

  test("broken links (with the linking pages), URLs named by metadata, redirecting links and chains", () => {
    const { pages, outcomes, sitemap } = cluster();
    const extra = [
      ok(url("/tr/yok"), { status: 404, linkedFrom: [pages[0].url] }),
      ok(url("/tr/eski-isim"), { status: 410, namedBy: [pages[0].url] }),
      ok(url("/tr/sayfa/kurumsal"), { finalUrl: url("/tr/kurumsal"), redirects: [{ status: 308, from: url("/tr/sayfa/kurumsal"), to: url("/tr/kurumsal") }], linkedFrom: [pages[0].url] }),
      ok(url("/a"), { finalUrl: url("/tr/c"), redirects: [{ status: 307, from: url("/a"), to: url("/b") }, { status: 308, from: url("/b"), to: url("/tr/c") }] }),
      ok(url("/tr/hesap"), { blocked: true, status: null, finalUrl: null, linkedFrom: [pages[0].url] }),
    ];
    const issues = checkSite({ origin: ORIGIN, outcomes: [...outcomes, ...extra], pages, sitemap });
    assert.deepEqual(codes(issues), ["broken-link", "broken-link", "internal-link-redirect", "redirect-chain"]);
    assert.match(issues.find((i) => i.url === url("/tr/yok"))?.message ?? "", /linked from .*\/tr\/urunler\/lavanta/);
    assert.match(issues.find((i) => i.url === url("/tr/eski-isim"))?.message ?? "", /named in the metadata/);
  });
});

describe("feed against the site", () => {
  const FEED_URL = `${ORIGIN}/feeds/google-merchant.xml`;
  const feed = (items: string[]) => checkFeed(parseMerchantFeed(feedXml(items)), { origin: ORIGIN, feedUrl: FEED_URL, now: NOW }).items;
  const trProduct = (jsonLd: unknown[]) => page("tr", { jsonLd });

  function run(items: string[], opts: { jsonLd?: unknown[]; sitemap?: SitemapUrl[]; outcomes?: FetchOutcome[] } = {}) {
    const pages = [trProduct(opts.jsonLd ?? [productLd()])];
    const facts = feed(items);
    const outcomes = opts.outcomes ?? [ok(pages[0].url), ...facts.map((f) => ok(f.link as string))];
    return checkFeedAgainstSite({ feedUrl: FEED_URL, items: facts, outcomes, pages, sitemap: opts.sitemap ?? [sitemapEntry("tr")], productPathPrefix: "/tr/urunler/", origin: ORIGIN, now: NOW });
  }

  test("matching price and availability, product in the sitemap: no issue", () => {
    assert.deepEqual(run([feedItem()]), []);
    assert.deepEqual(run([feedItem({ "g:id": "PR-LAV-5L", "g:price": "449.90 TRY", link: `${url(PATHS.product.tr)}?varyant=12` })]), []);
  });

  test("price, sale price and availability must match the page's Offer for that SKU", () => {
    assert.deepEqual(codes(run([feedItem({ "g:price": "159.90 TRY" })])), ["feed-price-mismatch"]);
    assert.deepEqual(codes(run([feedItem({ "g:availability": "out_of_stock" })])), ["feed-price-mismatch"]);
    const sale = { "g:price": "179.90 TRY", "g:sale_price": "149.90 TRY", "g:sale_price_effective_date": "2026-11-01T00:00+03:00/2026-11-30T23:59+03:00" };
    assert.deepEqual(run([feedItem(sale)]), [], "the active sale price is what the page shows");
    assert.deepEqual(codes(run([feedItem({ "g:id": "PR-UNKNOWN", "g:mpn": "PR-UNKNOWN" })])), ["feed-item-recommended"]);
  });

  test("the product page must be in the sitemap, the link must work; sitemap products need a feed item", () => {
    assert.deepEqual(codes(run([feedItem()], { sitemap: [] })), ["feed-item-not-in-sitemap"]);
    const link = `${url(PATHS.product.tr)}?varyant=11`;
    assert.deepEqual(codes(run([feedItem()], { outcomes: [ok(url(PATHS.product.tr)), ok(link, { status: 404 })] })), ["feed-link-broken"]);
    const otherProduct = { ...sitemapEntry("tr"), loc: url("/tr/urunler/portakal") };
    assert.deepEqual(codes(run([feedItem()], { sitemap: [sitemapEntry("tr"), otherProduct, { ...sitemapEntry("tr"), loc: url("/tr/urunler") }] })), ["feed-product-missing"]);
  });

  test("g:item_group_id should equal the page's ProductGroup id (warning)", () => {
    const issues = run([feedItem({ "g:item_group_id": "P1" })], { jsonLd: [productGroupLd()] });
    assert.deepEqual(codes(issues), ["feed-group-mismatch"]);
    assert.equal(issues[0].severity, "warning");
    assert.deepEqual(run([feedItem()], { jsonLd: [productGroupLd()] }), []);
  });
});
