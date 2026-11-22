// Day 5 SEO-AUDIT: the crawler/CLI (scripts/seo-audit.ts) end to end against a tiny local fixture site
// served by node:http on 127.0.0.1 (ephemeral port; no other network). The site's canonical origin is
// http://check.localhost:3580 (--base); requests go to 127.0.0.1 (--connect) with the base Host header.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { before, describe, test } from "node:test";
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import type { Issue } from "@/lib/seo/audit/types";
import { DEFAULT_USER_AGENT, jsonReport, parseArgs, runAudit, UsageError, type AuditOptions } from "../../scripts/seo-audit";
import { feedItem, feedXml, LOCALES, NOW, ORIGIN, PATHS, pageHtml, productLd, url, type Locale, type PageSpec } from "./day5-seo-audit-fixtures";

const BASE_HOST = new URL(ORIGIN).host;
const LISTING = { tr: "/tr/urunler", en: "/en/products", ar: "/ar/products" } as const;
const KINDS = { home: PATHS.home, listing: LISTING, product: PATHS.product } as const;
const TITLES: Record<keyof typeof KINDS, Record<Locale, string>> = {
  home: { tr: "Sıvı El Sabunu ve Duş Jeli | PRESTİJ", en: "Liquid Hand Soap and Shower Gel | PRESTİJ", ar: "صابون سائل لليدين وجل استحمام | PRESTİJ" },
  listing: { tr: "Temizlik Ürünleri | PRESTİJ", en: "Cleaning & Personal Care | PRESTİJ", ar: "منتجات التنظيف والعناية | PRESTİJ" },
  product: { tr: "Lavanta Sıvı El Sabunu | PRESTİJ", en: "Lavender Liquid Hand Soap | PRESTİJ", ar: "صابون اللافندر السائل لليدين | PRESTİJ" },
};
const describeText = (s: string) => `${s}: ${"doğal, açık ve bilgilendirici bir açıklama metni, arama sonucunda tam görünecek uzunlukta. ".repeat(3)}`.slice(0, 140).trim();

type Site = {
  pages: Map<string, string>;
  sitemap: string[];
  robots: string;
  feed: string;
  redirects: Map<string, { status: number; location: string }>;
  /** Paths answered with 404 even if they exist above. */
  missing?: Set<string>;
};

function buildSite(tweak: (kind: keyof typeof KINDS, locale: Locale) => PageSpec = () => ({})): Site {
  const pages = new Map<string, string>();
  const sitemap: string[] = [];
  for (const [kind, paths] of Object.entries(KINDS) as [keyof typeof KINDS, Record<Locale, string>][]) {
    for (const locale of LOCALES) {
      pages.set(
        paths[locale],
        pageHtml({
          locale,
          paths,
          title: TITLES[kind][locale],
          description: describeText(`${kind} ${locale}`),
          h1: [TITLES[kind][locale].replace(" | PRESTİJ", "")],
          jsonLd: kind === "product" && locale === "tr" ? [productLd()] : [],
          ...tweak(kind, locale),
        }),
      );
      const alternates = LOCALES.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${url(paths[l])}" />`).join("");
      sitemap.push(`<url><loc>${url(paths[locale])}</loc>${alternates}<xhtml:link rel="alternate" hreflang="x-default" href="${url(paths.tr)}" /></url>`);
    }
  }
  return {
    pages,
    sitemap,
    robots: `User-Agent: *\nAllow: /\nDisallow: /tr/hesap\nDisallow: /panel\n\nHost: ${ORIGIN}\nSitemap: ${ORIGIN}/sitemap.xml\n`,
    feed: feedXml([feedItem()]),
    redirects: new Map([["/", { status: 307, location: "/tr" }]]),
  };
}

type Seen = { path: string; host: string | undefined; userAgent: string | undefined };

function serve(site: Site, seen: Seen[]) {
  return http.createServer((req, res) => {
    const target = new URL(req.url ?? "/", "http://fixture.invalid");
    seen.push({ path: `${target.pathname}${target.search}`, host: req.headers.host, userAgent: req.headers["user-agent"] });
    const send = (status: number, type: string, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": type, ...headers });
      res.end(body);
    };
    if (site.missing?.has(target.pathname)) return send(404, "text/plain", "Not found");
    const redirect = site.redirects.get(target.pathname);
    if (redirect) return send(redirect.status, "text/plain", "", { location: redirect.location });
    if (target.pathname === "/robots.txt") return send(200, "text/plain", site.robots);
    if (target.pathname === "/sitemap.xml") {
      return send(200, "application/xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${site.sitemap.join("")}</urlset>`);
    }
    if (target.pathname === "/feeds/google-merchant.xml") return send(200, "application/xml; charset=utf-8", site.feed);
    if (target.pathname.startsWith("/media/")) return send(200, "image/webp", "RIFF....WEBP");
    const page = site.pages.get(target.pathname);
    if (page) return send(200, "text/html; charset=utf-8", page);
    return send(404, "text/html; charset=utf-8", '<!DOCTYPE html><html lang="tr"><head><meta name="robots" content="noindex"/><title>Bulunamadı</title></head><body><h1>404</h1></body></html>');
  });
}

async function audit(site: Site, extra: Partial<AuditOptions> = {}) {
  const seen: Seen[] = [];
  const server = serve(site, seen);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const options: AuditOptions = { base: ORIGIN, connect: `http://127.0.0.1:${port}`, json: null, strict: false, maxPages: 500, concurrency: 3, timeoutMs: 10_000, userAgent: DEFAULT_USER_AGENT, ...extra };
    const result = await runAudit(options, { now: NOW });
    return { result, seen, options };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const codes = (issues: Issue[]) => [...new Set(issues.map((i) => i.code))].sort();

describe("parseArgs", () => {
  test("--base is required and must be an origin; --connect defaults to it; numbers are validated", () => {
    assert.throws(() => parseArgs([]), UsageError);
    assert.throws(() => parseArgs(["--base", "http://x.localhost:1/tr"]), /without a path/);
    assert.throws(() => parseArgs(["--base", "nope"]), /not a URL/);
    assert.throws(() => parseArgs(["--base", "http://a.localhost", "--max-pages", "0"]), /integer/);
    assert.throws(() => parseArgs(["--base", "http://a.localhost", "--bogus"]), /Unknown option/);
    assert.throws(() => parseArgs(["--base"]), /needs a value/);
    assert.throws(() => parseArgs(["--help"]), UsageError);
    const options = parseArgs(["--base=http://check.localhost:3660/", "--json", "out.json", "--strict"]);
    assert.deepEqual(
      { base: options.base, connect: options.connect, json: options.json, strict: options.strict, maxPages: options.maxPages, concurrency: options.concurrency },
      { base: "http://check.localhost:3660", connect: "http://check.localhost:3660", json: "out.json", strict: true, maxPages: 2000, concurrency: 4 },
    );
    assert.equal(parseArgs(["--base", "http://check.localhost:3660", "--connect", "http://127.0.0.1:3660"]).connect, "http://127.0.0.1:3660");
  });

  test("the default user agent makes Next send blocking metadata (it matches Next's own HTML-limited bot list)", () => {
    assert.match(DEFAULT_USER_AGENT, HTML_LIMITED_BOT_UA_RE);
  });
});

describe("runAudit against a fixture site", () => {
  let clean: Awaited<ReturnType<typeof audit>>;
  before(async () => {
    clean = await audit(buildSite());
  });

  test("a consistent site passes with no issue at all", () => {
    assert.deepEqual(clean.result.issues, []);
    assert.equal(clean.result.exitCode, 0);
    assert.equal(clean.result.stats.pages, 10, "9 sitemap pages + the feed's ?varyant= link");
    assert.equal(clean.result.stats.indexablePages, 9);
    assert.equal(clean.result.stats.sitemapUrls, 9);
    assert.equal(clean.result.stats.feedItems, 1);
    assert.equal(clean.result.stats.assets, 1);
  });

  test("every request went to --connect with the --base Host header and the audit user agent", () => {
    assert.ok(clean.seen.length > 10);
    assert.ok(clean.seen.every((r) => r.host === BASE_HOST), JSON.stringify(clean.seen.filter((r) => r.host !== BASE_HOST)));
    assert.ok(clean.seen.every((r) => r.userAgent === DEFAULT_USER_AGENT));
    for (const path of ["/robots.txt", "/sitemap.xml", "/feeds/google-merchant.xml", "/", "/tr", "/ar/products/lavanta", "/tr/urunler/lavanta?varyant=11", "/media/urunler/lavanta/lavanta-1024.webp"]) {
      assert.ok(clean.seen.some((r) => r.path === path), `requested ${path}`);
    }
  });

  test("the JSON report carries every page with its facts", () => {
    const report = jsonReport(clean.options, clean.result);
    assert.equal(report.exitCode, 0);
    const home = report.pages.find((p) => p.url === url("/tr"));
    assert.deepEqual({ title: home?.title, indexable: home?.indexable, inSitemap: home?.inSitemap, lang: home?.lang }, { title: TITLES.home.tr, indexable: true, inSitemap: true, lang: "tr" });
    assert.deepEqual(report.pages.find((p) => p.url === url(PATHS.product.tr))?.jsonLdTypes, ["Product"]);
    assert.ok(report.outcomes.some((o) => o.url === `${ORIGIN}/` && o.redirects[0]?.status === 307 && o.finalUrl === url("/tr")));
  });

  test("defects are found: broken link, noindex in the sitemap, off-site redirect; robots-blocked links are never requested", async () => {
    const site = buildSite((kind, locale) =>
      kind === "home" && locale === "tr" ? { body: '<a href="/tr/yok">Yok</a><a href="/tr/hesap/giris">Giriş</a><a href="/tr/eski">Eski</a>' } : {},
    );
    site.redirects.set("/tr/eski", { status: 308, location: "https://example.com/yeni" });
    site.pages.set("/tr/gizli", pageHtml({ robots: "noindex", paths: { tr: "/tr/gizli", en: "/en/gizli", ar: "/ar/gizli" } }));
    site.sitemap.push(`<url><loc>${url("/tr/gizli")}</loc></url>`);
    const { result, seen } = await audit(site);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(codes(result.issues), ["broken-link", "internal-link-redirect", "redirect-external", "sitemap-noindex"]);
    assert.ok(result.issues.some((i) => i.code === "broken-link" && i.url === url("/tr/yok") && /linked from http:\/\/check\.localhost:3580\/tr/.test(i.message)));
    assert.ok(!seen.some((r) => r.path.startsWith("/tr/hesap")), "robots.txt is respected");
    assert.ok(seen.every((r) => r.host === BASE_HOST), "nothing was sent anywhere else");
    assert.equal(result.stats.blocked, 1);
  });

  test("--strict fails on warnings alone; a missing robots.txt, sitemap and feed are errors", async () => {
    const warned = await audit(buildSite((kind, locale) => (kind === "listing" && locale === "en" ? { title: "Products | PRESTİJ" } : {})), { strict: true });
    assert.deepEqual(codes(warned.result.issues), ["title-too-short"]);
    assert.equal(warned.result.exitCode, 1);

    const missing = await audit({ ...buildSite(), missing: new Set(["/robots.txt", "/sitemap.xml", "/feeds/google-merchant.xml"]) });
    assert.equal(missing.result.exitCode, 1);
    for (const code of ["robots-missing", "sitemap-missing", "feed-missing"] as const) assert.ok(codes(missing.result.issues).includes(code), code);
    assert.ok(codes(missing.result.issues).includes("sitemap-missing-page"), "pages reached through links are still checked");

    const notRss = await audit({ ...buildSite(), feed: "<html></html>" });
    assert.ok(codes(notRss.result.issues).includes("feed-invalid"));
  });

  test("--max-pages stops discovery with a warning", async () => {
    const { result } = await audit(buildSite(), { maxPages: 3 });
    assert.ok(result.issues.some((i) => i.code === "crawl-limit"));
    assert.ok(result.stats.pages <= 3);
  });
});
