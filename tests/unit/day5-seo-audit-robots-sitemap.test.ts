// Day 5 SEO-AUDIT: robots.txt and sitemap rules (src/lib/seo/audit/robots.ts, sitemap.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkRobots, isAllowed, parseRobotsTxt, rulesFor } from "@/lib/seo/audit/robots";
import { checkSitemap, isW3cDatetime, parseSitemapXml } from "@/lib/seo/audit/sitemap";
import type { Issue } from "@/lib/seo/audit/types";
import { NOW, ORIGIN } from "./day5-seo-audit-fixtures";

const codes = (issues: Issue[]) => issues.map((i) => i.code).sort();
const ROBOTS_URL = `${ORIGIN}/robots.txt`;

/** Exactly what Next printed for src/app/robots.ts on the day-5 build (origin swapped). */
const NEXT_ROBOTS = `User-Agent: *
Allow: /
Disallow: /panel
Disallow: /api
Disallow: /tr/sepet
Disallow: /tr/odeme
Disallow: /tr/hesap
Disallow: /tr/siparis
Disallow: /en/cart
Disallow: /en/checkout
Disallow: /en/account
Disallow: /en/order

Host: ${ORIGIN}
Sitemap: ${ORIGIN}/sitemap.xml
`;

describe("robots.txt", () => {
  test("parses Next's output and matches paths like Google (prefix, longest rule wins)", () => {
    const robots = parseRobotsTxt(NEXT_ROBOTS);
    assert.deepEqual(robots.sitemaps, [`${ORIGIN}/sitemap.xml`]);
    assert.equal(robots.host, ORIGIN);
    const rules = rulesFor(robots);
    assert.equal(isAllowed(rules, "/tr/urunler/lavanta"), true);
    assert.equal(isAllowed(rules, "/tr/hesap/giris?sonra=%2Ftr"), false);
    assert.equal(isAllowed(rules, "/en/account"), false);
    assert.equal(isAllowed(rules, "/panel/giris"), false);
    assert.equal(isAllowed(rules, "/tr/sepetim"), false, "Disallow is a prefix match");
    assert.equal(isAllowed(rules, "/robots.txt"), true);
    assert.deepEqual(checkRobots(robots, ORIGIN, ROBOTS_URL), []);
  });

  test("wildcards, $ anchors, Allow wins a tie, a specific group replaces *", () => {
    const robots = parseRobotsTxt(
      ["User-agent: *", "Disallow: /*?sirala=", "Disallow: /tr/hesap", "Allow: /tr/hesap/giris$", "Disallow: /x", "Allow: /x", "", "User-agent: Googlebot", "Disallow: /google-only"].join("\n"),
    );
    const star = rulesFor(robots);
    assert.equal(isAllowed(star, "/tr/urunler?sirala=fiyat"), false);
    assert.equal(isAllowed(star, "/tr/urunler?sayfa=2"), true);
    assert.equal(isAllowed(star, "/tr/hesap/giris"), true);
    assert.equal(isAllowed(star, "/tr/hesap/giris/x"), false);
    assert.equal(isAllowed(star, "/x"), true);
    const google = rulesFor(robots, "googlebot");
    assert.equal(isAllowed(google, "/tr/hesap"), true);
    assert.equal(isAllowed(google, "/google-only/a"), false);
  });

  test("several User-agent lines share one group; an empty Disallow allows everything", () => {
    const robots = parseRobotsTxt("User-agent: a\nUser-agent: *\nDisallow:\n");
    assert.deepEqual(robots.groups, [{ agents: ["a", "*"], rules: [] }]);
    assert.equal(isAllowed(rulesFor(robots), "/anything"), true);
  });

  test("rules: whole site blocked, no Sitemap for this origin, a local foreign Sitemap, Host mismatch, unknown lines", () => {
    assert.deepEqual(codes(checkRobots(parseRobotsTxt(`User-agent: *\nDisallow: /\nSitemap: ${ORIGIN}/sitemap.xml`), ORIGIN, ROBOTS_URL)), ["robots-blocks-all"]);
    assert.deepEqual(codes(checkRobots(parseRobotsTxt("User-agent: *\nAllow: /"), ORIGIN, ROBOTS_URL)), ["robots-no-sitemap"]);
    assert.deepEqual(codes(checkRobots(parseRobotsTxt("User-agent: *\nSitemap: http://localhost:3000/sitemap.xml"), ORIGIN, ROBOTS_URL)), ["foreign-origin-url", "robots-no-sitemap"]);
    assert.deepEqual(codes(checkRobots(parseRobotsTxt(`User-agent: *\nHost: https://prestij.com.tr\nSitemap: ${ORIGIN}/sitemap.xml`), ORIGIN, ROBOTS_URL)), ["robots-host-mismatch"]);
    assert.deepEqual(codes(checkRobots(parseRobotsTxt(`Disallow: /a\nUser-agent: *\nNoindex: /b\nSitemap: ${ORIGIN}/sitemap.xml`), ORIGIN, ROBOTS_URL)), ["robots-syntax", "robots-syntax"]);
  });
});

/** The shape Next's resolveSitemap prints (no escaping of its own). */
function nextSitemap(entries: { loc: string; lastmod?: string; alternates?: Record<string, string>; images?: string[] }[]): string {
  const hasImages = entries.some((e) => e.images?.length);
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  if (hasImages) xml += ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"';
  xml += ' xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
  for (const e of entries) {
    xml += `<url>\n<loc>${e.loc}</loc>\n`;
    for (const [lang, href] of Object.entries(e.alternates ?? {})) xml += `<xhtml:link rel="alternate" hreflang="${lang}" href="${href}" />\n`;
    for (const image of e.images ?? []) xml += `<image:image>\n<image:loc>${image}</image:loc>\n</image:image>\n`;
    if (e.lastmod) xml += `<lastmod>${e.lastmod}</lastmod>\n`;
    xml += "<priority>0.8</priority>\n</url>\n";
  }
  return `${xml}</urlset>\n`;
}

const SITEMAP_URL = `${ORIGIN}/sitemap.xml`;
const alt = (slug: string) => ({ tr: `${ORIGIN}/tr/urunler/${slug}`, en: `${ORIGIN}/en/products/${slug}`, ar: `${ORIGIN}/ar/products/${slug}`, "x-default": `${ORIGIN}/tr/urunler/${slug}` });
const entry = (locale: "tr" | "en" | "ar", slug = "lavanta", extra: { lastmod?: string; images?: string[] } = {}) => ({
  loc: alt(slug)[locale],
  lastmod: "2026-11-10T09:00:00.000Z",
  alternates: alt(slug),
  ...extra,
});

describe("sitemap", () => {
  test("parses urlset entries with alternates, images and lastmod; a clean file has no issue", () => {
    const xml = nextSitemap([entry("tr", "lavanta", { images: [`${ORIGIN}/media/a.webp`] }), entry("en"), entry("ar")]);
    const parsed = parseSitemapXml(xml);
    assert.equal(parsed.kind, "urlset");
    assert.equal(parsed.urls.length, 3);
    assert.deepEqual(parsed.urls[0].alternates.map((a) => a.hreflang), ["tr", "en", "ar", "x-default"]);
    assert.deepEqual(parsed.urls[0].images, [`${ORIGIN}/media/a.webp`]);
    assert.equal(parsed.urls[0].lastmod, "2026-11-10T09:00:00.000Z");
    assert.deepEqual(checkSitemap(parsed, ORIGIN, SITEMAP_URL, NOW), []);
  });

  test("an unescaped & (Next does not escape) makes the file invalid; &amp; is fine and decoded", () => {
    const bad = parseSitemapXml(nextSitemap([{ loc: `${ORIGIN}/tr/urunler?a=1&b=2` }]));
    assert.deepEqual(codes(checkSitemap(bad, ORIGIN, SITEMAP_URL, NOW)), ["sitemap-invalid"]);
    const good = parseSitemapXml(nextSitemap([{ loc: `${ORIGIN}/tr/urunler?a=1&amp;b=2` }]));
    assert.equal(good.urls[0].loc, `${ORIGIN}/tr/urunler?a=1&b=2`);
    assert.deepEqual(checkSitemap(good, ORIGIN, SITEMAP_URL, NOW), []);
  });

  test("locs must be absolute and on this origin, unique; lastmod a W3C date not in the future", () => {
    assert.deepEqual(codes(checkSitemap(parseSitemapXml(nextSitemap([{ loc: "/tr/urunler" }])), ORIGIN, SITEMAP_URL, NOW)), ["sitemap-loc-invalid"]);
    assert.deepEqual(codes(checkSitemap(parseSitemapXml(nextSitemap([{ loc: "http://localhost:3000/tr" }])), ORIGIN, SITEMAP_URL, NOW)), ["foreign-origin-url", "sitemap-loc-invalid"]);
    assert.deepEqual(codes(checkSitemap(parseSitemapXml(nextSitemap([{ loc: `${ORIGIN}/tr` }, { loc: `${ORIGIN}/tr` }])), ORIGIN, SITEMAP_URL, NOW)), ["sitemap-duplicate"]);
    assert.deepEqual(codes(checkSitemap(parseSitemapXml(nextSitemap([{ loc: `${ORIGIN}/tr`, lastmod: "10.11.2026" }])), ORIGIN, SITEMAP_URL, NOW)), ["sitemap-lastmod-invalid"]);
    assert.deepEqual(codes(checkSitemap(parseSitemapXml(nextSitemap([{ loc: `${ORIGIN}/tr`, lastmod: "2027-01-01" }])), ORIGIN, SITEMAP_URL, NOW)), ["sitemap-lastmod-invalid"]);
    assert.equal(isW3cDatetime("2026-11"), true);
    assert.equal(isW3cDatetime("2026-11-10T09:00+03:00"), true);
    assert.equal(isW3cDatetime("2026-11-10T09:00"), false, "a time needs a zone");
  });

  test("alternates: valid codes, absolute same-origin hrefs, the entry itself included, one URL per language", () => {
    const check = (alternates: Record<string, string>) => codes(checkSitemap(parseSitemapXml(nextSitemap([{ loc: alt("lavanta").tr, alternates }])), ORIGIN, SITEMAP_URL, NOW));
    assert.deepEqual(check({ ...alt("lavanta"), turkish: alt("lavanta").tr }), ["hreflang-invalid"]);
    assert.deepEqual(check({ ...alt("lavanta"), en: "/en/products/lavanta" }), ["hreflang-invalid"]);
    assert.deepEqual(check({ en: alt("lavanta").en, ar: alt("lavanta").ar }), ["hreflang-self-missing"]);
    const twice = parseSitemapXml(nextSitemap([{ loc: alt("lavanta").tr, alternates: alt("lavanta") }]).replace("</url>", `<xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}/en/x" />\n</url>`));
    assert.deepEqual(codes(checkSitemap(twice, ORIGIN, SITEMAP_URL, NOW)), ["hreflang-invalid"]);
  });

  test("images must be absolute; an empty urlset, a missing namespace and a sitemap index", () => {
    assert.deepEqual(codes(checkSitemap(parseSitemapXml(nextSitemap([{ loc: `${ORIGIN}/tr`, images: ["/media/a.webp"] }])), ORIGIN, SITEMAP_URL, NOW)), ["sitemap-image-invalid"]);
    assert.deepEqual(codes(checkSitemap(parseSitemapXml(nextSitemap([])), ORIGIN, SITEMAP_URL, NOW)), ["sitemap-empty"]);
    assert.deepEqual(codes(checkSitemap(parseSitemapXml("<urlset><url><loc>x</loc></url></urlset>"), ORIGIN, SITEMAP_URL, NOW)), ["sitemap-invalid", "sitemap-loc-invalid"]);
    assert.deepEqual(codes(checkSitemap(parseSitemapXml("<html><body>404</body></html>"), ORIGIN, SITEMAP_URL, NOW)), ["sitemap-invalid"]);
    const index = parseSitemapXml(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${ORIGIN}/sitemap/0.xml</loc></sitemap><sitemap><loc>https://elsewhere.example/s.xml</loc></sitemap></sitemapindex>`);
    assert.equal(index.kind, "sitemapindex");
    assert.deepEqual(index.sitemaps, [`${ORIGIN}/sitemap/0.xml`, "https://elsewhere.example/s.xml"]);
    assert.deepEqual(codes(checkSitemap(index, ORIGIN, SITEMAP_URL, NOW)), ["sitemap-loc-invalid"]);
  });
});
