// Plain, serializable image description shared by the data layer, <Img> and the panel.
// Type-only imports keep this module safe for client components.
import type { LocalizedText } from "@/db/schema/common";
import type { MediaVariant } from "@/db/schema/site";

export type { MediaVariant };

/** Day 6: what a media row holds (column `media.kind`, always in step with `mime`). */
export const MEDIA_KINDS = ["image", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export type MediaLike = {
  id: number;
  /** Public URL of the fallback file (largest WebP for processed images; the file itself for a video). */
  url: string;
  width: number | null;
  height: number | null;
  alt: LocalizedText | null;
  blurDataUrl: string | null;
  dominantColor: string | null;
  variants: MediaVariant[] | null;
  /**
   * Day 6: "image" | "video". Optional so literals and older selects stay valid: a missing kind means an
   * image (every row before day 6 is one). Test it with `isVideoMedia()`, never `kind === "image"`.
   */
  kind?: MediaKind;
  /** Day 6: content type of `url` (e.g. "image/webp", "video/mp4"); selected by the storefront `mediaColumns`. */
  mime?: string;
};

/** Any object with at least the MediaLike columns, e.g. a `media` table row. */
type MediaRowLike = MediaLike & Record<string, unknown>;

/** Narrows a DB row (or a wider object) to the MediaLike fields so it can cross the server/client boundary. */
export function toMediaLike(row: MediaRowLike): MediaLike {
  return {
    id: row.id,
    url: row.url,
    width: row.width ?? null,
    height: row.height ?? null,
    alt: row.alt ?? null,
    blurDataUrl: row.blurDataUrl ?? null,
    dominantColor: row.dominantColor ?? null,
    variants: row.variants ?? null,
    // Kept only when the row has them, so image objects built before day 6 keep their exact shape.
    ...(row.kind !== undefined ? { kind: row.kind } : {}),
    ...(row.mime !== undefined ? { mime: row.mime } : {}),
  };
}

/**
 * Day 6: the row is a video (kind "video", or a video/* mime when the kind was not selected). Pure, for
 * server and client code alike; `<Img>` and every image consumer must skip such rows.
 */
export function isVideoMedia(media: { kind?: string | null; mime?: string | null } | null | undefined): boolean {
  if (!media) return false;
  if (media.kind === "video") return true;
  return typeof media.mime === "string" && media.mime.toLowerCase().startsWith("video/");
}

/**
 * Public URL of a variant. Variants store only their storage key; every key shares the same public
 * base as `media.url` (the URL of one of the variants), so the base is derived from it. This works for
 * local disk ("/media/<key>") and Supabase Storage (".../object/public/<bucket>/<key>") alike. Never call
 * it for a video row (no variants: the result would be a wrong "/media/<key>" URL).
 */
export function variantUrl(media: Pick<MediaLike, "url" | "variants">, key: string): string {
  const variants = media.variants ?? [];
  for (const v of variants) {
    if (media.url.endsWith(v.key)) return media.url.slice(0, media.url.length - v.key.length) + key;
  }
  return `/media/${key}`;
}
