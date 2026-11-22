// The profile's "E-bültene abone ol" (setMarketingAction in ./actions.ts) without the request APIs (FIX F11): the
// action keeps the session, the rate limit and the cache refresh; this core decides inside the caller's transaction.
// No Next APIs: tests/db/salesready-fix.test.ts runs it in a rolled-back transaction.
//
// Newsletter off (settings.newsletter.enabled = false, until İYS): "closed", nothing written, no mail. On: the
// double opt-in starts (subscribeNewsletter: a pending row and a confirmation mail, or "already active"), and the
// profile's state is read back in the same transaction.
import "server-only";
import { isNewsletterEnabled, subscribeNewsletter } from "@/lib/newsletter/service";
import type { Tx } from "@/lib/panel/tx";
import { marketingState, type MarketingState } from "./service";

export type ProfileSubscribeOutcome =
  | { ok: true; state: MarketingState }
  /** closed: the newsletter is off (the profile says "şu an kapalı"); refused: the service did not accept the address. */
  | { ok: false; reason: "closed" | "refused" };

export async function profileMarketingSubscribe(
  tx: Tx,
  input: { email: string; locale: string; ip: string | null; marketingConsent: boolean },
  options: { now?: Date } = {},
): Promise<ProfileSubscribeOutcome> {
  if (!(await isNewsletterEnabled(tx))) return { ok: false, reason: "closed" };
  const result = await subscribeNewsletter(tx, { email: input.email, locale: input.locale, source: "profile", ip: input.ip }, options);
  if (!result.ok) return { ok: false, reason: result.reason === "disabled" ? "closed" : "refused" };
  return { ok: true, state: await marketingState(tx, { email: input.email, marketingConsent: input.marketingConsent }) };
}
