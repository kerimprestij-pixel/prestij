// Renewal calendar of subscriptions (pure: no DB, no clock — `now` is passed in).
//
// Renewal dates are kept at 00:00 Europe/Istanbul of the renewal day, so the daily job (Vercel cron
// at 03:30 UTC = 06:30 Istanbul) creates the order on that calendar day whatever time the first order
// was placed. Türkiye has used a fixed UTC+3 offset since 2016, so the calendar math below shifts by
// three hours instead of loading time-zone data.

export type PlanRhythm = { interval: "week" | "month"; intervalCount: number };

const DAY_MS = 86_400_000;
/** Europe/Istanbul is UTC+3 all year. */
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

const count = (n: number) => Math.min(52, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** 00:00 Europe/Istanbul of the day that contains `date`. */
export function startOfIstanbulDay(date: Date): Date {
  const local = date.getTime() + ISTANBUL_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - ISTANBUL_OFFSET_MS);
}

/** "YYYY-MM-DD" of `date` in Europe/Istanbul (dedupe keys, period ids). */
export function istanbulDay(date: Date): string {
  return new Date(date.getTime() + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Istanbul day of month of `date` (1–31): the anchor day of a monthly subscription started then. */
export function anchorDayOf(date: Date): number {
  return new Date(date.getTime() + ISTANBUL_OFFSET_MS).getUTCDate();
}

/**
 * One period later. Weeks add 7 × n days; months keep the Istanbul day of month, clamped to the
 * length of the target month (31 Jan + 1 month = 28/29 Feb). `anchorDay` (the subscription's own day,
 * anchorDayOf(createdAt)) undoes an earlier clamp: from 28 Feb an anchor of 31 gives 31 Mar, not 28 Mar.
 */
export function advanceRunAt(from: Date, plan: PlanRhythm, anchorDay?: number | null): Date {
  const n = count(plan.intervalCount);
  if (plan.interval === "week") return new Date(from.getTime() + n * 7 * DAY_MS);
  const local = new Date(from.getTime() + ISTANBUL_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + n;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const fromDay = local.getUTCDate();
  // Only a date that sits on a month's last day below its anchor was clamped; any other day is kept
  // (e.g. a subscription resumed on another day keeps its new day).
  const clamped = anchorDay != null && anchorDay > fromDay && anchorDay <= 31 && fromDay === daysInMonth(year, local.getUTCMonth());
  const day = Math.min(clamped ? anchorDay : fromDay, daysInMonth(targetYear, targetMonth));
  const shifted = Date.UTC(targetYear, targetMonth, day, local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds());
  return new Date(shifted - ISTANBUL_OFFSET_MS);
}

/** The first renewal after a subscription starts at `now`: one period later, at the start of that day. */
export function firstRunAt(now: Date, plan: PlanRhythm): Date {
  return startOfIstanbulDay(advanceRunAt(now, plan));
}

/**
 * The renewal after `current`, moved past `now` when runs were missed (a paused or long-failing
 * subscription never creates several orders at once). Pass `anchorDay` (anchorDayOf(subscription
 * createdAt)) so monthly renewals return to their day after a short month.
 */
export function nextRunAfter(current: Date, plan: PlanRhythm, now: Date, anchorDay?: number | null): Date {
  let next = startOfIstanbulDay(advanceRunAt(current, plan, anchorDay));
  for (let i = 0; i < 1000 && next.getTime() <= now.getTime(); i++) next = startOfIstanbulDay(advanceRunAt(next, plan, anchorDay));
  return next;
}

/** When the reminder for a renewal is due: `days` before it. */
export function reminderAt(nextRunAt: Date, days: number): Date {
  return new Date(nextRunAt.getTime() - Math.max(0, Math.round(days)) * DAY_MS);
}
