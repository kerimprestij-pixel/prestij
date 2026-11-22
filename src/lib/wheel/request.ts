// Gift wheel request helpers (pure): the same-origin check of the spin route and the canonical page
// path stored with a spin (Turkish folder path, no query, at most 200 characters; no personal data).
import { folderPath } from "@/i18n/paths";

type HeaderSource = { get(name: string): string | null };

/**
 * True when the request comes from a page of this site: an Origin header whose host equals the
 * request host, and (when the browser sends it) Sec-Fetch-Site same-origin. Requests without an
 * Origin (curl, old clients, cross-site forms) are refused: the spin route is only for our island.
 */
export function isSameOriginRequest(headers: HeaderSource): boolean {
  const origin = headers.get("origin");
  if (!origin || origin === "null") return false;
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/** Longest stored path (wheel_spins_page_path_check). */
export const WHEEL_PAGE_PATH_MAX = 200;

/**
 * The page a spin happened on as a canonical Turkish path ("/en/products/lavanta?x=1" →
 * "/urunler/lavanta"), or null for anything that is not a local storefront path.
 */
export function canonicalWheelPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const value = path.trim();
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  const folder = folderPath(value);
  if (!folder) return null;
  return folder.path.slice(0, WHEEL_PAGE_PATH_MAX);
}
