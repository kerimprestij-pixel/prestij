// Where the Google Merchant Center feed lives (FEED builds the route at src/app/feeds/google-merchant.xml/).
// Pure: the panel shows the URL (SEO-PANEL), the audit fetches it (SEO-AUDIT).
// The path ends in ".xml", so src/proxy.ts never localizes or redirects it (its matcher skips files).
import { siteOrigin } from "@/i18n/paths";

/** Site path of the merchant feed (not localized: one Turkish feed targeting TR). */
export const MERCHANT_FEED_PATH = "/feeds/google-merchant.xml";

/**
 * Absolute feed URL to paste into Merchant Center: `merchantFeedUrl()` → `"https://prestij.com.tr/feeds/google-merchant.xml"`.
 * `origin` defaults to the site origin (NEXT_PUBLIC_SITE_URL); a trailing slash is ignored.
 */
export function merchantFeedUrl(origin: string = siteOrigin()): string {
  return `${origin.replace(/\/+$/, "")}${MERCHANT_FEED_PATH}`;
}
