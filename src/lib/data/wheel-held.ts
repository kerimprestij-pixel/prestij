// The account's held gift wheel spin for the /hesap card (lead decision D15, day 6 follow-up): a prize the
// signed-in account won but has not taken yet stays visible and claimable on the account page, during the
// campaign and after its end (within the hold), even though the storefront teaser is gone by then. A
// module of its own (not src/lib/data/wheel.ts) so the locale layout's teaser reader keeps its small import
// graph: only the account page imports the wheel services through here.
import "server-only";
import { db } from "@/db";
import type { LocalizedText, WheelPrizeSnapshot } from "@/db/schema";
import type { Tx } from "@/lib/panel/tx";
import { findAccountHeldSpin, holdUntilOf, readWheelConfig } from "@/lib/wheel/service";

export type AccountHeldSpin = {
  spinId: number;
  /** The prize as it was when the wheel stopped (label, type, value, minimum basket). */
  prize: WheelPrizeSnapshot;
  /** ISO end of the unclaimed hold (frozen at spin time): the "claim until" date. */
  holdUntil: string;
  /** How long the prize is valid once claimed (hours; the claim uses the same setting). */
  validityHours: number;
  /** The heavy-parcel surcharge is on (a free-shipping prize says it is not included). */
  heavySurcharge: boolean;
  /** The panel's text for the claim button (giftWheel.texts.claimCta), else null (the dictionary's). */
  claimCta: LocalizedText | null;
};

/**
 * The held, unclaimed spin the /hesap card offers to claim for `userId` at `now`: bound to the account,
 * inside its frozen hold, the wheel switched on and the account still eligible by the rules claimWheel
 * uses (findAccountHeldSpin, by the account, no cookie). Null otherwise. Uncached and read-only (the
 * configuration is read fresh, like the spin route and the claim do).
 */
export async function queryAccountHeldSpin(executor: Tx, userId: string, now: Date): Promise<AccountHeldSpin | null> {
  if (!userId) return null;
  const config = await readWheelConfig(executor);
  if (!config.wheel.enabled) return null;
  const held = await findAccountHeldSpin(executor, { config, userId, now });
  if (!held) return null;
  return {
    spinId: held.id,
    prize: held.prize,
    holdUntil: holdUntilOf(held, config.wheel).toISOString(),
    validityHours: config.wheel.validityHours,
    heavySurcharge: config.heavySurcharge,
    claimCta: config.wheel.texts.claimCta ?? null,
  };
}

/** queryAccountHeldSpin on the shared client (the account page). */
export function getAccountHeldSpin(userId: string, now: Date): Promise<AccountHeldSpin | null> {
  return queryAccountHeldSpin(db as unknown as Tx, userId, now);
}
