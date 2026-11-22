// Deep navy band for businesses (hotels, spas, offices) with gold hairlines.
import { Check } from "lucide-react";
import { getMediaByIds } from "@/lib/data/media";
import { localize } from "@/i18n/localize";
import Img from "@/lib/media/Img";
import { cn } from "@/lib/utils";
import type { B2bCtaContent } from "./schemas";
import { CtaLink, Paragraphs, type SectionProps } from "./ui";

export default async function B2bCta({ content, locale }: SectionProps<B2bCtaContent>) {
  const media = content.imageId ? await getMediaByIds([content.imageId]) : {};
  const image = content.imageId ? media[content.imageId] : undefined;
  const eyebrow = localize(content.eyebrow, locale);

  return (
    <section className="relative isolate overflow-hidden bg-brand-950 text-white">
      <div aria-hidden className="absolute inset-x-0 top-3 h-px bg-gold/50" />
      <div aria-hidden className="absolute inset-x-0 bottom-3 h-px bg-gold/50" />
      <div className={cn("container-x grid gap-12 py-20 md:py-28", image && "lg:grid-cols-12 lg:items-center lg:gap-16")}>
        <div className={cn(image ? "lg:col-span-7" : "mx-auto max-w-4xl text-center")}>
          {eyebrow && <p className="eyebrow mb-6 text-gold-300">{eyebrow}</p>}
          <h2 className="font-heading text-4xl leading-[1.05] tracking-tight text-balance md:text-5xl lg:text-6xl">
            {localize(content.title, locale)}
          </h2>
          {content.body && (
            <div className={cn("mt-6 max-w-2xl space-y-4 text-base leading-relaxed text-white/75 md:text-lg", !image && "mx-auto")}>
              <Paragraphs text={content.body} locale={locale} />
            </div>
          )}
          {content.bullets.length > 0 && (
            <ul className={cn("mt-10 grid gap-x-10 gap-y-4 sm:grid-cols-2", !image && "mx-auto max-w-2xl text-start")}>
              {content.bullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-3 border-t border-gold/25 pt-4 text-[0.95rem] text-white/90">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" strokeWidth={1.75} />
                  <span>{localize(bullet, locale)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className={cn("mt-12 flex flex-wrap gap-3", !image && "justify-center")}>
            <CtaLink cta={content.cta} locale={locale} variant="light" />
            {content.secondaryCta && <CtaLink cta={content.secondaryCta} locale={locale} variant="outline-light" />}
          </div>
        </div>
        {image && (
          <div className="lg:col-span-5">
            <div className="relative mx-auto aspect-[4/5] max-w-md overflow-hidden rounded-t-full border border-gold/40 p-2">
              <div className="relative size-full overflow-hidden rounded-t-full">
                <Img media={image} alt={localize(image.alt, locale)} locale={locale} sizes="(min-width: 1024px) 34vw, 90vw" fill />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
