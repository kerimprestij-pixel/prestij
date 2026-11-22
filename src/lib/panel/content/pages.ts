// Page rules shared by the panel's page list, the page editor and the page service. Pure and
// client-safe (no DB, no Next APIs).
import type { PageKind } from "@/db/schema/site";

/**
 * CMS pages with their own storefront route instead of /sayfa/<slug> (SITE-PAGES renders them). Their
 * slug is fixed and they can't be deleted. Keep in sync with ROUTE_PAGES in src/lib/panel/pickers.ts.
 */
export const RESERVED_PAGE_ROUTES: Readonly<Record<string, string>> = {
  kurumsal: "/kurumsal",
  numune: "/numune",
  iletisim: "/iletisim",
};

/**
 * Page-builder rows that hold the copy of another storefront route: the `urunler` row's title, SEO texts
 * and sections show on /urunler (src/app/[locale]/urunler/page.tsx); /sayfa/urunler redirects there.
 */
export const ROUTE_COPY_PAGES: Readonly<Record<string, string>> = {
  urunler: "/urunler",
};

/** Slugs a custom page may not take: the home row, the routed pages and page-builder rows for other routes. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["home", "urunler", ...Object.keys(RESERVED_PAGE_ROUTES)]);

export const PAGE_KIND_LABELS: Record<PageKind, string> = {
  home: "Ana sayfa",
  custom: "Özel sayfa",
  legal: "Yasal metin",
  landing: "Açılış sayfası",
  b2b: "Kurumsal sayfa",
};

type PageLike = { slug: string; kind: PageKind | string };

/** Label for lists and the editor header: routed pages read as "Sabit sayfa" whatever their kind. */
export function pageKindLabel(page: PageLike): string {
  if (page.kind !== "home" && RESERVED_PAGE_ROUTES[page.slug]) return "Sabit sayfa";
  return PAGE_KIND_LABELS[page.kind as PageKind] ?? "Sayfa";
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/** Home, legal and routed pages keep their address (other code and the menus link to it). */
export function isFixedSlugPage(page: PageLike): boolean {
  return page.kind === "home" || page.kind === "legal" || isReservedSlug(page.slug);
}

/** The home page and the legal pages must stay published (the checkout links to the legal texts). */
export function isAlwaysPublished(page: PageLike): boolean {
  return page.kind === "home" || page.kind === "legal";
}

/** Only custom pages can be deleted: never the home page, legal pages or the routed pages. */
export function canDeletePage(page: PageLike): boolean {
  return page.kind !== "home" && page.kind !== "legal" && !isReservedSlug(page.slug);
}

/** Canonical (locale-less, Turkish) storefront path of a page, for "Sitede gör". */
export function pageSitePath(page: PageLike): string {
  if (page.kind === "home" || page.slug === "home") return "/";
  return RESERVED_PAGE_ROUTES[page.slug] ?? ROUTE_COPY_PAGES[page.slug] ?? `/sayfa/${page.slug}`;
}

/** Where a page appears on the storefront, as a short note for the editor. */
export function pageAddressNote(page: PageLike): string {
  if (page.kind === "home") return "Sitenin ana sayfası.";
  const route = RESERVED_PAGE_ROUTES[page.slug] ?? ROUTE_COPY_PAGES[page.slug];
  if (route) return `Bu içerik ${route} adresinde gösterilir.`;
  return `Bu sayfa /sayfa/${page.slug} adresinde yayınlanır.`;
}

export type PageGroupKey = "site" | "custom" | "legal";

/** List grouping: site pages (home + routed), custom pages, legal pages. */
export function pageGroup(page: PageLike): PageGroupKey {
  if (page.kind === "home" || isReservedSlug(page.slug)) return "site";
  if (page.kind === "legal") return "legal";
  return "custom";
}

export const PAGE_GROUPS: { key: PageGroupKey; title: string; description: string }[] = [
  { key: "site", title: "Site sayfaları", description: "Ana sayfa ve menüden bağlanan sabit sayfalar." },
  { key: "custom", title: "Özel sayfalar", description: "Sizin oluşturduğunuz sayfalar; /sayfa/… adresinde yayınlanır." },
  { key: "legal", title: "Yasal sayfalar", description: "Yasal metinlerin gösterildiği sayfalar. Metinleri Yasal Metinler bölümünden düzenleyin." },
];

/** Display order inside the list: home first, then the routed pages, then the rest by title. */
export function pageSortRank(page: PageLike): number {
  if (page.kind === "home") return 0;
  const routed = Object.keys(RESERVED_PAGE_ROUTES).indexOf(page.slug);
  return routed >= 0 ? 1 + routed : 10;
}
