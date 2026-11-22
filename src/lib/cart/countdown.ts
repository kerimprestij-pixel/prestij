// Countdown and expiry formatting for gift wheel prizes in the cart (day 6). Pure: the server formats
// the first value into the CartView (hydration-safe fallback) and the client formats the live value
// with the same function, so both sides always agree on the shape.
//
// Every countdown is a real expiry (coupons.ends_at): never a client guess, never a fake timer.
import { intlLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";

/** The two dictionary templates a countdown needs (`wheel.countdown.days` / `wheel.countdown.expired`). */
export type CountdownTexts = {
  /** "{days}g {clock}" (Arabic pluralizes `days`); used while at least one full day is left. */
  days: string;
  /** "Süresi doldu". */
  expired: string;
};

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number };

const pad = (n: number) => String(n).padStart(2, "0");

/** Whole days, hours, minutes and seconds left (floored; 0 everywhere once expired). */
export function countdownParts(msLeft: number): CountdownParts {
  const total = Number.isFinite(msLeft) && msLeft > 0 ? Math.floor(msLeft / 1000) : 0;
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}

/**
 * "2g 03:14" (days, hours:minutes) while a day or more is left, "03:14:07" (hours:minutes:seconds)
 * under a day, the expired text at or after the end. Western digits in every locale.
 */
export function formatCountdown(msLeft: number, texts: CountdownTexts, locale: Locale): string {
  if (!(msLeft >= 1000)) return texts.expired;
  const { days, hours, minutes, seconds } = countdownParts(msLeft);
  if (days >= 1) return format(texts.days, { days, clock: `${pad(hours)}:${pad(minutes)}` }, locale);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Milliseconds from `nowMs` until the ISO instant `endsAt` (negative once passed, -Infinity when unreadable). */
export function msUntil(endsAt: string, nowMs: number): number {
  const end = Date.parse(endsAt);
  return Number.isFinite(end) ? end - nowMs : Number.NEGATIVE_INFINITY;
}

const expiryFormats = new Map<Locale, Intl.DateTimeFormat>();

/** "15 Kasım 14:30" in Türkiye time (the shop's clock), whatever the server's or the browser's zone. */
export function formatPrizeExpiry(iso: string, locale: Locale): string {
  let f = expiryFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(locale), {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Europe/Istanbul",
    });
    expiryFormats.set(locale, f);
  }
  return f.format(new Date(iso));
}

/**
 * Splits a template around one `{key}` placeholder so the UI can render the value in its own element
 * (tabular digits, an isolated direction run): "Kalan süre: {time}" → ["Kalan süre: ", ""]. A template
 * without the placeholder (a panel override that dropped it) gives [template + " ", ""], so the value
 * still follows the text.
 */
export function splitTemplate(template: string, key: string): [before: string, after: string] {
  const token = `{${key}}`;
  const at = template.indexOf(token);
  if (at < 0) return [template ? `${template} ` : "", ""];
  return [template.slice(0, at), template.slice(at + token.length)];
}
