// CORE-DATA against the local PostgreSQL: the cron framework (src/lib/cron/**) — the per-job advisory
// lock (two runs at once → one skipped), job_runs bookkeeping, errors caught per job without their
// message, counts-only results, the /api/cron handler (401 / 404 / 200, timing-safe secret check), the
// core job registrations and the cart / verification prune helpers on rows of this file only.
// Only test jobs run here: the real groups would touch other agents' rows. Every row it creates is removed.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/cron.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { pruneExpiredCarts, pruneExpiredVerifications } from "@/lib/cron/core-jobs";
import { handleCronRequest, isAuthorizedCronRequest } from "@/lib/cron/handler";
import { scheduleOpportunisticOrderExpiry } from "@/lib/cron/opportunistic";
import { getJob, listJobs, registerJob, unregisterJob, type JobDefinition } from "@/lib/cron/registry";
import { listJobStatus, loadJobs, runJob, runJobs, sanitizeCounts, type JobGroupOutcome } from "@/lib/cron/run";

const RUN = randomBytes(3).toString("hex");
const JOB_PREFIX = `test.coredata${RUN}`;
const SECRET = `coredata-test-cron-secret-${RUN}`;
const runs = schema.jobRuns;
const testJobs: string[] = [];
const cartIds: string[] = [];
const verificationIds: string[] = [];

function testJob(name: string, run: JobDefinition["run"]): JobDefinition {
  const job = registerJob({ key: `${JOB_PREFIX}.${name}`, group: "frequent", label: `Test ${name}`, run });
  testJobs.push(job.key);
  return job;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const runRow = async (key: string) => (await db.select().from(runs).where(eq(runs.job, key)))[0];

after(async () => {
  for (const key of testJobs) unregisterJob(key);
  try {
    await db.delete(runs).where(like(runs.job, `${JOB_PREFIX}.%`));
    if (cartIds.length) await db.delete(schema.carts).where(inArray(schema.carts.id, cartIds));
    if (verificationIds.length) await db.delete(schema.verification).where(inArray(schema.verification.id, verificationIds));
    assert.equal((await db.select().from(runs).where(like(runs.job, `${JOB_PREFIX}.%`))).length, 0);
  } finally {
    await db.$client.end();
  }
});

describe("advisory lock and job_runs", () => {
  test("two runs of the same job at once: one runs, the other is skipped; job_runs records the run", async () => {
    let calls = 0;
    const job = testJob("slow", async () => {
      calls++;
      await sleep(400);
      return { processed: 3, note: "dropped" as unknown as number };
    });
    const [a, b] = await Promise.all([runJob(job), runJob(job)]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ["ok", "skipped"]);
    assert.equal(calls, 1, "the job body ran once");
    const ok = a.status === "ok" ? a : b;
    assert.deepEqual(ok.result, { processed: 3 }, "counts only");
    const row = await runRow(job.key);
    assert.equal(row.lastStatus, "ok", "the finished run is the last word");
    assert.equal(row.runCount, 1);
    assert.deepEqual(row.lastResult, { processed: 3 });
    assert.equal(row.lastError, null);
    assert.ok(row.lastStartedAt && row.lastFinishedAt && row.lastFinishedAt >= row.lastStartedAt);

    // Once the lock is released the next run goes through.
    const again = await runJob(job);
    assert.equal(again.status, "ok");
    assert.equal((await runRow(job.key)).runCount, 2);
  });

  test("a skipped attempt is recorded as such while the other run is in progress", async () => {
    const job = testJob("skip-visible", async () => {
      await sleep(400);
      return {};
    });
    const first = runJob(job);
    await sleep(150);
    const second = await runJob(job);
    assert.equal(second.status, "skipped");
    assert.equal((await runRow(job.key)).lastStatus, "skipped");
    assert.equal((await first).status, "ok");
    assert.equal((await runRow(job.key)).lastStatus, "ok");
  });

  test("errors are caught per job: recorded without the message, the next job still runs", async () => {
    const failing = testJob("failing", async () => {
      throw new TypeError("secret detail: customer@example.com");
    });
    const fine = testJob("fine", async () => ({ done: 1 }));
    const outcomes = await runJobs([failing, fine]);
    assert.deepEqual(
      outcomes.map((o) => [o.key, o.status]),
      [
        [failing.key, "error"],
        [fine.key, "ok"],
      ],
    );
    assert.equal(outcomes[0].result, undefined);
    const row = await runRow(failing.key);
    assert.equal(row.lastStatus, "error");
    assert.equal(row.lastError, "TypeError");
    assert.ok(!JSON.stringify(row).includes("example.com"), "no error message stored");
  });

  test("sanitizeCounts keeps finite numbers under short keys only", () => {
    assert.deepEqual(sanitizeCounts({ a: 1, b: Number.NaN, c: "2", "bad key": 3, d: Infinity, e: -4 }), { a: 1, e: -4 });
    assert.deepEqual(sanitizeCounts(null), {});
    assert.deepEqual(sanitizeCounts([1, 2]), {});
    assert.equal(Object.keys(sanitizeCounts(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i])))).length, 20);
  });
});

describe("registry", () => {
  test("the core jobs are registered in their groups", async () => {
    await loadJobs();
    for (const [key, group] of [
      ["orders.expire", "frequent"],
      ["carts.prune", "daily"],
      ["ratelimits.prune", "daily"],
      ["auth.prune", "daily"],
    ] as const) {
      assert.equal(getJob(key)?.group, group, key);
    }
    assert.ok(listJobs("daily").every((j) => j.group === "daily"));
    const status = await listJobStatus();
    assert.ok(status.some((s) => s.key === "orders.expire" && s.label.length > 0));
  });

  test("invalid definitions throw", () => {
    assert.throws(() => registerJob({ key: "NoDot", group: "daily", run: async () => ({}) }));
    assert.throws(() => registerJob({ key: "a.b", group: "hourly" as "daily", run: async () => ({}) }));
  });
});

describe("/api/cron handler", () => {
  const request = (headers: Record<string, string> = {}) => new Request("http://coredata.localhost/api/cron/frequent", { headers });
  const fakeRun = async (group: "frequent" | "daily"): Promise<JobGroupOutcome> => ({
    group,
    ok: true,
    jobs: [{ key: "orders.expire", status: "ok", durationMs: 12, result: { expired: 2 } }],
  });

  test("401 without a valid Bearer secret (missing header, wrong secret, wrong scheme, server without secret)", async () => {
    let ran = false;
    const runGroup = async (group: "frequent" | "daily") => ((ran = true), fakeRun(group));
    for (const [headers, secret] of [
      [{}, SECRET],
      [{ authorization: `Bearer ${SECRET}x` }, SECRET],
      [{ authorization: SECRET }, SECRET],
      [{ authorization: `Basic ${SECRET}` }, SECRET],
      [{ authorization: "Bearer " }, undefined],
      [{ authorization: "Bearer undefined" }, undefined],
      [{ authorization: "Bearer short" }, "short"],
    ] as const) {
      const res = await handleCronRequest(request(headers), "frequent", { runGroup, secret });
      assert.equal(res.status, 401, JSON.stringify(headers));
      assert.deepEqual(await res.json(), { error: "unauthorized" });
    }
    assert.equal(ran, false, "nothing ran");
  });

  test("404 for an unknown group (only after the secret check)", async () => {
    const ok = await handleCronRequest(request({ authorization: `Bearer ${SECRET}` }), "hourly", { runGroup: fakeRun, secret: SECRET });
    assert.equal(ok.status, 404);
    const anon = await handleCronRequest(request(), "hourly", { runGroup: fakeRun, secret: SECRET });
    assert.equal(anon.status, 401);
  });

  test("200 with statuses and counts only; no-store", async () => {
    const res = await handleCronRequest(request({ authorization: `Bearer ${SECRET}` }), "daily", { runGroup: fakeRun, secret: SECRET });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { group: "daily", ok: true, jobs: { "orders.expire": { status: "ok", durationMs: 12, result: { expired: 2 } } } });
  });

  test("a failed job makes the response 500 without any error text", async () => {
    const failing = async (group: "frequent" | "daily"): Promise<JobGroupOutcome> => ({
      group,
      ok: false,
      jobs: [{ key: "x.y", status: "error", durationMs: 1 }],
    });
    const res = await handleCronRequest(request({ authorization: `Bearer ${SECRET}` }), "frequent", { runGroup: failing, secret: SECRET });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { group: "frequent", ok: false, jobs: { "x.y": { status: "error", durationMs: 1 } } });
  });

  test("the secret comparison is exact", () => {
    assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET), true);
    assert.equal(isAuthorizedCronRequest(`bearer ${SECRET}`, SECRET), false);
    assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET} `, SECRET), false);
    assert.equal(isAuthorizedCronRequest(null, SECRET), false);
    assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET}`, undefined), false);
  });

  test("the route module exports GET and POST", async () => {
    const route = await import("@/app/api/cron/[group]/route");
    assert.equal(typeof route.GET, "function");
    assert.equal(typeof route.POST, "function");
    // Through the real route function: no Authorization → 401 before any job runs.
    const res = await route.GET(request(), { params: Promise.resolve({ group: "frequent" }) });
    assert.equal(res.status, 401);
  });
});

describe("core job helpers (rows of this file only)", () => {
  test("carts.prune deletes carts expired for more than a day, with their items; newer ones stay", async () => {
    const now = new Date("2001-01-10T12:00:00Z"); // far in the past: only this file's carts are older
    const oldId = randomUUID();
    const recentId = randomUUID();
    cartIds.push(oldId, recentId);
    await db.insert(schema.carts).values([
      { id: oldId, locale: "tr", expiresAt: new Date("2001-01-08T12:00:00Z") },
      { id: recentId, locale: "tr", expiresAt: new Date("2001-01-10T00:00:00Z") }, // expired < 1 day ago: kept
    ]);
    const result = await pruneExpiredCarts(now);
    assert.equal(result.deleted, 1);
    const left = await db.select({ id: schema.carts.id }).from(schema.carts).where(inArray(schema.carts.id, [oldId, recentId]));
    assert.deepEqual(left.map((r) => r.id), [recentId]);
  });

  test("auth.prune deletes expired verification rows only", async () => {
    const expiredId = `coredata-test-${RUN}-expired`;
    const validId = `coredata-test-${RUN}-valid`;
    verificationIds.push(expiredId, validId);
    await db.insert(schema.verification).values([
      { id: expiredId, identifier: `coredata-test-${RUN}`, value: "x", expiresAt: new Date("2001-01-01T00:00:00Z") },
      { id: validId, identifier: `coredata-test-${RUN}`, value: "y", expiresAt: new Date("2001-01-03T00:00:00Z") },
    ]);
    const result = await pruneExpiredVerifications(new Date("2001-01-02T00:00:00Z"));
    assert.equal(result.deleted, 1);
    const left = await db.select({ id: schema.verification.id }).from(schema.verification).where(inArray(schema.verification.id, [expiredId, validId]));
    assert.deepEqual(left.map((r) => r.id), [validId]);
  });

  test("the opportunistic orders.expire does nothing outside a request scope", () => {
    assert.equal(scheduleOpportunisticOrderExpiry(), false);
    assert.equal(scheduleOpportunisticOrderExpiry(), false, "and does not start the 5-minute throttle");
  });
});
