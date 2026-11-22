// Sitemap XML (urlset with xhtml:link alternates and image:image, or a sitemapindex) parsing and the
// sitemap file rules. Pure. Next's sitemap serializer (resolveSitemap) does not XML-escape values, so
// an unescaped "&" is checked here: it makes the whole file unreadable for search engines.
import { decodeEntities } from "./html";
import { issue, type Issue } from "./types";
import { isForeignLocalUrl, isValidHreflang, parseAbsolute } from "./url";

export type SitemapUrl = {
  loc: string;
  lastmod: string | null;
  alternates: { hreflang: string; href: string }[];
  images: string[];
};

export type ParsedSitemap = {
  kind: "urlset" | "sitemapindex" | "unknown";
  urls: SitemapUrl[];
  /** Child sitemaps of a sitemapindex. */
  sitemaps: string[];
  /** Well-formedness problems found while reading. */
  problems: string[];
};

export const SITEMAP_MAX_URLS = 50_000;

const text = (value: string) => decodeEntities(value.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")).trim();

function firstChild(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i").exec(block);
  return match ? text(match[1]) : null;
}

function attrsOf(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? "");
  return attrs;
}

export function parseSitemapXml(xml: string): ParsedSitemap {
  const problems: string[] = [];
  const withoutCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const badAmp = withoutCdata.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g);
  if (badAmp) problems.push(`${badAmp.length} unescaped "&" (must be written &amp;)`);
  const badLt = withoutCdata.match(/<(?![a-zA-Z/?!])/g);
  if (badLt) problems.push(`${badLt.length} unescaped "<"`);

  const kind = /<urlset[\s>]/.test(xml) ? "urlset" : /<sitemapindex[\s>]/.test(xml) ? "sitemapindex" : "unknown";
  if (kind === "unknown") problems.push("no <urlset> or <sitemapindex> root element");
  if (kind === "urlset" && !/xmlns\s*=\s*["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/.test(xml)) {
    problems.push('urlset without xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  }

  const urls: SitemapUrl[] = [];
  if (kind === "urlset") {
    for (const match of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url\s*>/gi)) {
      const block = match[1];
      const loc = firstChild(block, "loc");
      if (loc === null) {
        problems.push("<url> without <loc>");
        continue;
      }
      const alternates = [...block.matchAll(/<xhtml:link\b([^>]*?)\/?>/gi)]
        .map((m) => attrsOf(m[1]))
        .filter((a) => (a.rel ?? "").toLowerCase() === "alternate")
        .map((a) => ({ hreflang: (a.hreflang ?? "").trim(), href: (a.href ?? "").trim() }));
      const images = [...block.matchAll(/<image:image\b[^>]*>([\s\S]*?)<\/image:image\s*>/gi)].map((m) => firstChild(m[1], "image:loc") ?? "");
      urls.push({ loc, lastmod: firstChild(block, "lastmod"), alternates, images });
    }
  }
  const sitemaps: string[] = [];
  if (kind === "sitemapindex") {
    for (const match of xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap\s*>/gi)) {
      const loc = firstChild(match[1], "loc");
      if (loc) sitemaps.push(loc);
    }
  }
  return { kind, urls, sitemaps, problems };
}

/** W3C Datetime (the sitemap lastmod format): YYYY, YYYY-MM, YYYY-MM-DD or a full date-time with a zone. */
export function isW3cDatetime(value: string): boolean {
  return /^\d{4}(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?)?)?$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Rules for one sitemap file: XML, locs, duplicates, lastmod, alternates, images. */
export function checkSitemap(sitemap: ParsedSitemap, origin: string, sitemapUrl: string, now: Date = new Date()): Issue[] {
  const issues: Issue[] = [];
  for (const problem of sitemap.problems) issues.push(issue("sitemap-invalid", problem, sitemapUrl));
  if (sitemap.kind === "urlset" && sitemap.urls.length === 0) issues.push(issue("sitemap-empty", "The urlset has no <url>.", sitemapUrl));
  if (sitemap.urls.length > SITEMAP_MAX_URLS) {
    issues.push(issue("sitemap-invalid", `${sitemap.urls.length} URLs (a sitemap may list at most ${SITEMAP_MAX_URLS}).`, sitemapUrl));
  }
  for (const child of sitemap.sitemaps) {
    if (parseAbsolute(child)?.origin !== origin) issues.push(issue("sitemap-loc-invalid", `Child sitemap ${child} is not on ${origin}.`, sitemapUrl));
  }

  const seen = new Set<string>();
  const soon = now.getTime() + 24 * 60 * 60 * 1000;
  for (const entry of sitemap.urls) {
    const loc = parseAbsolute(entry.loc);
    if (!loc || loc.origin !== origin) {
      issues.push(issue("sitemap-loc-invalid", `<loc>${entry.loc}</loc> is not an absolute URL on ${origin}.`, sitemapUrl));
      if (isForeignLocalUrl(entry.loc, origin)) issues.push(issue("foreign-origin-url", `Sitemap lists ${entry.loc}.`, sitemapUrl));
    }
    if (seen.has(entry.loc)) issues.push(issue("sitemap-duplicate", `${entry.loc} is listed more than once.`, sitemapUrl));
    seen.add(entry.loc);

    if (entry.lastmod !== null) {
      if (!isW3cDatetime(entry.lastmod)) issues.push(issue("sitemap-lastmod-invalid", `${entry.loc}: lastmod "${entry.lastmod}" is not a W3C date.`, sitemapUrl));
      else if (Date.parse(entry.lastmod) > soon) issues.push(issue("sitemap-lastmod-invalid", `${entry.loc}: lastmod ${entry.lastmod} is in the future.`, sitemapUrl));
    }

    const langs = new Map<string, string>();
    for (const alt of entry.alternates) {
      const href = parseAbsolute(alt.href);
      if (!isValidHreflang(alt.hreflang)) issues.push(issue("hreflang-invalid", `Sitemap entry ${entry.loc}: hreflang "${alt.hreflang}" is not a language code.`, sitemapUrl));
      if (!href || href.origin !== origin) issues.push(issue("hreflang-invalid", `Sitemap entry ${entry.loc}: alternate ${alt.hreflang} → "${alt.href}" is not an absolute URL on ${origin}.`, sitemapUrl));
      const key = alt.hreflang.toLowerCase();
      if (langs.has(key) && langs.get(key) !== alt.href) issues.push(issue("hreflang-invalid", `Sitemap entry ${entry.loc}: hreflang "${alt.hreflang}" points to two URLs.`, sitemapUrl));
      langs.set(key, alt.href);
    }
    if (entry.alternates.length > 0 && !entry.alternates.some((a) => a.href === entry.loc)) {
      issues.push(issue("hreflang-self-missing", `Sitemap entry ${entry.loc}: its alternates do not include the URL itself.`, sitemapUrl));
    }

    for (const image of entry.images) {
      if (!parseAbsolute(image)) issues.push(issue("sitemap-image-invalid", `${entry.loc}: image "${image}" is not an absolute URL.`, sitemapUrl));
      else if (isForeignLocalUrl(image, origin)) issues.push(issue("foreign-origin-url", `${entry.loc}: sitemap image ${image}.`, sitemapUrl));
    }
  }
  return issues;
}
