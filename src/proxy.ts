// Runs before every page request (Node runtime). Five jobs, no DB access:
//  1. Locale-less paths → redirect to the visitor's language (cookie, then Accept-Language, then tr).
//  2. en/ar URLs use English segments: rewrite them to the Turkish route folders, and 308-redirect
//     Turkish segments under en/ar (or English ones under tr) to the canonical form. This covers the
//     first segment and the second one under hesap, odeme and bulten (SUB_SEGMENTS in paths.ts).
//  3. /panel/** (except the login page) needs a Better Auth session cookie. This is only an optimistic
//     gate; every panel page and action re-checks the session and role on the server. /panel/api/**
//     (route handlers such as the media upload) is outside the matcher: those answer 401 JSON
//     themselves, and a matched request body would be buffered and cut at proxyClientMaxBodySize (10 MB).
//  4. The checkout page without a cart cookie → a real 307 to the cart, and /sayfa/<reserved slug> →
//     a real 308 to /kurumsal, /numune or /iletisim (the pages themselves can only redirect from
//     inside their streamed Suspense boundary: 200 + meta refresh).
//  5. /hesap/** (except the auth pages: giris, kayit, sifremi-unuttum, sifre-sifirla, dogrula) without
//     a session cookie → 307 to the sign-in page with ?sonra=<the requested path>. Optimistic only:
//     every account page and action re-checks the session on the server.
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import type { Locale } from "@/i18n/config";
import {
  ACCOUNT_AUTH_SUB_SEGMENTS,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SEGMENTS_EN_TO_TR,
  hasSubSegments,
  href,
  isEnglishSegment,
  isEnglishSubSegment,
  isLocaleCode,
  isTurkishSegment,
  isTurkishSubSegment,
  localizePath,
  toFolderSegment,
  toSubFolderSegment,
} from "@/i18n/paths";
import { isReservedPageSlug, reservedPagePath } from "@/lib/reserved-pages";

const PANEL_LOGIN = "/panel/giris";
/** Never localized: framework internals, API, seeded media, panel uploads. (Mirrors the matcher, defensively.) */
const BYPASS = /^\/(?:api|_next|_vercel|media|uploads|\.well-known)(?:\/|$)/;
/** Panel route handlers check the session themselves (also excluded by the matcher). */
const PANEL_API = /^\/panel\/api(?:\/|$)/;
/** Requests for files (anything whose last segment has an extension). */
const FILE = /\/[^/]+\.[a-z0-9]+$/i;
/** Mirrors CART_COOKIE in src/lib/cart/cookie.ts (server-only, so not importable here). */
const CART_COOKIE = "prestij_cart";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PANEL_API.test(pathname)) return NextResponse.next();
  if (pathname === "/panel" || pathname.startsWith("/panel/")) return panelGate(request);
  if (BYPASS.test(pathname) || FILE.test(pathname)) return NextResponse.next();

  const segments = pathname.split("/").filter(Boolean);
  const [first, second] = segments;

  if (!isLocaleCode(first)) {
    // "/EN/products" → "/en/products"; anything else gets the preferred locale prepended.
    const lowered = first?.toLowerCase();
    if (isLocaleCode(lowered)) {
      return redirect(request, localizePath(lowered, `/${segments.slice(1).join("/")}`), 308);
    }
    const response = redirect(request, localizePath(preferredLocale(request), pathname), 307);
    response.headers.set("Vary", "Cookie, Accept-Language");
    return response;
  }

  if (!second) return NextResponse.next();

  // GET only: Server Actions are POSTs to the page URL and must reach the page.
  const folder = first === "tr" ? second : isEnglishSegment(second) ? SEGMENTS_EN_TO_TR[second] : null;
  const isRead = request.method === "GET" || request.method === "HEAD";
  if (folder === "odeme" && segments.length === 2 && isRead && !request.cookies.has(CART_COOKIE)) {
    return redirect(request, localizePath(first, "/sepet"), 307);
  }
  // /sayfa/kurumsal|numune|iletisim → their own routes with a real 308 (the page's own redirect runs
  // inside its streamed Suspense boundary, so it could only answer 200 + meta refresh).
  if (folder === "sayfa" && segments.length === 3 && isRead && isReservedPageSlug(segments[2])) {
    return redirect(request, localizePath(first, reservedPagePath(segments[2])), 308);
  }

  if (first === "tr") {
    // English segment under /tr (e.g. /tr/products) → /tr/urunler
    if (isEnglishSegment(second) && !isTurkishSegment(second)) {
      return redirect(request, localizePath("tr", pathname), 308);
    }
    // English second-level segment under a Turkish folder (e.g. /tr/hesap/sign-in) → /tr/hesap/giris
    if (wrongSubSegment("tr", second, segments[2])) return redirect(request, localizePath("tr", pathname), 308);
    return accountGate(request, "tr", second, segments[2]) ?? NextResponse.next();
  }

  // en / ar: Turkish segment in the URL → canonical English URL.
  if (isTurkishSegment(second) && !isEnglishSegment(second)) {
    return redirect(request, localizePath(first, pathname), 308);
  }
  // Turkish second-level segment under an English folder (e.g. /en/account/giris) → /en/account/sign-in
  if (wrongSubSegment(first, second, segments[2])) return redirect(request, localizePath(first, pathname), 308);

  const gate = accountGate(request, first, second, segments[2]);
  if (gate) return gate;

  // English segments → serve the Turkish route folders without changing the URL.
  if (isEnglishSegment(second)) {
    const folder = SEGMENTS_EN_TO_TR[second];
    const rest = segments.slice(2);
    if (rest.length > 0 && hasSubSegments(folder)) rest[0] = toSubFolderSegment(folder, rest[0]) ?? rest[0];
    const target = `/${[first, folder, ...rest].join("/")}`;
    if (target !== `/${segments.join("/")}`) {
      const url = request.nextUrl.clone();
      url.pathname = target;
      return NextResponse.rewrite(url);
    }
  }
  return NextResponse.next();
}

/** True when `third` is a translated sub-segment spelled in the other language than `locale`. */
function wrongSubSegment(locale: Locale, second: string, third: string | undefined): boolean {
  if (!third) return false;
  const folder = toFolderSegment(second);
  if (!folder || !hasSubSegments(folder)) return false;
  return locale === "tr"
    ? isEnglishSubSegment(folder, third) && !isTurkishSubSegment(folder, third)
    : isTurkishSubSegment(folder, third) && !isEnglishSubSegment(folder, third);
}

/**
 * /hesap/** without a session cookie → the sign-in page with ?sonra=<requested path>. The auth pages
 * stay public, and only page loads are redirected: Server Actions (POST) reach the page, which
 * re-checks the session itself. Returns null when the request may continue.
 */
function accountGate(request: NextRequest, locale: Locale, second: string, third: string | undefined): NextResponse | null {
  if (toFolderSegment(second) !== "hesap") return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const sub = third ? toSubFolderSegment("hesap", third) : null;
  if (sub && ACCOUNT_AUTH_SUB_SEGMENTS.includes(sub)) return null;
  if (getSessionCookie(request)) return null;

  const url = request.nextUrl.clone();
  url.pathname = href(locale, "signIn");
  url.search = "";
  url.searchParams.set("sonra", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.redirect(url, 307);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

function panelGate(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === PANEL_LOGIN || pathname.startsWith(`${PANEL_LOGIN}/`)) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  // A Server Action call after the session expired: let it through so the action answers itself
  // (panelAction redirects to the login page). A 307 here would re-POST the action to /panel/giris,
  // where it does not exist, and the editor would get no feedback at all.
  if (request.method === "POST" && request.headers.has("next-action")) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = PANEL_LOGIN;
  url.search = "";
  url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

function redirect(request: NextRequest, path: string, status: 307 | 308) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  return NextResponse.redirect(url, status);
}

/** NEXT_LOCALE cookie, then the best Accept-Language match among our locales, then Turkish. */
function preferredLocale(request: NextRequest): Locale {
  const fromCookie = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocaleCode(fromCookie)) return fromCookie;

  const header = request.headers.get("accept-language");
  if (!header) return DEFAULT_LOCALE;

  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { language: tag.trim().toLowerCase().split("-")[0], quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const { language } of ranked) if (isLocaleCode(language)) return language;
  return DEFAULT_LOCALE;
}

export const config = {
  matcher: [
    // Everything except framework internals, API routes (incl. panel route handlers), seeded media,
    // panel uploads, metadata files and any path ending in a file extension.
    "/((?!api/|api$|panel/api/|_next/|_vercel|media/|uploads/|\\.well-known|favicon\\.ico|icon|apple-icon|robots\\.txt|sitemap|manifest|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
