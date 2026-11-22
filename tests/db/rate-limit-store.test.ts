// CORE-DATA against the local PostgreSQL: the durable rate-limit store (src/lib/rate-limit-store.ts) —
// exactly `limit` of 20 parallel consumes allowed, multi-key semantics, read-only checks, window
// rollover with the sliding weight, forget, prune, hashed keys — and Better Auth's
// `rateLimit.storage = "database"` against the `rate_limit` table. Every row it creates is removed.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/rate-limit-store.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, describe, test } from "node:test";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, inArray, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { auth } from "@/lib/auth";
import { AUTH_RATE_LIMIT_RULES } from "@/lib/auth-limits";
import type { LimitEntry } from "@/lib/rate-limit";
import { checkLimits, consumeLimits, forgetLimits, pruneRateLimits, storedLimitKey } from "@/lib/rate-limit-store";

const RUN = randomBytes(4).toString("hex");
/** Every key this file uses starts with this (and is forgotten at the end). */
const key = (name: string) => `coredata-test:${name}:${RUN}`;
const usedKeys = new Set<string>();
const entry = (name: string, limit: number, windowMs: number): LimitEntry => {
  usedKeys.add(key(name));
  return [key(name), { limit, windowMs }];
};
/** Better Auth's limiter keys are "<ip>|<path>"; this file uses addresses from 198.18.0.0/15 (benchmarking). */
const AUTH_IP = `198.18.${Number.parseInt(RUN.slice(0, 2), 16)}.${Number.parseInt(RUN.slice(2, 4), 16)}`;
const c = schema.rateLimitCounters;

async function cleanup() {
  await forgetLimits([...usedKeys]);
  await db.delete(schema.rateLimit).where(like(schema.rateLimit.key, `${AUTH_IP}|%`));
}

after(async () => {
  await cleanup();
  try {
    const left = await db.select({ key: c.key }).from(c).where(inArray(c.key, [...usedKeys].map(storedLimitKey)));
    assert.equal(left.length, 0, "no counter of this file is left");
    assert.equal((await db.select().from(schema.rateLimit).where(like(schema.rateLimit.key, `${AUTH_IP}|%`))).length, 0);
  } finally {
    await db.$client.end();
  }
});

describe("durable rate-limit store", () => {
  test("20 parallel consumes against a limit of 5: exactly 5 are allowed, the counter says 5", async () => {
    const e = entry("parallel", 5, 60 * 60_000);
    const results = await Promise.all(Array.from({ length: 20 }, () => consumeLimits([e])));
    assert.equal(results.filter((r) => r.allowed).length, 5);
    for (const r of results.filter((x) => !x.allowed)) assert.ok(r.retryAfterMinutes >= 1 && r.retryAfterMinutes <= 60, `${r.retryAfterMinutes} min`);
    const rows = await db.select({ count: c.count }).from(c).where(eq(c.key, storedLimitKey(e[0])));
    assert.deepEqual(rows.map((r) => r.count), [5]);
    assert.equal((await checkLimits([e])).allowed, false);
  });

  test("checkLimits is read-only; consume counts every key that has room and is allowed only when all had", async () => {
    const ip = entry("multi-ip", 3, 60_000);
    const mail = entry("multi-mail", 1, 60_000);
    for (let i = 0; i < 5; i++) assert.equal((await checkLimits([ip, mail])).allowed, true, "checks never count");
    assert.deepEqual(await consumeLimits([ip, mail]), { allowed: true, retryAfterMinutes: 0 });
    const second = await consumeLimits([ip, mail]);
    assert.equal(second.allowed, false, "the e-mail key is full");
    assert.ok(second.retryAfterMinutes >= 1);
    const counts = await db.select({ key: c.key, count: c.count }).from(c).where(inArray(c.key, [storedLimitKey(ip[0]), storedLimitKey(mail[0])]));
    const byKey = Object.fromEntries(counts.map((r) => [r.key, r.count]));
    assert.equal(byKey[storedLimitKey(ip[0])], 2, "the IP key had room and counted the attempt");
    assert.equal(byKey[storedLimitKey(mail[0])], 1, "a full key is not counted further");
    assert.deepEqual(await checkLimits([ip]), { allowed: true, retryAfterMinutes: 0 }, "keys are independent");
  });

  test("window rollover: the previous window weighs in, then drops out", async () => {
    const W = 60_000;
    const e = entry("rollover", 3, W);
    const t0 = Date.parse("2026-11-10T08:00:00.000Z"); // a window start (aligned to the epoch)
    for (let i = 0; i < 3; i++) assert.equal((await consumeLimits([e], { now: t0 + i })).allowed, true);
    const blocked = await consumeLimits([e], { now: t0 + 10 });
    assert.deepEqual(blocked, { allowed: false, retryAfterMinutes: 1 });
    // Half-way through the next window the old 3 still count as 1.5: two more attempts fit, the third not.
    const mid = t0 + W + W / 2;
    assert.equal((await consumeLimits([e], { now: mid })).allowed, true);
    assert.equal((await consumeLimits([e], { now: mid + 1 })).allowed, true);
    assert.equal((await consumeLimits([e], { now: mid + 2 })).allowed, false);
    // Two windows on, the window before is empty and nothing of the full one counts: room again.
    assert.equal((await checkLimits([e], { now: t0 + 3 * W })).allowed, true);
    assert.equal((await consumeLimits([e], { now: t0 + 3 * W })).allowed, true);
  });

  test("forgetLimits clears every window of a key", async () => {
    const e = entry("forget", 1, 60_000);
    await consumeLimits([e]);
    assert.equal((await checkLimits([e])).allowed, false);
    await forgetLimits([e[0]]);
    assert.equal((await checkLimits([e])).allowed, true);
    assert.equal((await db.select().from(c).where(eq(c.key, storedLimitKey(e[0])))).length, 0);
  });

  test("keys are stored hashed: no e-mail address or IP in the table", async () => {
    const plain = `contact:email:coredata-test-${RUN}@test.local`;
    usedKeys.add(plain);
    await consumeLimits([[plain, { limit: 5, windowMs: 60_000 }]]);
    const stored = storedLimitKey(plain);
    assert.match(stored, /^contact:email:[A-Za-z0-9_-]{32}$/);
    const rows = await db.select({ key: c.key }).from(c).where(eq(c.key, stored));
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].key.includes("@") && !rows[0].key.includes(RUN));
  });

  test("prune deletes expired counters only", async () => {
    const W = 60_000;
    const old = entry("prune-old", 5, W);
    const fresh = entry("prune-fresh", 5, W);
    await consumeLimits([old], { now: Date.parse("2026-01-01T00:00:00Z") }); // expired long ago
    await consumeLimits([fresh]);
    const result = await pruneRateLimits({ only: { keys: [old[0], fresh[0]], authKeys: [] } });
    assert.deepEqual(result, { counters: 1, authRows: 0 });
    assert.equal((await db.select().from(c).where(eq(c.key, storedLimitKey(old[0])))).length, 0);
    assert.equal((await db.select().from(c).where(eq(c.key, storedLimitKey(fresh[0])))).length, 1);
  });

  test("invalid rules are programming errors", async () => {
    await assert.rejects(consumeLimits([[key("bad"), { limit: 0, windowMs: 60_000 }]]));
    await assert.rejects(checkLimits([[key("bad"), { limit: 1, windowMs: 10 }]]));
  });
});

describe("Better Auth database rate limits", () => {
  test("the app's auth instance stores its limits in the database", () => {
    assert.equal(auth.options.rateLimit?.storage, "database");
    assert.deepEqual(auth.options.rateLimit?.customRules, AUTH_RATE_LIMIT_RULES);
  });

  test("rateLimit storage 'database' works against the rate_limit table: 429 after the limit, one row per ip|path", async () => {
    // Same adapter schema as src/lib/auth.ts, limiter forced on (it is production-only in the app).
    const limited = betterAuth({
      baseURL: "http://coredata-test.localhost",
      database: drizzleAdapter(db, {
        provider: "pg",
        schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, rateLimit: schema.rateLimit },
      }),
      emailAndPassword: { enabled: true },
      rateLimit: { enabled: true, storage: "database", customRules: { "/ok": { window: 60, max: 2 } } },
      advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    });
    const call = () =>
      limited.handler(new Request("http://coredata-test.localhost/api/auth/ok", { headers: { "x-forwarded-for": AUTH_IP } }));
    assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 200);
    const third = await call();
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get("x-retry-after")) > 0);
    const rows = await db.select().from(schema.rateLimit).where(like(schema.rateLimit.key, `${AUTH_IP}|%`));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, `${AUTH_IP}|/ok`);
    assert.equal(rows[0].count, 2);
    assert.equal(typeof rows[0].lastRequest, "number");
    assert.ok(Math.abs(rows[0].lastRequest - Date.now()) < 60_000, "epoch milliseconds");
  });
});
