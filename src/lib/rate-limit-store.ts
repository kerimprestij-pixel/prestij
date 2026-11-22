// Durable rate limits in Postgres (table rate_limit_counters), shared by every server instance and
// surviving restarts and deploys. Used by every public form and auth limit.
//
// Algorithm: sliding-window counter. One row per key and fixed window (aligned to the epoch); an
// attempt is allowed while `current + previous × (unelapsed share of the window) < limit`, which
// approximates a true sliding window without storing every hit (no burst of 2 × limit at a window
// boundary). Each consume is ONE atomic statement per key (INSERT … ON CONFLICT DO UPDATE … WHERE),
// so concurrent requests can never let more than `limit` attempts through.
//
// Keys are stored hashed ("<area>:<dimension>:<sha256>"), so the table holds no e-mail address or IP;
// pass the same plain key to consume/check/forget. Rows expire after two windows and are deleted by the
// `ratelimits.prune` job.
import "server-only";
import { createHash } from "node:crypto";
import { and, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Tx } from "@/lib/panel/tx";
import {
  slidingWaitMs,
  slidingWindowAt as windowAt,
  type LimitDecision,
  type LimitEntry,
  type LimitStore,
  type RateRule,
  type SlidingWindow as WindowInfo,
} from "./rate-limit";

export type { LimitDecision, LimitEntry, LimitStore, RateRule } from "./rate-limit";

type Options = { now?: number; executor?: Tx };

const counters = schema.rateLimitCounters;

/** "order:email:a@b.c" → "order:email:<base64url sha256, 32 chars>". The area/dimension stay readable. */
export function storedLimitKey(key: string): string {
  const parts = key.split(":");
  const prefix = parts.length >= 3 ? `${parts[0]}:${parts[1]}`.slice(0, 64) : "key";
  return `${prefix}:${createHash("sha256").update(key).digest("base64url").slice(0, 32)}`;
}

function assertRule(rule: RateRule): void {
  if (!Number.isInteger(rule.limit) || rule.limit < 1 || !Number.isInteger(rule.windowMs) || rule.windowMs < 1000) {
    throw new Error("rate-limit-store: limit must be an integer ≥ 1 and windowMs an integer ≥ 1000");
  }
}

/** Raw `sql` parameters are not mapped by column type: pass instants as ISO strings and cast. */
const iso = (ms: number) => new Date(ms).toISOString();

const toMinutes = (ms: number) => (ms > 0 ? Math.max(1, Math.ceil(ms / 60_000)) : 0);

async function readCounts(executor: Tx, key: string, info: WindowInfo): Promise<{ current: number; previous: number }> {
  const rows = await executor
    .select({ windowStart: counters.windowStart, count: counters.count })
    .from(counters)
    .where(sql`${counters.key} = ${key} and ${counters.windowStart} in (${iso(info.start)}::timestamptz, ${iso(info.prevStart)}::timestamptz)`);
  let current = 0;
  let previous = 0;
  for (const row of rows) {
    if (row.windowStart.getTime() === info.start) current = row.count;
    else previous = row.count;
  }
  return { current, previous };
}

async function consumeOne(executor: Tx, [plainKey, rule]: LimitEntry, now: number): Promise<number> {
  assertRule(rule);
  const key = storedLimitKey(plainKey);
  const info = windowAt(now, rule.windowMs);
  const start = iso(info.start);
  const prevStart = iso(info.prevStart);
  const expiresAt = iso(info.start + 2 * rule.windowMs);
  const rows = await executor.execute<{ count: number }>(sql`
    with prev as (
      select coalesce((select ${counters.count} from ${counters} where ${counters.key} = ${key} and ${counters.windowStart} = ${prevStart}::timestamptz), 0)::float8
        * ${info.weight}::float8 as w
    )
    insert into ${counters} (key, window_start, count, expires_at)
    select ${key}, ${start}::timestamptz, 1, ${expiresAt}::timestamptz from prev where prev.w < ${rule.limit}
    on conflict (key, window_start) do update set count = ${counters.count} + 1
      where ${counters.count} + (select w from prev) < ${rule.limit}
    returning count`);
  if (rows.length > 0) return 0;
  const counts = await readCounts(executor, key, info);
  return Math.max(1, slidingWaitMs({ now, windowMs: rule.windowMs, limit: rule.limit, ...counts }));
}

/**
 * Counts one attempt against each key (one atomic upsert per key). Allowed when every key was under its
 * limit; a key that is already at its limit is not counted further. Use it either as "consume, then act
 * only when allowed" or, after `checkLimits`, to record an outcome (a failed lookup, a placed order).
 */
export async function consumeLimits(entries: readonly LimitEntry[], options: Options = {}): Promise<LimitDecision> {
  const now = options.now ?? Date.now();
  const executor = options.executor ?? db;
  const waits = await Promise.all(entries.map((entry) => consumeOne(executor, entry, now)));
  const waitMs = Math.max(0, ...waits);
  return { allowed: waitMs === 0, retryAfterMinutes: toMinutes(waitMs) };
}

/** Read-only: would the next attempt be allowed? `retryAfterMinutes` is the longest wait of all keys. */
export async function checkLimits(entries: readonly LimitEntry[], options: Options = {}): Promise<LimitDecision> {
  const now = options.now ?? Date.now();
  const executor = options.executor ?? db;
  const waits = await Promise.all(
    entries.map(async ([plainKey, rule]) => {
      assertRule(rule);
      const counts = await readCounts(executor, storedLimitKey(plainKey), windowAt(now, rule.windowMs));
      return slidingWaitMs({ now, windowMs: rule.windowMs, limit: rule.limit, ...counts });
    }),
  );
  const waitMs = Math.max(0, ...waits);
  return { allowed: waitMs === 0, retryAfterMinutes: toMinutes(waitMs) };
}

/** Deletes every window of these keys (e.g. the failed sign-ins of an address after a successful one). */
export async function forgetLimits(keys: readonly string[], options: Pick<Options, "executor"> = {}): Promise<void> {
  if (keys.length === 0) return;
  await (options.executor ?? db).delete(counters).where(inArray(counters.key, keys.map(storedLimitKey)));
}

/** Better Auth's own rate-limit rows (table rate_limit) older than this are stale (its longest window is 1 h). */
const AUTH_ROW_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * For the `ratelimits.prune` job: expired counters and stale Better Auth rate-limit rows. `only`
 * restricts the deletes to the given plain keys / Better Auth keys (tests sharing the database).
 */
export async function pruneRateLimits(
  options: { now?: number; only?: { keys?: readonly string[]; authKeys?: readonly string[] } } = {},
): Promise<{ counters: number; authRows: number }> {
  const now = options.now ?? Date.now();
  const { only } = options;
  const expiredWhere = lt(counters.expiresAt, new Date(now));
  const expired = await db
    .delete(counters)
    .where(only ? and(expiredWhere, inArray(counters.key, (only.keys ?? []).map(storedLimitKey))) : expiredWhere)
    .returning({ key: counters.key });
  const ba = schema.rateLimit;
  const staleWhere = lt(ba.lastRequest, now - AUTH_ROW_MAX_AGE_MS);
  const auth = await db
    .delete(ba)
    .where(only ? and(staleWhere, inArray(ba.key, [...(only.authKeys ?? [])])) : staleWhere)
    .returning({ id: ba.id });
  return { counters: expired.length, authRows: auth.length };
}

/** The durable store behind the `LimitStore` interface (for code that takes a store parameter). */
export const dbLimitStore: LimitStore = {
  consumeLimits: (entries, options) => consumeLimits(entries, options),
  checkLimits: (entries, options) => checkLimits(entries, options),
  forgetLimits: (keys) => forgetLimits(keys),
};
