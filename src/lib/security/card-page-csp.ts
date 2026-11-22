// Content-Security-Policy of the PayTR card page (/odeme/kart, /checkout/card). Pure, with no imports:
// next.config.ts loads this file at build time (relative import) to build the page's headers. Unit-tested in
// tests/unit/golive-config.test.ts. The same rules as src/lib/payments/config.ts (localPaymentMockAllowed,
// checkBaseUrl, paytrFrameOrigin), which is server-only and cannot be imported by the config.

export const PAYTR_DEFAULT_FRAME_ORIGIN = "https://www.paytr.com";

type Env = Record<string, string | undefined>;

/** Outside production, or a production build serving a local origin (a `next start` check on *.localhost). */
export function localPaymentMockAllowedIn(env: Env): boolean {
  if (env.NODE_ENV !== "production") return true;
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL ?? "");
    return site.protocol === "http:" && (site.hostname === "localhost" || site.hostname === "127.0.0.1" || site.hostname.endsWith(".localhost"));
  } catch {
    return false;
  }
}

/**
 * Origin of the PayTR payment iframe: PAYTR_BASE_URL when it is https://, or http://localhost /
 * http://127.0.0.1 where the local payment mock is allowed (scripts/payment-mock.mjs); else PayTR's host.
 */
export function paytrFrameOriginFrom(env: Env): string {
  try {
    const url = new URL(env.PAYTR_BASE_URL?.trim() || PAYTR_DEFAULT_FRAME_ORIGIN);
    const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return url.protocol === "https:" || (local && localPaymentMockAllowedIn(env)) ? url.origin : PAYTR_DEFAULT_FRAME_ORIGIN;
  } catch {
    return PAYTR_DEFAULT_FRAME_ORIGIN;
  }
}

/**
 * The card page may be framed by itself and by PayTR (PayTR-fix C7): PayTR opens merchant_ok_url /
 * merchant_fail_url (this page, ?r=…&sonuc=…) inside its iframe, and the docs do not say from which frame. Navigated
 * in our #paytriframe, the ancestor is this page ('self'); opened from a frame nested inside PayTR's document, the
 * ancestors are PayTR and this page, so PayTR's origin must be listed too, or the browser refuses the page and the
 * buyer is stuck inside the frame (the page then moves the tab, see CardReturnPoller). frame-ancestors checks every
 * ancestor, so a third party can still not frame it. It frames PayTR, and whatever PayTR's iframe navigates to: our
 * own return URL ('self') and the card's bank for 3-D Secure (any https origin; banks differ per card). Without
 * `https:` a 3-D Secure step inside the iframe would be blocked ("Refused to frame").
 */
export function cardPageCsp(paytrOrigin: string): string {
  return `frame-ancestors 'self' ${paytrOrigin}; frame-src 'self' ${paytrOrigin} https:`;
}

/**
 * Headers of the card page (later entries in next.config.ts' headers() win over the site-wide ones).
 * X-Frame-Options cannot name an origin (ALLOW-FROM is obsolete and ignored by current browsers), and next.config
 * headers can only replace the site-wide DENY, not remove it. It stays SAMEORIGIN, the closest legacy value: every
 * browser that supports CSP Level 2 ignores X-Frame-Options when the policy has frame-ancestors (HTML standard,
 * "check a navigation response's adherence to X-Frame-Options"), so PayTR's frame is allowed by the CSP above,
 * and only browsers without frame-ancestors support (which cannot run PayTR's form anyway) fall back to SAMEORIGIN.
 */
export function cardPageHeaders(env: Env): { key: string; value: string }[] {
  return [
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Content-Security-Policy", value: cardPageCsp(paytrFrameOriginFrom(env)) },
  ];
}
