"use client";

// Day 6 (VIDEO-STORE): a storefront video laid over its cover image, shared by the product gallery and
// the video section. The cover (children: an <Img fill>) is what the page shows first and what stays
// the LCP candidate; the <video> fades in over it once a frame plays, so nothing jumps (the box is sized
// by the caller).
//
//   mode "click":    the <video> is in the DOM with preload="none" (nothing downloads) and a play button
//                    sits on the cover. Pressing it plays with native controls (sound allowed) and moves
//                    focus to the video, so its controls are reachable by keyboard.
//   mode "autoplay": muted, looped, inline. The <source> is attached the first time the box is in view
//                    (isMostlyVisible: half of it, or 30 % of the screen's height), it plays while in view
//                    and the tab is shown, and pauses otherwise. A
//                    pause/play button is always there (WCAG 2.2.2). With reduced motion, Save-Data or a
//                    2g/3g connection (video-rules.ts) nothing starts by itself; the button starts it.
//
// The video and its buttons carry `data-video-player` / `data-video-control`, so a surrounding gallery
// can ignore their keyboard and pointer events (no slide change while seeking). The autoplay video has
// no native controls and ignores the pointer, so swiping over it still changes the slide.
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { isMostlyVisible, mayAutoplay, readPlaybackEnv, VISIBILITY_THRESHOLDS } from "./video-rules";

export type VideoPlayerProps = {
  src: string;
  /** <source type>, e.g. "video/mp4" (videoSourceType). */
  type?: string;
  mode: "autoplay" | "click";
  /** Accessible name of the video: its description in the page language. */
  label: string;
  labels: { play: string; pause: string };
  /** The cover image (an <Img fill>), shown until the video plays. */
  children?: ReactNode;
  /** Classes for the positioned box (it fills its nearest positioned ancestor). */
  className?: string;
  /** Where the autoplay pause/play button sits (default bottom end). */
  toggleClassName?: string;
};

const roundButton =
  "grid place-items-center rounded-full bg-bg/90 text-text shadow-sm backdrop-blur transition-colors hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export default function VideoPlayer({ src, type, mode, label, labels, children, className, toggleClassName }: VideoPlayerProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** The box is in view (isMostlyVisible; true where IntersectionObserver is missing). */
  const inView = useRef(false);
  /** The visitor's own choice with the autoplay button: it wins over the automatic rules. */
  const choice = useRef<"play" | "pause" | null>(null);
  const [attached, setAttached] = useState(mode === "click");
  const [started, setStarted] = useState(false);
  const [shown, setShown] = useState(false);
  const [playing, setPlaying] = useState(false);

  // Autoplay: play while visible and allowed (or chosen), pause otherwise.
  const sync = useEffectEvent(() => {
    const video = videoRef.current;
    if (mode !== "autoplay" || !video) return;
    const wanted = choice.current === "play" || (choice.current === null && mayAutoplay(readPlaybackEnv()));
    if (wanted && inView.current && !document.hidden) {
      video.muted = true; // React does not always reflect `muted` as an attribute; autoplay needs it
      void video.play().catch(() => {});
    } else if (!video.paused) {
      video.pause();
    }
  });

  useEffect(() => {
    if (mode !== "autoplay") return;
    const box = boxRef.current;
    if (!box) return;
    const onVisibility = () => sync();
    document.addEventListener("visibilitychange", onVisibility);
    if (typeof IntersectionObserver === "undefined") {
      inView.current = true;
      return () => document.removeEventListener("visibilitychange", onVisibility);
    }
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        inView.current = isMostlyVisible({
          isIntersecting: entry.isIntersecting,
          ratio: entry.intersectionRatio,
          visibleHeight: entry.intersectionRect.height,
          viewportHeight: entry.rootBounds?.height ?? window.innerHeight,
        });
        if (inView.current && choice.current !== "pause" && mayAutoplay(readPlaybackEnv())) setAttached(true);
        sync();
      },
      { threshold: VISIBILITY_THRESHOLDS },
    );
    io.observe(box);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode]);

  // A source attached just now (first sight, or the button): start it when it should play.
  useEffect(() => {
    if (attached) sync();
  }, [attached]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video || video.paused) {
      choice.current = "play";
      if (!video) {
        setAttached(true); // the effect above starts it once the <video> exists
      } else {
        video.muted = true;
        void video.play().catch(() => {});
      }
    } else {
      choice.current = "pause";
      video.pause();
    }
  };

  const playWithControls = () => {
    const video = videoRef.current;
    if (!video) return;
    setStarted(true);
    void video.play().catch(() => {});
    // The play button disappears: keep the keyboard focus on the video and its native controls.
    video.focus({ preventScroll: true });
  };

  return (
    <div ref={boxRef} className={cn("absolute inset-0 overflow-hidden", className)}>
      {children}
      {attached && (
        <video
          ref={videoRef}
          aria-label={label}
          data-video-player=""
          playsInline
          muted={mode === "autoplay"}
          loop={mode === "autoplay"}
          controls={mode === "click" && started}
          preload={mode === "click" && !started ? "none" : "auto"}
          tabIndex={mode === "click" && !started ? -1 : undefined}
          onPlaying={() => setShown(true)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-500 motion-reduce:transition-none",
            shown || started ? "opacity-100" : "opacity-0",
            mode === "autoplay" && "pointer-events-none",
          )}
        >
          <source src={src} type={type} />
        </video>
      )}
      {mode === "click" && !started && (
        <button
          type="button"
          onClick={playWithControls}
          aria-label={labels.play}
          data-video-control=""
          className={cn(roundButton, "absolute inset-0 m-auto size-16 hover:scale-105 motion-reduce:hover:scale-100")}
        >
          {/* Media controls are not mirrored in RTL: "play" points the same way everywhere. */}
          <Play aria-hidden className="size-6 translate-x-0.5 fill-current" strokeWidth={0} />
        </button>
      )}
      {mode === "autoplay" && (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? labels.pause : labels.play}
          data-video-control=""
          className={cn(roundButton, "absolute size-10", toggleClassName ?? "bottom-3 end-3")}
        >
          {playing ? <Pause aria-hidden className="size-4 fill-current" strokeWidth={0} /> : <Play aria-hidden className="size-4 translate-x-px fill-current" strokeWidth={0} />}
        </button>
      )}
    </div>
  );
}
