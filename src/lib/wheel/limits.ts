// Durable per-IP limits of the gift wheel (rate_limit_counters, src/lib/rate-limit-store.ts):
//   wheel:ip:<address>        3 spins / 24 h   (the spin route, through spinWheel; lead decision D13)
//   wheel-claim:ip:<address>  3 claims / 24 h  (claimWheel, sign-in, sign-up, the unverified sign-in bind)
// <address> = wheelLimitAddress(ip) (./limit-address.ts, D13): an IPv6 address counts by its /64 prefix,
// an IPv4-mapped IPv6 address as its IPv4 address, IPv4 as it is. Only these two keys do that: the other
// areas' per-IP limits keep the plain IP.
// Both are ALWAYS counted on the executor of the transaction that is already open (day 6 FIX, SEC-1):
// counting them on the shared pool while a transaction holds a pooled connection needs a second
// connection, and enough concurrent spins or claims then wait for each other forever (pool deadlock).
// A rolled-back spin/bind also rolls back its count. No Next APIs: callers pass the IP.
import "server-only";
import type { Tx } from "@/lib/panel/tx";
import { consumeLimits, type LimitDecision } from "@/lib/rate-limit-store";
import { wheelLimitAddress } from "./limit-address";
import { WHEEL_RATE_LIMITS } from "./types";

export { wheelLimitAddress } from "./limit-address";

/** Durable key of the per-IP claim limit (3 per 24 h); kept apart from the spin limit `wheel:ip:<address>`. */
export const wheelClaimLimitKey = (ip: string) => `wheel-claim:ip:${wheelLimitAddress(ip)}`;
/** Durable key of the per-IP spin limit (3 per 24 h, D13). */
export const wheelSpinLimitKey = (ip: string) => `wheel:ip:${wheelLimitAddress(ip)}`;

/**
 * Consumes one claim from the durable per-IP claim limit on `executor` (the caller's transaction or
 * savepoint, never the shared pool); false when the limit is reached.
 */
export type ClaimLimiter = (executor: Tx) => Promise<boolean>;

/** A limiter that consumes one claim of `ip` on the executor it is given. */
export function wheelClaimLimiter(ip: string): ClaimLimiter {
  return async (executor) => (await consumeLimits([[wheelClaimLimitKey(ip), WHEEL_RATE_LIMITS.claimsPerIp]], { executor })).allowed;
}

/** Consumes one spin of `ip` on `executor` (the spin's own transaction). */
export function consumeWheelSpinLimit(executor: Tx, ip: string): Promise<LimitDecision> {
  return consumeLimits([[wheelSpinLimitKey(ip), WHEEL_RATE_LIMITS.spinsPerIp]], { executor });
}
