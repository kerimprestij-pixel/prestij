// Day 6: which files the media library accepts, decided from the declared type and name only. The
// browser runs it before sending (instant feedback) and the ticket route runs it again; the complete
// step then sniffs the real bytes (video-sniff.ts / sniffImage), so nothing here is trusted on its own.
// Pure and client-safe (no Node APIs). Messages are Turkish, for the panel.
import type { MediaKind } from "@/lib/media/types";
import { MEDIA_UPLOAD, type MediaKindFilter } from "./types";

export const IMAGE_UPLOAD_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
} as const satisfies Record<string, string>;

export const VIDEO_UPLOAD_TYPES = {
  "video/mp4": "mp4",
  "video/webm": "webm",
} as const satisfies Record<string, string>;

type ImageType = keyof typeof IMAGE_UPLOAD_TYPES;
type VideoType = keyof typeof VIDEO_UPLOAD_TYPES;
export type UploadMime = ImageType | VideoType;

/** Extension → canonical type, for files the browser hands over without a type. */
const BY_EXTENSION: Record<string, UploadMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
};

/** Other spellings browsers and operating systems use for the same containers. */
const ALIASES: Record<string, UploadMime> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "video/x-m4v": "video/mp4",
};

const MB = 1024 * 1024;

/** Display name for messages and media.original_name: no path, no control characters, ≤ 120 chars. */
export function sanitizeFileName(name: string | null | undefined, fallback = "görsel"): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001F\u007F-\u009F<>"]/g, "").trim();
  return (clean || fallback).slice(0, 120);
}

/** "12,3 MB" for messages. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;
}

/** 42_000 → "0:42", 102_000 → "1:42". */
export function formatSeconds(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export type UploadCandidate = { name: string; size: number; type?: string | null };

export type UploadClassification =
  | { ok: true; kind: MediaKind; mime: UploadMime; ext: string }
  | { ok: false; error: string };

export const MOV_HINT = "MP4 (H.264) olarak dışa aktarın";

const extensionOf = (name: string) => {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
};

/**
 * The kind and canonical type of a file from its declared type (or, when empty, its extension), with a
 * clear Turkish refusal for the formats people actually try: MOV/HEVC from phones, HEIC, MKV, SVG, GIF.
 */
export function classifyUpload(file: Pick<UploadCandidate, "name" | "type">): UploadClassification {
  const name = file.name ?? "";
  const ext = extensionOf(name);
  const declared = (file.type ?? "").trim().toLowerCase().split(";")[0];
  const type: string = ALIASES[declared] ?? declared;

  if (type === "video/quicktime" || (!type && (ext === "mov" || ext === "qt"))) {
    return { ok: false, error: `MOV (iPhone) videoları yüklenemez. Videoyu ${MOV_HINT} ve tekrar deneyin.` };
  }
  if (type === "image/heic" || type === "image/heif" || (!type && (ext === "heic" || ext === "heif"))) {
    return { ok: false, error: "HEIC görseller yüklenemez. Telefonunuzdan JPEG olarak paylaşıp tekrar deneyin." };
  }
  if (type === "video/x-matroska" || (!type && ext === "mkv")) {
    return { ok: false, error: `MKV videoları yüklenemez. Videoyu ${MOV_HINT} ya da WebM olarak kaydedin.` };
  }
  if (type === "image/svg+xml" || (!type && ext === "svg")) {
    return { ok: false, error: "SVG yüklenemez. PNG, JPEG, WebP veya AVIF kullanın." };
  }
  if (type === "image/gif" || (!type && ext === "gif")) {
    return { ok: false, error: "GIF yüklenemez. PNG, JPEG, WebP veya AVIF kullanın; hareketli içerik için MP4 video yükleyin." };
  }

  const mime: UploadMime | undefined = type
    ? type in IMAGE_UPLOAD_TYPES || type in VIDEO_UPLOAD_TYPES
      ? (type as UploadMime)
      : undefined
    : BY_EXTENSION[ext];
  if (!mime) {
    if (type.startsWith("video/")) return { ok: false, error: `Desteklenmeyen video biçimi. ${MOV_HINT} ya da WebM yükleyin.` };
    return { ok: false, error: "Desteklenmeyen biçim. JPEG, PNG, WebP, AVIF görsel ya da MP4 (H.264), WebM video yükleyin." };
  }
  if (mime in VIDEO_UPLOAD_TYPES) return { ok: true, kind: "video", mime, ext: VIDEO_UPLOAD_TYPES[mime as VideoType] };
  return { ok: true, kind: "image", mime, ext: IMAGE_UPLOAD_TYPES[mime as ImageType] };
}

/** Largest allowed file of a kind. */
export function maxUploadBytes(kind: MediaKind): number {
  return kind === "video" ? MEDIA_UPLOAD.video.maxBytes : MEDIA_UPLOAD.maxFileBytes;
}

/**
 * Full pre-check of one file for a library that offers `accept` ("image", "video" or "all"): type,
 * kind and size. Returns the classification or a Turkish error.
 */
export function checkUploadCandidate(file: UploadCandidate, accept: MediaKindFilter = "all"): UploadClassification {
  const result = classifyUpload(file);
  if (!result.ok) return result;
  if (accept === "image" && result.kind !== "image") {
    return { ok: false, error: "Buraya yalnızca görsel yüklenebilir (JPEG, PNG, WebP veya AVIF)." };
  }
  if (accept === "video" && result.kind !== "video") {
    return { ok: false, error: "Buraya yalnızca video yüklenebilir (MP4 (H.264) veya WebM)." };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: "Dosya boş." };
  const max = maxUploadBytes(result.kind);
  if (file.size > max) {
    return {
      ok: false,
      error:
        result.kind === "video"
          ? `Video çok büyük (${formatMegabytes(file.size)}). En fazla ${max / MB} MB yükleyebilirsiniz; daha kısa ya da daha düşük çözünürlüklü dışa aktarın.`
          : `Görsel çok büyük (${formatMegabytes(file.size)}). En fazla ${max / MB} MB yükleyebilirsiniz.`,
    };
  }
  return result;
}

/** <input accept> for a kind filter. */
export function acceptFor(kind: MediaKindFilter): string {
  return kind === "image" ? MEDIA_UPLOAD.accept : kind === "video" ? MEDIA_UPLOAD.video.accept : MEDIA_UPLOAD.acceptAll;
}

/** Duration check shared by the browser (before sending) and the server (after sniffing). */
export function checkVideoDuration(durationMs: number | null | undefined): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return "Videonun süresi okunamadı. MP4 (H.264) olarak yeniden dışa aktarıp tekrar deneyin.";
  }
  // Half a second of slack: players and encoders round a 90 s export to 90.0x s.
  if (durationMs > MEDIA_UPLOAD.video.maxDurationMs + 500) {
    return `Video en fazla ${MEDIA_UPLOAD.video.maxDurationMs / 1000} saniye olabilir (bu video ${formatSeconds(durationMs)}). Kısaltıp tekrar yükleyin.`;
  }
  return null;
}

/** Width/height check (positive integers, longest side within the limit). */
export function checkVideoSize(width: number | null | undefined, height: number | null | undefined): string | null {
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
  if (!ok(width) || !ok(height)) return "Videonun boyutları okunamadı. MP4 (H.264) olarak yeniden dışa aktarıp tekrar deneyin.";
  const max = MEDIA_UPLOAD.video.maxDimension;
  if (Math.max(width, height) > max) return `Video çözünürlüğü çok yüksek (${width}×${height}). En fazla ${max} piksel (4K) olabilir.`;
  return null;
}
