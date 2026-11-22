// Small display helpers for media rows in the panel (pure; client and server).
import type { MediaKind } from "@/lib/media/types";
import type { PanelMedia } from "@/lib/panel/media/types";

const MB = 1024 * 1024;

/** "Lavanta şişe" (alt text), else the uploaded file name, else "Görsel #12" / "Video #12". */
export function mediaLabel(media: Pick<PanelMedia, "id" | "alt"> & { originalName?: string | null; kind?: MediaKind }): string {
  return media.alt?.tr?.trim() || media.originalName || `${media.kind === "video" ? "Video" : "Görsel"} #${media.id}`;
}

/** 950 → "1 KB", 2_500_000 → "2,4 MB"; empty for null/0. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
}

/** 42_000 → "0:42", 605_000 → "10:05", 3_725_000 → "1:02:05"; null/invalid → "". */
export function formatMediaDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "MP4", "WebM", "WebP" … for a mime type. */
export function formatLabel(mime: string | null | undefined): string {
  const labels: Record<string, string> = {
    "image/webp": "WebP",
    "image/avif": "AVIF",
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "video/mp4": "MP4",
    "video/webm": "WebM",
  };
  return mime ? (labels[mime] ?? mime) : "";
}
