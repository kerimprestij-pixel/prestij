import type { NextConfig } from "next";
// Relative imports of pure files without imports of their own (Next compiles next.config.ts and what it
// requires; the "@/" alias is not used here).
import { productionSiteUrlError } from "./src/lib/deploy/site-url";
import { cardPageHeaders } from "./src/lib/security/card-page-csp";

// A Vercel production build must bake the live https address into canonicals, the sitemap, e-mail links and
// payment return URLs: fail the build instead of shipping localhost links (go-live CF-5).
const siteUrlError = productionSiteUrlError(process.env);
if (siteUrlError) throw new Error(siteUrlError);

/** Sent with every response. A nonce-based Content-Security-Policy is a planned follow-up. */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No framing anywhere (clickjacking on checkout, order pages and the panel).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=()" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

/** Panel uploads (src/app/uploads/[...key]/route.ts): a sandboxing CSP in case a non-image ever lands in storage. */
const UPLOAD_HEADERS = SECURITY_HEADERS.map((header) =>
  header.key === "Content-Security-Policy" ? { ...header, value: "default-src 'none'; sandbox; frame-ancestors 'none'" } : header,
);

/** Browser/CDN caching of the files in public/media (see headers() below). */
const MEDIA_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

/** Pages whose URL carries an order token: never send it in a Referer (also set as <meta>, which Next streams in the body). */
const TOKEN_PAGES = [
  "/:locale/siparis/:orderNumber",
  "/:locale/order/:orderNumber",
  "/:locale/odeme/simulator",
  "/:locale/checkout/simulator",
  "/:locale/odeme/kart",
  "/:locale/checkout/card",
];

/**
 * The PayTR card page (/odeme/kart): the only page that frames a third party (PayTR's iframe, and the return
 * page and the bank's 3-D Secure page it navigates to). It may be framed by itself and by PayTR (PayTR can open
 * the return URL inside its iframe; the page then moves the tab). Rules and reasons: src/lib/security/card-page-csp.ts.
 */
const CARD_PAGE_HEADERS = cardPageHeaders(process.env);
const CARD_PAGES = ["/:locale/odeme/kart", "/:locale/checkout/card"];

const nextConfig: NextConfig = {
  // Lets several local dev servers run side by side (e.g. NEXT_DIST_DIR=.next/dev-cart). Unset = default.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  poweredByHeader: false,
  // Self-hosted route cache: Next's FileSystemCache with consistent tag-invalidation stamps and no disk
  // writes for 404 pages (see cache-handler.cjs). Vercel brings its own cache.
  ...(process.env.VERCEL ? {} : { cacheHandler: require.resolve("./cache-handler.cjs") }),
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Styled 404 for URLs outside every root layout (/api/x, /media/x, …): src/app/global-not-found.tsx
    globalNotFound: true,
  },
  async headers() {
    return [
      // Everything except /uploads, which gets the same headers with a sandboxing CSP. Config headers
      // replace those a route handler sets, so the uploads CSP has to come from here.
      { source: "/:path((?!uploads(?:/|$)).*)", headers: SECURITY_HEADERS },
      { source: "/uploads/:path*", headers: UPLOAD_HEADERS },
      // Seeded catalog images (public/media), which `next start` serves with max-age=0. Their names are
      // not content-hashed (a replaced file keeps its URL), so a day fresh plus a week of
      // stale-while-revalidate, not immutable like the hashed /uploads files.
      { source: "/media/:path*", headers: [{ key: "Cache-Control", value: MEDIA_CACHE_CONTROL }] },
      ...TOKEN_PAGES.map((source) => ({ source, headers: [{ key: "Referrer-Policy", value: "no-referrer" }] })),
      // Later entries win for the same header key.
      ...CARD_PAGES.map((source) => ({ source, headers: CARD_PAGE_HEADERS })),
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
