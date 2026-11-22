// Basic brute-force throttling for the order lookup form (order number + e-mail).
//
// How it works: failed lookups are counted in a sliding window, separately per client IP and per
// (order number, client IP). Once a counter reaches its limit, further attempts for that key are
// refused (with one generic "too many attempts" message) until enough failures leave the window.
// A successful lookup never counts.
// - The IP key stops one client from walking through order numbers with a known e-mail.
// - The order-number key is scoped to the client on purpose: a global per-order counter let anyone
//   lock the real owner out of their own order with a handful of wrong guesses.
// The IP comes from a trusted source (clientIpFrom in @/lib/rate-limit): never the client-sent first
// X-Forwarded-For entry. Counters are durable and shared by all instances (@/lib/rate-limit-store).
import "server-only";
import type { LimitEntry, RateRule } from "@/lib/rate-limit";
import { checkLimits, consumeLimits } from "@/lib/rate-limit-store";

export const LOOKUP_RULES = {
  ip: { limit: 8, windowMs: 15 * 60_000 },
  order: { limit: 5, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateRule>;

type LookupWho = { ip: string; orderNumber: string | null };

export function lookupLimitKeys(input: LookupWho): LimitEntry[] {
  const keys: LimitEntry[] = [[`lookup:ip:${input.ip}`, LOOKUP_RULES.ip]];
  if (input.orderNumber) keys.push([`lookup:order:${input.orderNumber}:${input.ip}`, LOOKUP_RULES.order]);
  return keys;
}

/**
 * Is this client (or this client on this order number) currently blocked? Returns the whole minutes
 * until the next attempt is allowed, or 0 when the lookup may proceed.
 */
export async function lookupBlockedFor(input: LookupWho, now?: number): Promise<number> {
  return (await checkLimits(lookupLimitKeys(input), { now })).retryAfterMinutes;
}

/** Records a failed lookup against the client and the (order number, client) pair. */
export async function recordLookupFailure(input: LookupWho, now?: number): Promise<void> {
  await consumeLimits(lookupLimitKeys(input), { now });
}
