// Small presentational pieces shared by the sections (pure; usable on server and client).
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LocalizedText } from "@/db/schema/common";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { cn } from "@/lib/utils";
import type { SectionAudience } from "./audience-gate-rules";
import { buttonClass, type ButtonVariant } from "./button-styles";
import { isExternalLink, resolveLink } from "./links";

export type SectionProps<T> = {
  content: T;
  locale: Locale;
  messages: Messages;
  /**
   * The section's audience (SectionRenderer passes it). "business" sections render inside <AudienceGate>
   * and are not in the static HTML guests and crawlers get: they never take the page's <h1> and never
   * preload an image.
   */
  audience?: SectionAudience;
  /**
   * The first section guests see at the very top of the page's content (SectionRenderer's `leadsPage`):
   * its first image is the page's LCP candidate, so it is preloaded with high priority.
   */
  priority?: boolean;
};

export { buttonClass, type ButtonVariant };

type Cta = { label: LocalizedText; href: string };

export function CtaLink({
  cta,
  locale,
  variant = "primary",
  className,
  arrow = variant === "link",
}: {
  cta: Cta;
  locale: Locale;
  variant?: ButtonVariant;
  className?: string;
  arrow?: boolean;
}) {
  const label = localize(cta.label, locale);
  const target = resolveLink(locale, cta.href);
  if (!label) return null;
  const inner = (
    <>
      <span>{label}</span>
      {arrow && (
        <ArrowRight
          aria-hidden
          className="size-4 transition-transform duration-300 group-hover/link:translate-x-1 rtl:-scale-x-100 rtl:group-hover/link:-translate-x-1"
        />
      )}
    </>
  );
  if (isExternalLink(target)) {
    return (
      <a href={target} className={buttonClass(variant, className)} rel="noopener noreferrer" target="_blank">
        {inner}
      </a>
    );
  }
  return (
    <Link href={target} className={buttonClass(variant, className)}>
      {inner}
    </Link>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null;
  return <p className={cn("eyebrow", className)}>{children}</p>;
}

export function SectionHeading({
  eyebrow,
  title,
  intro,
  locale,
  align = "start",
  as: Heading = "h2",
  className,
  tone = "default",
}: {
  eyebrow?: LocalizedText | null;
  title?: LocalizedText | null;
  intro?: LocalizedText | null;
  locale: Locale;
  align?: "start" | "center";
  as?: "h1" | "h2" | "h3";
  className?: string;
  tone?: "default" | "light";
}) {
  const e = localize(eyebrow, locale);
  const t = localize(title, locale);
  const i = localize(intro, locale);
  if (!e && !t && !i) return null;
  return (
    <header className={cn("max-w-3xl", align === "center" && "mx-auto text-center", className)}>
      {e && <Eyebrow className={cn("mb-5", tone === "light" && "text-gold-300")}>{e}</Eyebrow>}
      {t && (
        <Heading
          className={cn(
            "font-heading text-4xl leading-[1.05] tracking-tight text-balance md:text-5xl lg:text-6xl",
            tone === "light" ? "text-white" : "text-text",
          )}
        >
          {t}
        </Heading>
      )}
      {i && (
        <p
          className={cn(
            // localizedLong: keep the editor's line breaks and blank-line paragraphs.
            "mt-6 text-base leading-relaxed text-pretty whitespace-pre-line md:text-lg",
            align === "center" && "mx-auto",
            "max-w-2xl",
            tone === "light" ? "text-white/80" : "text-text-muted",
          )}
        >
          {i}
        </p>
      )}
    </header>
  );
}

/** Splits localized text into paragraphs on blank lines. */
export function Paragraphs({ text, locale, className }: { text: LocalizedText | null | undefined; locale: Locale; className?: string }) {
  const value = localize(text, locale);
  if (!value) return null;
  return (
    <>
      {value
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className={className}>
            {p}
          </p>
        ))}
    </>
  );
}

/** A thin gold rule used as an editorial divider. */
export function GoldRule({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block h-px w-14 bg-gold", className)} />;
}

/** Collects every media/product id (ignoring empties) for one batched lookup. */
export function ids(...values: (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && v > 0);
}
