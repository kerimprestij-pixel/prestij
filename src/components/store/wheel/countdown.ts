// Countdown and date formatting for the gift wheel prize (pure: unit-tested; used by the reminder chip,
// the account card and the dialog). Every countdown is a real expiry from the server (the coupon's
// ends_at): these helpers only format the time left, they never invent an end.
import { intlLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";

/** Texts of `messages.wheel.countdown` ("{days}g {clock}", plural in Arabic; "Süresi doldu"). */
export type CountdownLabels = { days: string; expired: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** Whole parts of a remaining time in milliseconds (negative or zero = expired). */
export function countdownParts(remainingMs: number): { expired: boolean; days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  return {
    expired: total <= 0,
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/**
 * The time left as the chip and the account card show it: with a day or more "2g 03:14" (days + hh:mm,
 * through the dictionary template so Arabic pluralizes), under a day "03:14:09" (hh:mm:ss), and the
 * "expired" text at zero. Western digits in every locale.
 */
export function formatCountdown(remainingMs: number, locale: Locale, labels: CountdownLabels): string {
  const p = countdownParts(remainingMs);
  if (p.expired) return labels.expired;
  if (p.days >= 1) return format(labels.days, { days: p.days, clock: `${pad(p.hours)}:${pad(p.minutes)}` }, locale);
  return `${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`;
}

const dateFormats = new Map<Locale, Intl.DateTimeFormat>();

/** An instant as a Türkiye date and time in `locale` ("14 Kasım 2026 18:30"); "" for an invalid value. */
export function formatWheelDate(iso: string, locale: Locale): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  let f = dateFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Istanbul" });
    dateFormats.set(locale, f);
  }
  return f.format(time);
}
