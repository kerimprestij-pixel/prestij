// Abuse limits for the public quote and sample forms: 5 requests per hour per client IP and 20 per day
// per e-mail address, per form (durable, shared by every instance: @/lib/rate-limit-store). Every valid
// submission counts (gate pattern: consume first, store only when allowed); a submission with field
// errors does not, so a visitor fixing a typo is not penalised. Honeypot hits count against the IP.
import "server-only";
import type { LimitEntry, RateRule } from "@/lib/rate-limit";

export type RequestKind = "quote" | "sample";

export const REQUEST_RULES = {
  ip: { limit: 5, windowMs: 60 * 60_000 },
  email: { limit: 20, windowMs: 24 * 60 * 60_000 },
} as const satisfies Record<string, RateRule>;

/**
 * Site-wide cap on stored requests per form (counted in the table, so it holds across instances and
 * restarts): bounds an inbox flood even when a client rotates IPs and addresses.
 */
export const REQUEST_SITE_RULE = { limit: 30, windowMinutes: 10 } as const;

/** Keys `quote:ip:<ip>`, `quote:email:<e>` (and `sample:…`); e-mails lower-cased. */
export function requestLimitKeys(kind: RequestKind, who: { ip: string; email: string | null }): LimitEntry[] {
  const keys: LimitEntry[] = [[`${kind}:ip:${who.ip}`, REQUEST_RULES.ip]];
  if (who.email) keys.push([`${kind}:email:${who.email.trim().toLowerCase()}`, REQUEST_RULES.email]);
  return keys;
}
