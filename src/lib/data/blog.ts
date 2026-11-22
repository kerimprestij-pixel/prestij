// Storefront blog reads (cached, tags `blog`, `post:<slug>`, `media`). A post is public when it is
// published and its publish date has passed. While a scheduled post is waiting, the cache entries
// that would show it revalidate at its publish time, so it appears on time without a redeploy.
import { and, asc, desc, eq, gt, isNull, lte, min, or } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import type { LocalizedText, SeoFields } from "@/db/schema";
import { TAGS } from "@/lib/cache-tags";
import type { MediaLike } from "@/lib/media/types";
import { lifeUntil, postLastModified } from "@/lib/panel/blog/reading";
import { mediaColumns } from "./media";

const b = schema.blogPosts;

export type PostCardData = {
  id: number;
  slug: string;
  title: LocalizedText;
  excerpt: LocalizedText | null;
  cover: MediaLike | null;
  authorName: string | null;
  /** ISO */
  publishedAt: string;
  readingMinutes: number | null;
};

export type PostDetail = PostCardData & {
  /** Panel-authored HTML per locale; sanitize before rendering. */
  body: LocalizedText | null;
  tags: string[];
  relatedProductIds: number[];
  seo: SeoFields | null;
  /** ISO; the last change, never before the publish date (postLastModified in src/lib/panel/blog/reading.ts). */
  updatedAt: string;
};

/** Calls cacheLife (inside a "use cache" scope) with lifeUntil(at). */
function applyLife(at: Date | null) {
  const life = lifeUntil(at);
  if (life === "max") cacheLife("max");
  else cacheLife(life);
}

const publicWhere = (now: Date) => and(eq(b.status, "published"), or(isNull(b.publishedAt), lte(b.publishedAt, now)));

const cardColumns = {
  id: b.id,
  slug: b.slug,
  title: b.title,
  excerpt: b.excerpt,
  authorName: b.authorName,
  publishedAt: b.publishedAt,
  updatedAt: b.updatedAt,
  createdAt: b.createdAt,
  readingMinutes: b.readingMinutes,
  cover: mediaColumns,
} as const;

type CardRow = {
  id: number;
  slug: string;
  title: LocalizedText;
  excerpt: LocalizedText | null;
  authorName: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  readingMinutes: number | null;
  cover: MediaLike | null;
};

function toCard(row: CardRow): PostCardData {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? null,
    cover: row.cover?.id ? row.cover : null,
    authorName: row.authorName ?? null,
    publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    readingMinutes: row.readingMinutes ?? null,
  };
}

/** The earliest publish date of a scheduled (published, future-dated) post, or null. Uncached. */
export async function nextScheduledAt(now: Date): Promise<Date | null> {
  const [row] = await db
    .select({ at: min(b.publishedAt) })
    .from(b)
    .where(and(eq(b.status, "published"), gt(b.publishedAt, now)));
  return row?.at ? new Date(row.at) : null;
}

/** Public posts, newest first. Uncached (the cached wrapper below adds tags and lifetime). */
export async function selectPublicPosts(now: Date, limit = 200): Promise<PostCardData[]> {
  const rows = await db
    .select(cardColumns)
    .from(b)
    .leftJoin(schema.media, eq(schema.media.id, b.coverId))
    .where(publicWhere(now))
    .orderBy(desc(b.publishedAt), desc(b.id))
    .limit(limit);
  return rows.map((r) => toCard(r as CardRow));
}

/** One public post by slug; `scheduledAt` is set when the post exists but is not public yet. Uncached. */
export async function selectPublicPost(slug: string, now: Date): Promise<{ post: PostDetail | null; scheduledAt: Date | null }> {
  const [row] = await db
    .select({ ...cardColumns, body: b.body, tags: b.tags, relatedProductIds: b.relatedProductIds, seo: b.seo, status: b.status })
    .from(b)
    .leftJoin(schema.media, eq(schema.media.id, b.coverId))
    .where(eq(b.slug, slug))
    .limit(1);
  if (!row || row.status !== "published") return { post: null, scheduledAt: null };
  if (row.publishedAt && row.publishedAt.getTime() > now.getTime()) return { post: null, scheduledAt: row.publishedAt };
  return {
    post: {
      ...toCard(row as CardRow),
      body: row.body ?? null,
      tags: row.tags ?? [],
      relatedProductIds: row.relatedProductIds ?? [],
      seo: row.seo ?? null,
      updatedAt: postLastModified(row).toISOString(),
    },
    scheduledAt: null,
  };
}

/** Public posts for the listing (cached; revalidates when the next scheduled post goes live). */
export async function listPublishedPosts(): Promise<PostCardData[]> {
  "use cache";
  cacheTag(TAGS.blog, TAGS.media);
  const now = new Date();
  const [posts, next] = await Promise.all([selectPublicPosts(now), nextScheduledAt(now)]);
  applyLife(next);
  return posts;
}

/** A public post by slug, or null (cached; a scheduled post's entry revalidates at its publish time). */
export async function getPublishedPost(slug: string): Promise<PostDetail | null> {
  "use cache";
  cacheTag(TAGS.blog, TAGS.post(slug), TAGS.media);
  const { post, scheduledAt } = await selectPublicPost(slug, new Date());
  applyLife(scheduledAt);
  return post;
}

/** Slugs of public posts (generateStaticParams). */
export async function listPublishedPostSlugs(): Promise<string[]> {
  "use cache";
  cacheTag(TAGS.blog);
  const now = new Date();
  const [rows, next] = await Promise.all([
    db.select({ slug: b.slug }).from(b).where(publicWhere(now)).orderBy(desc(b.publishedAt), asc(b.id)).limit(500),
    nextScheduledAt(now),
  ]);
  applyLife(next);
  return rows.map((r) => r.slug);
}
