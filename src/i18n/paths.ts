// Public URL building for the storefront. Pure and dependency-free, so it is safe in proxy.ts,
// Server Components and Client Components alike (config.ts pulls in drizzle, so it is not imported here).
//
// Route folders are Turkish (canonical). Turkish URLs use them as-is; en/ar URLs use English segments
// that proxy.ts rewrites to the Turkish folders. The first segment after the locale is localized, and
// so is the second one under `hesap`, `odeme` and `bulten` (SUB_SEGMENTS, e.g. /en/account/sign-in).
import type { Locale } from "./config";

export const LOCALE_CODES = ["tr", "en", "ar"] as const satisfies readonly Locale[];
/** Compile-time guard: fails to type-check if config.ts gains a locale that is missing above. */
export const LOCALE_CODES_COMPLETE: Locale extends (typeof LOCALE_CODES)[number] ? true : never = true;

export const DEFAULT_LOCALE: Locale = "tr";
/** Cookie that remembers the visitor's language choice (read by proxy.ts, written by the switcher). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocaleCode(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALE_CODES as readonly string[]).includes(value);
}

/** Turkish folder name → English public segment (used by en and ar). */
export const SEGMENTS = {
  urunler: "products",
  kategori: "category",
  sepet: "cart",
  odeme: "checkout",
  hesap: "account",
  kurumsal: "business",
  numune: "samples",
  blog: "blog",
  sayfa: "page",
  iletisim: "contact",
  siparis: "order",
  bulten: "newsletter",
} as const;

export type TurkishSegment = keyof typeof SEGMENTS;
export type EnglishSegment = (typeof SEGMENTS)[TurkishSegment];

/** English public segment → Turkish folder name. */
export const SEGMENTS_EN_TO_TR = Object.fromEntries(
  Object.entries(SEGMENTS).map(([trSegment, enSegment]) => [enSegment, trSegment]),
) as Record<EnglishSegment, TurkishSegment>;

export function isTurkishSegment(value: string): value is TurkishSegment {
  return Object.hasOwn(SEGMENTS, value);
}

export function isEnglishSegment(value: string): value is EnglishSegment {
  return Object.hasOwn(SEGMENTS_EN_TO_TR, value);
}

/** The public segment for a route folder in `locale`. */
export function segmentFor(locale: Locale, folder: TurkishSegment): string {
  return locale === "tr" ? folder : SEGMENTS[folder];
}

/** Maps a public first segment in either language to its Turkish folder; null for anything else. */
export function toFolderSegment(segment: string): TurkishSegment | null {
  if (isTurkishSegment(segment)) return segment;
  if (isEnglishSegment(segment)) return SEGMENTS_EN_TO_TR[segment];
  return null;
}

/**
 * Second-level segments that are translated too: Turkish sub-folder → English public segment, per
 * parent folder (en and ar use the English one). Sub-paths not listed here (e.g. /odeme/simulator,
 * /hesap/siparisler/<orderNumber>'s order number) are the same in every language.
 */
export const SUB_SEGMENTS = {
  hesap: {
    giris: "sign-in",
    kayit: "register",
    "sifremi-unuttum": "forgot-password",
    "sifre-sifirla": "reset-password",
    dogrula: "verify",
    siparisler: "orders",
    adresler: "addresses",
    profil: "profile",
    favoriler: "favorites",
    abonelikler: "subscriptions",
    kurumsal: "business",
  },
  odeme: { kart: "card" },
  bulten: { onay: "confirm", ayril: "unsubscribe" },
} as const satisfies Partial<Record<TurkishSegment, Record<string, string>>>;

export type SubSegmentParent = keyof typeof SUB_SEGMENTS;
type SubSegmentsOf<P extends SubSegmentParent> = keyof (typeof SUB_SEGMENTS)[P] & string;

export function hasSubSegments(folder: string): folder is SubSegmentParent {
  return Object.hasOwn(SUB_SEGMENTS, folder);
}

function subSegmentMap(folder: SubSegmentParent): Record<string, string> {
  return SUB_SEGMENTS[folder] as Record<string, string>;
}

/**
 * Maps a public second segment (either language) under `folder` to its Turkish sub-folder; null when
 * it is not a translated sub-segment (it then passes through unchanged).
 */
export function toSubFolderSegment(folder: string, segment: string): string | null {
  if (!hasSubSegments(folder)) return null;
  const map = subSegmentMap(folder);
  if (Object.hasOwn(map, segment)) return segment;
  for (const [trSub, enSub] of Object.entries(map)) if (enSub === segment) return trSub;
  return null;
}

/** The public second segment for a Turkish sub-folder in `locale` (unknown sub-folders pass through). */
export function subSegmentFor(locale: Locale, folder: string, trSub: string): string {
  if (locale === "tr" || !hasSubSegments(folder)) return trSub;
  const map = subSegmentMap(folder);
  return Object.hasOwn(map, trSub) ? map[trSub] : trSub;
}

/** True when `segment` is the Turkish spelling of a translated sub-segment under `folder`. */
export function isTurkishSubSegment(folder: string, segment: string): boolean {
  return hasSubSegments(folder) && Object.hasOwn(subSegmentMap(folder), segment);
}

/** True when `segment` is the English spelling of a translated sub-segment under `folder`. */
export function isEnglishSubSegment(folder: string, segment: string): boolean {
  return hasSubSegments(folder) && Object.values(subSegmentMap(folder)).includes(segment);
}

type SlugParams = { slug: string };
type OrderParams = { orderNumber: string };
type RouteParams = {
  product: SlugParams;
  category: SlugParams;
  post: SlugParams;
  page: SlugParams;
  order: OrderParams;
  /** /hesap/siparisler/<orderNumber> — an order in the customer's account. */
  accountOrder: OrderParams;
};
export type ParamRoute = keyof RouteParams;
export type StaticRoute =
  | "home"
  | "products"
  | "cart"
  | "checkout"
  | "account"
  | "business"
  | "samples"
  | "blog"
  | "contact"
  /** /siparis — order lookup form (order number + e-mail). */
  | "orderLookup"
  /** /odeme/simulator — fake 3-D Secure page (PAYMENT_SIMULATOR only). */
  | "paymentSimulator"
  /** /odeme/kart — the card provider's payment page (PayTR iframe). */
  | "cardPayment"
  // Customer accounts (/hesap/…). The auth pages are public; the rest needs a session (proxy gate).
  | "signIn"
  | "register"
  | "forgotPassword"
  | "resetPassword"
  | "verifyEmail"
  | "accountOrders"
  | "accountAddresses"
  | "accountProfile"
  | "accountFavorites"
  | "accountSubscriptions"
  | "accountBusiness"
  // Newsletter double opt-in landing pages (signed links from e-mails).
  | "newsletterConfirm"
  | "newsletterUnsubscribe";
export type Route = StaticRoute | ParamRoute;

type RoutePath = { folder: TurkishSegment; sub?: string; suffix?: string };

const subRoute = <P extends SubSegmentParent>(folder: P, sub: SubSegmentsOf<P>): RoutePath => ({ folder, sub });

const ROUTE_PATHS: Record<Exclude<Route, "home">, RoutePath> = {
  products: { folder: "urunler" },
  product: { folder: "urunler" },
  category: { folder: "kategori" },
  cart: { folder: "sepet" },
  checkout: { folder: "odeme" },
  account: { folder: "hesap" },
  business: { folder: "kurumsal" },
  samples: { folder: "numune" },
  blog: { folder: "blog" },
  post: { folder: "blog" },
  page: { folder: "sayfa" },
  contact: { folder: "iletisim" },
  order: { folder: "siparis" },
  orderLookup: { folder: "siparis" },
  // Fixed sub-path, the same in every language.
  paymentSimulator: { folder: "odeme", suffix: "/simulator" },
  cardPayment: subRoute("odeme", "kart"),
  signIn: subRoute("hesap", "giris"),
  register: subRoute("hesap", "kayit"),
  forgotPassword: subRoute("hesap", "sifremi-unuttum"),
  resetPassword: subRoute("hesap", "sifre-sifirla"),
  verifyEmail: subRoute("hesap", "dogrula"),
  accountOrders: subRoute("hesap", "siparisler"),
  accountOrder: subRoute("hesap", "siparisler"),
  accountAddresses: subRoute("hesap", "adresler"),
  accountProfile: subRoute("hesap", "profil"),
  accountFavorites: subRoute("hesap", "favoriler"),
  accountSubscriptions: subRoute("hesap", "abonelikler"),
  accountBusiness: subRoute("hesap", "kurumsal"),
  newsletterConfirm: subRoute("bulten", "onay"),
  newsletterUnsubscribe: subRoute("bulten", "ayril"),
};

/** Account pages that never need a session (the proxy's /hesap gate lets them through). */
export const ACCOUNT_AUTH_SUB_SEGMENTS: readonly string[] = ["giris", "kayit", "sifremi-unuttum", "sifre-sifirla", "dogrula"];

type AnyParams = Partial<SlugParams & OrderParams>;

/**
 * Public path for a route: href("en", "product", { slug: "lavanta" }) → "/en/products/lavanta",
 * href("en", "order", { orderNumber: "PR-261001" }) → "/en/order/PR-261001",
 * href("en", "signIn") → "/en/account/sign-in".
 * Always build storefront links with this (or localizePath for stored canonical paths).
 */
export function href(locale: Locale, route: StaticRoute): string;
export function href<R extends ParamRoute>(locale: Locale, route: R, params: RouteParams[R]): string;
export function href(locale: Locale, route: Route, params?: AnyParams): string {
  if (route === "home") return `/${locale}`;
  const { folder, sub, suffix } = ROUTE_PATHS[route];
  const base = `/${locale}/${segmentFor(locale, folder)}${sub ? `/${subSegmentFor(locale, folder, sub)}` : ""}${suffix ?? ""}`;
  const param = route === "order" || route === "accountOrder" ? params?.orderNumber : params?.slug;
  return param ? `${base}/${encodeURIComponent(param)}` : base;
}

/** Longest return path `safeReturnPath` accepts. */
const MAX_RETURN_PATH = 512;

/**
 * A `sonra` (return-to) value that is safe to redirect to: a local path only ("/tr/hesap", optionally
 * with a query and hash). Refuses absolute and protocol-relative URLs, backslashes, control or
 * whitespace characters, encoded slashes that could turn into "//", and anything over 512 characters.
 * Returns null when unsafe (callers fall back to a default page).
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_RETURN_PATH) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // Backslashes ("/\evil.example" acts like "//evil.example"), whitespace and control characters.
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  // Encoded slashes/backslashes at the start could be decoded by a later hop into "//host".
  if (/^\/(?:%2f|%5c)/i.test(value)) return null;
  try {
    const parsed = new URL(value, "http://return.invalid");
    if (parsed.origin !== "http://return.invalid") return null;
  } catch {
    return null;
  }
  return value;
}

/**
 * Sign-in page that returns to `returnTo` afterwards: signInHref("en", "/en/account/orders")
 * → "/en/account/sign-in?sonra=%2Fen%2Faccount%2Forders". An unsafe return path is dropped.
 */
export function signInHref(locale: Locale, returnTo?: string | null): string {
  const base = href(locale, "signIn");
  const safe = safeReturnPath(returnTo);
  return safe ? `${base}?sonra=${encodeURIComponent(safe)}` : base;
}

/** True for absolute URLs (http:, mailto:, tel:, …) and protocol-relative ones. */
export function isExternalHref(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//");
}

function splitSuffix(path: string): { pathname: string; suffix: string } {
  const index = path.search(/[?#]/);
  return index === -1 ? { pathname: path, suffix: "" } : { pathname: path.slice(0, index), suffix: path.slice(index) };
}

/**
 * Converts a stored path (canonical Turkish like "/urunler/lavanta", or an already-localized one)
 * into the public path for `locale`. External links, "#anchors" and empty values pass through.
 * localizePath("en", "/urunler?sirala=yeni") → "/en/products?sirala=yeni",
 * localizePath("ar", "/hesap/giris") → "/ar/account/sign-in", localizePath("tr", "/en/account/orders") → "/tr/hesap/siparisler"
 */
export function localizePath(locale: Locale, path: string): string {
  if (!path || path.startsWith("#") || isExternalHref(path)) return path;
  const { pathname, suffix } = splitSuffix(path);
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length > 0 && isLocaleCode(parts[0])) parts.shift();
  if (parts.length > 0) {
    const folder = toFolderSegment(parts[0]);
    if (folder) {
      parts[0] = segmentFor(locale, folder);
      if (parts.length > 1) {
        const sub = toSubFolderSegment(folder, parts[1]);
        if (sub) parts[1] = subSegmentFor(locale, folder, sub);
      }
    }
  }
  return `/${locale}${parts.length > 0 ? `/${parts.join("/")}` : ""}${suffix}`;
}

/**
 * The canonical Turkish folder path of a public storefront path, without locale and query:
 * folderPath("/en/account/orders/PR-1?x") → { locale: "en", path: "/hesap/siparisler/PR-1" }.
 * Null when the path does not start with a locale.
 */
export function folderPath(publicPath: string): { locale: Locale; path: string } | null {
  const { pathname } = splitSuffix(publicPath);
  const parts = pathname.split("/").filter(Boolean);
  const [locale] = parts;
  if (!isLocaleCode(locale)) return null;
  const rest = localizePath("tr", `/${parts.slice(1).join("/")}`).slice("/tr".length);
  return { locale, path: rest || "/" };
}

/** Same page in another language: switchLocalePath("/en/products/lavanta", "tr") → "/tr/urunler/lavanta". */
export function switchLocalePath(currentPath: string, target: Locale): string {
  return localizePath(target, currentPath || "/");
}

/** Every locale's version of a route, for <link rel="alternate" hreflang> via Metadata.alternates. */
export function localeAlternates(locale: Locale, route: StaticRoute): LocaleAlternates;
export function localeAlternates<R extends ParamRoute>(locale: Locale, route: R, params: RouteParams[R]): LocaleAlternates;
export function localeAlternates(locale: Locale, route: Route, params?: AnyParams): LocaleAlternates {
  const build = (l: Locale) => (href as (l: Locale, r: Route, p?: AnyParams) => string)(l, route, params);
  const languages = Object.fromEntries(LOCALE_CODES.map((l) => [l, build(l)])) as Record<Locale, string>;
  return { canonical: build(locale), languages: { ...languages, "x-default": build(DEFAULT_LOCALE) } };
}

export type LocaleAlternates = {
  canonical: string;
  languages: Record<Locale | "x-default", string>;
};

/** Public site origin without a trailing slash (NEXT_PUBLIC_SITE_URL, else localhost). */
export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Absolute URL for a public path. */
export function absoluteUrl(path: string): string {
  return `${siteOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}
