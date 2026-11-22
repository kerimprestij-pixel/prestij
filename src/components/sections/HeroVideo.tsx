"use client";

// Day 6 (VIDEO-STORE): the hero's background video, the small part every page with a hero loads. It
// renders nothing on the server and on the first client render; after the page's `load` event and an idle
// moment it checks the visitor's settings (never with reduced motion, Save-Data or a 2g/3g connection,
// video-rules.ts) and only then loads the player (HeroVideoPlayer, its own chunk), which attaches the
// source. So the static HTML has no <video>, the responsive cover <Img> the hero renders stays the LCP, and
// visitors who never get a video never download the player's code either.
//
// Place it where the pause button belongs (a positioned box above the hero's copy); the video itself goes
// into the hero's `[data-hero-video-slot]` element inside the media layer (see HeroVideoPlayer).
import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { mayAutoplay, readPlaybackEnv } from "./video-rules";

export type HeroVideoProps = {
  src: string;
  type?: string;
  labels: { play: string; pause: string };
  /** Position of the pause/play button inside the nearest positioned box, e.g. "bottom-4 end-4". */
  toggleClassName?: string;
};

/** If the player's code cannot load (e.g. a stale tab after a deploy), the hero keeps its cover image. */
function NoVideo(): null {
  return null;
}

const HeroVideoPlayer = lazy((): Promise<{ default: ComponentType<HeroVideoProps> }> => import("./HeroVideoPlayer").catch(() => ({ default: NoVideo })));

/** How long to wait for an idle moment after `load` before going on anyway (ms). */
const IDLE_TIMEOUT = 3000;

export default function HeroVideo(props: HeroVideoProps) {
  const [go, setGo] = useState(false);

  useEffect(() => {
    const pending = { cancelled: false, idleId: undefined as number | undefined, timer: undefined as number | undefined };
    const decide = () => {
      if (!pending.cancelled && mayAutoplay(readPlaybackEnv())) setGo(true);
    };
    const whenIdle = () => {
      if (typeof window.requestIdleCallback === "function") pending.idleId = window.requestIdleCallback(decide, { timeout: IDLE_TIMEOUT });
      else pending.timer = window.setTimeout(decide, 1200);
    };
    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });
    return () => {
      pending.cancelled = true;
      window.removeEventListener("load", whenIdle);
      if (pending.idleId !== undefined && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(pending.idleId);
      if (pending.timer !== undefined) window.clearTimeout(pending.timer);
    };
  }, []);

  if (!go) return null;
  return (
    <Suspense fallback={null}>
      <HeroVideoPlayer {...props} />
    </Suspense>
  );
}
