// SEO audit: the rule catalog and the issue type every rule returns. Pure (no I/O): the crawler in
// scripts/seo-audit.ts fetches, these modules judge. One code per kind of problem; its severity lives
// here only, so a summary can group by code and `--strict` can promote warnings in one place.
//
// Severity policy:
//   error   = breaks indexing, canonicalization, hreflang, rich-result eligibility or the merchant feed
//             (search engines report these as errors), or a crawl failure. Errors make the exit code 1.
//   warning = worth fixing but not blocking (length guidelines, recommended fields, untranslated texts).

export type Severity = "error" | "warning";

export const RULES = {
  // Fetching and status
  "fetch-failed": { severity: "error", title: "Request failed (network error or timeout)" },
  "http-status": { severity: "error", title: "Page does not answer 200" },
  "broken-link": { severity: "error", title: "Internal link to a page that answers 4xx/5xx" },
  "redirect-external": { severity: "error", title: "Redirect leaves the site's origin" },
  "redirect-loop": { severity: "error", title: "Redirect loop or more than 10 hops" },
  "redirect-chain": { severity: "warning", title: "More than one redirect hop" },
  "internal-link-redirect": { severity: "warning", title: "Internal link points to a redirect (link the final URL)" },
  "content-type": { severity: "warning", title: "Unexpected Content-Type" },
  "crawl-limit": { severity: "warning", title: "Crawl stopped at --max-pages" },
  "audit-crash": { severity: "error", title: "The audit could not check this URL (a bug in the audit)" },
  "foreign-origin-url": { severity: "error", title: "Site URL on another origin (wrong NEXT_PUBLIC_SITE_URL baked in?)" },
  "client-render-bailout": { severity: "warning", title: "Part of the page is only rendered in the browser" },

  // robots.txt
  "robots-missing": { severity: "error", title: "/robots.txt missing or not 200" },
  "robots-blocks-all": { severity: "error", title: "robots.txt disallows the whole site" },
  "robots-no-sitemap": { severity: "error", title: "robots.txt has no Sitemap line for this origin" },
  "robots-host-mismatch": { severity: "warning", title: "robots.txt Host differs from the site origin" },
  "robots-syntax": { severity: "warning", title: "robots.txt line not understood" },

  // Sitemap
  "sitemap-missing": { severity: "error", title: "Sitemap missing or not 200" },
  "sitemap-invalid": { severity: "error", title: "Sitemap is not valid sitemap XML" },
  "sitemap-empty": { severity: "error", title: "Sitemap lists no URL" },
  "sitemap-loc-invalid": { severity: "error", title: "Sitemap <loc> not an absolute URL on this origin" },
  "sitemap-duplicate": { severity: "error", title: "URL listed twice in the sitemap" },
  "sitemap-lastmod-invalid": { severity: "warning", title: "Sitemap <lastmod> not a W3C date or in the future" },
  "sitemap-url-blocked": { severity: "error", title: "Sitemap URL disallowed by robots.txt" },
  "sitemap-url-not-200": { severity: "error", title: "Sitemap URL does not answer 200" },
  "sitemap-url-redirect": { severity: "error", title: "Sitemap URL redirects" },
  "sitemap-noindex": { severity: "error", title: "Sitemap URL is noindex" },
  "sitemap-non-canonical": { severity: "error", title: "Sitemap URL's canonical points to another URL" },
  "sitemap-missing-page": { severity: "warning", title: "Indexable page missing from the sitemap" },
  "sitemap-alternates-mismatch": { severity: "warning", title: "Sitemap hreflang alternates differ from the page's" },
  "sitemap-image-invalid": { severity: "error", title: "Sitemap image not an absolute URL" },

  // Page head and content
  "metadata-outside-head": { severity: "warning", title: "Title/description/canonical/robots only outside <head>" },
  "title-missing": { severity: "error", title: "<title> missing or empty" },
  "title-multiple": { severity: "error", title: "More than one <title>" },
  "title-too-long": { severity: "warning", title: "Title longer than 70 characters" },
  "title-too-short": { severity: "warning", title: "Title shorter than 20 characters" },
  "title-duplicate": { severity: "error", title: "Same title on different pages" },
  "title-untranslated": { severity: "warning", title: "Same title as the page's other-language version" },
  "description-missing": { severity: "error", title: "Meta description missing or empty" },
  "description-multiple": { severity: "error", title: "More than one meta description" },
  "description-length": { severity: "warning", title: "Meta description outside 120–160 characters" },
  "description-duplicate": { severity: "warning", title: "Same meta description on different pages" },
  "description-untranslated": { severity: "warning", title: "Same meta description as the page's other-language version" },
  "h1-missing": { severity: "error", title: "No <h1>" },
  "h1-multiple": { severity: "error", title: "More than one <h1>" },
  "h1-empty": { severity: "error", title: "<h1> without text" },
  "html-lang-missing": { severity: "error", title: "<html lang> missing" },
  "html-lang-mismatch": { severity: "error", title: "<html lang> does not match the URL's locale" },
  "html-dir-mismatch": { severity: "error", title: "<html dir> wrong for the locale (ar = rtl)" },
  "canonical-missing": { severity: "error", title: "No rel=canonical" },
  "canonical-multiple": { severity: "error", title: "More than one rel=canonical" },
  "canonical-relative": { severity: "error", title: "Canonical is not an absolute URL" },
  "canonical-not-self": { severity: "error", title: "Canonical does not point to the page itself" },
  "canonical-target-bad": { severity: "error", title: "Canonical target is not a 200, indexable, self-canonical page" },
  "noindex-foreign-canonical": { severity: "warning", title: "noindex page with a canonical to another URL (mixed signals)" },
  "hreflang-missing": { severity: "error", title: "No hreflang alternates" },
  "hreflang-incomplete": { severity: "error", title: "hreflang set misses a locale or x-default" },
  "hreflang-invalid": { severity: "error", title: "hreflang value or URL invalid" },
  "hreflang-self-missing": { severity: "error", title: "hreflang set does not include the page itself" },
  "hreflang-not-reciprocal": { severity: "error", title: "hreflang alternate does not link back" },
  "hreflang-target-bad": { severity: "error", title: "hreflang target is not a 200, indexable, self-canonical page in that language" },
  "hreflang-x-default": { severity: "warning", title: "x-default is not the default-locale URL" },
  "og-title-missing": { severity: "error", title: "og:title missing" },
  "og-image-missing": { severity: "warning", title: "og:image missing" },
  "og-image-relative": { severity: "error", title: "og:image is not an absolute URL" },
  "og-url-mismatch": { severity: "warning", title: "og:url differs from the canonical" },
  "img-alt-missing": { severity: "error", title: "<img> without an alt attribute" },
  "img-alt-empty-priority": { severity: "warning", title: "Main (high-priority) image has an empty alt" },
  "asset-broken": { severity: "error", title: "Image referenced by metadata does not load as an image" },

  // JSON-LD
  "jsonld-parse": { severity: "error", title: "JSON-LD does not parse" },
  "jsonld-context": { severity: "error", title: "JSON-LD @context is not schema.org" },
  "jsonld-no-type": { severity: "error", title: "JSON-LD node without @type" },
  "jsonld-required": { severity: "error", title: "JSON-LD required property missing" },
  "jsonld-invalid-value": { severity: "error", title: "JSON-LD property has an invalid value" },
  "jsonld-recommended": { severity: "warning", title: "JSON-LD recommended property missing" },
  "jsonld-format": { severity: "warning", title: "JSON-LD value not in the format Google recommends" },
  "jsonld-faq-multiple": { severity: "error", title: "More than one FAQPage on the page" },
  "jsonld-duplicate-type": { severity: "warning", title: "Same JSON-LD type printed twice on the page" },
  "jsonld-mismatch": { severity: "warning", title: "JSON-LD url/inLanguage differs from the page" },

  // Merchant feed
  "feed-missing": { severity: "error", title: "Merchant feed missing or not 200" },
  "feed-invalid": { severity: "error", title: "Merchant feed is not RSS 2.0 with the g: namespace" },
  "feed-empty": { severity: "error", title: "Merchant feed has no item" },
  "feed-content-type": { severity: "warning", title: "Merchant feed Content-Type is not XML" },
  "feed-item-required": { severity: "error", title: "Feed item misses a required field" },
  "feed-item-invalid": { severity: "error", title: "Feed item field has an invalid value" },
  "feed-item-recommended": { severity: "warning", title: "Feed item misses a recommended field" },
  "feed-duplicate-id": { severity: "error", title: "Two feed items share a g:id" },
  "feed-item-group": { severity: "error", title: "Feed variants of one product do not share one g:item_group_id" },
  "feed-link-broken": { severity: "error", title: "Feed item link does not answer 200" },
  "feed-item-not-in-sitemap": { severity: "error", title: "Feed item's product page is not in the sitemap" },
  "feed-product-missing": { severity: "warning", title: "Product page in the sitemap has no feed item" },
  "feed-price-mismatch": { severity: "error", title: "Feed price/availability differs from the product page" },
  "feed-group-mismatch": { severity: "warning", title: "Feed g:item_group_id differs from the page's productGroupID" },
} as const satisfies Record<string, { severity: Severity; title: string }>;

export type RuleCode = keyof typeof RULES;

export type Issue = {
  severity: Severity;
  code: RuleCode;
  message: string;
  /** The URL the issue is about (the page, sitemap, feed or link target). */
  url?: string;
};

/** An issue with the severity from RULES. */
export function issue(code: RuleCode, message: string, url?: string): Issue {
  return { severity: RULES[code].severity, code, message, ...(url ? { url } : {}) };
}
