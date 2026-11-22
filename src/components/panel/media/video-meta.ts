// Day 6, browser only: what a video file is (size, duration) and a cover frame, read by the browser
// itself before anything is uploaded (no ffmpeg on the server). If the browser cannot decode the file
// (typically HEVC/H.265 or MOV on Windows), videoWidth stays 0 or the element errors: the owner gets the
// "MP4 (H.264) olarak dışa aktarın" hint instead of a video nobody can play.

export type VideoMeta = { width: number; height: number; durationMs: number; poster: Blob | null };

export class VideoMetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoMetaError";
  }
}

export const VIDEO_DECODE_HINT =
  "Bu video bu tarayıcıda açılamadı; büyük olasılıkla HEVC (H.265) ya da MOV biçiminde. Videoyu MP4 (H.264) olarak dışa aktarın ve tekrar deneyin.";
const DURATION_ERROR = "Videonun süresi okunamadı. MP4 (H.264) olarak yeniden dışa aktarıp tekrar deneyin.";
const TIMEOUT_ERROR = "Video okunurken zaman aşımı oldu. Dosya bozuk olabilir; tekrar deneyin.";

/** Resolves on the first of `events`; rejects on the element's error event or after `timeoutMs`. */
function waitFor(video: HTMLVideoElement, events: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      for (const name of events) video.removeEventListener(name, onEvent);
      video.removeEventListener("error", onError);
    };
    const onEvent = (event: Event) => {
      cleanup();
      resolve(event.type);
    };
    const onError = () => {
      cleanup();
      reject(new VideoMetaError(VIDEO_DECODE_HINT));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new VideoMetaError(TIMEOUT_ERROR));
    }, timeoutMs);
    for (const name of events) video.addEventListener(name, onEvent);
    video.addEventListener("error", onError);
  });
}

/** Seeks and waits until the frame at `time` can be drawn. */
async function seekTo(video: HTMLVideoElement, time: number, timeoutMs: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.01 && video.readyState >= 2) return;
  const seeked = waitFor(video, ["seeked"], timeoutMs);
  video.currentTime = time;
  await seeked;
  if (video.readyState < 2) await waitFor(video, ["loadeddata", "canplay"], timeoutMs);
}

/**
 * The current frame of a playing or paused <video> as a JPEG (longest side ≤ maxWidth), or null when the
 * frame cannot be read (no data yet, or a cross-origin video without CORS).
 */
export async function captureVideoFrame(video: HTMLVideoElement, { maxWidth = 1920, quality = 0.88 } = {}): Promise<Blob | null> {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return null;
  const scale = Math.min(1, maxWidth / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  } catch {
    return null; // SecurityError: tainted canvas
  }
}

/**
 * Size, duration and a cover frame (about one second in, or a third of a shorter clip) of a local video
 * file. Throws VideoMetaError with a Turkish message when the browser cannot decode it.
 */
export async function readVideoMeta(file: Blob, { timeoutMs = 20_000, posterAtSeconds = 1 } = {}): Promise<VideoMeta> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const loaded = waitFor(video, ["loadedmetadata"], timeoutMs);
    video.src = url;
    await loaded;
    if (!video.videoWidth || !video.videoHeight) throw new VideoMetaError(VIDEO_DECODE_HINT);

    let duration = video.duration;
    if (!Number.isFinite(duration)) {
      // WebM written by a recorder has no duration in its header; seeking far ahead makes the browser
      // scan to the end and report it (durationchange).
      const deadline = Date.now() + timeoutMs;
      const changed = waitFor(video, ["durationchange", "seeked"], timeoutMs);
      video.currentTime = Number.MAX_SAFE_INTEGER;
      await changed;
      while (!Number.isFinite(video.duration) && Date.now() < deadline) {
        await waitFor(video, ["durationchange", "seeked", "timeupdate"], Math.max(1, deadline - Date.now()));
      }
      duration = video.duration;
    }
    if (!Number.isFinite(duration) || duration <= 0) throw new VideoMetaError(DURATION_ERROR);

    let poster: Blob | null = null;
    try {
      await seekTo(video, Math.min(posterAtSeconds, duration / 3), Math.min(timeoutMs, 10_000));
      poster = await captureVideoFrame(video);
    } catch (error) {
      if (error instanceof VideoMetaError && error.message === VIDEO_DECODE_HINT) throw error;
      poster = null; // a missing cover is not fatal: the owner can add one later
    }
    return { width: video.videoWidth, height: video.videoHeight, durationMs: Math.round(duration * 1000), poster };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
