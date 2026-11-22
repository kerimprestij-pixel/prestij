// The sitemap's URL list, built from the indexable rows (src/lib/data/sitemap.ts) and the enabled
// locales. Pure (no DB, no Next APIs): src/app/sitemap.ts prints it and the IndexNow job
// (src/lib/seo/jobs.ts) submits the entries that changed, so both always agree.
import type { MetadataRoute } from "next";
import type { LocalizedText } from "@/db/schema/common";
import type { Locale } from "@/i18n/config";
import { DEFAULT_LOCALE, LOCALE_CODES, absoluteUrl, href, type ParamRoute, type StaticRoute } from "@/i18n/paths";
import { RESERVED_PAGES, type ReservedPageSlug } from "@/lib/reserved-pages";

/**
 * Day 6: a product video for the video sitemap. Title and description are per locale (a missing locale
 * falls back to Turkish); the thumbnail is the cover image and `content` the file (URL or site path).
 */
export type SitemapVideo = {
  title: LocalizedText;
  description: LocalizedText;
  thumbnail: string;
  content: string;
  durationMs?: number | null;
  /** ISO time of the upload. */
  publishedAt?: string;
};

/** One indexable record: its slug, last change (ISO), the absolute-or-site-relative URLs of its images and (products) its videos. */
export type SitemapItem = { slug: string; updatedAt: string; images?: string[]; videos?: SitemapVideo[] };

export type SitemapData = {
  products: SitemapItem[];
  categories: SitemapItem[];
  pages: SitemapItem[];
  /** Published, indexable pages of the dedicated routes /kurumsal, /numune, /iletisim. */
  reservedPages: (SitemapItem & { slug: ReservedPageSlug })[];
  /** Public, indexable blog posts (newest first), `images` = the cover; updatedAt is never before the publish date. */
  posts: SitemapItem[];
  /** Last change (ISO) of the published home page row: a page save bumps it, sections included. */
  homeUpdatedAt?: string;
  /** The published page row behind /urunler (slug `urunler`): its last change, and noIndex leaves /urunler out. */
  productsPage?: { updatedAt: string; noIndex: boolean };
};

export type SitemapEntry = MetadataRoute.Sitemap[number];

/** Google reads up to 1,000 images per URL; product pages list their first few (gallery order). */
export const SITEMAP_PRODUCT_IMAGES = 5;

type Target = { route: StaticRoute } | { route: ParamRoute; slug: string };

function pathFor(locale: Locale, target: Target): string {
  return "slug" in target ? href(locale, target.route, { slug: target.slug }) : href(locale, target.route);
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/**
 * An image URL that is safe inside `<image:loc>`: absolute, percent-encoded (spaces, non-ASCII) and
 * XML-escaped, because Next writes sitemap values into the XML as they are. Anything that does not
 * start with http(s):// is a path on this site (so it can never become another scheme); null when empty.
 */
export function sitemapImageUrl(urlOrPath: string): string | null {
  const raw = urlOrPath.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : absoluteUrl(raw));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
  } catch {
    return null;
  }
}

/** A character XML 1.0 allows (tab, line breaks and everything from U+0020 except U+FFFE/U+FFFF). */
const xmlChar = (ch: string) => {
  const code = ch.codePointAt(0) ?? 0;
  return code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code !== 0xfffe && code !== 0xffff);
};

/**
 * Text that is safe inside an XML element, because Next writes sitemap values as they are: characters
 * XML does not allow dropped, white space collapsed, at most `max` characters, then XML-escaped.
 */
export function sitemapText(value: string, max = 2048): string {
  const clean = Array.from(value).filter(xmlChar).join("").replace(/\s+/g, " ").trim();
  return Array.from(clean)
    .slice(0, max)
    .join("")
    .trimEnd()
    .replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/** Google's video sitemap accepts durations of 1–28,800 seconds. */
const MAX_VIDEO_SECONDS = 28_800;

/**
 * Day 6: the `videos` of one locale's entry: title and description in that language (Turkish fallback),
 * XML-escaped; thumbnail and file as absolute, escaped URLs (sitemapImageUrl); duration in whole seconds
 * (1–28,800, else left out); publication date as given (ISO). A video without a usable title, thumbnail
 * or file is left out.
 */
export function sitemapVideos(videos: readonly SitemapVideo[] | undefined, locale: Locale): NonNullable<SitemapEntry["videos"]> {
  const out: NonNullable<SitemapEntry["videos"]> = [];
  for (const video of videos ?? []) {
    const title = sitemapText(video.title[locale] || video.title.tr || "", 100);
    const description = sitemapText(video.description[locale] || video.description.tr || "", 2048) || title;
    const thumbnail = sitemapImageUrl(video.thumbnail);
    const content = sitemapImageUrl(video.content);
    if (!title || !thumbnail || !content) continue;
    const seconds = typeof video.durationMs === "number" && Number.isFinite(video.durationMs) ? Math.round(video.durationMs / 1000) : 0;
    out.push({
      title,
      thumbnail_loc: thumbnail,
      description,
      content_loc: content,
      ...(seconds >= 1 && seconds <= MAX_VIDEO_SECONDS ? { duration: seconds } : {}),
      ...(video.publishedAt && !Number.isNaN(Date.parse(video.publishedAt)) ? { publication_date: video.publishedAt } : {}),
    });
  }
  return out;
}

/** Every indexable storefront URL in each enabled locale, with hreflang alternates (x-default = Turkish), images and (day 6) product videos. */
export function buildSitemap(data: SitemapData, enabledLocales: readonly string[]): MetadataRoute.Sitemap {
  const active = LOCALE_CODES.filter((l) => enabledLocales.includes(l));
  const xDefault: Locale = active.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : (active[0] ?? DEFAULT_LOCALE);

  const entries = (target: Target, priority: number, lastModified?: string, images?: readonly string[], videos?: readonly SitemapVideo[]): SitemapEntry[] => {
    const languages: Record<string, string> = Object.fromEntries(active.map((l) => [l, absoluteUrl(pathFor(l, target))]));
    languages["x-default"] = absoluteUrl(pathFor(xDefault, target));
    const imageUrls = [...new Set((images ?? []).map(sitemapImageUrl).filter((u): u is string => Boolean(u)))];
    return active.map((locale) => {
      const localVideos = sitemapVideos(videos, locale);
      return {
        url: absoluteUrl(pathFor(locale, target)),
        ...(lastModified ? { lastModified } : {}),
        priority,
        alternates: { languages },
        ...(imageUrls.length ? { images: imageUrls } : {}),
        ...(localVideos.length ? { videos: localVideos } : {}),
      };
    });
  };

  // ISO strings from toISOString() (same length and zone) sort chronologically.
  const latest = (...values: (string | undefined)[]) => values.filter((v): v is string => Boolean(v)).sort().at(-1);
  const newest = latest(...[...data.products, ...data.categories].map((i) => i.updatedAt));
  const newestPost = latest(...data.posts.map((p) => p.updatedAt));

  return [
    // Home and /urunler show the catalog and their own page-builder copy (hero, FAQ, guide).
    ...entries({ route: "home" }, 1, latest(newest, data.homeUpdatedAt)),
    ...(data.productsPage?.noIndex ? [] : entries({ route: "products" }, 0.9, latest(newest, data.productsPage?.updatedAt))),
    ...data.categories.flatMap((c) => entries({ route: "category", slug: c.slug }, 0.8, c.updatedAt)),
    ...data.products.flatMap((p) => entries({ route: "product", slug: p.slug }, 0.8, p.updatedAt, p.images?.slice(0, SITEMAP_PRODUCT_IMAGES), p.videos)),
    ...data.pages.flatMap((p) => entries({ route: "page", slug: p.slug }, 0.3, p.updatedAt)),
    // /kurumsal, /numune, /iletisim: their page-builder pages (published, indexable) live on their own routes.
    ...data.reservedPages.flatMap((p) => entries({ route: RESERVED_PAGES[p.slug] }, p.slug === "kurumsal" ? 0.7 : 0.5, p.updatedAt)),
    // Blog: the index only once there is something to read (an empty "coming soon" page is not worth indexing).
    ...(data.posts.length > 0 ? entries({ route: "blog" }, 0.6, newestPost) : []),
    ...data.posts.flatMap((p) => entries({ route: "post", slug: p.slug }, 0.6, p.updatedAt, p.images?.slice(0, 1))),
  ];
}
