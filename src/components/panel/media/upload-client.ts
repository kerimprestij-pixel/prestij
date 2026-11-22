// Day 6, browser only: one file through the direct upload flow (docs/DAY6-WHEEL-VIDEO.md §1.2) —
// ticket → PUT straight to the storage with byte progress → complete. Used by the one shared upload
// queue (useUploadQueue) behind the media library and the picker dialog. A video is first opened by the
// browser (size, duration, a cover frame): the frame goes through the image pipeline as its own upload,
// then the video is sent and linked to it. Turkish errors throughout.
import { toPayloadFormData } from "@/lib/panel/action-types";
import { deleteMediaAction } from "@/lib/panel/media/actions";
import {
  MEDIA_UPLOAD,
  type MediaKindFilter,
  type MediaUploadCompleteRequest,
  type MediaUploadMeta,
  type MediaUploadTarget,
  type PanelMedia,
} from "@/lib/panel/media/types";
import { checkUploadCandidate, checkVideoDuration, checkVideoSize } from "@/lib/panel/media/upload-rules";
import type { MediaKind } from "@/lib/media/types";
import { putFailureMessage, SESSION_ERROR } from "./upload-errors";
import { readVideoMeta, VideoMetaError } from "./video-meta";

export type UploadPhase = "preparing" | "poster" | "uploading" | "processing";
export type ProgressListener = (phase: UploadPhase, fraction: number) => void;
export type UploadResult = { item: PanelMedia; poster: PanelMedia | null; warnings: string[] };

/** A refusal or failure with a message for the owner. */
export class UploadFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadFailure";
  }
}

export const NETWORK_ERROR = "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.";
const POSTER_WARNING = "Kapak görseli oluşturulamadı; videonun ayrıntılarından sonradan ekleyebilirsiniz.";

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    throw new UploadFailure(signal?.aborted ? "Yükleme iptal edildi." : NETWORK_ERROR);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (res.ok && data && typeof data === "object" && !("error" in data)) return data;
  if (res.status === 401) throw new UploadFailure(SESSION_ERROR);
  if (data && typeof data.error === "string") throw new UploadFailure(data.error);
  throw new UploadFailure(`Yükleme tamamlanamadı (HTTP ${res.status}). Lütfen tekrar deneyin.`);
}

/** PUTs the raw file (never FormData: the stored object's type is the Content-Type header) with progress. */
export function putFile(target: MediaUploadTarget, file: Blob, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // A 401 means "session ended" only from our own route; refusals of the storage are shown as such.
      reject(new UploadFailure(putFailureMessage(target.url, xhr.status, xhr.responseText)));
    };
    xhr.onerror = () => reject(new UploadFailure(NETWORK_ERROR));
    xhr.onabort = () => reject(new UploadFailure("Yükleme iptal edildi."));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

type DirectOptions = {
  name: string;
  kind: MediaKind;
  mime: string;
  folder: string;
  meta?: MediaUploadMeta;
  posterId?: number | null;
  purpose?: "poster";
  onProgress?: ProgressListener;
  signal?: AbortSignal;
};

/** Ticket → PUT → complete for one file whose kind/type were already checked. */
export async function uploadDirect(file: Blob, options: DirectOptions): Promise<{ item: PanelMedia; warnings: string[] }> {
  const progress = options.onProgress ?? (() => undefined);
  const { ticket, upload } = await postJson<{ ticket: string; upload: MediaUploadTarget }>(
    MEDIA_UPLOAD.direct.ticket,
    { name: options.name, size: file.size, type: options.mime, kind: options.kind, folder: options.folder },
    options.signal,
  );
  progress("uploading", 0);
  await putFile(upload, file, (fraction) => progress("uploading", fraction), options.signal);
  progress("processing", 1);
  const body: MediaUploadCompleteRequest = { ticket, meta: options.meta, posterId: options.posterId ?? null, purpose: options.purpose };
  // Once the bytes are up the server finishes the file even if the owner cancels now (no signal here): an
  // aborted request would not stop the server, and the file would appear although "cancelled" was shown.
  const result = await postJson<{ item: PanelMedia; warnings?: string[] }>(MEDIA_UPLOAD.direct.complete, body);
  return { item: result.item, warnings: Array.isArray(result.warnings) ? result.warnings : [] };
}

/** "tanitim.mp4" → "tanitim-kapak.jpg". */
export function posterFileName(videoName: string): string {
  const stem = videoName.replace(/\.[^.]+$/, "").trim() || "video";
  return `${stem}-kapak.jpg`;
}

/**
 * Uploads one file chosen by the owner into `folder`, for a library that accepts `accept`. Images go
 * straight through; videos are measured and get a cover image first (a failed cover is a warning, not an
 * error). Throws UploadFailure with a Turkish message.
 */
export async function uploadMediaFile(
  file: File,
  { folder, accept = "all", onProgress, signal }: { folder: string; accept?: MediaKindFilter; onProgress?: ProgressListener; signal?: AbortSignal },
): Promise<UploadResult> {
  const check = checkUploadCandidate({ name: file.name, size: file.size, type: file.type }, accept);
  if (!check.ok) throw new UploadFailure(check.error);
  const progress = onProgress ?? (() => undefined);

  if (check.kind === "image") {
    const { item, warnings } = await uploadDirect(file, { name: file.name, kind: "image", mime: check.mime, folder, onProgress: progress, signal });
    return { item, poster: null, warnings };
  }

  progress("preparing", 0);
  let meta;
  try {
    meta = await readVideoMeta(file);
  } catch (error) {
    throw new UploadFailure(error instanceof VideoMetaError ? error.message : "Video okunamadı. Dosya bozuk olabilir; tekrar deneyin.");
  }
  const problem = checkVideoDuration(meta.durationMs) ?? checkVideoSize(meta.width, meta.height);
  if (problem) throw new UploadFailure(problem);

  const warnings: string[] = [];
  let poster: PanelMedia | null = null;
  if (meta.poster) {
    progress("poster", 0);
    try {
      const cover = new File([meta.poster], posterFileName(file.name), { type: "image/jpeg" });
      poster = (await uploadDirect(cover, { name: cover.name, kind: "image", mime: "image/jpeg", folder, purpose: "poster", signal })).item;
    } catch (error) {
      if (signal?.aborted) throw error;
      warnings.push(POSTER_WARNING);
    }
  } else {
    warnings.push(POSTER_WARNING);
  }

  try {
    const result = await uploadDirect(file, {
      name: file.name,
      kind: "video",
      mime: check.mime,
      folder,
      meta: { width: meta.width, height: meta.height, durationMs: meta.durationMs },
      posterId: poster?.id ?? null,
      onProgress: progress,
      signal,
    });
    return { item: result.item, poster, warnings: [...warnings, ...result.warnings] };
  } catch (error) {
    // The cover was made for this video only: do not leave it behind (best effort).
    if (poster) void deleteMediaAction(null, toPayloadFormData({ id: poster.id })).catch(() => undefined);
    throw error;
  }
}
