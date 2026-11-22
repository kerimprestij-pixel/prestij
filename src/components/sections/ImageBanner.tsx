// Wide image band with optional overlay copy and a call to action.
import { getMediaByIds } from "@/lib/data/media";
import { localize } from "@/i18n/localize";
import Img from "@/lib/media/Img";
import { cn } from "@/lib/utils";
import type { ImageBannerContent } from "./schemas";
import { CtaLink, ids, type SectionProps } from "./ui";

/** Matches the md breakpoint the two copies switch at (md:hidden / hidden md:block). */
const PHONE_QUERY = "(max-width: 767.98px)";
const WIDE_QUERY = "(min-width: 768px)";

export default async function ImageBanner({ content, locale, priority = false }: SectionProps<ImageBannerContent>) {
  const media = await getMediaByIds(ids(content.imageId, content.mobileImageId));
  const image = content.imageId ? media[content.imageId] : undefined;
  const mobile = content.mobileImageId ? media[content.mobileImageId] : undefined;
  const eyebrow = localize(content.eyebrow, locale);
  const title = localize(content.title, locale);
  const body = localize(content.body, locale);
  const hasCopy = Boolean(eyebrow || title || body || content.cta);
  const overlay = Math.min(0.9, Math.max(0, content.overlay / 100));

  return (
    <section
      className={cn(
        "relative isolate flex overflow-hidden bg-brand-950 text-white",
        content.height === "lg" ? "min-h-[80svh]" : "min-h-[60svh]",
      )}
    >
      <div className="absolute inset-0 -z-10">
        {mobile && (
          <div className="absolute inset-0 md:hidden">
            <Img media={mobile} alt="" locale={locale} sizes="100vw" fill preload={priority} preloadMedia={PHONE_QUERY} />
          </div>
        )}
        {image && (
          <div className={cn("absolute inset-0", mobile && "hidden md:block")}>
            <Img
              media={image}
              alt={hasCopy ? "" : localize(image.alt, locale)}
              locale={locale}
              sizes="100vw"
              fill
              preload={priority}
              preloadMedia={mobile ? WIDE_QUERY : undefined}
            />
          </div>
        )}
        {hasCopy && <div aria-hidden className="absolute inset-0" style={{ backgroundColor: `rgb(6 16 38 / ${overlay})` }} />}
      </div>
      {hasCopy && (
        <div
          className={cn(
            "container-x flex w-full flex-col justify-end gap-5 py-16 md:justify-center md:py-24",
            content.align === "center" && "items-center text-center",
            content.align === "end" && "items-end text-end",
          )}
        >
          {eyebrow && <p className="eyebrow text-gold-300">{eyebrow}</p>}
          {title && (
            <h2 className="max-w-3xl font-heading text-4xl leading-[1.05] tracking-tight text-balance md:text-6xl">{title}</h2>
          )}
          {body && <p className="max-w-xl text-base leading-relaxed whitespace-pre-line text-white/85 md:text-lg">{body}</p>}
          {content.cta && (
            <div className="mt-4">
              <CtaLink cta={content.cta} locale={locale} variant="light" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
