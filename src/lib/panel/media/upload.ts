// Upload validation for the media library: size limits, the real image type sniffed by sharp (never the
// client's Content-Type or file name), a pixel limit against decompression bombs, and the same-origin
// check for the upload route. No "server-only" import so unit tests can run it; uses sharp (Node only).
import sharp, { type Metadata } from "sharp";
import type { MediaKind } from "@/lib/media/types";
import { MEDIA_UPLOAD } from "./types";
import { formatMegabytes, maxUploadBytes, sanitizeFileName } from "./upload-rules";

export { sanitizeFileName };

export type UploadFormat = "jpeg" | "png" | "webp" | "avif";

export type SniffResult =
  | { ok: true; format: UploadFormat; width: number; height: number }
  | { ok: false; error: string };

/** Whole multipart body limit: every file at the maximum plus 1 MB for the envelope. */
export const MAX_UPLOAD_REQUEST_BYTES = MEDIA_UPLOAD.maxFiles * MEDIA_UPLOAD.maxFileBytes + 1024 * 1024;

const MB = 1024 * 1024;

/** Size check before reading the file (images by default; day 6: videos have their own limit). Turkish error or null. */
export function checkUploadSize(file: { name: string; size: number }, kind: MediaKind = "image"): string | null {
  const name = sanitizeFileName(file.name, kind === "video" ? "video" : "görsel");
  if (!Number.isFinite(file.size) || file.size <= 0) return `"${name}" boş bir dosya.`;
  const max = maxUploadBytes(kind);
  if (file.size > max) {
    return `"${name}" çok büyük (${formatMegabytes(file.size)}). En fazla ${max / MB} MB yükleyebilirsiniz.`;
  }
  return null;
}

/**
 * Reads the image header with sharp and accepts only JPEG, PNG, WebP and AVIF (no SVG, GIF, HEIC,
 * TIFF, …). Images above MEDIA_UPLOAD.maxPixels are refused before anything is decoded.
 */
export async function sniffImage(data: Buffer, fileName = "görsel"): Promise<SniffResult> {
  const name = sanitizeFileName(fileName);
  const unsupported = `"${name}" desteklenmeyen bir dosya. JPEG, PNG, WebP veya AVIF görsel yükleyin.`;
  let meta: Metadata;
  try {
    meta = await sharp(data, { limitInputPixels: MEDIA_UPLOAD.maxPixels, failOn: "error" }).metadata();
  } catch {
    return { ok: false, error: unsupported };
  }

  let format: UploadFormat | null = null;
  if (meta.format === "jpeg" || meta.format === "png" || meta.format === "webp") format = meta.format;
  else if (meta.format === "heif" && meta.compression === "av1") format = "avif";

  if (!format) {
    if (meta.format === "svg") return { ok: false, error: `"${name}" bir SVG dosyası. Güvenlik nedeniyle SVG yüklenemez; PNG veya WebP olarak kaydedip yükleyin.` };
    if (meta.format === "gif") return { ok: false, error: `"${name}" bir GIF dosyası. GIF desteklenmiyor; PNG, JPEG veya WebP yükleyin.` };
    if (meta.format === "heif") return { ok: false, error: `"${name}" bir HEIC dosyası. Telefonunuzdan JPEG olarak paylaşıp tekrar deneyin.` };
    return { ok: false, error: unsupported };
  }

  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  const height = meta.autoOrient?.height ?? meta.height ?? 0;
  if (!width || !height) return { ok: false, error: unsupported };
  if (width * height > MEDIA_UPLOAD.maxPixels) {
    return {
      ok: false,
      error: `"${name}" çok yüksek çözünürlüklü (${width}×${height}). En fazla ${MEDIA_UPLOAD.maxPixels / 1_000_000} megapiksel yükleyebilirsiniz.`,
    };
  }
  return { ok: true, format, width, height };
}

type HeaderSource = { get(name: string): string | null };

/**
 * Same-origin check for state-changing route handlers (Server Actions get this from Next): the
 * Origin header must be present and its host must equal the request host (x-forwarded-host when set,
 * like Next's own check). A cross-site `Sec-Fetch-Site` is refused as well.
 */
export function isSameOriginRequest(headers: HeaderSource): boolean {
  const origin = headers.get("origin");
  if (!origin || origin === "null") return false;
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}
