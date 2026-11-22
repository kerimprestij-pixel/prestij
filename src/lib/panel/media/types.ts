// Media library types and limits shared by the server modules and the panel UI. Type-only imports:
// safe in client components.
import type { LocalizedText } from "@/db/schema/common";
import type { MediaKind, MediaLike } from "@/lib/media/types";

/** A media row as the panel library shows it. */
export type PanelMedia = MediaLike & {
  id: number;
  folder: string;
  alt: LocalizedText | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp; send it back as `updatedAt` when editing the alt text. */
  updatedAt: string;
  /** File name as uploaded (null for seeded images). */
  originalName: string | null;
  /** Content type of `url` (image/webp for processed images). */
  mime: string;
  // Day 6 (optional so test literals and older callers stay valid; the panel queries always set them).
  /** "image" | "video" (`media.kind`). */
  kind?: MediaKind;
  /** Video length in ms (null for images). */
  durationMs?: number | null;
  /** The video's cover image id (null for images or a video without one). */
  posterId?: number | null;
  /** The cover image itself, for thumbnails (listMedia / getPanelMedia attach it; null when none). */
  poster?: MediaLike | null;
};

/**
 * Day 6: which rows a library query returns. "image" is the default everywhere, so every existing image
 * picker keeps offering images only; the media library passes "all" (or a tab's choice), video fields "video".
 */
export type MediaKindFilter = MediaKind | "all";
export const MEDIA_KIND_FILTERS = ["image", "video", "all"] as const satisfies readonly MediaKindFilter[];

export type MediaListInput = { q?: string; folder?: string; cursor?: number | null; kind?: MediaKindFilter };

export type MediaListResult = { items: PanelMedia[]; nextCursor: number | null; folders: string[] };

export type MediaUsageKind =
  | "product"
  | "product_media"
  | "variant"
  | "option_swatch"
  | "category"
  | "section"
  | "settings"
  | "blog"
  | "legal"
  // Day 6: the image is the cover of a video in the library (media.poster_id).
  | "video_poster";

/** One place that references a media row. */
export type MediaUsage = {
  kind: MediaUsageKind;
  /** What uses it, e.g. "Lavanta Latte" or "Ana Sayfa". */
  label: string;
  /** How, e.g. "Ürün görseli", "Varyant görseli · LL-500", "Bölüm: Kapak (hero)", "SEO paylaşım görseli". */
  detail: string;
  /** Panel page where it can be changed, when there is one. */
  href: string | null;
};

/** Upload endpoint and limits (enforced again on the server). */
export const MEDIA_UPLOAD = {
  /** Legacy multipart endpoint (small single files; both panel clients use the direct flow below). */
  endpoint: "/panel/api/media",
  /** Multipart field (repeat it once per file) and the optional folder field. */
  fileField: "files",
  folderField: "folder",
  maxFiles: 10,
  /** Largest source image. */
  maxFileBytes: 15 * 1024 * 1024,
  /** Decompression-bomb guard: width × height of one source image. */
  maxPixels: 50_000_000,
  /** For <input type="file" accept> (images). */
  accept: "image/jpeg,image/png,image/webp,image/avif",
  defaultFolder: "genel",
  /**
   * Day 6 direct uploads, one file per request straight to the storage (docs/DAY6-WHEEL-VIDEO.md §1.2):
   * 1. POST `ticket` { name, size, type, kind, folder } → { ticket, upload: { url, method, headers } };
   * 2. the browser PUTs the file to `upload.url` (Supabase signed URL, or `local` on the local driver);
   * 3. POST `complete` { ticket, meta, posterId?, alt? } → { item }.
   */
  direct: {
    ticket: "/panel/api/media/uploads",
    local: "/panel/api/media/uploads/local",
    complete: "/panel/api/media/uploads/complete",
    /** Lifetime of a ticket (and of Supabase's signed upload URL). */
    ticketSeconds: 7200,
    /** Staging objects whose completion never arrived are swept after this many hours (daily job). */
    incomingMaxAgeHours: 24,
  },
  /** Day 6: videos (MP4 with H.264, or WebM), stored as they are; the browser makes the cover image. */
  video: {
    accept: "video/mp4,video/webm,.mp4,.m4v,.webm",
    maxBytes: 50 * 1024 * 1024,
    maxDurationMs: 90_000,
    /** Longest side in pixels. */
    maxDimension: 4096,
  },
  /** Day 6: <input accept> for "images or videos". */
  acceptAll: "image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,.mp4,.m4v,.webm",
  /** Day 6: tag of the cover images the panel captures from a video (deleted with their video when unused). */
  posterTag: "video-poster",
} as const;

export type MediaUploadResponse = { items: PanelMedia[] } | { error: string };

/** Day 6: POST MEDIA_UPLOAD.direct.ticket body. */
export type MediaUploadTicketRequest = { name: string; size: number; type: string; kind: MediaKind; folder: string };

/** Day 6: where the browser PUTs the file (headers must be sent exactly as given). */
export type MediaUploadTarget = { method: "PUT"; url: string; headers: Record<string, string> };

export type MediaUploadTicketResponse = { ticket: string; upload: MediaUploadTarget; expiresAt: string } | { error: string };

/** Day 6: what the browser measured (videos; images are measured by the server). */
export type MediaUploadMeta = { width?: number; height?: number; durationMs?: number };

/** Day 6: POST MEDIA_UPLOAD.direct.complete body. `purpose: "poster"` tags the image as a video cover. */
export type MediaUploadCompleteRequest = {
  ticket: string;
  meta?: MediaUploadMeta;
  posterId?: number | null;
  alt?: LocalizedText | null;
  purpose?: "poster";
};

/** `warnings`: Turkish notes for the owner (e.g. a video that is not optimised for streaming). */
export type MediaUploadCompleteResponse = { item: PanelMedia; warnings: string[] } | { error: string };

/** Page size of listMedia / listMediaAction. */
export const MEDIA_PAGE_SIZE = 48;
