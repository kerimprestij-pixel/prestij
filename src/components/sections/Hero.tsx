// Opening section. "split" (default): the image sits above the copy on phones and beside it from
// tablets up, so text never lies over the product photo. "full": the image is full-bleed behind the
// copy with a contrast overlay. One art-directed <img> (optional phone crop), preloaded as the LCP
// when the hero opens the page (`priority`).
// Page title: the hero that opens a page (nothing claimed the <h1> before it) is that page's <h1>,
// with its eyebrow (the keyword line) as the first, smaller line inside it; any other hero uses <h2>.
// Both look exactly as before.
// Background video (day 6): a library video (`videoMediaId`, wins) or the legacy `videoUrl`. The static
// HTML has no <video>: a client island (HeroVideo.tsx) attaches the source after load + idle, never with
// reduced motion or a constrained connection, and fades it in over the cover image, which stays the LCP.
// A hero with a library video but no image of its own uses the video's cover image.
import { claimSectionHeading } from "@/components/store/page-heading";
import { getMediaByIds } from "@/lib/data/media";
import { localize } from "@/i18n/localize";
import Img from "@/lib/media/Img";
import { cn } from "@/lib/utils";
import { mayLeadPage } from "./audience-gate-rules";
import HeroVideo from "./HeroVideo";
import type { HeroContent } from "./schemas";
import SectionStyles from "./SectionStyles";
import { CtaLink, ids, type SectionProps } from "./ui";
import { getVideoMedia } from "./video-media";
import { videoSourceType } from "./video-rules";

const NAVY = "6 16 38";
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Overlays for the "full" layout. The editor's strength (0–100) only darkens further: behind the
 * copy the navy never drops below ~0.62, which keeps white text at AA even over a white image.
 */
function overlays(strength: number): { mobile: string; desktop: string; centered: string } {
  const s = clamp(strength / 100, 0, 0.9);
  const strong = clamp(s + 0.45, 0.8, 0.92);
  const text = clamp(s + 0.3, 0.62, 0.85);
  const light = s * 0.3;
  return {
    // Phones: the copy fills the lower two thirds.
    mobile: `linear-gradient(to top, rgb(${NAVY} / ${strong}) 0%, rgb(${NAVY} / ${text}) 65%, rgb(${NAVY} / ${light}) 100%)`,
    // Tablets/desktop, start-aligned copy (mirrored for RTL by the element).
    desktop: `linear-gradient(to right, rgb(${NAVY} / ${text}) 0%, rgb(${NAVY} / ${text * 0.85}) 40%, rgb(${NAVY} / ${light}) 80%)`,
    centered: `radial-gradient(ellipse at center, rgb(${NAVY} / ${text}) 0%, rgb(${NAVY} / ${text * 0.8}) 45%, rgb(${NAVY} / ${light}) 100%)`,
  };
}

export default async function Hero({ content, locale, messages, audience, priority = false }: SectionProps<HeroContent>) {
  // A business-only hero is not in the static HTML (AudienceGate shows guests nothing): it never takes
  // the page's <h1> and never preloads its image (a high-priority download nobody sees).
  const inGuestHtml = mayLeadPage(audience);
  // Only the hero that opens the page for guests (SectionRenderer's `priority`, on pages with
  // `leadsPage`) is the LCP candidate. A hero further down, or below the /urunler grid, loads lazily
  // and must not compete with the real LCP image.
  const preload = priority && inGuestHtml;
  // Before the first await: claims follow tree order (see page-heading.ts).
  const isPageTitle = claimSectionHeading(content, audience);
  const [media, libraryVideo] = await Promise.all([getMediaByIds(ids(content.imageId, content.mobileImageId)), getVideoMedia(content.videoMediaId)]);
  const desktopImage = content.imageId ? media[content.imageId] : undefined;
  const mobileImage = content.mobileImageId ? media[content.mobileImageId] : undefined;
  const image = desktopImage ?? mobileImage ?? libraryVideo?.poster ?? undefined;
  const video = libraryVideo
    ? { src: libraryVideo.video.url, type: videoSourceType(libraryVideo.video.url, libraryVideo.video.mime) }
    : content.videoUrl
      ? { src: content.videoUrl, type: videoSourceType(content.videoUrl) }
      : null;
  const videoLabels = { play: messages.product.playVideo, pause: messages.product.pauseVideo };
  const split = content.layout === "split";
  const eyebrow = localize(content.eyebrow, locale);
  const headline = localize(content.headline, locale);
  const subline = localize(content.subline, locale);
  // Honoured in both layouts (split: the copy column centres its text).
  const center = content.align === "center";
  const sizes = split ? "(min-width: 1024px) 58vw, (min-width: 768px) 50vw, 100vw" : "100vw";
  const full = content.height === "full";
  const overlay = overlays(content.overlay);

  const mediaLayer = (
    <div className="prestij-hero-media absolute inset-0">
      {image && (
        <Img
          media={image}
          alt={localize(image.alt, locale)}
          locale={locale}
          sizes={sizes}
          fill
          preload={preload}
          mobile={desktopImage && mobileImage ? { media: mobileImage, sizes: "100vw" } : null}
        />
      )}
      {/* HeroVideo (placed above the copy) renders the video into this slot once it may play. */}
      {video && <div data-hero-video-slot="" className="absolute inset-0" />}
    </div>
  );

  const eyebrowClass = cn("eyebrow mb-6", !split && "text-gold-100");
  const headlineClass = cn(
    "font-heading text-5xl leading-[1.02] tracking-tight text-balance sm:text-6xl lg:text-7xl xl:text-8xl",
    center ? (split ? "mx-auto max-w-xl" : "mx-auto max-w-4xl") : "max-w-xl",
  );

  const copy = (
    <>
      {isPageTitle ? (
        // The <h1> itself carries no styles: each line keeps the look of the element it replaces
        // (the eyebrow <p>, the headline). The space keeps the two lines apart in the heading's text.
        <h1>
          {eyebrow && (
            <>
              <span className={cn(eyebrowClass, "block text-pretty [font-feature-settings:normal]")}>{eyebrow}</span>{" "}
            </>
          )}
          <span className={cn(headlineClass, "block")}>{headline}</span>
        </h1>
      ) : (
        <>
          {eyebrow && <p className={eyebrowClass}>{eyebrow}</p>}
          <h2 className={headlineClass}>{headline}</h2>
        </>
      )}
      {subline && (
        <p
          className={cn(
            "mt-6 max-w-md text-base leading-relaxed text-pretty whitespace-pre-line md:text-lg",
            split ? "text-text-muted" : "text-white/90",
            center && "mx-auto",
          )}
        >
          {subline}
        </p>
      )}
      {(content.primaryCta || content.secondaryCta) && (
        <div className={cn("mt-10 flex flex-wrap gap-3", center && "justify-center")}>
          {content.primaryCta && <CtaLink cta={content.primaryCta} locale={locale} variant={split ? "primary" : "light"} />}
          {content.secondaryCta && (
            <CtaLink cta={content.secondaryCta} locale={locale} variant={split ? "secondary" : "outline-light"} />
          )}
        </div>
      )}
    </>
  );

  if (split) {
    return (
      <section className="relative isolate overflow-hidden bg-bg">
        <SectionStyles />
        <div className={cn("flex flex-col md:grid md:grid-cols-12", full ? "md:min-h-[86svh]" : "md:min-h-[68svh]")}>
          <div
            className={cn(
              "relative overflow-hidden bg-surface-2 md:order-last md:col-span-6 md:h-auto md:min-h-0 lg:col-span-7",
              full ? "h-[58svh] min-h-80" : "h-[46svh] min-h-72",
            )}
          >
            {mediaLayer}
            {video && <HeroVideo src={video.src} type={video.type} labels={videoLabels} toggleClassName="bottom-4 end-4" />}
          </div>
          <div className="flex md:col-span-6 md:items-center lg:col-span-5">
            <div
              className={cn(
                "prestij-hero-copy w-full px-6 pt-10 pb-14 text-text sm:px-10 md:py-24 md:ps-10 md:pe-12 lg:ps-16 xl:ps-24",
                center && "text-center",
              )}
            >
              {copy}
            </div>
          </div>
        </div>
      </section>
    );
  }

  const minH = full ? "min-h-[88svh] md:min-h-[86svh]" : "min-h-[72svh] md:min-h-[68svh]";
  return (
    <section className="relative isolate overflow-hidden bg-brand-950">
      <SectionStyles />
      <div className={cn("relative", minH)}>
        <div className="absolute inset-0 -z-10 overflow-hidden">
          {mediaLayer}
          <div aria-hidden className="absolute inset-0 md:hidden" style={{ background: overlay.mobile }} />
          <div
            aria-hidden
            className={cn("absolute inset-0 hidden md:block", !center && "rtl:-scale-x-100")}
            style={{ background: center ? overlay.centered : overlay.desktop }}
          />
        </div>
        <div className={cn("flex items-end md:items-center", minH)}>
          <div
            className={cn(
              "prestij-hero-copy container-x w-full px-6 pt-32 pb-14 text-white sm:px-10 md:py-28",
              center && "text-center",
            )}
          >
            {copy}
          </div>
        </div>
        {/* Above the copy (the media layer sits behind it); the copy's bottom padding keeps them apart. */}
        {video && <HeroVideo src={video.src} type={video.type} labels={videoLabels} toggleClassName="bottom-4 end-4" />}
      </div>
    </section>
  );
}
