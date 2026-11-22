// URL helpers for the SEO audit. Pure.

/** Parses an absolute http(s) URL; null for anything else (relative, mailto:, garbage). */
export function parseAbsolute(value: string | null | undefined): URL | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

/** True when `value` is an absolute http(s) URL. */
export function isAbsoluteHttpUrl(value: unknown): value is string {
  return typeof value === "string" && parseAbsolute(value) !== null;
}

/** Normalized origin ("http://check.localhost:3660") of an origin or URL string; throws when invalid. */
export function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Not an http(s) origin: ${value}`);
  return url.origin;
}

/**
 * Resolves `href` against `pageUrl` and drops the fragment. Null for non-http(s) links (mailto:, tel:,
 * javascript:), fragment-only links and unparsable values.
 */
export function resolveLink(href: string, pageUrl: string): string | null {
  const value = href.trim();
  if (!value || value.startsWith("#")) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:/i.test(value)) return null;
  try {
    const url = new URL(value, pageUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** True when `url` (absolute) is on `origin`. */
export function isSameOrigin(url: string, origin: string): boolean {
  const parsed = parseAbsolute(url);
  return parsed !== null && parsed.origin === origin;
}

/** Hosts that only exist on a developer machine: a production URL must never point there. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host.startsWith("127.") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".test")
  );
}

/**
 * True for an absolute URL on a local host that is not the audited origin, e.g. "http://localhost:3000/tr"
 * while auditing http://check.localhost:3660: the site was built with the wrong NEXT_PUBLIC_SITE_URL.
 */
export function isForeignLocalUrl(url: string, origin: string): boolean {
  const parsed = parseAbsolute(url);
  return parsed !== null && parsed.origin !== origin && isLocalHost(parsed.hostname);
}

/** The URL without its query string and fragment. */
export function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
  }
}

/** True when the URL has a query string. */
export function hasQuery(url: string): boolean {
  try {
    return new URL(url).search.length > 1;
  } catch {
    return false;
  }
}

/** The first path segment when it is one of `locales` ("/en/products" → "en"), else null. */
export function localeOfUrl(url: string, locales: readonly string[]): string | null {
  try {
    const first = new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
    return locales.includes(first) ? first : null;
  } catch {
    return null;
  }
}

/** Path + query of an absolute URL (what the server sees). */
export function pathAndQuery(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

// ---------------------------------------------------------------------------------------------------
// Language codes (hreflang, <html lang>, inLanguage)

/**
 * A valid hreflang value: "x-default" or an ISO 639 language code with an optional script and region
 * ("tr", "en-US", "zh-Hant-TW", "es-419"). Case-insensitive, as Google reads it.
 */
export function isValidHreflang(value: string): boolean {
  return /^(?:x-default|[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?)$/i.test(value.trim());
}

/** The primary language subtag, lowercased: "tr-TR" → "tr", "ar" → "ar". */
export function primaryLanguage(value: string): string {
  return value.trim().split(/[-_]/)[0].toLowerCase();
}

/** `url` with its origin swapped for `origin` (e.g. base → connect origin). */
export function withOrigin(url: string, origin: string): string {
  const parsed = new URL(url);
  return `${origin.replace(/\/+$/, "")}${parsed.pathname}${parsed.search}`;
}
