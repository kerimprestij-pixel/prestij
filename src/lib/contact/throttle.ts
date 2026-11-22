// Abuse limits for the public contact form: 5 messages per hour per client IP and 20 per day per
// e-mail address. Only stored messages (and honeypot hits) count, so a visitor fixing a typo is not
// penalised. Counters are durable and shared by all instances (@/lib/rate-limit-store).
import "server-only";
import type { LimitEntry, RateRule } from "@/lib/rate-limit";
import { checkLimits, consumeLimits } from "@/lib/rate-limit-store";

/**
 * Site-wide cap on stored messages (counted in contact_messages, so it holds across instances and
 * restarts): bounds an inbox flood even when a client rotates IPs and e-mail addresses (a self-hosted
 * server without TRUSTED_IP_HEADER cannot trust the client IP).
 */
export const CONTACT_SITE_RULE = { limit: 50, windowMinutes: 10 } as const;

export const CONTACT_RULES = {
  ip: { limit: 5, windowMs: 60 * 60_000 },
  email: { limit: 20, windowMs: 24 * 60 * 60_000 },
} as const satisfies Record<string, RateRule>;

type Who = { ip: string; email: string | null };

export function contactLimitKeys({ ip, email }: Who): LimitEntry[] {
  const keys: LimitEntry[] = [[`contact:ip:${ip}`, CONTACT_RULES.ip]];
  if (email) keys.push([`contact:email:${email.trim().toLowerCase()}`, CONTACT_RULES.email]);
  return keys;
}

/** Whole minutes until this IP / e-mail may send again (0 = allowed now). */
export async function contactBlockedFor(who: Who, now?: number): Promise<number> {
  return (await checkLimits(contactLimitKeys(who), { now })).retryAfterMinutes;
}

/** Counts one sent message (or honeypot hit) against the IP and, when known, the e-mail. */
export async function recordContactHit(who: Who, now?: number): Promise<void> {
  await consumeLimits(contactLimitKeys(who), { now });
}
