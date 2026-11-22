// Cross-page rules: sitemap ↔ pages, duplicate titles/descriptions, hreflang reciprocity and targets,
// canonical targets, broken and redirecting internal links, and the merchant feed against the pages.
// Pure: it judges what the crawler collected.
import { effectivePrice, sameAvailability, type FeedItemFacts } from "./feed";
import type { PageFacts } from "./page";
import type { SitemapUrl } from "./sitemap";
import { issue, type Issue } from "./types";
import { primaryLanguage } from "./url";

export type FetchOutcome = {
  /** Requested URL (on the audited origin). */
  url: string;
  /** Disallowed by robots.txt: not fetched. */
  blocked: boolean;
  /** Final status after same-origin redirects; null when the request failed or was not made. */
  status: number | null;
  /** URL that finally answered (equals `url` without redirects). */
  finalUrl: string | null;
  redirects: { status: number; from: string; to: string }[];
  error: string | null;
  contentType: string | null;
  /** Pages whose <a href> points here. */
  linkedFrom: string[];
  /** Pages whose metadata (canonical, hreflang, og:url, JSON-LD) names this URL. */
  namedBy: string[];
};

export type SiteInput = {
  origin: string;
  outcomes: readonly FetchOutcome[];
  /** Facts of every HTML page that answered 200, keyed by its final URL. */
  pages: readonly PageFacts[];
  sitemap: readonly SitemapUrl[];
};

const list = (urls: readonly string[], max = 5) => `${urls.slice(0, max).join(", ")}${urls.length > max ? ` (+${urls.length - max} more)` : ""}`;

/** Why `url` is not a good target for a canonical/hreflang, or null when it is. */
function targetProblem(url: string, outcomes: Map<string, FetchOutcome>, pages: Map<string, PageFacts>): string | null {
  const outcome = outcomes.get(url);
  if (!outcome) return null; // not crawled (crawl limit): nothing to say
  if (outcome.blocked) return "is disallowed by robots.txt";
  if (outcome.status === null) return null; // fetch-failed is reported on its own
  if (outcome.redirects.length > 0) return `redirects to ${outcome.finalUrl}`;
  if (outcome.status !== 200) return `answers ${outcome.status}`;
  const page = pages.get(url);
  if (!page) return null; // not HTML
  if (page.noindex) return "is noindex";
  if (page.canonical && !page.selfCanonical) return `has its canonical on ${page.canonical}`;
  return null;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x) ?? x;
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string) {
    this.parent.set(this.find(a), this.find(b));
  }
}

function duplicates(pages: readonly PageFacts[], pick: (p: PageFacts) => string | null, codes: { cross: "title-duplicate" | "description-duplicate"; same: "title-untranslated" | "description-untranslated" }, what: string): Issue[] {
  const issues: Issue[] = [];
  const groups = new Map<string, PageFacts[]>();
  for (const page of pages) {
    const value = pick(page)?.trim().toLowerCase();
    if (value) groups.set(value, [...(groups.get(value) ?? []), page]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const urls = new Set(group.map((p) => p.url));
    const uf = new UnionFind();
    for (const page of group) for (const href of Object.values(page.hreflang)) if (urls.has(href) && href !== page.url) uf.union(page.url, href);
    const clusters = new Map<string, string[]>();
    for (const page of group) clusters.set(uf.find(page.url), [...(clusters.get(uf.find(page.url)) ?? []), page.url]);
    const text = pick(group[0]) ?? "";
    if (clusters.size > 1) {
      issues.push(issue(codes.cross, `${group.length} pages share the ${what} "${text}": ${list(group.map((p) => p.url), 10)}.`, group[0].url));
    }
    for (const members of clusters.values()) {
      if (members.length > 1) issues.push(issue(codes.same, `The ${what} "${text}" is the same in ${members.length} language versions: ${list(members, 10)}.`, members[0]));
    }
  }
  return issues;
}

export function checkSite(input: SiteInput): Issue[] {
  const issues: Issue[] = [];
  const outcomes = new Map(input.outcomes.map((o) => [o.url, o]));
  const pages = new Map(input.pages.map((p) => [p.url, p]));
  const sitemapLocs = new Set(input.sitemap.map((e) => e.loc));

  // ---- sitemap URLs must be crawlable, 200, indexable and canonical
  for (const entry of input.sitemap) {
    const outcome = outcomes.get(entry.loc);
    if (!outcome) continue;
    if (outcome.blocked) {
      issues.push(issue("sitemap-url-blocked", `${entry.loc} is in the sitemap but robots.txt disallows it.`, entry.loc));
      continue;
    }
    if (outcome.status === null) continue;
    if (outcome.redirects.length > 0) issues.push(issue("sitemap-url-redirect", `${entry.loc} redirects (${outcome.redirects[0].status}) to ${outcome.finalUrl}; list the final URL.`, entry.loc));
    else if (outcome.status !== 200) issues.push(issue("sitemap-url-not-200", `${entry.loc} answers ${outcome.status}.`, entry.loc));
    const page = outcome.redirects.length === 0 ? pages.get(entry.loc) : undefined;
    if (!page) continue;
    if (page.noindex) issues.push(issue("sitemap-noindex", `${entry.loc} is in the sitemap but noindex.`, entry.loc));
    else if (page.canonical && !page.selfCanonical) issues.push(issue("sitemap-non-canonical", `${entry.loc} is in the sitemap but its canonical is ${page.canonical}.`, entry.loc));

    if (entry.alternates.length > 0 && Object.keys(page.hreflang).length > 0) {
      const fromSitemap = Object.fromEntries(entry.alternates.map((a) => [a.hreflang.toLowerCase(), a.href]));
      const keys = [...new Set([...Object.keys(fromSitemap), ...Object.keys(page.hreflang)])].sort();
      const diffs = keys.filter((k) => fromSitemap[k] !== page.hreflang[k]).map((k) => `${k}: sitemap ${fromSitemap[k] ?? "(none)"} / page ${page.hreflang[k] ?? "(none)"}`);
      if (diffs.length > 0) issues.push(issue("sitemap-alternates-mismatch", `${entry.loc}: ${diffs.join("; ")}.`, entry.loc));
    }
  }

  // ---- indexable pages the sitemap forgot
  for (const page of input.pages) {
    if (!page.indexable || !page.selfCanonical || sitemapLocs.has(page.url)) continue;
    const outcome = outcomes.get(page.url);
    if (outcome && outcome.redirects.length > 0) continue;
    const from = outcome?.linkedFrom ?? [];
    issues.push(issue("sitemap-missing-page", `${page.url} is indexable but not in the sitemap${from.length ? ` (linked from ${list(from, 3)})` : ""}. Add it, or mark it noindex.`, page.url));
  }

  // ---- duplicate titles and descriptions among pages that can appear in search
  const searchable = input.pages.filter((p) => p.indexable && p.selfCanonical);
  issues.push(...duplicates(searchable, (p) => p.title, { cross: "title-duplicate", same: "title-untranslated" }, "title"));
  issues.push(...duplicates(searchable, (p) => p.description, { cross: "description-duplicate", same: "description-untranslated" }, "meta description"));

  // ---- hreflang: targets must be good pages in that language and link back
  for (const page of searchable) {
    const own = page.locale ?? (page.lang ? primaryLanguage(page.lang) : null);
    for (const [key, href] of Object.entries(page.hreflang)) {
      if (href === page.url) continue;
      const problem = targetProblem(href, outcomes, pages);
      if (problem) {
        issues.push(issue("hreflang-target-bad", `hreflang ${key} → ${href} ${problem}.`, page.url));
        continue;
      }
      if (key === "x-default") continue;
      const target = pages.get(href);
      if (!target) continue;
      const targetLang = target.locale ?? (target.lang ? primaryLanguage(target.lang) : null);
      if (targetLang && targetLang !== primaryLanguage(key)) issues.push(issue("hreflang-target-bad", `hreflang ${key} → ${href}, which is a "${targetLang}" page.`, page.url));
      if (!own || Object.keys(target.hreflang).length === 0) continue;
      const back = Object.entries(target.hreflang).find(([k]) => k !== "x-default" && primaryLanguage(k) === own);
      if (!back || back[1] !== page.url) {
        issues.push(issue("hreflang-not-reciprocal", `${href} (hreflang ${key}) does not link back: its ${own} alternate is ${back ? back[1] : "missing"}.`, page.url));
      }
    }
  }

  // ---- canonical targets of pages that point elsewhere (query variants, duplicates)
  for (const page of input.pages) {
    if (!page.canonical || page.selfCanonical || !page.canonical.startsWith(`${input.origin}/`)) continue;
    const problem = targetProblem(page.canonical, outcomes, pages);
    if (problem) issues.push(issue("canonical-target-bad", `Canonical ${page.canonical} ${problem}.`, page.url));
  }

  // ---- internal links and URLs named by metadata
  for (const outcome of input.outcomes) {
    if (outcome.redirects.length > 1) issues.push(issue("redirect-chain", `${outcome.redirects.length} hops: ${[outcome.url, ...outcome.redirects.map((r) => `${r.status} → ${r.to}`)].join(" ")}.`, outcome.url));
    if (outcome.blocked || outcome.status === null) continue;
    if (outcome.status >= 400) {
      if (outcome.linkedFrom.length > 0) issues.push(issue("broken-link", `${outcome.url} answers ${outcome.status}; linked from ${list(outcome.linkedFrom)}.`, outcome.url));
      else if (outcome.namedBy.length > 0) issues.push(issue("broken-link", `${outcome.url} answers ${outcome.status}; named in the metadata of ${list(outcome.namedBy)}.`, outcome.url));
    } else if (outcome.redirects.length > 0 && outcome.linkedFrom.length > 0) {
      issues.push(issue("internal-link-redirect", `${outcome.url} → ${outcome.finalUrl} (${outcome.redirects.map((r) => r.status).join(", ")}); linked from ${list(outcome.linkedFrom)}.`, outcome.url));
    }
  }
  return issues;
}

export type FeedSiteInput = {
  feedUrl: string;
  items: readonly FeedItemFacts[];
  outcomes: readonly FetchOutcome[];
  pages: readonly PageFacts[];
  sitemap: readonly SitemapUrl[];
  /** Path prefix of product pages in the feed's language, e.g. "/tr/urunler/". */
  productPathPrefix: string;
  origin: string;
  now: Date;
};

/** The feed against the crawled site: links work, products are indexable, prices/availability match the pages. */
export function checkFeedAgainstSite(input: FeedSiteInput): Issue[] {
  const issues: Issue[] = [];
  const outcomes = new Map(input.outcomes.map((o) => [o.url, o]));
  const pages = new Map(input.pages.map((p) => [p.url, p]));
  const sitemapLocs = new Set(input.sitemap.map((e) => e.loc));
  const productsInFeed = new Set<string>();

  for (const item of input.items) {
    const label = `item #${item.position}${item.id ? ` (g:id ${item.id})` : ""}`;
    if (item.link) {
      const outcome = outcomes.get(item.link);
      if (outcome && outcome.status !== null && outcome.status !== 200) issues.push(issue("feed-link-broken", `${label}: ${item.link} answers ${outcome.status}.`, input.feedUrl));
    }
    if (!item.productUrl) continue;
    productsInFeed.add(item.productUrl);
    if (!sitemapLocs.has(item.productUrl)) issues.push(issue("feed-item-not-in-sitemap", `${label}: ${item.productUrl} is not in the sitemap (inactive, noindex or a sample?).`, input.feedUrl));

    const page = pages.get(item.productUrl);
    if (!page || !item.id) continue;
    const group = page.jsonLd.groups.find((g) => g.skus.includes(item.id as string));
    if (group && item.itemGroupId && group.id !== item.itemGroupId) {
      issues.push(issue("feed-group-mismatch", `${label}: g:item_group_id ${item.itemGroupId}, but the page's ProductGroup id is ${group.id} (use one id in both so Google ties the listing to the page).`, input.feedUrl));
    }
    if (page.jsonLd.offers.length === 0) continue;
    const offers = page.jsonLd.offers.filter((o) => o.sku === item.id);
    if (offers.length === 0) {
      issues.push(issue("feed-item-recommended", `${label}: the product page's JSON-LD has no Offer with sku ${item.id} (Merchant Center matches the landing page by it).`, input.feedUrl));
      continue;
    }
    const price = effectivePrice(item, input.now);
    const offer = offers[0];
    if (price && offer.price !== null && (Math.abs(offer.price - price.value) > 0.005 || (offer.currency && offer.currency !== price.currency))) {
      issues.push(issue("feed-price-mismatch", `${label}: feed price ${price.value.toFixed(2)} ${price.currency}, page ${offer.price.toFixed(2)} ${offer.currency ?? ""} (${item.productUrl}).`, input.feedUrl));
    }
    if (item.availability && offer.availability && !sameAvailability(item.availability, offer.availability)) {
      issues.push(issue("feed-price-mismatch", `${label}: feed availability ${item.availability}, page ${offer.availability} (${item.productUrl}).`, input.feedUrl));
    }
  }

  const prefix = `${input.origin}${input.productPathPrefix}`;
  for (const entry of input.sitemap) {
    const rest = entry.loc.startsWith(prefix) ? entry.loc.slice(prefix.length) : null;
    if (rest && !rest.includes("/") && !productsInFeed.has(entry.loc)) {
      issues.push(issue("feed-product-missing", `${entry.loc} is in the sitemap but has no feed item.`, input.feedUrl));
    }
  }
  return issues;
}
