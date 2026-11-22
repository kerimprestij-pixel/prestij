// IndexNow (Bing, Yandex and the other IndexNow engines): tell them which sitemap URLs changed.
// Pure: no DB, no Next APIs, no network of its own. `fetch` and the data readers are injected, so the
// unit tests never reach the network; src/lib/seo/jobs.ts wires the real ones into the daily job
// `seo.indexnow`, and src/app/indexnow-key.txt/route.ts serves the key file.
//
// Protocol (https://www.indexnow.org/documentation, read 2026-11-10): POST JSON
// { host, key, keyLocation, urlList } to https://api.indexnow.org/indexnow, at most 10,000 URLs per
// request, every URL on `host`; 200 = submitted, 202 = received (key check pending), 400/403/422/429 =
// rejected. The key file (UTF-8 text containing the key) lives at /indexnow-key.txt, the site root, so it
// covers every URL of the host.
//
// The job does nothing (result `skipped` + a reason count) unless NODE_ENV is "production", INDEXNOW_KEY
// is set and valid, and the site origin is not a local one. It submits the sitemap URLs whose
// lastModified is at or after the previous successful submission (`checkedAt`, stored in the job's
// last result); without one (first run, or the last run failed or was skipped) it submits them all.
import { siteOrigin } from "@/i18n/paths";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** Where the key file is served (src/app/indexnow-key.txt/route.ts). */
export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";
/** IndexNow keys: 8–128 characters of a–z, A–Z, 0–9 and "-". */
export const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
export const INDEXNOW_MAX_URLS_PER_REQUEST = 10_000;
/** The job's key in job_runs and on the panel's job card. */
export const INDEXNOW_JOB_KEY = "seo.indexnow";
const REQUEST_TIMEOUT_MS = 15_000;

/** The configured key (INDEXNOW_KEY, trimmed) when it is valid, else null. Never log it. */
export function readIndexNowKey(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const key = (env.INDEXNOW_KEY ?? "").trim();
  return INDEXNOW_KEY_PATTERN.test(key) ? key : null;
}

/** Absolute URL of the key file: `"https://prestij.com.tr/indexnow-key.txt"`. */
export function indexNowKeyUrl(origin: string = siteOrigin()): string {
  return `${origin.replace(/\/+$/, "")}${INDEXNOW_KEY_PATH}`;
}

/** True for origins search engines cannot reach: localhost, *.localhost, *.test, loopback, private and link-local IPs, or not http(s). */
export function isLocalOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return true;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return true;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.includes(":")) {
    // IPv6: loopback, unspecified, IPv4-mapped, link-local (fe80::/10) and unique local (fc00::/7).
    return host === "::1" || host === "::" || host.startsWith("::ffff:") || /^fe[89ab]/.test(host) || /^f[cd]/.test(host);
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".test") || host.endsWith(".local")) return true;
  if (!host.includes(".")) return true; // single-label names ("server", "intranet")
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

export type IndexNowSkipReason = "notProduction" | "noKey" | "localOrigin";

/** Why the job must not submit anything right now, or null when it may. */
export function indexNowSkipReason(input: { nodeEnv: string | undefined; key: string | null; origin: string }): IndexNowSkipReason | null {
  if (input.nodeEnv !== "production") return "notProduction";
  if (!input.key) return "noKey";
  if (isLocalOrigin(input.origin)) return "localOrigin";
  return null;
}

/** A sitemap entry as the job needs it (MetadataRoute.Sitemap entries fit). */
export type IndexNowEntry = { url: string; lastModified?: string | Date };

/**
 * URLs of the entries changed at or after `sinceMs` (all of them when `sinceMs` is null), on `origin`
 * only, without duplicates, in sitemap order. An entry without a readable lastModified counts as changed
 * only when everything is submitted.
 */
export function changedUrls(entries: readonly IndexNowEntry[], sinceMs: number | null, origin: string): string[] {
  const base = origin.replace(/\/+$/, "");
  const out = new Set<string>();
  for (const entry of entries) {
    if (!entry.url.startsWith(`${base}/`) && entry.url !== base) continue;
    if (sinceMs != null) {
      const at = entry.lastModified instanceof Date ? entry.lastModified.getTime() : Date.parse(entry.lastModified ?? "");
      if (!Number.isFinite(at) || at < sinceMs) continue;
    }
    out.add(entry.url);
  }
  return [...out];
}

export type IndexNowPayload = { host: string; key: string; keyLocation: string; urlList: string[] };

/** The JSON body of one submission. */
export function indexNowPayload(origin: string, key: string, urls: readonly string[]): IndexNowPayload {
  return { host: new URL(origin).host, key, keyLocation: indexNowKeyUrl(origin), urlList: [...urls] };
}

export type FetchLike = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number }>;

/**
 * POSTs the URLs in batches of 10,000. Resolves with the number of requests; throws when IndexNow
 * answers anything but 200/202 (the job then records an error and the next run submits everything).
 */
export async function submitIndexNow(urls: readonly string[], options: { origin: string; key: string; fetch: FetchLike }): Promise<number> {
  let requests = 0;
  for (let i = 0; i < urls.length; i += INDEXNOW_MAX_URLS_PER_REQUEST) {
    const batch = urls.slice(i, i + INDEXNOW_MAX_URLS_PER_REQUEST);
    const response = await options.fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(indexNowPayload(options.origin, options.key, batch)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    requests++;
    if (response.status !== 200 && response.status !== 202) throw new Error(`IndexNow answered HTTP ${response.status}`);
  }
  return requests;
}

/** The previous run's stored counts as the job left them (job_runs.last_status / last_result). */
export type IndexNowLastRun = { status: string | null; result: Record<string, number> | null } | null;

/** Epoch ms of the last successful submission (`checkedAt` of an ok run that submitted), else null. */
export function lastCheckedAt(last: IndexNowLastRun): number | null {
  if (!last || last.status !== "ok" || !last.result) return null;
  const { checkedAt, submitted } = last.result;
  return typeof submitted === "number" && typeof checkedAt === "number" && Number.isFinite(checkedAt) && checkedAt > 0 ? checkedAt * 1000 : null;
}

export type IndexNowDeps = {
  /** process.env (NODE_ENV, INDEXNOW_KEY). */
  env: Readonly<Record<string, string | undefined>>;
  origin: string;
  fetch: FetchLike;
  /** The sitemap entries (buildSitemap over fresh data). */
  loadEntries: () => Promise<readonly IndexNowEntry[]>;
  /** The job's previous run (before this one finishes). */
  loadLastRun: () => Promise<IndexNowLastRun>;
  now?: () => number;
};

/**
 * One run of `seo.indexnow`. Counts only (job_runs keeps them): `{ skipped: 1, <reason>: 1 }` when it
 * must not submit; otherwise `{ submitted, requests, checkedAt }` (checkedAt = run start, epoch seconds,
 * the next run's starting point).
 */
export async function runIndexNow(deps: IndexNowDeps): Promise<Record<string, number>> {
  const key = readIndexNowKey(deps.env);
  const reason = indexNowSkipReason({ nodeEnv: deps.env.NODE_ENV, key, origin: deps.origin });
  if (reason || !key) return { skipped: 1, [reason ?? "noKey"]: 1 };

  const startedAt = Math.floor((deps.now ?? Date.now)() / 1000);
  const [entries, last] = await Promise.all([deps.loadEntries(), deps.loadLastRun()]);
  const urls = changedUrls(entries, lastCheckedAt(last), deps.origin);
  const requests = urls.length ? await submitIndexNow(urls, { origin: deps.origin, key, fetch: deps.fetch }) : 0;
  return { submitted: urls.length, requests, checkedAt: startedAt };
}
