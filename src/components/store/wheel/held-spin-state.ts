// What the /hesap held-spin card (AccountHeldSpinCard, lead decision D15) does with a refused claim and
// with the end of the spin's hold (pure: unit-tested). Type-only imports, so the client card can use it
// without pulling zod or the wheel services into the account page's chunk.
import type { WheelErrorCode } from "@/lib/wheel/types";

/** The id of the prize card's heading on /hesap (AccountWheelCard); the held card moves focus there after a refresh. */
export const ACCOUNT_WHEEL_HEADING_ID = "account-wheel";

/**
 * Refusals after which the offer will not come back by trying again now (the button goes), as the dialog's
 * LASTING list: the wheel was switched off or its campaign is not running, the account may no longer take
 * part, the spin was claimed or ran out meanwhile, or this connection's claim limit is used up. Other
 * errors (network, a server problem, a lost session) keep the button for a retry.
 */
export const HELD_CARD_FINAL_ERRORS: readonly WheelErrorCode[] = [
  "disabled",
  "not_started",
  "ended",
  "staff",
  "business",
  "has_ordered",
  "already_claimed",
  "claim_limit",
  "no_spin",
  "spin_expired",
];

/**
 * The server loaded this card's spin as held, and claims stay possible within the hold also after the
 * campaign end (D8). So these refusals mean the spin is no longer held, which in practice is the end of its
 * hold: the card says the result expired instead of "you have not spun yet" or "the campaign ended".
 */
const HOLD_OVER_ERRORS: readonly WheelErrorCode[] = ["no_spin", "ended", "not_started", "spin_expired"];

export type HeldCardRefusal = {
  /** The button goes for good. */
  final: boolean;
  /** The offer itself is gone: the "waiting for you" lines go too (claim_limit keeps them: the spin is still held). */
  offerGone: boolean;
  /** Show the hold-expiry text ("Çark sonucunun süresi doldu.") instead of the server's message. */
  expired: boolean;
  /** Claimed elsewhere (another tab or device): re-render the overview, whose prize card shows the code. */
  refresh: boolean;
};

export function heldCardRefusal(code: string): HeldCardRefusal {
  const known = code as WheelErrorCode;
  const final = HELD_CARD_FINAL_ERRORS.includes(known);
  return {
    final,
    offerGone: final && known !== "claim_limit",
    expired: HOLD_OVER_ERRORS.includes(known),
    refresh: known === "already_claimed",
  };
}

/** The spin's frozen hold has passed at `now` (ms). A date that cannot be read never counts as passed: the server decides then. */
export function heldHoldPassed(holdUntil: string, now: number): boolean {
  const end = Date.parse(holdUntil);
  return Number.isFinite(end) && now >= end;
}
