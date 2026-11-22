// Unsubscribe links of marketing e-mails (newsletter campaigns). One signed token per subscriber row
// (purpose "newsletter-unsubscribe", payload { s: subscriberId }, no expiry) serves both the visible
// footer link (/bulten/ayril?t=…) and the RFC 8058 one-click POST (/api/newsletter/unsubscribe?t=…),
// which the List-Unsubscribe / List-Unsubscribe-Post headers point to. NOTIFY's page and route verify
// it with readNewsletterUnsubscribeToken().
import type { Locale } from "@/i18n/locales";
import { absoluteUrl, href } from "@/i18n/paths";
import { signToken, verifyToken } from "@/lib/signed-token";

export const NEWSLETTER_UNSUBSCRIBE_PURPOSE = "newsletter-unsubscribe";

/** Route handler for the one-click unsubscribe POST (not localized). */
export const ONE_CLICK_UNSUBSCRIBE_PATH = "/api/newsletter/unsubscribe";

export type UnsubscribeLinks = {
  /** The page a reader opens from the footer link (shows a confirmation). */
  url: string;
  /** The RFC 8058 one-click endpoint (POST "List-Unsubscribe=One-Click"). */
  oneClickUrl: string;
};

export function newsletterUnsubscribeToken(subscriberId: number): string {
  return signToken(NEWSLETTER_UNSUBSCRIBE_PURPOSE, { s: subscriberId });
}

/** Both links for one subscriber, absolute (NEXT_PUBLIC_SITE_URL). */
export function newsletterUnsubscribeLinks(subscriberId: number, locale: Locale): UnsubscribeLinks {
  const t = encodeURIComponent(newsletterUnsubscribeToken(subscriberId));
  return {
    url: absoluteUrl(`${href(locale, "newsletterUnsubscribe")}?t=${t}`),
    oneClickUrl: absoluteUrl(`${ONE_CLICK_UNSUBSCRIBE_PATH}?t=${t}`),
  };
}

/** The subscriber id of a valid token, or null (forged, malformed). Re-read the row by id afterwards. */
export function readNewsletterUnsubscribeToken(token: unknown): number | null {
  const result = verifyToken<{ s?: unknown }>(NEWSLETTER_UNSUBSCRIBE_PURPOSE, token);
  if (!result.ok) return null;
  const id = result.payload.s;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The List-Unsubscribe headers for a marketing mail (stored with the message at enqueue time). */
export function listUnsubscribeHeaders(links: UnsubscribeLinks): Record<string, string> {
  return {
    "List-Unsubscribe": `<${links.oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
