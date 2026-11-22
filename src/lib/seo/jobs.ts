// seo.indexnow (daily): submits the sitemap URLs changed since the last successful submission to
// IndexNow (Bing, Yandex, …). Loaded by src/lib/cron/jobs.ts. The logic is pure and unit-tested in
// src/lib/seo/indexnow.ts; this module wires the real data: a fresh (uncached) read of the sitemap
// records, the enabled locales, the job's previous run, and the global fetch. It skips itself (counts
// `skipped` + reason) outside production, without INDEXNOW_KEY, or on a local origin.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { siteOrigin } from "@/i18n/paths";
import { registerJob } from "@/lib/cron/registry";
import { querySitemapData } from "@/lib/data/sitemap";
import { parseSettings } from "@/lib/settings/types";
import { INDEXNOW_JOB_KEY, runIndexNow, type IndexNowDeps, type IndexNowLastRun } from "./indexnow";
import { buildSitemap } from "./sitemap-entries";

/** The enabled storefront locales, read uncached (the job runs outside any page cache). */
async function enabledLocales(): Promise<string[]> {
  const [row] = await db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "locales")).limit(1);
  return parseSettings("locales", row?.value).enabled;
}

/** The job's previous run. runJob only stamps last_started_at before calling run, so status/result are still the previous run's. */
async function lastRun(): Promise<IndexNowLastRun> {
  const runs = schema.jobRuns;
  const [row] = await db.select({ status: runs.lastStatus, result: runs.lastResult }).from(runs).where(eq(runs.job, INDEXNOW_JOB_KEY)).limit(1);
  return row ? { status: row.status ?? null, result: row.result ?? null } : null;
}

/** The real dependencies (exported for the DB test, which swaps `fetch` and `env`). */
export function indexNowDeps(overrides: Partial<IndexNowDeps> = {}): IndexNowDeps {
  return {
    env: process.env,
    origin: siteOrigin(),
    fetch: (url, init) => fetch(url, init),
    loadEntries: async () => {
      const [data, locales] = await Promise.all([querySitemapData(), enabledLocales()]);
      return buildSitemap(data, locales);
    },
    loadLastRun: lastRun,
    ...overrides,
  };
}

export const seoIndexNowJob = registerJob({
  key: INDEXNOW_JOB_KEY,
  group: "daily",
  label: "IndexNow bildirimi (Bing, Yandex)",
  run: () => runIndexNow(indexNowDeps()),
});
