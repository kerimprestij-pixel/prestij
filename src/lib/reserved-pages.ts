// Page-builder pages that hold the content of a dedicated storefront route instead of living at
// /sayfa/<slug>: /kurumsal, /numune and /iletisim (en/ar: /business, /samples, /contact).
// Pure and dependency-free: used by those routes, the /sayfa redirect, the sitemap and the panel
// (a reserved page keeps its slug, cannot be deleted, and "Sitede gör" opens its own route).
import type { StaticRoute } from "@/i18n/paths";

/** Reserved slug → the storefront route that renders it (build links with href(locale, route)). */
export const RESERVED_PAGES = {
  kurumsal: "business",
  numune: "samples",
  iletisim: "contact",
} as const satisfies Record<string, StaticRoute>;

export type ReservedPageSlug = keyof typeof RESERVED_PAGES;

export const RESERVED_PAGE_SLUGS = Object.keys(RESERVED_PAGES) as ReservedPageSlug[];

export function isReservedPageSlug(slug: string): slug is ReservedPageSlug {
  return Object.hasOwn(RESERVED_PAGES, slug);
}

/** Canonical (locale-less Turkish) storefront path of a reserved page: reservedPagePath("kurumsal") → "/kurumsal". */
export function reservedPagePath(slug: ReservedPageSlug): string {
  return `/${slug}`;
}
