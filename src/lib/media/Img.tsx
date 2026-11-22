// Responsive <picture> for processed media (AVIF + WebP srcsets, intrinsic size, blur placeholder).
// Pure and hook-free so it renders in Server and Client Components alike.
// Day 6: a video row is never an image. <Img> renders nothing for one (and ignores a video given as the
// phone crop) instead of an <img src="….mp4">; image consumers filter videos out before they get here.
import type { CSSProperties } from "react";
import { preload as preloadResource } from "react-dom";
import type { Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { cn } from "@/lib/utils";
import { isVideoMedia, variantUrl, type MediaLike, type MediaVariant } from "./types";

export type ImgProps = {
  media: MediaLike;
  /** Overrides the stored alt text. Pass "" for purely decorative images. */
  alt?: string;
  /** Locale used to pick the stored alt text (default "tr"). */
  locale?: Locale;
  /** Required: how wide the image renders, e.g. "(min-width: 1024px) 50vw, 100vw". */
  sizes: string;
  /** Classes for the <img> element. */
  className?: string;
  style?: CSSProperties;
  /** Cover the nearest positioned ancestor (absolute inset-0, object-cover). */
  fill?: boolean;
  /**
   * The page's main above-the-fold image (the LCP candidate: first hero or product image): eager, high
   * fetch priority and a <link rel="preload"> in <head>. Keep it to the images that can be the LCP.
   */
  preload?: boolean;
  /**
   * With `preload`, for an image that is only displayed from some width on (e.g. hidden below md):
   * the media query of the preload, e.g. "(min-width: 768px)". The <img> itself is then lazy, so
   * phones never download the hidden copy, while the preload still fetches it early where it shows.
   */
  preloadMedia?: string;
  /**
   * Visible on load but not the main image (e.g. the header logo): loads eagerly at the browser's
   * normal priority, without a preload, so it does not compete with the `preload` image.
   */
  eager?: boolean;
  /**
   * Show the blur placeholder while loading (default true). It sits behind the image, so an opaque
   * image hides it once loaded; turn it off for transparent images or object-contain layouts.
   */
  placeholder?: boolean;
  /**
   * Art direction: a different image (e.g. a portrait crop) below the md breakpoint. One <img>
   * either way, so phones never download the desktop file; with `preload` both get a
   * media-scoped preload.
   */
  mobile?: { media: MediaLike; sizes: string } | null;
};

const MOBILE_QUERY = "(max-width: 767.98px)";
const DESKTOP_QUERY = "(min-width: 768px)";

function byFormat(variants: MediaVariant[], format: MediaVariant["format"]): MediaVariant[] {
  const seen = new Set<number>();
  return variants
    .filter((v) => v.format === format)
    .sort((a, b) => a.width - b.width)
    .filter((v) => (seen.has(v.width) ? false : (seen.add(v.width), true)));
}

function srcSetOf(media: MediaLike, variants: MediaVariant[]): string {
  return variants.map((v) => `${variantUrl(media, v.key)} ${v.width}w`).join(", ");
}

/** AVIF/WebP srcsets plus the largest WebP (or the original) as the plain src. */
function sourcesOf(media: MediaLike) {
  const variants = media.variants ?? [];
  const avif = byFormat(variants, "avif");
  const webp = byFormat(variants, "webp");
  const fallback = webp.at(-1);
  return {
    src: fallback ? variantUrl(media, fallback.key) : media.url,
    avifSrcSet: srcSetOf(media, avif),
    webpSrcSet: srcSetOf(media, webp),
  };
}

type Sources = ReturnType<typeof sourcesOf>;

function preloadImage({ src, avifSrcSet, webpSrcSet }: Sources, sizes: string, media?: string) {
  // Hint the best format first; browsers skip a preload whose `type` they cannot decode.
  const [hintSet, hintType] = avifSrcSet ? [avifSrcSet, "image/avif"] : [webpSrcSet, "image/webp"];
  preloadResource(src, {
    as: "image",
    fetchPriority: "high",
    imageSrcSet: hintSet || undefined,
    imageSizes: hintSet ? sizes : undefined,
    type: hintSet ? hintType : undefined,
    media,
  });
}

/** Intrinsic size on an art-directed <source> (avoids layout shift when the crops differ). */
function sizeAttrs(media: MediaLike, fill: boolean): { width?: number; height?: number } {
  return !fill && media.width != null && media.height != null ? { width: media.width, height: media.height } : {};
}

export default function Img({
  media,
  alt,
  locale = "tr",
  sizes,
  className,
  style,
  fill = false,
  preload = false,
  preloadMedia,
  eager = false,
  placeholder = true,
  mobile: mobileProp,
}: ImgProps) {
  if (isVideoMedia(media)) return null;
  const mobile = mobileProp && !isVideoMedia(mobileProp.media) ? mobileProp : null;
  const main = sourcesOf(media);
  const { src, avifSrcSet, webpSrcSet } = main;
  const small = mobile ? sourcesOf(mobile.media) : null;

  if (preload) {
    if (mobile && small) {
      preloadImage(small, mobile.sizes, MOBILE_QUERY);
      preloadImage(main, sizes, DESKTOP_QUERY);
    } else {
      preloadImage(main, sizes, preloadMedia);
    }
  }
  // A media-scoped preload means the image is hidden elsewhere: never fetch the hidden copy eagerly.
  const loadEagerly = (preload && !(preloadMedia && !mobile)) || eager;

  const blurStyle: CSSProperties | undefined =
    placeholder && media.blurDataUrl
      ? {
          backgroundImage: `url("${media.blurDataUrl}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }
      : undefined;

  const hasIntrinsicSize = !fill && media.width != null && media.height != null;

  return (
    <picture className="contents">
      {mobile && small && (
        <>
          {/* The first matching <source> wins, so the phone crop comes first. */}
          {small.avifSrcSet && (
            <source media={MOBILE_QUERY} type="image/avif" srcSet={small.avifSrcSet} sizes={mobile.sizes} {...sizeAttrs(mobile.media, fill)} />
          )}
          <source
            media={MOBILE_QUERY}
            srcSet={small.webpSrcSet || small.src}
            sizes={small.webpSrcSet ? mobile.sizes : undefined}
            type={small.webpSrcSet ? "image/webp" : undefined}
            {...sizeAttrs(mobile.media, fill)}
          />
        </>
      )}
      {avifSrcSet && <source type="image/avif" srcSet={avifSrcSet} sizes={sizes} />}
      {webpSrcSet && <source type="image/webp" srcSet={webpSrcSet} sizes={sizes} />}
      {/* Variants are pre-optimized at import time, so next/image would only add a second pipeline. */}
      <img
        src={src}
        alt={alt ?? localize(media.alt, locale)}
        width={hasIntrinsicSize ? (media.width ?? undefined) : undefined}
        height={hasIntrinsicSize ? (media.height ?? undefined) : undefined}
        sizes={webpSrcSet ? sizes : undefined}
        srcSet={webpSrcSet || undefined}
        decoding="async"
        loading={loadEagerly ? "eager" : "lazy"}
        fetchPriority={preload ? "high" : undefined}
        className={cn(fill ? "absolute inset-0 size-full object-cover" : "block h-auto max-w-full", className)}
        style={blurStyle ? { ...blurStyle, ...style } : style}
      />
    </picture>
  );
}
