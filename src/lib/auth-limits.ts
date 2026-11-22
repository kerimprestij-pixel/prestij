// Sign-in protection for Better Auth (src/lib/auth.ts) and the HTTP auth route. Pure (no Next, DB or
// Better Auth imports), so it is unit-tested: the counters live in a `LimitStore` passed in by the
// caller (auth.ts passes the durable Postgres store `dbLimitStore`, unit tests `memoryLimitStore`).
//
// Why a per-e-mail limit: Better Auth's own limiter is keyed on the client IP. On a self-hosted
// `next start` without a trusted proxy header, a client can send any X-Forwarded-For (Next keeps it)
// and get a fresh bucket per request. Counting failed sign-ins per e-mail address does not depend on
// the IP, so guessing one account's password stays slow whatever headers the client sends. Trade-off
// (documented on purpose): someone who knows an e-mail can delay that account's sign-in for the
// window; existing sessions are not affected. With the DB store the lock holds across instances.
import type { LimitStore, RateRule } from "./rate-limit";

/** Failed e-mail/password sign-ins allowed per address before further attempts are refused. */
export const SIGN_IN_FAILURE_RULE: RateRule = { limit: 10, windowMs: 15 * 60_000 };

/** Better Auth error code returned (HTTP 429) while an address is locked. */
export const SIGN_IN_LOCKED_CODE = "TOO_MANY_FAILED_SIGN_INS";

export function signInFailureKey(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase().slice(0, 320);
  return normalized ? `auth:sign-in-failure:${normalized}` : null;
}

/** Whole minutes until `email` may try again (0 = allowed now). */
export async function signInLockedMinutes(store: LimitStore, email: unknown, now?: number): Promise<number> {
  const key = signInFailureKey(email);
  if (!key) return 0;
  return (await store.checkLimits([[key, SIGN_IN_FAILURE_RULE]], { now })).retryAfterMinutes;
}

export async function recordSignInFailure(store: LimitStore, email: unknown, now?: number): Promise<void> {
  const key = signInFailureKey(email);
  if (key) await store.consumeLimits([[key, SIGN_IN_FAILURE_RULE]], { now });
}

export async function clearSignInFailures(store: LimitStore, email: unknown): Promise<void> {
  const key = signInFailureKey(email);
  if (key) await store.forgetLimits([key]);
}

/**
 * Better Auth's IP-keyed limits (`rateLimit.customRules`, window in seconds). Stored in the `rate_limit`
 * table (`rateLimit.storage = "database"`), active in production (Better Auth's default).
 */
export const AUTH_RATE_LIMIT_RULES = {
  "/sign-in/email": { window: 60, max: 5 },
  "/sign-up/email": { window: 3600, max: 10 },
  "/request-password-reset": { window: 3600, max: 5 },
} as const satisfies Record<string, { window: number; max: number }>;

/**
 * True for paths of the HTTP auth handler (`/api/auth/[...all]`) that browsers never need. The admin
 * plugin's endpoints (set-role, ban-user, impersonate-user, remove-user, set-user-password, …) are used
 * only in-process through `auth.api.*` by the panel's team actions, which enforce the team rules (no
 * self-demotion, at least one admin) and write the audit log. Over HTTP they would bypass both.
 */
export function isBlockedAuthPath(pathname: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return true; // malformed escapes: refuse rather than guess what the router would make of it
  }
  path = path.toLowerCase().replace(/[\\/]+/g, "/");
  return /\/api\/auth\/admin(?:\/|$)/.test(path);
}

/** Loopback and private ranges: an appending reverse proxy on the same host or LAN. */
export const DEFAULT_TRUSTED_PROXIES = [
  "127.0.0.0/8",
  "::1/128",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "fc00::/7",
  "fe80::/10",
] as const;

type Env = Record<string, string | undefined>;

/**
 * `advanced.ipAddress` for Better Auth's IP-keyed limiter:
 * - `AUTH_IP_HEADER` (or `TRUSTED_IP_HEADER`, shared with src/lib/rate-limit.ts): a header the
 *   reverse proxy overwrites, e.g. `x-real-ip`. Optional `AUTH_TRUSTED_PROXIES` (comma-separated CIDRs).
 * - On Vercel: `x-vercel-forwarded-for` only (the platform overwrites it). Elsewhere that header is
 *   client-controlled, so it is never read.
 * - Otherwise `x-forwarded-for`, read from the right and skipping `AUTH_TRUSTED_PROXIES` (default:
 *   loopback and private ranges). Behind an appending proxy this yields the real client instead of
 *   collapsing two-value headers into one shared bucket. Without any proxy the value is still
 *   client-controlled; the per-e-mail limit above covers that case.
 */
export function authIpAddressOptions(env: Env = process.env): { ipAddressHeaders: string[]; trustedProxies?: string[] } {
  const header = (env.AUTH_IP_HEADER || env.TRUSTED_IP_HEADER || "").trim().toLowerCase();
  const listed = (env.AUTH_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (header) return { ipAddressHeaders: [header], ...(listed.length ? { trustedProxies: listed } : {}) };
  if (env.VERCEL) return { ipAddressHeaders: ["x-vercel-forwarded-for"] };
  return { ipAddressHeaders: ["x-forwarded-for"], trustedProxies: listed.length ? listed : [...DEFAULT_TRUSTED_PROXIES] };
}
