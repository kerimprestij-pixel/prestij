// Order access tokens (orders.accessToken, a UUID) guard the guest order page and the simulator.
import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { Locale } from "@/i18n/config";
import { href } from "@/i18n/paths";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Constant-time comparison of a presented token with the stored one (case-insensitive UUIDs). */
export function tokensMatch(presented: unknown, stored: string): boolean {
  if (typeof presented !== "string" || !UUID.test(presented) || !UUID.test(stored)) return false;
  const a = Buffer.from(presented.toLowerCase(), "utf8");
  const b = Buffer.from(stored.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const isTokenShape = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/**
 * The guest order page link: /tr/siparis/PR-261001?t=<token> (en: /en/order/…). `flags` adds
 * `new=1` (thank-you hero), `payment=failed` (card retry banner) or `payment=checking` (the card
 * result is not known yet: the page asks the provider again instead of offering a retry).
 */
export function orderPageHref(
  locale: Locale,
  orderNumber: string,
  token: string,
  flags: { new?: boolean; paymentFailed?: boolean; paymentChecking?: boolean } = {},
): string {
  const params = new URLSearchParams({ t: token });
  if (flags.new) params.set("new", "1");
  if (flags.paymentFailed) params.set("payment", "failed");
  else if (flags.paymentChecking) params.set("payment", "checking");
  return `${href(locale, "order", { orderNumber })}?${params.toString()}`;
}
