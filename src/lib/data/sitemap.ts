// Indexable storefront records for app/sitemap.ts and the IndexNow job (src/lib/seo/jobs.ts).
// getSitemapData is cached and invalidated with the catalog/page/blog/media tags; querySitemapData is
// the uncached query behind it (the IndexNow job and DB tests call it directly, because cacheLife only
// works inside Next). The URL list itself is built by buildSitemap (src/lib/seo/sitemap-entries.ts).
import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import type { LocalizedText, SeoFields } from "@/db/schema";
import { LOCALES } from "@/i18n/locales";
import { localize } from "@/i18n/localize";
import { defaultMessages } from "@/i18n/messages";
import { TAGS } from "@/lib/cache-tags";
import { nextScheduledAt } from "@/lib/data/blog";
import { imageOnly } from "@/lib/data/media";
import { lifeUntil, postLastModified } from "@/lib/panel/blog/reading";
import type { Tx } from "@/lib/panel/tx";
import { isReservedPageSlug, RESERVED_PAGE_SLUGS } from "@/lib/reserved-pages";
import { SITEMAP_PRODUCT_IMAGES, type SitemapData, type SitemapItem, type SitemapVideo } from "@/lib/seo/sitemap-entries";
import { productVideoName } from "@/lib/seo/structured-data";

export type { SitemapData, SitemapItem, SitemapVideo };

/** The page-builder row of the home page (src/app/[locale]/page.tsx reads getPage("home")). */
const HOME_PAGE_SLUG = "home";

/** The page-builder row that holds the copy of /urunler (src/app/[locale]/urunler/page.tsx). */
const PRODUCTS_PAGE_SLUG = "urunler";

/** Page-builder slugs that hold copy for a dedicated route rather than a page of their own. */
const ROUTE_CONTENT_PAGES = new Set<string>([PRODUCTS_PAGE_SLUG, ...RESERVED_PAGE_SLUGS]);

const indexable = (seo: SeoFields | null) => !seo?.noIndex;
const toItem = (row: { slug: string; updatedAt: Date }): SitemapItem => ({ slug: row.slug, updatedAt: row.updatedAt.toISOString() });

/** Cached sitemap records. A scheduled blog post appears on time: the entry revalidates at its publish date. */
export async function getSitemapData(): Promise<SitemapData> {
  "use cache";
  cacheTag(TAGS.products, TAGS.categories, TAGS.pages, TAGS.blog, TAGS.media);
  const now = new Date();
  const [data, next] = await Promise.all([querySitemapData(db, now), nextScheduledAt(now)]);
  const life = lifeUntil(next);
  if (life === "max") cacheLife("max");
  else cacheLife(life);
  return data;
}

/**
 * Every indexable record (uncached): active standard/bundle products sold to everyone (business-only
 * products are noindex, like the feed leaves them out) with up to SITEMAP_PRODUCT_IMAGES image URLs
 * (gallery order, then variant images; images only) and, day 6, their videos that have a cover image
 * (title as the page's VideoObject names it, per locale), visible categories, published pages, the
 * reserved route pages, and public blog posts with their cover (lastmod never before the publish date).
 * Rows marked noIndex are left out. Also the last change of the home and /urunler page rows (their
 * lastmod includes it).
 */
export async function querySitemapData(executor: Tx = db, now: Date = new Date()): Promise<SitemapData> {
  const { products: p, categories: c, pages, blogPosts: b, productMedia: pm, productVariants: v, media: m } = schema;
  const poster = alias(schema.media, "poster");
  const [products, categories, pageRows, postRows] = await Promise.all([
    executor
      .select({ id: p.id, slug: p.slug, seo: p.seo, updatedAt: p.updatedAt, name: p.name, subtitle: p.subtitle, shortDescription: p.shortDescription })
      .from(p)
      .where(and(eq(p.status, "active"), inArray(p.type, ["standard", "bundle"]), eq(p.businessOnly, false)))
      .orderBy(asc(p.position), asc(p.id)),
    executor
      .select({ slug: c.slug, seo: c.seo, updatedAt: c.updatedAt })
      .from(c)
      .where(eq(c.isVisible, true))
      .orderBy(asc(c.position), asc(c.id)),
    executor
      .select({ slug: pages.slug, kind: pages.kind, seo: pages.seo, updatedAt: pages.updatedAt })
      .from(pages)
      .where(eq(pages.isPublished, true))
      .orderBy(asc(pages.slug)),
    executor
      .select({ slug: b.slug, seo: b.seo, updatedAt: b.updatedAt, publishedAt: b.publishedAt, cover: m.url })
      .from(b)
      .leftJoin(m, eq(m.id, b.coverId))
      .where(and(eq(b.status, "published"), or(isNull(b.publishedAt), lte(b.publishedAt, now))))
      .orderBy(desc(b.publishedAt), asc(b.id)),
  ]);

  const listed = products.filter((r) => indexable(r.seo));
  const ids = listed.map((r) => r.id);
  const [galleryRows, variantRows, videoRows] = ids.length
    ? await Promise.all([
        executor
          .select({ productId: pm.productId, url: m.url })
          .from(pm)
          .innerJoin(m, eq(m.id, pm.mediaId))
          .where(and(inArray(pm.productId, ids), imageOnly(m)))
          .orderBy(asc(pm.productId), asc(pm.position), asc(pm.id)),
        executor
          .select({ productId: v.productId, url: m.url })
          .from(v)
          .innerJoin(m, eq(m.id, v.imageId))
          .where(and(inArray(v.productId, ids), eq(v.isActive, true), imageOnly(m)))
          .orderBy(asc(v.productId), asc(v.position), asc(v.id)),
        executor
          .select({ productId: pm.productId, url: m.url, alt: m.alt, durationMs: m.durationMs, createdAt: m.createdAt, thumbnail: poster.url })
          .from(pm)
          .innerJoin(m, eq(m.id, pm.mediaId))
          .innerJoin(poster, and(eq(poster.id, m.posterId), imageOnly(poster)))
          .where(and(inArray(pm.productId, ids), eq(m.kind, "video")))
          .orderBy(asc(pm.productId), asc(pm.position), asc(pm.id)),
      ])
    : [[], [], []];
  const imagesBy = new Map<number, string[]>();
  for (const row of [...galleryRows, ...variantRows]) {
    const list = imagesBy.get(row.productId) ?? [];
    if (row.url && !list.includes(row.url) && list.length < SITEMAP_PRODUCT_IMAGES) list.push(row.url);
    imagesBy.set(row.productId, list);
  }
  const videosBy = new Map<number, SitemapVideo[]>();
  for (const product of listed) {
    const rows = videoRows.filter((r) => r.productId === product.id);
    const videos = rows.map((row, index) => {
      const title = {} as LocalizedText;
      const description = {} as LocalizedText;
      for (const locale of LOCALES) {
        title[locale] = productVideoName(product, row, { index, count: rows.length }, locale, defaultMessages[locale].product.video);
        description[locale] = localize(product.shortDescription, locale).trim() || title[locale];
      }
      return { title, description, thumbnail: row.thumbnail, content: row.url, durationMs: row.durationMs, publishedAt: row.createdAt.toISOString() };
    });
    if (videos.length) videosBy.set(product.id, videos);
  }

  const contentPages = pageRows.filter((r) => r.kind !== "home");
  const home = pageRows.find((r) => r.slug === HOME_PAGE_SLUG); // the home route reads getPage("home")
  const productsPage = contentPages.find((r) => r.slug === PRODUCTS_PAGE_SLUG);

  return {
    products: listed.map((r) => {
      const images = imagesBy.get(r.id) ?? [];
      const videos = videosBy.get(r.id);
      return { ...toItem(r), ...(images.length ? { images } : {}), ...(videos ? { videos } : {}) };
    }),
    categories: categories.filter((r) => indexable(r.seo)).map(toItem),
    pages: contentPages.filter((r) => indexable(r.seo) && !ROUTE_CONTENT_PAGES.has(r.slug)).map(toItem),
    reservedPages: contentPages.flatMap((r) => (indexable(r.seo) && isReservedPageSlug(r.slug) ? [{ ...toItem(r), slug: r.slug }] : [])),
    posts: postRows
      .filter((r) => indexable(r.seo))
      .map((r) => ({ ...toItem({ slug: r.slug, updatedAt: postLastModified(r) }), ...(r.cover ? { images: [r.cover] } : {}) })),
    ...(home ? { homeUpdatedAt: home.updatedAt.toISOString() } : {}),
    ...(productsPage ? { productsPage: { updatedAt: productsPage.updatedAt.toISOString(), noIndex: !indexable(productsPage.seo) } } : {}),
  };
}
