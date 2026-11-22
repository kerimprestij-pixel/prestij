"use client";

// Main image + thumbnails. Follows the selected variant, supports arrow keys (RTL-aware), swipe on
// touch screens and previous/next buttons. Only the active large image is mounted.
//
// Day 6 (videos): an item with `video` is a product video. Its slide shows the cover image, and the
// player (VideoPlayer, loaded only when a video slide is first shown) mounts its <video> only while the
// slide is active: autoplay rows play muted and looped with a pause button, the others show a play
// button and play with native controls. The first item of every variant view is an image whenever the
// view has one (imagesFor), so the preloaded LCP image is never a video and the static HTML never holds
// a <video>. Keyboard and swipe handling ignore events from the video and its buttons (seeking does not
// change the slide). Thumbnails of videos get a play badge with the duration; screen readers hear "Video".
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import LazyVideoPlayer from "@/components/sections/LazyVideoPlayer";
import { formatVideoDuration, videoSourceType } from "@/components/sections/video-rules";
import type { Locale } from "@/i18n/config";
import Img from "@/lib/media/Img";
import type { MediaLike } from "@/lib/media/types";
import { cn } from "@/lib/utils";
import { useVariantSelection } from "./VariantContext";

/** Day 6: the file behind a video item (its cover is the item's `media`). */
export type GalleryVideo = { id: number; src: string; mime: string; durationMs: number | null; autoplay: boolean };

export type GalleryImage = { media: MediaLike; variantId: number | null; alt: string; video?: GalleryVideo };

export type GalleryLabels = {
  gallery: string;
  previous: string;
  next: string;
  /** Day 6 (product.video / playVideo / pauseVideo). */
  video?: string;
  play?: string;
  pause?: string;
};

const MAIN_SIZES = "(min-width: 1024px) 55vw, 100vw";

const fadeCss = `@keyframes prestij-gallery-in{from{opacity:0;transform:scale(1.015)}to{opacity:1;transform:none}}
.prestij-gallery-in{animation:prestij-gallery-in .6s cubic-bezier(.16,1,.3,1) both}
@media (prefers-reduced-motion: reduce){.prestij-gallery-in{animation:none}}`;

/** A list whose first item is an image whenever it holds one (the first video-free item moves to the front). */
export function firstImageFirst<T extends { video?: unknown }>(list: readonly T[]): T[] {
  if (list.length === 0 || !list[0].video) return [...list];
  const i = list.findIndex((item) => !item.video);
  if (i < 0) return [...list];
  return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

/** One variant view: its own items, then the shared ones (else every item), starting with an image. */
export function imagesFor(images: GalleryImage[], variantId: number | null): GalleryImage[] {
  const own = images.filter((i) => i.variantId != null && i.variantId === variantId);
  const shared = images.filter((i) => i.variantId == null);
  const list = [...own, ...shared];
  return firstImageFirst(list.length ? list : images);
}

/** Events from a video or its buttons belong to the player, not to the gallery's keyboard/swipe handling. */
function fromPlayer(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && target instanceof Element && target.closest("[data-video-player], [data-video-control]") !== null;
}

function VideoSlide({ item, video, locale, preload, labels }: { item: GalleryImage; video: GalleryVideo; locale: Locale; preload: boolean; labels: GalleryLabels }) {
  const cover = <Img media={item.media} alt={item.alt} locale={locale} sizes={MAIN_SIZES} fill preload={preload} />;
  return (
    <LazyVideoPlayer
      src={video.src}
      type={videoSourceType(video.src, video.mime)}
      mode={video.autoplay ? "autoplay" : "click"}
      label={item.alt}
      labels={{ play: labels.play ?? labels.video ?? item.alt, pause: labels.pause ?? labels.video ?? item.alt }}
      toggleClassName="top-3 end-3"
    >
      {cover}
    </LazyVideoPlayer>
  );
}

export default function ProductGallery({ images, locale, labels }: { images: GalleryImage[]; locale: Locale; labels: GalleryLabels }) {
  const { selectedId } = useVariantSelection();
  const [view, setView] = useState({ variant: selectedId, index: 0 });
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  // Reset to the first image whenever another variant is chosen (state adjusted during render).
  if (view.variant !== selectedId) setView({ variant: selectedId, index: 0 });

  const list = imagesFor(images, selectedId);
  const count = list.length;
  const index = Math.min(view.index, Math.max(0, count - 1));
  const current = list[index];
  if (!current) return null;

  const go = (next: number) => setView({ variant: selectedId, index: (next + count) % count });
  const isRtl = () => typeof document !== "undefined" && document.documentElement.dir === "rtl";

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (count < 2 || fromPlayer(e.target)) return;
    const forward = isRtl() ? "ArrowLeft" : "ArrowRight";
    const backward = isRtl() ? "ArrowRight" : "ArrowLeft";
    if (e.key === forward) go(index + 1);
    else if (e.key === backward) go(index - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(count - 1);
    else return;
    e.preventDefault();
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" && !fromPlayer(e.target)) swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || count < 2) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(e.clientY - start.y)) return;
    const towardsNext = isRtl() ? dx > 0 : dx < 0;
    go(index + (towardsNext ? 1 : -1));
  };

  const slideKey = current.video ? `v${current.video.id}` : String(current.media.id);

  return (
    <div className="flex flex-col gap-4">
      <style href="prestij-gallery" precedence="default">
        {fadeCss}
      </style>
      <div
        role="group"
        aria-label={labels.gallery}
        tabIndex={count > 1 ? 0 : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipeStart.current = null)}
        className="group/gallery relative aspect-[4/5] touch-pan-y overflow-hidden rounded-md bg-product-soft transition-colors duration-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <div key={`${selectedId}-${slideKey}`} className="prestij-gallery-in absolute inset-0">
          {current.video ? (
            <VideoSlide item={current} video={current.video} locale={locale} preload={index === 0} labels={labels} />
          ) : (
            <Img
              media={current.media}
              alt={current.alt}
              locale={locale}
              sizes={MAIN_SIZES}
              fill
              preload={index === 0}
            />
          )}
        </div>

        {count > 1 && (
          <>
            {/* A click-to-play video draws its own controls along the bottom (play, timeline, volume, fullscreen):
                the counter and arrows move to the top there so a tap on a control never changes the slide. */}
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 flex items-center justify-between gap-3 p-4",
                current.video && !current.video.autoplay ? "top-0" : "bottom-0",
              )}
            >
              <span className="pointer-events-auto rounded-full bg-bg/85 px-3 py-1 text-xs tabular-nums text-text backdrop-blur">
                <span aria-live="polite">
                  {index + 1} / {count}
                </span>
              </span>
              {/* md+: invisible until hover or focus, and not clickable while invisible (touch tablets have no hover). */}
              <div className="pointer-events-auto flex gap-2 opacity-100 transition-opacity duration-300 md:pointer-events-none md:opacity-0 md:group-hover/gallery:pointer-events-auto md:group-hover/gallery:opacity-100 md:group-focus-within/gallery:pointer-events-auto md:group-focus-within/gallery:opacity-100">
                <button
                  type="button"
                  onClick={() => go(index - 1)}
                  aria-label={labels.previous}
                  className="grid size-10 place-items-center rounded-full bg-bg/90 text-text backdrop-blur transition-colors hover:bg-bg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
                </button>
                <button
                  type="button"
                  onClick={() => go(index + 1)}
                  aria-label={labels.next}
                  className="grid size-10 place-items-center rounded-full bg-bg/90 text-text backdrop-blur transition-colors hover:bg-bg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {count > 1 && (
        <ul className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          {list.map((img, i) => {
            const duration = img.video ? formatVideoDuration(img.video.durationMs) : "";
            return (
              <li key={`${img.video ? `v${img.video.id}` : img.media.id}-${i}`} className="shrink-0">
                {/* The thumbnail is often the only rendering of the photo, so its <img> carries the alt (image
                    search reads it); the button's name is that alt plus the position, as before. A video's
                    thumbnail adds "Video" and its length for screen readers and a play badge for the eye. */}
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === index ? "true" : undefined}
                  className={cn(
                    "relative block aspect-[4/5] w-16 overflow-hidden rounded-md bg-surface-2 ring-offset-2 ring-offset-bg transition md:w-20",
                    i === index ? "ring-2 ring-product" : "opacity-70 hover:opacity-100",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  )}
                >
                  <Img media={img.media} alt={img.alt} locale={locale} sizes="80px" fill />
                  {img.video && (
                    <>
                      <span
                        aria-hidden
                        className="absolute bottom-1 start-1 inline-flex items-center gap-0.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[0.625rem] font-medium leading-none text-white tabular-nums"
                      >
                        <Play className="size-2.5 fill-current" strokeWidth={0} />
                        {duration && <span dir="ltr">{duration}</span>}
                      </span>
                      <span className="sr-only">{`${locale === "ar" ? "، " : ", "}${labels.video ?? "Video"}${duration ? ` ${duration}` : ""}`}</span>
                    </>
                  )}
                  <span className="sr-only">{` (${i + 1}/${count})`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
