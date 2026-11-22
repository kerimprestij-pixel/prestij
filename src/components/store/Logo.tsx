import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { href } from "@/i18n/paths";
import Img from "@/lib/media/Img";
import type { MediaLike } from "@/lib/media/types";
import { cn } from "@/lib/utils";
import { CrownMark } from "./BrandIcons";

type Tone = "default" | "inverse";

type LogoProps = {
  locale: Locale;
  siteName: string;
  /** Logo for light backgrounds (settings.general.logo.lightId). */
  logo: MediaLike | null;
  /** Logo for dark backgrounds (settings.general.logo.darkId). */
  logoDark: MediaLike | null;
  /** "inverse" = placed on a dark surface (e.g. the navy footer). */
  tone?: Tone;
  /** Visible on load (the header): the light and dark logos load eagerly, at normal priority (never the LCP image). */
  eager?: boolean;
  className?: string;
};

/** Text fallback: gold crown over the letter-spaced serif name, like the printed logo. */
function Wordmark({ siteName, tone }: { siteName: string; tone: Tone }) {
  return (
    <span className="inline-flex flex-col items-center leading-none">
      <CrownMark className="mb-1.5 h-2.5 w-auto text-gold" />
      <span
        dir="ltr"
        className={cn(
          // Negative end margin cancels the trailing letter-spacing so the mark stays centred.
          "-me-[0.3em] font-heading text-[1.375rem] font-semibold tracking-[0.3em] md:text-2xl",
          tone === "inverse" ? "text-brand-contrast" : "text-brand dark:text-text",
        )}
      >
        {siteName}
      </span>
    </span>
  );
}

/** Largest rendered height (md:h-10) and the max-w cap below, in CSS pixels. */
const LOGO_HEIGHT = 40;
const LOGO_MAX_WIDTH = 180;

/** The logo's rendered width for `sizes` (height × aspect ratio, capped), so phones pick the small file. */
export function logoSizes(media: Pick<MediaLike, "width" | "height">): string {
  const { width, height } = media;
  if (!width || !height) return `${LOGO_MAX_WIDTH}px`;
  return `${Math.min(LOGO_MAX_WIDTH, Math.ceil((LOGO_HEIGHT * width) / height))}px`;
}

function LogoImage({ media, siteName, eager }: { media: MediaLike; siteName: string; eager?: boolean }) {
  return (
    <Img
      media={media}
      alt={siteName}
      sizes={logoSizes(media)}
      eager={eager}
      placeholder={false}
      className="h-9 w-auto max-w-[180px] object-contain md:h-10"
    />
  );
}

/** Home link with the uploaded logo, or the typographic wordmark when no logo is set. */
export default function Logo({ locale, siteName, logo, logoDark, tone = "default", eager, className }: LogoProps) {
  let content: ReactNode;
  if (tone === "inverse") {
    // A light-background logo would vanish on navy, so only a dark-background logo replaces the wordmark.
    content = logoDark ? <LogoImage media={logoDark} siteName={siteName} /> : <Wordmark siteName={siteName} tone="inverse" />;
  } else if (logo) {
    // Light/dark is the `dark` class ThemeScript sets on <html> before first paint (saved choice or the
    // OS setting), which a static page cannot know on the server: both images are in the HTML and CSS
    // shows one. With `eager`, both load eagerly at normal priority, so the visible one is never the
    // late lazy image (the hidden one costs one small file).
    content = (
      <>
        <span className="contents dark:hidden">
          <LogoImage media={logo} siteName={siteName} eager={eager} />
        </span>
        <span className="hidden dark:contents">
          {logoDark ? <LogoImage media={logoDark} siteName={siteName} eager={eager} /> : <Wordmark siteName={siteName} tone="default" />}
        </span>
      </>
    );
  } else {
    content = <Wordmark siteName={siteName} tone="default" />;
  }

  return (
    <Link
      href={href(locale, "home")}
      className={cn(
        "inline-flex items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
        className,
      )}
    >
      {content}
    </Link>
  );
}
