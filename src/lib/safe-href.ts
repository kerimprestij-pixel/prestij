// The one link rule for everything the panel stores and the storefront renders (section CTAs, menu
// items, announcements; links inside rich text go through sanitizeHtml). Pure and dependency-free, so the
// storefront (server and client components) can apply it on render without pulling in zod.
// src/lib/panel/schemas.ts re-exports it for the panel's zod schemas (hrefInput, optionalHrefInput).

export const HREF_MESSAGE = "Bağlantı /yol, #bölüm, https://, mailto: veya tel: ile başlamalı.";

/** Whitespace (incl. Unicode spaces), control and zero-width characters, and backslashes are never allowed. */
const HREF_FORBIDDEN = /[\s\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u2060\uFEFF\\]/;
const BASE = "https://prestij.invalid";

/**
 * A site path ("/urunler/x", not "//host"), "#anchor", https://…, mailto:… or tel:…. Rejects
 * javascript:, data:, vbscript:, http:, protocol-relative and backslash tricks, whitespace/control/
 * zero-width characters and entity-encoded schemes (they do not start with an allowed prefix).
 * Returns a plain boolean on purpose (a type predicate narrows `string` to `never` in the else branch).
 */
export function isSafeHref(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const value = raw.trim();
  if (!value || value.length > 2000 || HREF_FORBIDDEN.test(value)) return false;

  if (value.startsWith("#")) return /^#[A-Za-z][\w:.-]{0,99}$/.test(value);

  if (value.startsWith("/")) {
    if (value.startsWith("//")) return false;
    try {
      return new URL(value, BASE).origin === BASE;
    } catch {
      return false;
    }
  }

  if (/^https:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname.includes(".") && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  if (/^mailto:/i.test(value)) return /^mailto:[^@?/]+@[^@?/]+\.[^@?/.]+(\?\S*)?$/i.test(value);
  if (/^tel:/i.test(value)) return /^tel:\+?[0-9][0-9().-]{2,24}$/i.test(value);
  return false;
}
