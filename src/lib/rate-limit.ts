// Rate-limit types, the trusted client IP, and a small in-memory sliding-window limiter.
//
// Since day 4 every request-time limit (order lookup, order placement, coupon guessing, contact form,
// sign-in failures) uses the durable Postgres store in ./rate-limit-store.ts, shared by all instances
// and surviving restarts. The in-memory helpers below stay for unit tests and as `memoryLimitStore`
// (same interface as the DB store) for code that takes a store as a parameter (src/lib/auth-limits.ts).
// Pure (no Next APIs, no DB) so it is unit-tested; request code reads the IP through ./request-ip.ts.

export type RateRule = { limit: number; windowMs: number };
/** One limit to apply: [key, rule]. Keys look like "<area>:<dimension>:<value>", e.g. "order:ip:1.2.3.4". */
export type LimitEntry = readonly [key: string, rule: RateRule];
/** `retryAfterMinutes`: whole minutes until every key allows again (0 when allowed). */
export type LimitDecision = { allowed: boolean; retryAfterMinutes: number };
/** The durable store (rate-limit-store.ts) and `memoryLimitStore` implement this. */
export type LimitStore = {
  /** Counts one attempt against every key that is under its limit; allowed when all keys were. */
  consumeLimits(entries: readonly LimitEntry[], options?: { now?: number }): Promise<LimitDecision>;
  /** Read-only: would the next attempt be allowed? */
  checkLimits(entries: readonly LimitEntry[], options?: { now?: number }): Promise<LimitDecision>;
  /** Forgets every counter of these keys (e.g. failed sign-ins after a successful one). */
  forgetLimits(keys: readonly string[]): Promise<void>;
};

/** Upper bound on tracked keys so a flood of random keys cannot grow memory without limit. */
const MAX_KEYS = 50_000;

type Store = Map<string, number[]>;
const globalStore = globalThis as typeof globalThis & { __prestijRateLimit?: Store };
// Kept on globalThis so dev hot reloads do not reset it.
const store: Store = (globalStore.__prestijRateLimit ??= new Map());

function recent(key: string, rule: RateRule, now: number): number[] {
  const hits = (store.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (hits.length) store.set(key, hits);
  else store.delete(key);
  return hits;
}

/**
 * Whole minutes until `key` may act again under `rule` (0 = allowed now). Pass several keys (e.g. per
 * IP and per e-mail): the longest wait wins.
 */
export function blockedFor(entries: readonly (readonly [key: string, rule: RateRule])[], now = Date.now()): number {
  let waitMs = 0;
  for (const [key, rule] of entries) {
    const hits = recent(key, rule, now);
    if (hits.length >= rule.limit) waitMs = Math.max(waitMs, rule.windowMs - (now - hits[hits.length - rule.limit]));
  }
  return waitMs > 0 ? Math.max(1, Math.ceil(waitMs / 60_000)) : 0;
}

/** Counts one hit against every key. */
export function recordHit(entries: readonly (readonly [key: string, rule: RateRule])[], now = Date.now()): void {
  for (const [key, rule] of entries) {
    const hits = recent(key, rule, now);
    hits.push(now);
    store.delete(key); // re-insert so Map order stays "least recently touched first"
    store.set(key, hits);
  }
  while (store.size > MAX_KEYS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Forgets the counters of these keys (e.g. failed sign-ins after a successful one). */
export function forgetHits(keys: readonly string[]): void {
  for (const key of keys) store.delete(key);
}

/** Test helper: forget every counter. */
export function resetRateLimits(): void {
  store.clear();
}

// ---------------------------------------------------------------------------------------------------
// Sliding-window counter math (used by the durable store; pure so it is unit-tested)

/** The fixed window containing `now` (aligned to the epoch), the previous one, and the previous window's weight. */
export type SlidingWindow = { start: number; prevStart: number; weight: number };

export function slidingWindowAt(now: number, windowMs: number): SlidingWindow {
  const start = Math.floor(now / windowMs) * windowMs;
  return { start, prevStart: start - windowMs, weight: (windowMs - (now - start)) / windowMs };
}

/**
 * Milliseconds until `current + previous × weight < limit` holds again (0 = allowed now), where
 * `current` / `previous` are the counts of the window containing `now` and of the one before.
 */
export function slidingWaitMs(input: { now: number; windowMs: number; limit: number; current: number; previous: number }): number {
  const { now, windowMs: w, limit, current, previous } = input;
  const { start, weight } = slidingWindowAt(now, w);
  if (current + previous * weight < limit) return 0;
  if (current >= limit) {
    // This window is full: in the next one, `current` becomes the weighted previous count.
    return Math.max(1, start + w + Math.ceil(w * (1 - limit / current)) + 1 - now);
  }
  // Only the weighted previous window blocks: wait until enough of it has slid out.
  return Math.max(1, start + Math.ceil(w * (1 - (limit - current) / previous)) + 1 - now);
}

/** The in-memory helpers behind the `LimitStore` interface (per instance; unit tests and fallbacks). */
export const memoryLimitStore: LimitStore = {
  async consumeLimits(entries, { now = Date.now() } = {}) {
    let waitMinutes = 0;
    for (const entry of entries) {
      const blocked = blockedFor([entry], now);
      if (blocked > 0) waitMinutes = Math.max(waitMinutes, blocked);
      else recordHit([entry], now);
    }
    return { allowed: waitMinutes === 0, retryAfterMinutes: waitMinutes };
  },
  async checkLimits(entries, { now = Date.now() } = {}) {
    const waitMinutes = blockedFor(entries, now);
    return { allowed: waitMinutes === 0, retryAfterMinutes: waitMinutes };
  },
  async forgetLimits(keys) {
    forgetHits(keys);
  },
};

/**
 * The client IP from a source the client cannot forge:
 * - `TRUSTED_IP_HEADER` (or `AUTH_IP_HEADER`, shared with Better Auth): a header your reverse proxy
 *   sets, e.g. `x-real-ip`. Its last entry is used (the one the proxy itself added).
 * - On Vercel (`VERCEL` set): `x-vercel-forwarded-for`, which the platform overwrites.
 * - Otherwise the LAST X-Forwarded-For entry: correct behind one appending proxy (nginx
 *   $proxy_add_x_forwarded_for). The first entry is whatever the client sent and is never used.
 *   Without a proxy, `next start` keeps a client-sent X-Forwarded-For, so self-hosted deployments
 *   must set TRUSTED_IP_HEADER.
 */
export function clientIpFrom(h: Pick<Headers, "get">): string {
  const last = (value: string | null | undefined) => value?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  const trusted = process.env.TRUSTED_IP_HEADER || process.env.AUTH_IP_HEADER;
  const ip = trusted ? last(h.get(trusted)) : process.env.VERCEL ? last(h.get("x-vercel-forwarded-for")) : last(h.get("x-forwarded-for")) || h.get("x-real-ip")?.trim();
  return (ip || "unknown").slice(0, 64);
}
