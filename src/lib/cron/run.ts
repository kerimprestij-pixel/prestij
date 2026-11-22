// Runs scheduled jobs: one transaction-scoped advisory lock per job (a second run of the same job at
// the same time is skipped, across every server instance), a job_runs row per job, errors caught per
// job. Called by /api/cron/[group], the panel's "run now" and the opportunistic orders.expire.
import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { JobRunStatus } from "@/db/schema";
import { safeErrorInfo } from "@/lib/db-errors";
import { getJob, listJobs, type JobCounts, type JobDefinition, type JobGroup } from "./registry";

/** First key of pg_try_advisory_xact_lock(int, int); the second is hashtext(job key). */
const LOCK_NAMESPACE = 0x50524a42; // "PRJB"
const MAX_RESULT_KEYS = 20;
const RESULT_KEY = /^[A-Za-z0-9_.-]{1,40}$/;

export type JobOutcome = {
  key: string;
  status: JobRunStatus;
  durationMs: number;
  /** Counts returned by the job (ok only). */
  result?: JobCounts;
};

export type JobGroupOutcome = { group: JobGroup; ok: boolean; jobs: JobOutcome[] };

const runs = schema.jobRuns;

/** Keeps only finite numbers under short keys: job_runs and the cron response hold counts, never data. */
export function sanitizeCounts(value: unknown): JobCounts {
  const out: JobCounts = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, count] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_RESULT_KEYS) break;
    if (RESULT_KEY.test(key) && typeof count === "number" && Number.isFinite(count)) out[key] = count;
  }
  return out;
}

/** Error class, SQLSTATE and constraint only: messages can carry query parameters (personal data). */
function describeError(error: unknown): string {
  const info = safeErrorInfo(error);
  return [info.name, info.code, info.constraint].filter(Boolean).join(" ").slice(0, 200) || "Error";
}

async function recordStart(key: string): Promise<void> {
  await db
    .insert(runs)
    .values({ job: key, lastStartedAt: sql`now()` })
    .onConflictDoUpdate({ target: runs.job, set: { lastStartedAt: sql`now()` } });
}

async function recordFinish(key: string, status: "ok" | "error", result: JobCounts | null, error: string | null): Promise<void> {
  await db
    .update(runs)
    .set({ lastFinishedAt: sql`now()`, lastStatus: status, lastResult: result, lastError: error, runCount: sql`${runs.runCount} + 1` })
    .where(eq(runs.job, key));
}

async function recordSkip(key: string): Promise<void> {
  await db
    .insert(runs)
    .values({ job: key, lastStatus: "skipped" })
    .onConflictDoUpdate({ target: runs.job, set: { lastStatus: "skipped" } });
}

/**
 * Runs one job under its advisory lock. Never throws: a failing job is recorded (`error`) and logged
 * with its key and error class only; a job already running elsewhere returns `skipped`.
 *
 * The lock is transaction-scoped (pg_try_advisory_xact_lock), so it also works through a transaction
 * pooler (Supabase :6543) and is released by Postgres if the process dies. The lock transaction stays
 * open (idle) while the job runs on other pool connections.
 */
export async function runJob(job: JobDefinition): Promise<JobOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  try {
    return await db.transaction(async (lockTx) => {
      const [lock] = await lockTx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${LOCK_NAMESPACE}::int, hashtext(${job.key})) as locked`,
      );
      if (!lock?.locked) {
        await recordSkip(job.key);
        return { key: job.key, status: "skipped" as const, durationMs: elapsed() };
      }
      await recordStart(job.key);
      try {
        const result = sanitizeCounts(await job.run());
        await recordFinish(job.key, "ok", result, null);
        return { key: job.key, status: "ok" as const, durationMs: elapsed(), result };
      } catch (error) {
        const reason = describeError(error);
        console.error(`[cron] job ${job.key} failed`, reason);
        await recordFinish(job.key, "error", null, reason);
        return { key: job.key, status: "error" as const, durationMs: elapsed() };
      }
    });
  } catch (error) {
    // The lock transaction or the job_runs bookkeeping failed (e.g. the database is unreachable).
    console.error(`[cron] job ${job.key} could not run`, describeError(error));
    return { key: job.key, status: "error", durationMs: elapsed() };
  }
}

/** Runs the given jobs one after another (each with its own lock). */
export async function runJobs(jobs: readonly JobDefinition[]): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  for (const job of jobs) outcomes.push(await runJob(job));
  return outcomes;
}

/**
 * Loads every area's jobs (src/lib/cron/jobs.ts). Dynamic on purpose: job modules import services that
 * may import runJob themselves (placeOrder → orders.expire), and a static import would make a cycle.
 */
export async function loadJobs(): Promise<void> {
  await import("./jobs");
}

/** Runs every job of a group (the cron route). `ok` is false when any job failed. */
export async function runJobGroup(group: JobGroup): Promise<JobGroupOutcome> {
  await loadJobs();
  const jobs = await runJobs(listJobs(group));
  return { group, ok: jobs.every((j) => j.status !== "error"), jobs };
}

/** "Run now" from the panel (the caller checks the admin role). Null for an unknown key. */
export async function runJobNow(key: string): Promise<JobOutcome | null> {
  await loadJobs();
  const job = getJob(key);
  return job ? runJob(job) : null;
}

export type JobStatus = {
  key: string;
  group: JobGroup;
  label: string;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastStatus: JobRunStatus | null;
  lastResult: JobCounts | null;
  lastError: string | null;
  runCount: number;
  /** Started and not finished yet (within the last hour; an older start is treated as crashed). */
  running: boolean;
};

/** Every registered job with its last run, for the panel's status card. */
export async function listJobStatus(): Promise<JobStatus[]> {
  await loadJobs();
  const rows = await db.select().from(runs);
  const byKey = new Map(rows.map((r) => [r.job, r]));
  const hourAgo = Date.now() - 60 * 60_000;
  return listJobs().map((job) => {
    const row = byKey.get(job.key);
    const startedAt = row?.lastStartedAt ?? null;
    const finishedAt = row?.lastFinishedAt ?? null;
    return {
      key: job.key,
      group: job.group,
      label: job.label ?? job.key,
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
      lastStatus: row?.lastStatus ?? null,
      lastResult: row?.lastResult ?? null,
      lastError: row?.lastError ?? null,
      runCount: row?.runCount ?? 0,
      running: !!startedAt && startedAt.getTime() > hourAgo && (!finishedAt || finishedAt < startedAt),
    };
  });
}
