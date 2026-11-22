"use client";

// Day 6 (VIDEO-STORE): the hero video player, loaded by HeroVideo only once a video may play. It renders
// the muted, looped <video> into the hero's `[data-hero-video-slot]` (inside the media layer, under the
// copy and its contrast overlay) through a portal, and the pause/play button where HeroVideo was placed
// (above the copy, so it stays clickable in the full-bleed layout too). The video fades in over the cover
// image once it plays, pauses while the hero is off screen or the tab is hidden, and stays paused once the
// visitor pauses it (WCAG 2.2.2).
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HeroVideoProps } from "./HeroVideo";

export default function HeroVideoPlayer({ src, type, labels, toggleClassName }: HeroVideoProps) {
  const [slot, setSlot] = useState<Element | null>(null);
  const [shown, setShown] = useState(false);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inView = useRef(true);
  const userPaused = useRef(false);
  const findSlot = useCallback((anchor: HTMLSpanElement | null) => {
    if (anchor) setSlot(anchor.closest("section")?.querySelector("[data-hero-video-slot]") ?? null);
  }, []);

  const sync = useEffectEvent(() => {
    const video = videoRef.current;
    if (!video) return;
    if (inView.current && !document.hidden && !userPaused.current) {
      video.muted = true; // React does not always reflect `muted` as an attribute; autoplay needs it
      void video.play().catch(() => {});
    } else if (!video.paused) {
      video.pause();
    }
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!slot || !video) return;
    const onVisibility = () => sync();
    document.addEventListener("visibilitychange", onVisibility);
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          inView.current = entries[entries.length - 1].isIntersecting;
          sync();
        },
        { threshold: 0 },
      );
      io.observe(video);
    }
    sync();
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [slot]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      userPaused.current = false;
      video.muted = true;
      void video.play().catch(() => {});
    } else {
      userPaused.current = true;
      video.pause();
    }
  };

  return (
    <>
      {/* Finds the media layer's slot of the same hero. */}
      <span hidden ref={findSlot} />
      {slot &&
        createPortal(
          <video
            ref={videoRef}
            aria-hidden
            tabIndex={-1}
            muted
            loop
            playsInline
            preload="auto"
            onPlaying={() => setShown(true)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            className={cn("pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-700", shown ? "opacity-100" : "opacity-0")}
          >
            <source src={src} type={type} />
          </video>,
          slot,
        )}
      {shown && (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? labels.pause : labels.play}
          className={cn(
            "absolute z-10 grid size-10 place-items-center rounded-full bg-bg/85 text-text shadow-sm backdrop-blur transition-colors hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            toggleClassName ?? "bottom-4 end-4",
          )}
        >
          {playing ? <Pause aria-hidden className="size-4 fill-current" strokeWidth={0} /> : <Play aria-hidden className="size-4 translate-x-px fill-current" strokeWidth={0} />}
        </button>
      )}
    </>
  );
}
