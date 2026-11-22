// Gift wheel eligibility rules (pure; contract docs/DAY6-WHEEL-VIDEO.md §1.1 "Who sees it"). The DB
// services gather the facts (src/lib/wheel/service.ts); these functions only decide, so every rule is
// unit-tested in isolation.
//
// Order of the checks (the first failing rule is the reason):
//   1. switched off → "disabled" (nothing works: no spin, no bind, no prize);
//   2. account rules (signed-in or claiming accounts): staff → "staff", approved business customer while
//      showToBusiness is off → "business", audience "new_customers" and a counted order → "has_ordered",
//      a prize already claimed in the round → "already_claimed";
//   3. schedule (new spins only): before startsAt → "not_started", at/after endsAt → "ended".
// A held spin (spun during the campaign, still inside its hold) may be claimed after the campaign ended:
// the visitor was shown a result with a "claim until" date, so that promise is kept (not when disabled).
import type { GiftWheelSettings, WheelEligibilityReason } from "./types";

/** Roles that may enter the panel; any of them in the (comma-separated) role string = staff. */
const STAFF_ROLES = new Set(["staff", "editor", "admin"]);

export function isStaffRoleString(role: string | null | undefined): boolean {
  return (role ?? "").split(",").some((r) => STAFF_ROLES.has(r.trim()));
}

export type WheelScheduleState = "live" | "disabled" | "not_started" | "ended";

/** Whether new spins are possible at `now` (enabled and inside startsAt ≤ now < endsAt). */
export function wheelScheduleState(settings: Pick<GiftWheelSettings, "enabled" | "startsAt" | "endsAt">, now: Date): WheelScheduleState {
  if (!settings.enabled) return "disabled";
  const t = now.getTime();
  const start = settings.startsAt ? Date.parse(settings.startsAt) : NaN;
  const end = settings.endsAt ? Date.parse(settings.endsAt) : NaN;
  if (Number.isFinite(start) && t < start) return "not_started";
  if (Number.isFinite(end) && t >= end) return "ended";
  return "live";
}

/** What the services know about an account (all from the DB, never from the client). */
export type WheelAccountFacts = {
  staff: boolean;
  /** CustomerContext.isBusiness: an approved company or a business customer group. */
  business: boolean;
  /** A counted order (COUNTED_ORDER_STATUSES) by user id or lower(e-mail). */
  hasOrdered: boolean;
};

/**
 * The account rules (2. above) without the round check: staff, business, audience. "eligible" when
 * none applies. Guests have no account facts: their audience is checked again when they claim.
 */
export function wheelAccountReason(
  settings: Pick<GiftWheelSettings, "enabled" | "audience" | "showToBusiness">,
  account: WheelAccountFacts,
): WheelEligibilityReason {
  if (!settings.enabled) return "disabled";
  if (account.staff) return "staff";
  if (account.business && !settings.showToBusiness) return "business";
  if (settings.audience === "new_customers" && account.hasOrdered) return "has_ordered";
  return "eligible";
}

/**
 * Whether a NEW spin may start: switched on, account rules (when signed in), no prize claimed this
 * round, inside the schedule. `account` is null for guests.
 */
export function wheelSpinReason(
  settings: Pick<GiftWheelSettings, "enabled" | "startsAt" | "endsAt" | "audience" | "showToBusiness">,
  input: { account: WheelAccountFacts | null; claimedThisRound: boolean },
  now: Date,
): WheelEligibilityReason {
  if (!settings.enabled) return "disabled";
  if (input.account) {
    const reason = wheelAccountReason(settings, input.account);
    if (reason !== "eligible") return reason;
  }
  if (input.claimedThisRound) return "already_claimed";
  const schedule = wheelScheduleState(settings, now);
  return schedule === "live" ? "eligible" : schedule;
}

/**
 * Whether an account may turn a held spin into a prize now: switched on and the account rules. The
 * round check is the database's (one bound/claimed spin per account and round, unique index); the
 * schedule does not apply (see the header).
 */
export function wheelClaimReason(
  settings: Pick<GiftWheelSettings, "enabled" | "audience" | "showToBusiness">,
  account: WheelAccountFacts,
): WheelEligibilityReason {
  return wheelAccountReason(settings, account);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** End of an unclaimed hold that starts at `createdAt` with `holdDays` (what a new spin freezes). */
export function spinHoldUntil(createdAt: Date, holdDays: number): Date {
  return new Date(createdAt.getTime() + holdDays * DAY_MS);
}

/** The parts of a spin row the hold rule reads (the prize snapshot carries the frozen end). */
export type HoldFacts = { createdAt: Date; prize?: { holdUntil?: string } | null };

/**
 * End of a spin's unclaimed hold: the end frozen in its prize snapshot when the wheel stopped (so the
 * date the result screen promised never moves when the owner changes holdDays later), else, for rows
 * spun before the end was frozen, spin time + the current holdDays.
 */
export function spinHoldUntilOf(spin: HoldFacts, holdDays: number): Date {
  const frozen = spin.prize?.holdUntil ? Date.parse(spin.prize.holdUntil) : Number.NaN;
  return Number.isFinite(frozen) ? new Date(frozen) : spinHoldUntil(spin.createdAt, holdDays);
}

/** A spin that can still be claimed: spun or bound, no prize yet, hold not over. */
export function isSpinHeld(
  spin: { status: string; couponId: number | null } & HoldFacts,
  holdDays: number,
  now: Date,
): boolean {
  return (spin.status === "spun" || spin.status === "bound") && spin.couponId == null && spinHoldUntilOf(spin, holdDays).getTime() > now.getTime();
}
