// Where the gift wheel may appear (pure: unit-tested). Contract §1.1 "Triggers and placement": never on
// cart, checkout, account, order, legal pages, /bulten, 404 or the panel. The island checks the URL
// (canonicalized to the Turkish folder path, so /en/account/… and /ar/cart match too) and, at decision
// time, the rendered page itself: a legal document section or a noindex robots tag (404, private pages)
// keeps the wheel away from pages whose path alone does not tell.
import { localizePath } from "@/i18n/paths";

/** Canonical Turkish path prefixes where the wheel never shows. */
export const WHEEL_EXCLUDED_PREFIXES = ["/sepet", "/odeme", "/hesap", "/siparis", "/bulten", "/panel", "/api"] as const;

/**
 * Legal pages known by slug (scripts/seed-data/site.ts LEGAL_PAGES). Others are caught by their
 * `[data-legal-version]` section (LegalDocument) when the page renders.
 */
export const WHEEL_LEGAL_SLUGS = [
  "kvkk",
  "mesafeli-satis-sozlesmesi",
  "on-bilgilendirme-formu",
  "cerez-politikasi",
  "iade-ve-degisim",
  "uyelik-sozlesmesi",
  "hediye-carki-kampanya-kosullari",
] as const;

/**
 * Paths where a prize may be claimed or spent: the launcher drops its cached answer there and asks the
 * server again on the next storefront page (the /hesap card claims held spins, D15).
 */
export const WHEEL_SPEND_PREFIXES = ["/sepet", "/odeme", "/siparis", "/hesap"] as const;

/** The canonical Turkish folder path of a public pathname, without locale prefix and query ("/" for home). */
export function canonicalWheelPath(pathname: string): string {
  const raw = (pathname || "/").split(/[?#]/)[0] || "/";
  const tr = localizePath("tr", raw.startsWith("/") ? raw : `/${raw}`);
  const rest = tr.replace(/^\/tr(?=\/|$)/, "");
  const trimmed = rest.length > 1 ? rest.replace(/\/+$/, "") : rest;
  return trimmed || "/";
}

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The wheel may show on this URL (path rules only; see wheelBlockedByPage for the page itself). */
export function wheelRouteAllowed(pathname: string): boolean {
  const path = canonicalWheelPath(pathname);
  if (WHEEL_EXCLUDED_PREFIXES.some((prefix) => matches(path, prefix))) return false;
  if (WHEEL_LEGAL_SLUGS.some((slug) => matches(path, `/sayfa/${slug}`))) return false;
  return true;
}

/** True on cart/checkout/order and account pages (where a prize may be claimed or spent: the launcher drops its cached answer). */
export function isWheelSpendPath(pathname: string): boolean {
  const path = canonicalWheelPath(pathname);
  return WHEEL_SPEND_PREFIXES.some((prefix) => matches(path, prefix));
}

/** The bits of `Document` the page check reads (a fake is enough in tests). */
export type WheelPageProbe = { querySelector(selector: string): { getAttribute(name: string): string | null } | null };

/**
 * The rendered page rules the wheel out: a legal document section (`data-legal-version`, every legal
 * page), or a "not found" page: noindex robots without a canonical link (notFoundMetadata clears the
 * canonical; a page an editor marked noindex keeps its canonical and keeps the wheel).
 */
export function wheelBlockedByPage(doc: WheelPageProbe): boolean {
  if (doc.querySelector("[data-legal-version]")) return true;
  const robots = doc.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";
  const noindex = /(^|[\s,])noindex([\s,]|$)/i.test(robots);
  return noindex && !doc.querySelector('link[rel="canonical"]');
}
