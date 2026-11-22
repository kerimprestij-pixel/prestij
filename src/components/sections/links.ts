// Section content stores canonical (Turkish) paths such as "/kurumsal" or "/urunler/lavanta";
// these helpers turn them into public URLs for the current locale.
import type { Locale } from "@/i18n/config";
import { href, isExternalHref, localizePath } from "@/i18n/paths";
import { isSafeHref } from "@/lib/safe-href";

/**
 * Public URL of a stored link. Empty or "/" → the home page. Anything the link rule refuses
 * (javascript:, data:, http:, //host, …; see src/lib/safe-href.ts) also falls back to the home page:
 * panel saves validate links already, this is the render-time second check.
 */
export function resolveLink(locale: Locale, raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value || value === "/" || !isSafeHref(value)) return href(locale, "home");
  return localizePath(locale, value);
}

/** Absolute http(s) or protocol-relative URL (opens in a new tab). */
export function isExternalLink(value: string): boolean {
  return /^(https?:)?\/\//i.test(value) && isExternalHref(value);
}
