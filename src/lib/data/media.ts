import { inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import { TAGS } from "@/lib/cache-tags";
import type { MediaLike } from "@/lib/media/types";

/**
 * Columns that make up a MediaLike; reused by other data modules in joins. Day 6: `kind` and `mime` too,
 * so every consumer can tell a video row from an image (`isVideoMedia()` in src/lib/media/types.ts).
 */
export const mediaColumns = {
  id: schema.media.id,
  url: schema.media.url,
  width: schema.media.width,
  height: schema.media.height,
  alt: schema.media.alt,
  blurDataUrl: schema.media.blurDataUrl,
  dominantColor: schema.media.dominantColor,
  variants: schema.media.variants,
  kind: schema.media.kind,
  mime: schema.media.mime,
} as const;

/**
 * Day 6: SQL condition "this media row is an image". Add it to every image query that reads
 * `product_media`/`media` (card images, cart thumbnails, JSON-LD, image sitemap, pickers, e-mails…), so a
 * product video never ends up where an image is expected. Pass the aliased table when you join `media`
 * under another name: `imageOnly(posterAlias)`.
 *
 *   db.select(...).from(pm).innerJoin(schema.media, eq(schema.media.id, pm.mediaId)).where(and(eq(pm.productId, id), imageOnly()))
 */
export function imageOnly(table: { kind: AnyPgColumn } = schema.media): SQL {
  return sql`${table.kind} = 'image'`;
}

/** Normalizes ids for use as a cache key: unique, positive integers, sorted. */
export function normalizeIds(ids: readonly unknown[]): number[] {
  const set = new Set<number>();
  for (const id of ids) {
    const n = typeof id === "string" ? Number(id) : id;
    if (typeof n === "number" && Number.isInteger(n) && n > 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** Media rows by id, keyed by id. Missing ids are simply absent from the result. */
export async function getMediaByIds(ids: readonly number[]): Promise<Record<number, MediaLike>> {
  const wanted = normalizeIds(ids);
  if (wanted.length === 0) return {};
  return loadMedia(wanted);
}

async function loadMedia(ids: number[]): Promise<Record<number, MediaLike>> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.media);
  const rows = await db.select(mediaColumns).from(schema.media).where(inArray(schema.media.id, ids));
  const out: Record<number, MediaLike> = {};
  for (const row of rows) out[row.id] = row;
  return out;
}
