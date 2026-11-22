/**
 * SEO audit: crawls a running PRESTİJ build the way a search engine does and checks what it finds
 * (docs/DAY5-SEO.md §5.8). The rules are pure functions in src/lib/seo/audit/; this file only fetches.
 *
 *   npx tsx scripts/seo-audit.ts --base http://check.localhost:3660 --connect http://127.0.0.1:3660 [--json report.json] [--strict]
 *
 * --base <origin>      The site's canonical origin (what NEXT_PUBLIC_SITE_URL was at build time). Every
 *                      canonical, hreflang, sitemap and JSON-LD URL is compared against it.
 * --connect <origin>   Where requests actually go (default: --base). Use it when the base host does not
 *                      resolve (Node on Windows and *.localhost): requests are sent to this origin with
 *                      the base origin's Host header, so the server still builds base-origin URLs.
 * --json <file>        Write the full report (every issue, page facts, fetch outcomes) as JSON.
 * --strict             Warnings fail the run too (exit code 1).
 * --max-pages <n>      Stop discovering URLs after n (default 2000).
 * --concurrency <n>    Parallel requests (default 4).
 * --timeout <ms>       Per-request timeout (default 30000).
 * --user-agent <ua>    Default identifies as an HTML-limited crawler (it contains "bingbot"), so Next
 *                      sends blocking metadata in <head> as Bing and Yandex get it.
 *
 * What it fetches: /robots.txt, /sitemap.xml (+ Sitemap lines and child sitemaps), the merchant feed,
 * "/", every sitemap URL, every same-origin link found on those pages (except links on URLs with a
 * query string, so filters cannot explode the crawl) and every same-origin URL named by page metadata
 * (canonical, hreflang, og:url, JSON-LD), all only when robots.txt allows them; plus same-origin images
 * named by og:image, JSON-LD, the sitemap and the feed. It never requests another origin: redirects
 * that leave the site are reported, not followed, and external images are skipped.
 *
 * Exit code: 0 = no errors, 1 = errors (with --strict: any issue), 2 = bad arguments.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, resolve } from "node:path";
import { defaultLocale, locales, rtlLocales } from "@/i18n/config";
import { href } from "@/i18n/paths";
import { checkFeed, parseMerchantFeed, type FeedItemFacts } from "@/lib/seo/audit/feed";
import { checkPage, type PageFacts } from "@/lib/seo/audit/page";
import { exitCodeFor, formatSummary, groupIssues, type AuditStats } from "@/lib/seo/audit/report";
import { checkRobots, isAllowed, parseRobotsTxt, rulesFor, type RobotsRule } from "@/lib/seo/audit/robots";
import { checkFeedAgainstSite, checkSite, type FetchOutcome } from "@/lib/seo/audit/site";
import { checkSitemap, parseSitemapXml, type SitemapUrl } from "@/lib/seo/audit/sitemap";
import { issue, type Issue } from "@/lib/seo/audit/types";
import { hasQuery, normalizeOrigin, parseAbsolute, pathAndQuery, withOrigin } from "@/lib/seo/audit/url";
import { MERCHANT_FEED_PATH } from "@/lib/seo/feed-url";

export const DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; PrestijSeoAudit/1.0; bingbot-compatible)";
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const MAX_SITEMAP_FILES = 50;

export type AuditOptions = {
  base: string;
  connect: string;
  json: string | null;
  strict: boolean;
  maxPages: number;
  concurrency: number;
  timeoutMs: number;
  userAgent: string;
};

export class UsageError extends Error {}

const USAGE = "Usage: npx tsx scripts/seo-audit.ts --base <origin> [--connect <origin>] [--json <file>] [--strict] [--max-pages <n>] [--concurrency <n>] [--timeout <ms>] [--user-agent <ua>]";

export function parseArgs(argv: readonly string[]): AuditOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const VALUED = new Set(["base", "connect", "json", "max-pages", "concurrency", "timeout", "user-agent"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new UsageError(`Unexpected argument "${arg}".\n${USAGE}`);
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    if (name === "strict" || name === "help") {
      flags.add(name);
      continue;
    }
    if (!VALUED.has(name)) throw new UsageError(`Unknown option --${name}.\n${USAGE}`);
    const value = inline ?? argv[++i];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`--${name} needs a value.\n${USAGE}`);
    values.set(name, value);
  }
  if (flags.has("help")) throw new UsageError(USAGE);
  const baseRaw = values.get("base");
  if (!baseRaw) throw new UsageError(`--base is required.\n${USAGE}`);
  const origin = (raw: string, name: string) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new UsageError(`--${name} "${raw}" is not a URL.`);
    }
    if (url.pathname !== "/" || url.search || url.hash) throw new UsageError(`--${name} must be an origin without a path ("${url.origin}").`);
    return normalizeOrigin(raw);
  };
  const integer = (name: string, fallback: number, min: number) => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) throw new UsageError(`--${name} must be an integer ≥ ${min}.`);
    return n;
  };
  const base = origin(baseRaw, "base");
  return {
    base,
    connect: values.has("connect") ? origin(values.get("connect") as string, "connect") : base,
    json: values.get("json") ?? null,
    strict: flags.has("strict"),
    maxPages: integer("max-pages", 2000, 1),
    concurrency: integer("concurrency", 4, 1),
    timeoutMs: integer("timeout", 30_000, 1000),
    userAgent: values.get("user-agent") ?? DEFAULT_USER_AGENT,
  };
}

// ---------------------------------------------------------------------------------------------------
// HTTP (node:http, so the Host header can differ from the address we connect to)

type RawResponse = { status: number; headers: http.IncomingHttpHeaders; body: string };

function header(headers: http.IncomingHttpHeaders, name: string): string | null {
  const value = headers[name];
  return Array.isArray(value) ? value.join(", ") : (value ?? null);
}

function request(options: AuditOptions, url: string, withBody: boolean): Promise<RawResponse> {
  const target = new URL(withOrigin(url, options.connect));
  const site = new URL(url);
  const lib = target.protocol === "https:" ? https : http;
  return new Promise((resolvePromise, reject) => {
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: {
          host: site.host,
          "user-agent": options.userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        ...(target.protocol === "https:" ? { servername: site.hostname } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (!withBody) {
          res.destroy();
          resolvePromise({ status, headers: res.headers, body: "" });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            res.destroy(new Error(`response larger than ${MAX_BODY_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolvePromise({ status, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.setTimeout(options.timeoutMs, () => req.destroy(new Error(`timed out after ${options.timeoutMs} ms`)));
    req.on("error", reject);
    req.end();
  });
}

type FollowResult = {
  status: number | null;
  finalUrl: string;
  redirects: { status: number; from: string; to: string }[];
  headers: http.IncomingHttpHeaders;
  body: string;
  error: string | null;
  loop: boolean;
  external: string | null;
};

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

async function fetchFollow(options: AuditOptions, url: string, withBody: boolean): Promise<FollowResult> {
  const redirects: FollowResult["redirects"] = [];
  const seen = new Set([url]);
  let current = url;
  for (;;) {
    let res: RawResponse;
    try {
      res = await request(options, current, withBody);
    } catch (error) {
      return { status: null, finalUrl: current, redirects, headers: {}, body: "", error: error instanceof Error ? error.message : String(error), loop: false, external: null };
    }
    const location = header(res.headers, "location");
    if (!REDIRECT_STATUS.has(res.status) || !location) {
      return { status: res.status, finalUrl: current, redirects, headers: res.headers, body: res.body, error: null, loop: false, external: null };
    }
    const next = new URL(location, current);
    next.hash = "";
    redirects.push({ status: res.status, from: current, to: next.href });
    if (next.origin !== options.base) {
      return { status: res.status, finalUrl: next.href, redirects, headers: res.headers, body: "", error: null, loop: false, external: next.href };
    }
    if (seen.has(next.href) || redirects.length >= MAX_REDIRECTS) {
      return { status: null, finalUrl: next.href, redirects, headers: {}, body: "", error: `redirect loop or more than ${MAX_REDIRECTS} hops`, loop: true, external: null };
    }
    seen.add(next.href);
    current = next.href;
  }
}

async function pool<T>(take: () => T | undefined, worker: (item: T) => Promise<void>, concurrency: number): Promise<void> {
  await new Promise<void>((done, fail) => {
    let active = 0;
    let finished = false;
    const pump = () => {
      if (finished) return;
      for (let item = active < concurrency ? take() : undefined; item !== undefined; item = active < concurrency ? take() : undefined) {
        active += 1;
        worker(item).then(
          () => {
            active -= 1;
            pump();
          },
          (error) => {
            finished = true;
            fail(error);
          },
        );
      }
      if (active === 0 && !finished) {
        finished = true;
        done();
      }
    };
    pump();
  });
}

// ---------------------------------------------------------------------------------------------------
// The audit

export type AuditResult = {
  issues: Issue[];
  stats: AuditStats;
  pages: PageFacts[];
  outcomes: FetchOutcome[];
  sitemap: SitemapUrl[];
  feedItems: FeedItemFacts[];
  exitCode: 0 | 1;
  startedAt: string;
  finishedAt: string;
};

const isHtml = (contentType: string | null) => /text\/html|application\/xhtml\+xml/i.test(contentType ?? "");
const isXml = (contentType: string | null) => /(?:application|text)\/(?:[\w.+-]+\+)?xml/i.test(contentType ?? "");

export async function runAudit(options: AuditOptions, io: { now?: Date; log?: (line: string) => void } = {}): Promise<AuditResult> {
  const now = io.now ?? new Date();
  const log = io.log ?? (() => {});
  const startedAt = new Date().toISOString();
  const { base } = options;
  const issues: Issue[] = [];
  const outcomes = new Map<string, FetchOutcome>();
  const pages = new Map<string, PageFacts>();
  const queue: string[] = [];
  const assets = new Map<string, Set<string>>();
  const externalAssets = new Set<string>();
  let fetched = 0;
  let limited = false;

  // ---- robots.txt
  const robotsUrl = `${base}/robots.txt`;
  let rules: RobotsRule[] = [];
  let sitemapUrls = [`${base}/sitemap.xml`];
  log(`Fetching ${robotsUrl}`);
  const robotsRes = await fetchFollow(options, robotsUrl, true);
  fetched += 1;
  if (robotsRes.status !== 200) {
    issues.push(issue("robots-missing", robotsRes.error ?? `/robots.txt answers ${robotsRes.status}.`, robotsUrl));
  } else {
    const robots = parseRobotsTxt(robotsRes.body);
    rules = rulesFor(robots);
    issues.push(...checkRobots(robots, base, robotsUrl));
    sitemapUrls = [...new Set([...robots.sitemaps.filter((s) => parseAbsolute(s)?.origin === base).map((s) => new URL(s).href), ...sitemapUrls])];
  }
  const allowed = (url: string) => isAllowed(rules, pathAndQuery(url));

  const discover = (raw: string, from: { linkedFrom?: string; namedBy?: string } = {}) => {
    const parsed = parseAbsolute(raw);
    if (!parsed || parsed.origin !== base) return;
    parsed.hash = "";
    const url = parsed.href;
    let outcome = outcomes.get(url);
    if (!outcome) {
      if (outcomes.size >= options.maxPages) {
        limited = true;
        return;
      }
      outcome = { url, blocked: !allowed(url), status: null, finalUrl: null, redirects: [], error: null, contentType: null, linkedFrom: [], namedBy: [] };
      outcomes.set(url, outcome);
      if (!outcome.blocked) queue.push(url);
    }
    if (from.linkedFrom && from.linkedFrom !== url && !outcome.linkedFrom.includes(from.linkedFrom)) outcome.linkedFrom.push(from.linkedFrom);
    if (from.namedBy && from.namedBy !== url && !outcome.namedBy.includes(from.namedBy)) outcome.namedBy.push(from.namedBy);
  };
  const addAsset = (url: string, referrer: string) => {
    const parsed = parseAbsolute(url);
    if (!parsed) return;
    if (parsed.origin !== base) {
      externalAssets.add(parsed.href);
      return;
    }
    assets.set(parsed.href, (assets.get(parsed.href) ?? new Set()).add(referrer));
  };

  // ---- sitemaps (robots Sitemap lines + /sitemap.xml, following sitemap indexes)
  const sitemapEntries = new Map<string, SitemapUrl>();
  const seenSitemaps = new Set<string>();
  const sitemapQueue = [...sitemapUrls];
  while (sitemapQueue.length > 0 && seenSitemaps.size < MAX_SITEMAP_FILES) {
    const url = sitemapQueue.shift() as string;
    if (seenSitemaps.has(url)) continue;
    seenSitemaps.add(url);
    log(`Fetching ${url}`);
    const res = await fetchFollow(options, url, true);
    fetched += 1;
    if (res.status !== 200) {
      issues.push(issue("sitemap-missing", res.error ?? `${url} answers ${res.status}${res.redirects.length ? ` after redirecting to ${res.finalUrl}` : ""}.`, url));
      continue;
    }
    if (res.redirects.length > 0) issues.push(issue("sitemap-missing", `${url} redirects to ${res.finalUrl}; point to the final URL.`, url));
    const contentType = header(res.headers, "content-type");
    if (!isXml(contentType)) issues.push(issue("content-type", `${url} is served as ${contentType ?? "(none)"}, expected application/xml.`, url));
    const parsed = parseSitemapXml(res.body);
    issues.push(...checkSitemap(parsed, base, url, now));
    for (const child of parsed.sitemaps) if (parseAbsolute(child)?.origin === base) sitemapQueue.push(new URL(child).href);
    for (const entry of parsed.urls) if (!sitemapEntries.has(entry.loc)) sitemapEntries.set(entry.loc, entry);
  }
  const sitemap = [...sitemapEntries.values()];

  // ---- merchant feed
  const feedUrl = `${base}${MERCHANT_FEED_PATH}`;
  let feedItems: FeedItemFacts[] = [];
  log(`Fetching ${feedUrl}`);
  const feedRes = await fetchFollow(options, feedUrl, true);
  fetched += 1;
  if (feedRes.status !== 200) {
    issues.push(issue("feed-missing", feedRes.error ?? `${MERCHANT_FEED_PATH} answers ${feedRes.status}.`, feedUrl));
  } else {
    const contentType = header(feedRes.headers, "content-type");
    if (!isXml(contentType) || !/charset=utf-8/i.test(contentType ?? "")) {
      issues.push(issue("feed-content-type", `Served as ${contentType ?? "(none)"}, expected application/xml; charset=utf-8.`, feedUrl));
    }
    const checked = checkFeed(parseMerchantFeed(feedRes.body), { origin: base, feedUrl, now });
    issues.push(...checked.issues);
    feedItems = checked.items;
  }

  // ---- crawl: "/", the sitemap, feed links, then whatever pages link to or name
  discover(`${base}/`);
  for (const entry of sitemap) discover(entry.loc);
  for (const item of feedItems) {
    if (item.link) discover(item.link, { namedBy: feedUrl });
    for (const image of item.images) addAsset(image, `feed item #${item.position}`);
  }
  for (const entry of sitemap) for (const image of entry.images) addAsset(image, `sitemap entry ${entry.loc}`);

  log(`Crawling (${queue.length} URLs queued)`);
  await pool(
    () => queue.shift(),
    async (url) => {
      const outcome = outcomes.get(url) as FetchOutcome;
      const res = await fetchFollow(options, url, true);
      fetched += 1;
      outcome.status = res.status;
      outcome.finalUrl = res.finalUrl;
      outcome.redirects = res.redirects;
      outcome.error = res.error;
      outcome.contentType = header(res.headers, "content-type");
      if (res.error) {
        issues.push(issue(res.loop ? "redirect-loop" : "fetch-failed", `${url}: ${res.error}.`, url));
        return;
      }
      if (res.external) {
        issues.push(issue("redirect-external", `${url} redirects (${res.status}) to ${res.external}.`, url));
        return;
      }
      if (res.redirects.length > 0) {
        // The final URL is checked under its own name (so each page is judged once, without redirects).
        discover(res.finalUrl);
        return;
      }
      if (res.status !== 200) return;
      if (!isHtml(outcome.contentType)) {
        if (sitemapEntries.has(url)) issues.push(issue("content-type", `${url} is in the sitemap but served as ${outcome.contentType ?? "(none)"}.`, url));
        return;
      }
      let checked: ReturnType<typeof checkPage>;
      try {
        checked = checkPage({ url, html: res.body, xRobotsTag: header(res.headers, "x-robots-tag"), origin: base, locales, defaultLocale, rtlLocales, now });
      } catch (error) {
        issues.push(issue("audit-crash", `${url}: ${error instanceof Error ? error.message : String(error)}.`, url));
        return;
      }
      const { issues: pageIssues, facts } = checked;
      pages.set(url, facts);
      issues.push(...pageIssues);
      if (!hasQuery(url)) for (const link of facts.links) discover(link, { linkedFrom: url });
      for (const named of facts.metadataUrls) discover(named, { namedBy: url });
      for (const image of facts.imageUrls) addAsset(image, url);
    },
    options.concurrency,
  );
  if (limited) issues.push(issue("crawl-limit", `Stopped discovering URLs at --max-pages ${options.maxPages}; some pages were not checked.`, base));

  // ---- images named by metadata, the sitemap and the feed
  log(`Checking ${assets.size} images`);
  const assetQueue = [...assets.keys()];
  await pool(
    () => assetQueue.shift(),
    async (url) => {
      const res = await fetchFollow(options, url, false);
      const referrers = [...(assets.get(url) ?? [])];
      const usedBy = `${referrers.slice(0, 3).join(", ")}${referrers.length > 3 ? ` (+${referrers.length - 3} more)` : ""}`;
      const contentType = header(res.headers, "content-type");
      if (res.error || res.status !== 200 || !/^image\//i.test(contentType ?? "")) {
        const what = res.error ?? (res.status !== 200 ? `answers ${res.status}` : `is served as ${contentType ?? "(no content type)"}`);
        issues.push(issue("asset-broken", `${url} ${what}; used by ${usedBy}.`, url));
      } else if (/^image\/avif/i.test(contentType ?? "") && referrers.some((r) => r.startsWith("feed item"))) {
        issues.push(issue("feed-item-invalid", `${url} is AVIF (Merchant Center does not accept it); used by ${usedBy}.`, feedUrl));
      }
    },
    options.concurrency,
  );

  // ---- cross-page rules
  const outcomeList = [...outcomes.values()];
  const pageList = [...pages.values()];
  issues.push(...checkSite({ origin: base, outcomes: outcomeList, pages: pageList, sitemap }));
  if (feedItems.length > 0) {
    issues.push(
      ...checkFeedAgainstSite({ feedUrl, items: feedItems, outcomes: outcomeList, pages: pageList, sitemap, productPathPrefix: `${href(defaultLocale, "products")}/`, origin: base, now }),
    );
  }

  const stats: AuditStats = {
    fetched,
    pages: pageList.length,
    indexablePages: pageList.filter((p) => p.indexable && p.selfCanonical).length,
    blocked: outcomeList.filter((o) => o.blocked).length,
    sitemapUrls: sitemap.length,
    feedItems: feedItems.length,
    assets: assets.size,
    externalAssetsSkipped: externalAssets.size,
  };
  return {
    issues,
    stats,
    pages: pageList,
    outcomes: outcomeList,
    sitemap,
    feedItems,
    exitCode: exitCodeFor(issues, options.strict),
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

/** The --json document: everything, so a reviewer never needs to re-run the crawl to see a detail. */
export function jsonReport(options: AuditOptions, result: AuditResult) {
  return {
    tool: "scripts/seo-audit.ts",
    base: options.base,
    connect: options.connect,
    strict: options.strict,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    exitCode: result.exitCode,
    stats: result.stats,
    summary: groupIssues(result.issues).map((g) => ({ code: g.code, severity: g.severity, title: g.title, count: g.count })),
    issues: result.issues,
    pages: result.pages.map((p) => ({
      url: p.url,
      indexable: p.indexable && p.selfCanonical,
      noindex: p.noindex,
      lang: p.lang,
      dir: p.dir,
      title: p.title,
      description: p.description,
      h1: p.h1,
      canonical: p.canonical,
      hreflang: p.hreflang,
      ogTitle: p.ogTitle,
      ogImage: p.ogImage,
      jsonLdTypes: p.jsonLd.types,
      inSitemap: result.sitemap.some((e) => e.loc === p.url),
    })),
    outcomes: result.outcomes,
    sitemap: result.sitemap,
    feedItems: result.feedItems,
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let options: AuditOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const result = await runAudit(options, { log: (line) => console.error(line) });
  console.log(formatSummary({ base: options.base, connect: options.connect, strict: options.strict, stats: result.stats, issues: result.issues }));
  if (options.json) {
    const file = resolve(options.json);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(jsonReport(options, result), null, 2)}\n`, "utf8");
    console.log(`Full report: ${file}`);
  }
  return result.exitCode;
}

// Run when executed directly (tests import runAudit without running anything).
if (/seo-audit\.ts$/.test(process.argv[1] ?? "")) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : error);
      process.exitCode = 1;
    },
  );
}
