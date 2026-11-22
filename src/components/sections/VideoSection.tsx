// Day 6 (VIDEO-STORE): section type "video". A library video over its cover image, with an optional
// eyebrow, title and short text: "wide" puts the copy above a full-width video, "split" puts them side
// by side from tablets up (copy first in reading order, mirrored for RTL by the grid).
// The box takes the video's own aspect ratio from the server (no layout shift), the cover <Img> is what
// the static HTML shows (preloaded when the section opens the page), and VideoPlayer (loaded lazily, its
// own chunk: pages without a video section never download it) attaches the
// source only when needed: on the click for "click_to_play", when the section scrolls into view for
// "autoplay_muted" (never by itself with reduced motion or a constrained connection).
// Renders nothing when the video is missing or is not a video row (e.g. deleted in the library).
import { getMediaByIds } from "@/lib/data/media";
import { localize } from "@/i18n/localize";
import Img from "@/lib/media/Img";
import { isVideoMedia } from "@/lib/media/types";
import { ownLocaleText } from "@/lib/seo/localized";
import { cn } from "@/lib/utils";
import type { VideoSectionContent } from "./schemas";
import { Paragraphs, SectionHeading, type SectionProps } from "./ui";
import { getVideoMedia } from "./video-media";
import LazyVideoPlayer from "./LazyVideoPlayer";
import { videoAspectRatio, videoSourceType } from "./video-rules";

export default async function VideoSection({ content, locale, messages, priority = false }: SectionProps<VideoSectionContent>) {
  const [data, chosen] = await Promise.all([
    getVideoMedia(content.videoMediaId),
    content.posterImageId ? getMediaByIds([content.posterImageId]) : Promise.resolve({} as Awaited<ReturnType<typeof getMediaByIds>>),
  ]);
  if (!data) return null;
  const chosenPoster = content.posterImageId ? chosen[content.posterImageId] : undefined;
  const poster = chosenPoster && !isVideoMedia(chosenPoster) ? chosenPoster : data.poster;

  const title = localize(content.title, locale);
  // The video's own description in this language, else the section title, else "Video".
  const label = ownLocaleText(data.video.alt, locale) || title || messages.product.video;
  const split = content.layout === "split";
  const aspectRatio = videoAspectRatio(data.video.width, data.video.height);
  const hasCopy = Boolean(localize(content.eyebrow, locale) || title || localize(content.text, locale));

  const player = (
    <div className="relative w-full overflow-hidden rounded-md bg-brand-950" style={{ aspectRatio }}>
      <LazyVideoPlayer
        src={data.video.url}
        type={videoSourceType(data.video.url, data.video.mime)}
        mode={content.playback === "autoplay_muted" ? "autoplay" : "click"}
        label={label}
        labels={{ play: messages.product.playVideo, pause: messages.product.pauseVideo }}
      >
        {poster && (
          <Img
            media={poster}
            alt={label}
            locale={locale}
            sizes={split ? "(min-width: 1024px) 55vw, 92vw" : "(min-width: 1280px) 1200px, 92vw"}
            fill
            preload={priority}
          />
        )}
      </LazyVideoPlayer>
    </div>
  );

  if (split) {
    return (
      <section className="py-20 md:py-28">
        <div className={cn("container-x grid items-center gap-10 lg:gap-16", hasCopy && "md:grid-cols-12")}>
          {hasCopy && (
            <div className="md:col-span-5">
              <SectionHeading eyebrow={content.eyebrow} title={content.title} locale={locale} />
              <div className="mt-6 space-y-4 text-base leading-relaxed text-pretty text-text-muted md:text-lg">
                <Paragraphs text={content.text} locale={locale} />
              </div>
            </div>
          )}
          <div className={cn(hasCopy && "md:col-span-7")}>{player}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-20 md:py-28">
      <div className="container-x">
        {hasCopy && (
          <div className="mb-10 md:mb-14">
            <SectionHeading eyebrow={content.eyebrow} title={content.title} intro={content.text} locale={locale} align="center" className="mx-auto" />
          </div>
        )}
        <div className="mx-auto max-w-6xl">{player}</div>
      </div>
    </section>
  );
}
