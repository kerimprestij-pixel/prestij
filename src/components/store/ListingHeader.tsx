import type { ReactNode } from "react";
import type { MediaLike } from "@/lib/media/types";
import Img from "@/lib/media/Img";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { claimPageHeading } from "./page-heading";

/** Stable claim token: a listing header is always its page's title. */
const LISTING_HEADER = {};

/**
 * Editorial header for listing pages: optional breadcrumbs, eyebrow, serif title (the page's <h1>),
 * intro and an optional side image.
 */
export default function ListingHeader({
  eyebrow,
  title,
  intro,
  image,
  locale,
  breadcrumbs,
  claimHeading = true,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  image?: MediaLike | null;
  locale: Locale;
  /** A <Breadcrumbs> trail shown above the title, on the header's tint. */
  breadcrumbs?: ReactNode;
  /**
   * false: render the <h1> without claiming the page heading, for a header that only some viewers see
   * (CmsPage shows it to business customers in place of a retail-only hero, which keeps the claim).
   */
  claimHeading?: boolean;
  children?: ReactNode;
}) {
  // A hero further down the page then renders its headline as <h2> (see page-heading.ts).
  if (claimHeading) claimPageHeading(LISTING_HEADER);
  return (
    <header className="relative isolate overflow-hidden border-b border-border">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-full bg-linear-to-b from-product-soft/70 to-transparent" />
      {breadcrumbs && <div className="container-x pt-6 md:pt-8">{breadcrumbs}</div>}
      <div
        className={cn(
          "container-x grid grid-cols-[minmax(0,1fr)] gap-10 pb-10 md:pb-14",
          breadcrumbs ? "pt-10 md:pt-14" : "pt-14 md:pt-20",
          image && "md:grid-cols-12 md:items-end",
        )}
      >
        {/* min-w-0: the chips row below scrolls sideways instead of widening the grid column. */}
        <div className={cn("min-w-0", image && "md:col-span-7")}>
          {eyebrow && <p className="eyebrow mb-5">{eyebrow}</p>}
          <h1 className="font-heading text-5xl leading-[1.02] tracking-tight text-balance text-text md:text-7xl">{title}</h1>
          {intro && <p className="mt-6 max-w-xl text-base leading-relaxed text-pretty text-text-muted md:text-lg">{intro}</p>}
          {children && <div className="mt-10">{children}</div>}
        </div>
        {image && (
          <div className="relative hidden aspect-[4/3] overflow-hidden rounded-t-full md:col-span-5 md:block">
            {/* Shown from md up only: a media-scoped preload, so phones never fetch it. Stored alt text (the
                category photo is a high-priority image that search engines read). */}
            <Img media={image} locale={locale} sizes="38vw" fill preload preloadMedia="(min-width: 768px)" />
          </div>
        )}
      </div>
    </header>
  );
}
