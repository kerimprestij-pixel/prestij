// Gift wheel countdowns and dates (pure; safe in client components). Every countdown counts to a real
// expiry from the server (coupon ends_at, spin hold): never a made-up timer (contract §2).
//   formatWheelCountdown("2026-11-14T12:00:00Z", now, messages.wheel.countdown, "tr") → "2g 03:14"
//   with less than a day left → "03:14:59"; at/after the end → messages.wheel.countdown.expired
import { intlLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";

export type CountdownParts = {
  /** Milliseconds left (0 when over). */
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
};

const toMs = (value: Date | string | number): number => (value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value));

/** Time left until `endsAt` at `now`, split into whole days, hours, minutes and seconds (rounded down). */
export function countdownParts(endsAt: Date | string | number, now: Date | number): CountdownParts {
  const end = toMs(endsAt);
  const at = typeof now === "number" ? now : now.getTime();
  const totalMs = Number.isFinite(end) ? Math.max(0, end - at) : 0;
  const totalSeconds = Math.floor(totalMs / 1000);
  return {
    totalMs,
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    expired: totalSeconds <= 0,
  };
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * "2g 03:14" (days + hh:mm, via the `days` template "{days}g {clock}") or "03:14:59" (hh:mm:ss) when
 * less than a day is left; the `expired` text at the end. Western digits in every locale.
 */
export function formatWheelCountdown(
  endsAt: Date | string | number,
  now: Date | number,
  texts: { days: string; expired: string },
  locale: Locale,
): string {
  const p = countdownParts(endsAt, now);
  if (p.expired) return texts.expired;
  if (p.days > 0) return format(texts.days, { days: p.days, clock: `${two(p.hours)}:${two(p.minutes)}` }, locale);
  return `${two(p.hours)}:${two(p.minutes)}:${two(p.seconds)}`;
}

const dateTimeFormats = new Map<Locale, Intl.DateTimeFormat>();

/** "14 Kasım 2026 15:00" / "November 14, 2026 at 3:00 PM" / Arabic with Western digits; Istanbul time. */
export function formatWheelDateTime(value: Date | string | number, locale: Locale): string {
  let fmt = dateTimeFormats.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Istanbul" });
    dateTimeFormats.set(locale, fmt);
  }
  const ms = toMs(value);
  return Number.isFinite(ms) ? fmt.format(new Date(ms)) : "";
}
