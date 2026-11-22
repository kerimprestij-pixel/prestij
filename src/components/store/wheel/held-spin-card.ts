// What the /hesap card for a held, unclaimed gift wheel spin says (lead decision D15; pure: unit-tested).
// Built on the server from the held spin (src/lib/data/wheel-held.ts) and the dictionary; the client card
// (AccountHeldSpinCard) only renders it and claims through the existing claimWheel action. Honest copy
// (D12): the prize name follows the shared prize-name rule (src/lib/wheel/prize.ts prizeLabel), the
// conditions line states the minimum basket, the validity after the claim and, for free shipping, the
// heavy-parcel note; the claim-until date is the spin's frozen hold end. Server side only (it reads
// @/lib/wheel/types, which carries zod): the client card imports its types, never this module's values.
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { LocalizedText } from "@/i18n/locales";
import type { Messages } from "@/i18n/messages";
import { prizeLabel, prizeSummary } from "@/lib/wheel/prize";
import { wheelText, type WheelPrizeSnapshot } from "@/lib/wheel/types";
import { formatWheelDate, type CountdownLabels } from "./countdown";

type WheelMessages = Messages["wheel"];

/** The held spin as the card needs it (= AccountHeldSpin of src/lib/data/wheel-held.ts). */
export type HeldSpinCardInput = {
  prize: WheelPrizeSnapshot;
  /** ISO end of the unclaimed hold. */
  holdUntil: string;
  validityHours: number;
  heavySurcharge: boolean;
  /** The panel's claim button text, if set. */
  claimCta: LocalizedText | null;
};

export type HeldSpinCardModel = {
  title: string;
  /** The prize name in the reader's language. */
  label: string;
  /** "Çarkta kazandığınız hediye: %10 indirim. …" */
  intro: string;
  /** Minimum basket (when set), validity after the claim, heavy-parcel note (free shipping, when it applies). */
  conditions: string;
  /** "Hediyenizi 19 Kasım 2026 12:00 tarihine kadar alabilirsiniz." */
  claimUntil: string;
  /** ISO end of the hold: once it has passed, the card hides the button and says the result expired (no claim is sent). */
  holdUntil: string;
  /** "Hediyemi al", or the panel's text. */
  claimCta: string;
};

/** The texts of the card's claim and claimed states (from the panel-overridable dictionary). */
export type HeldSpinCardLabels = {
  claiming: string;
  claimedTitle: string;
  code: string;
  copy: string;
  copied: string;
  applied: string;
  kept: string;
  /** Template with {time}. */
  timeLeft: string;
  /** Template with {date}. */
  expiresAt: string;
  goToCart: string;
  countdown: CountdownLabels;
  /** When the action itself cannot be reached. */
  network: string;
  unavailable: string;
  /** The spin's hold has passed ("Çark sonucunun süresi doldu."). */
  expired: string;
  /** Neutral title once the offer is gone (the "waiting for you" title would no longer be true). */
  goneTitle: string;
};

export function heldSpinCardModel(input: HeldSpinCardInput, locale: Locale, m: WheelMessages): HeldSpinCardModel {
  const label = prizeLabel(input.prize, locale, m);
  return {
    title: m.account.heldTitle,
    label,
    intro: format(m.account.held, { prize: label }, locale),
    conditions: prizeSummary(input.prize, { validityHours: input.validityHours, heavySurcharge: input.heavySurcharge }, locale, m),
    claimUntil: format(m.account.claimUntil, { date: formatWheelDate(input.holdUntil, locale) }, locale),
    holdUntil: input.holdUntil,
    claimCta: wheelText(input.claimCta, locale, m.claim.claimCta),
  };
}

export function heldSpinCardLabels(m: WheelMessages): HeldSpinCardLabels {
  return {
    claiming: m.claim.claiming,
    claimedTitle: m.claim.claimedTitle,
    code: m.claim.code,
    copy: m.claim.copy,
    copied: m.claim.copied,
    applied: m.claim.applied,
    kept: m.claim.kept,
    timeLeft: m.account.timeLeft,
    expiresAt: m.account.expiresAt,
    goToCart: m.claim.goToCart,
    countdown: { days: m.countdown.days, expired: m.countdown.expired },
    network: m.errors.network,
    unavailable: m.errors.unavailable,
    expired: m.errors.spin_expired,
    goneTitle: m.account.title,
  };
}
