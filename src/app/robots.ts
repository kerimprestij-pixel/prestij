// /robots.txt. Crawlers skip the panel, the APIs and the visitor-specific pages (cart, checkout, account,
// order pages and the order lookup) in every language. Pages that only need to stay out of the index
// but must be crawlable so their noindex is seen (newsletter confirm/unsubscribe links from e-mails,
// noindex catalog pages) are NOT disallowed here: they carry `robots: { index: false }` metadata.
import type { MetadataRoute } from "next";
import { LOCALE_CODES, absoluteUrl, href, siteOrigin } from "@/i18n/paths";

export default function robots(): MetadataRoute.Robots {
  // Visitor-specific pages have no search value in any language. "/tr/siparis" also covers the order
  // pages below it (/tr/siparis/<number>), "/tr/hesap" every account page.
  const privatePages = LOCALE_CODES.flatMap((locale) => [
    href(locale, "cart"),
    href(locale, "checkout"),
    href(locale, "account"),
    href(locale, "orderLookup"),
  ]);

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/panel", "/api", ...privatePages] }],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteOrigin(),
  };
}
