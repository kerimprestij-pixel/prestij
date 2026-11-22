// Day 6 (VIDEO-STORE): the video row a section references (hero `videoMediaId`, video section) with its
// cover image. Cached like getMediaByIds (tag media: a new cover or alt text refreshes the pages), and
// kind-safe: an id that is not a video row, or a cover that is not an image row, is ignored. The
// uncached `queryVideoMedia(id, executor)` is what DB tests call (cacheLife works only inside Next).
import "server-only";
import { and, eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import { TAGS } from "@/lib/cache-tags";
import { imageOnly, mediaColumns } from "@/lib/data/media";
import type { MediaLike } from "@/lib/media/types";
import type { Tx } from "@/lib/panel/tx";

export type SectionVideo = {
  video: {
    id: number;
    url: string;
    mime: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    /** The video's description (media.alt): its accessible name. */
    alt: LocalizedText | null;
  };
  /** The video's own cover image (media.poster_id), when it has one. */
  poster: MediaLike | null;
};

export async function getVideoMedia(id: number | null | undefined): Promise<SectionVideo | null> {
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
  return loadVideoMedia(id);
}

async function loadVideoMedia(id: number): Promise<SectionVideo | null> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.media);
  return queryVideoMedia(id);
}

/** Uncached read behind getVideoMedia. */
export async function queryVideoMedia(id: number, executor: Tx = db): Promise<SectionVideo | null> {
  const m = schema.media;
  const [row] = await executor
    .select({ id: m.id, url: m.url, mime: m.mime, width: m.width, height: m.height, durationMs: m.durationMs, alt: m.alt, posterId: m.posterId })
    .from(m)
    .where(and(eq(m.id, id), eq(m.kind, "video")))
    .limit(1);
  if (!row) return null;
  const [poster] = row.posterId
    ? await executor.select(mediaColumns).from(m).where(and(eq(m.id, row.posterId), imageOnly())).limit(1)
    : [];
  return {
    video: { id: row.id, url: row.url, mime: row.mime, width: row.width, height: row.height, durationMs: row.durationMs, alt: row.alt ?? null },
    poster: poster ?? null,
  };
}
