// Thumbnail of a media library row for panel grids, pickers and lists (day 6). An image renders as
// itself (<Img>); a video renders its cover image (or a neutral tile when it has none) with a play badge
// and its duration, and screen readers hear "Video". The video file itself is never used as an image.
// Pure and hook-free: Server and Client Components.
import { Film, Play } from "lucide-react";
import Img from "@/lib/media/Img";
import { isVideoMedia, type MediaLike } from "@/lib/media/types";
import { cn } from "@/lib/utils";
import { formatMediaDuration } from "./media-format";

export { formatMediaDuration };

/** A media row as the panel has it (PanelMedia fits): videos carry `durationMs` and their `poster`. */
export type MediaThumbMedia = MediaLike & { durationMs?: number | null; poster?: MediaLike | null };

export type MediaThumbProps = {
  media: MediaThumbMedia;
  /** As for <Img>: how wide the thumbnail renders, e.g. "48px". */
  sizes: string;
  /** Cover the nearest positioned ancestor (like <Img fill>). Without it the thumbnail fills its own box. */
  fill?: boolean;
  /** Alternative text; thumbnails next to a visible label are decorative (the default ""). */
  alt?: string;
  /** Classes for the <img> element (image rows and video covers). */
  className?: string;
  /** Show the duration next to the play badge (default true; turn it off for very small thumbnails). */
  showDuration?: boolean;
};

export default function MediaThumb({ media, sizes, fill = false, alt = "", className, showDuration = true }: MediaThumbProps) {
  if (!isVideoMedia(media)) return <Img media={media} alt={alt} sizes={sizes} fill={fill} className={className} />;

  // Tiny thumbnails (showDuration false) sit next to a label that states the duration itself.
  const duration = showDuration ? formatMediaDuration(media.durationMs) : "";
  return (
    <span className={cn("block overflow-hidden bg-surface-2", fill ? "absolute inset-0" : "relative size-full")}>
      {media.poster ? (
        <Img media={media.poster} alt={alt} sizes={sizes} fill className={className} />
      ) : (
        <span aria-hidden className="grid size-full place-items-center bg-brand-950 text-gold-200">
          <Film className="size-1/3 max-h-8 max-w-8" strokeWidth={1.5} />
        </span>
      )}
      <span
        aria-hidden
        className="absolute bottom-1 start-1 inline-flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[0.625rem] font-medium leading-none text-white tabular-nums"
      >
        <Play className="size-2.5 fill-current" strokeWidth={0} />
        {duration ? <span dir="ltr">{duration}</span> : null}
      </span>
      <span className="sr-only">{duration ? `Video, ${duration}` : "Video"}</span>
    </span>
  );
}
