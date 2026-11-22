// Day 6 (VIDEO-STORE): when a storefront video may start by itself, how a source is typed and how a
// duration reads. Pure (no React, no DOM access except the explicit `readPlaybackEnv`), so the product
// gallery, the hero background and the video section share one rule set and unit tests cover it.
//
// Rules (docs/DAY6-WHEEL-VIDEO.md §1.2):
//   - nothing moves by itself for visitors who ask for reduced motion (prefers-reduced-motion: reduce);
//   - nothing downloads by itself with Save-Data on or on a 2g/3g connection (Network Information API,
//     Chromium only; other browsers report nothing and count as fast);
//   - autoplaying videos are muted, looped and inline, and always offer a pause button (WCAG 2.2.2);
//   - the source is attached only when the video is about to be seen (in view, or after load + idle for
//     the hero), so a page never pays for a video nobody watches.

/** What the browser tells us about the visitor's preferences and connection. */
export type PlaybackEnv = {
  reducedMotion: boolean;
  /** navigator.connection.saveData */
  saveData?: boolean;
  /** navigator.connection.effectiveType: "slow-2g" | "2g" | "3g" | "4g" (absent outside Chromium). */
  effectiveType?: string;
};

const SLOW_CONNECTIONS = new Set(["slow-2g", "2g", "3g"]);

/** True when the connection asks us not to download media by ourselves (Save-Data or a 2g/3g link). */
export function isConstrainedConnection(env: Pick<PlaybackEnv, "saveData" | "effectiveType">): boolean {
  return env.saveData === true || (typeof env.effectiveType === "string" && SLOW_CONNECTIONS.has(env.effectiveType));
}

/** True when a muted video may start (and download) without a click: no reduced motion, no constrained connection. */
export function mayAutoplay(env: PlaybackEnv): boolean {
  return !env.reducedMotion && !isConstrainedConnection(env);
}

/**
 * "In view" for an autoplaying video: at least half of the box is visible, or its visible part covers at
 * least 30 % of the viewport's height (a tall box, e.g. the 4:5 product slide on a laptop, may never show
 * half of itself while it clearly fills the screen).
 */
export function isMostlyVisible(entry: { isIntersecting: boolean; ratio: number; visibleHeight: number; viewportHeight: number | null }): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.ratio >= 0.5) return true;
  return entry.viewportHeight !== null && entry.viewportHeight > 0 && entry.visibleHeight >= entry.viewportHeight * 0.3;
}

/** IntersectionObserver thresholds that keep isMostlyVisible up to date while the box scrolls. */
export const VISIBILITY_THRESHOLDS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1];

type NavigatorConnection = { saveData?: unknown; effectiveType?: unknown };

/** The current PlaybackEnv (browser only; on the server: reduced motion, so nothing would start). */
export function readPlaybackEnv(): PlaybackEnv {
  if (typeof window === "undefined") return { reducedMotion: true };
  const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const connection = (navigator as Navigator & { connection?: NavigatorConnection }).connection;
  return {
    reducedMotion,
    ...(typeof connection?.saveData === "boolean" ? { saveData: connection.saveData } : {}),
    ...(typeof connection?.effectiveType === "string" ? { effectiveType: connection.effectiveType } : {}),
  };
}

const TYPE_BY_EXTENSION: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm" };

/**
 * The `type` of a <source>: the stored mime when it is a video type, else a guess from the URL's file
 * extension (the legacy hero `videoUrl`), else undefined (the browser sniffs it).
 */
export function videoSourceType(src: string, mime?: string | null): string | undefined {
  if (typeof mime === "string" && /^video\/[\w.+-]+$/i.test(mime.trim())) return mime.trim().toLowerCase();
  const match = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(src.trim());
  return match ? TYPE_BY_EXTENSION[match[1].toLowerCase()] : undefined;
}

/** 42_000 → "0:42", 605_000 → "10:05", 3_725_000 → "1:02:05"; null, negative or not finite → "". Western digits in every locale. */
export function formatVideoDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** CSS aspect-ratio of a video box from its stored size ("1920 / 1080"), or the fallback when the size is unknown. */
export function videoAspectRatio(width: number | null | undefined, height: number | null | undefined, fallback = "16 / 9"): string {
  const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  return ok(width) && ok(height) ? `${Math.round(width)} / ${Math.round(height)}` : fallback;
}
