// Scheduled jobs registry. Each area registers its jobs at import time in its own module, and
// src/lib/cron/jobs.ts imports every such module (one line each), so the route handler and the panel
// see all of them. No DB or Next imports here.
//
//   // src/lib/<area>/jobs.ts
//   import { registerJob } from "@/lib/cron/registry";
//   registerJob({ key: "reviews.request", group: "daily", label: "Yorum isteği e-postaları", run: async () => ({ queued: 3 }) });
//
// Rules for `run`: idempotent and safe to run twice (the runner also takes a per-job advisory lock),
// bounded work per call (batches; the next run continues), no Next request APIs, returns counts only
// (`Record<string, number>`; anything else is dropped before it is stored or returned).

export const JOB_GROUPS = ["frequent", "daily"] as const;
export type JobGroup = (typeof JOB_GROUPS)[number];
export type JobCounts = Record<string, number>;

export type JobDefinition = {
  /** "<area>.<action>", e.g. "orders.expire". Also the job_runs primary key. */
  key: string;
  /** "frequent": every few minutes (local cron / pg_cron); "daily": once a day (Vercel Hobby cron). */
  group: JobGroup;
  /** Turkish label for the panel's job status card. */
  label?: string;
  run: () => Promise<JobCounts>;
};

const JOB_KEY = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;

type Registry = Map<string, JobDefinition>;
const globalRegistry = globalThis as typeof globalThis & { __prestijJobs?: Registry };
// On globalThis so a dev hot reload of one job module replaces its entry instead of losing the others.
const jobs: Registry = (globalRegistry.__prestijJobs ??= new Map());

export function isJobGroup(value: unknown): value is JobGroup {
  return typeof value === "string" && (JOB_GROUPS as readonly string[]).includes(value);
}

/** Registers (or replaces, e.g. after a hot reload) a job and returns it. */
export function registerJob(job: JobDefinition): JobDefinition {
  if (!JOB_KEY.test(job.key) || job.key.length > 64) throw new Error(`cron: invalid job key "${job.key}" (use "<area>.<action>")`);
  if (!isJobGroup(job.group)) throw new Error(`cron: invalid group "${String(job.group)}" for ${job.key}`);
  if (typeof job.run !== "function") throw new Error(`cron: job ${job.key} has no run function`);
  jobs.set(job.key, job);
  return job;
}

/** Registered jobs (all, or one group), sorted by key. Import @/lib/cron/jobs first to load every area. */
export function listJobs(group?: JobGroup): JobDefinition[] {
  return [...jobs.values()].filter((job) => !group || job.group === group).sort((a, b) => a.key.localeCompare(b.key));
}

export function getJob(key: string): JobDefinition | null {
  return jobs.get(key) ?? null;
}

/** Tests only: removes a job registered by the test. */
export function unregisterJob(key: string): void {
  jobs.delete(key);
}
