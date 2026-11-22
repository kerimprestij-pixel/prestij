// Panel reads for the blog (uncached). Callers have checked the role (editor+).
import "server-only";
import { and, count, desc, eq, gt, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText, SeoFields } from "@/db/schema";
import { mediaColumns } from "@/lib/data/media";
import type { MediaLike } from "@/lib/media/types";
import { escapeLike, FOLD_FROM, FOLD_TO, foldText } from "../format";

const b = schema.blogPosts;

export type PanelPostFilter = "all" | "published" | "scheduled" | "draft";

export type PanelPostRow = {
  id: number;
  slug: string;
  title: LocalizedText;
  status: "draft" | "published";
  /** ISO */
  publishedAt: string | null;
  /** ISO */
  updatedAt: string;
  readingMinutes: number | null;
  authorName: string | null;
  tags: string[];
  cover: MediaLike | null;
  /** Translations present (title + body). */
  hasEn: boolean;
  hasAr: boolean;
};

export type PanelPostList = {
  rows: PanelPostRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  counts: Record<PanelPostFilter, number>;
  /** The instant the list was read (epoch ms): decides "Yayında" vs "Planlandı". */
  now: number;
};

const PAGE_SIZE = 25;

function filterWhere(filter: PanelPostFilter, now: Date): SQL | undefined {
  switch (filter) {
    case "draft":
      return eq(b.status, "draft");
    case "scheduled":
      return and(eq(b.status, "published"), gt(b.publishedAt, now));
    case "published":
      return and(eq(b.status, "published"), or(isNull(b.publishedAt), lte(b.publishedAt, now)));
    default:
      return undefined;
  }
}

const fold = (expr: SQL) => sql`lower(translate(coalesce(${expr}, ''), ${FOLD_FROM}, ${FOLD_TO}))`;

/** One page of posts (newest publish date first, drafts by last edit), with counts per filter tab. */
export async function listPanelPosts({ filter = "all", q = "", page = 1 }: { filter?: PanelPostFilter; q?: string; page?: number } = {}): Promise<PanelPostList> {
  const now = new Date();
  const nowIso = now.toISOString();
  const query = q.trim().slice(0, 100);
  const search = query
    ? or(
        sql`${fold(sql`${b.title}::text`)} like ${`%${escapeLike(foldText(query))}%`}`,
        sql`${b.slug} like ${`%${escapeLike(foldText(query))}%`}`,
        sql`${fold(sql`array_to_string(${b.tags}, ' ')`)} like ${`%${escapeLike(foldText(query))}%`}`,
        sql`${fold(sql`${b.authorName}`)} like ${`%${escapeLike(foldText(query))}%`}`,
      )
    : undefined;

  const [countRows] = await db
    .select({
      all: count(),
      draft: sql<number>`count(*) filter (where ${b.status} = 'draft')`.mapWith(Number),
      scheduled: sql<number>`count(*) filter (where ${b.status} = 'published' and ${b.publishedAt} > ${nowIso}::timestamptz)`.mapWith(Number),
      published: sql<number>`count(*) filter (where ${b.status} = 'published' and (${b.publishedAt} is null or ${b.publishedAt} <= ${nowIso}::timestamptz))`.mapWith(Number),
    })
    .from(b)
    .where(search);

  const counts: Record<PanelPostFilter, number> = {
    all: Number(countRows?.all ?? 0),
    draft: countRows?.draft ?? 0,
    scheduled: countRows?.scheduled ?? 0,
    published: countRows?.published ?? 0,
  };
  const total = counts[filter];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);

  const rows = await db
    .select({
      id: b.id,
      slug: b.slug,
      title: b.title,
      body: b.body,
      status: b.status,
      publishedAt: b.publishedAt,
      updatedAt: b.updatedAt,
      readingMinutes: b.readingMinutes,
      authorName: b.authorName,
      tags: b.tags,
      cover: mediaColumns,
    })
    .from(b)
    .leftJoin(schema.media, eq(schema.media.id, b.coverId))
    .where(and(filterWhere(filter, now), search))
    .orderBy(sql`${b.publishedAt} desc nulls first`, desc(b.updatedAt), desc(b.id))
    .limit(PAGE_SIZE)
    .offset((current - 1) * PAGE_SIZE);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
      readingMinutes: r.readingMinutes ?? null,
      authorName: r.authorName ?? null,
      tags: r.tags ?? [],
      cover: r.cover?.id ? r.cover : null,
      hasEn: Boolean(r.title.en && r.body?.en),
      hasAr: Boolean(r.title.ar && r.body?.ar),
    })),
    total,
    page: current,
    pageSize: PAGE_SIZE,
    pageCount,
    counts,
    now: now.getTime(),
  };
}

/** Editor state of one post (dates as ISO strings), or null. */
export async function getPanelPost(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await db.select().from(b).where(eq(b.id, id)).limit(1);
  if (!row) return null;
  const seo: SeoFields = row.seo ?? {};
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? null,
    body: row.body ?? null,
    coverId: row.coverId ?? null,
    authorName: row.authorName ?? "",
    tags: row.tags ?? [],
    relatedProductIds: row.relatedProductIds ?? [],
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    seo: { title: seo.title ?? null, description: seo.description ?? null, ogImageId: seo.ogImageId ?? null, noIndex: seo.noIndex ?? false },
    readingMinutes: row.readingMinutes ?? null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export type PanelPost = NonNullable<Awaited<ReturnType<typeof getPanelPost>>>;

/** Every tag used so far (for suggestions), most used first. */
export async function listBlogTags(): Promise<string[]> {
  const rows = await db.execute<{ tag: string }>(
    sql`select tag from (select unnest(${b.tags}) as tag from ${b}) t group by tag order by count(*) desc, tag asc limit 100`,
  );
  return rows.map((r) => r.tag);
}
