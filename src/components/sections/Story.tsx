// Two-column brand story: image and text, optional figures and signature.
import { getMediaByIds } from "@/lib/data/media";
import { localize } from "@/i18n/localize";
import Img from "@/lib/media/Img";
import { cn } from "@/lib/utils";
import Reveal from "./Reveal";
import SectionStyles from "./SectionStyles";
import type { StoryContent } from "./schemas";
import { CtaLink, GoldRule, Paragraphs, type SectionProps } from "./ui";

export default async function Story({ content, locale, priority = false }: SectionProps<StoryContent>) {
  const media = content.imageId ? await getMediaByIds([content.imageId]) : {};
  const image = content.imageId ? media[content.imageId] : undefined;
  const eyebrow = localize(content.eyebrow, locale);
  const signature = localize(content.signature, locale);

  return (
    <section className="py-20 md:py-28">
      <SectionStyles />
      <div className={cn("container-x grid items-center gap-12 lg:gap-20", image && "lg:grid-cols-2")}>
        {image && (
          <Reveal className={cn("relative isolate", content.imagePosition === "end" && "lg:order-last")}>
            <div className="relative aspect-[4/5] overflow-hidden rounded-md bg-surface-2">
              {/* Opening the page (e.g. /sayfa/hakkimizda under its title), the image is the LCP: preload it. */}
              <Img media={image} alt={localize(image.alt, locale)} locale={locale} sizes="(min-width: 1024px) 45vw, 92vw" fill preload={priority} />
            </div>
            <div
              aria-hidden
              className={cn(
                "absolute -bottom-5 -z-10 h-2/3 w-2/3 border border-gold/50",
                content.imagePosition === "end" ? "-start-5" : "-end-5",
              )}
            />
          </Reveal>
        )}
        <div className={cn("max-w-xl", !image && "mx-auto text-center")}>
          {eyebrow && <p className="eyebrow mb-5">{eyebrow}</p>}
          <h2 className="font-heading text-4xl leading-[1.05] tracking-tight text-balance text-text md:text-5xl lg:text-6xl">
            {localize(content.title, locale)}
          </h2>
          <GoldRule className={cn("my-8", !image && "mx-auto")} />
          <div className="space-y-5 text-base leading-relaxed text-pretty text-text-muted md:text-lg">
            <Paragraphs text={content.body} locale={locale} />
          </div>
          {content.stats.length > 0 && (
            <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-border pt-8 sm:grid-cols-3">
              {content.stats.map((stat, i) => (
                <div key={i} className="flex flex-col-reverse gap-1">
                  <dt className="text-xs uppercase tracking-[0.14em] text-text-muted">{localize(stat.label, locale)}</dt>
                  <dd className="font-heading text-3xl text-text md:text-4xl">{localize(stat.value, locale)}</dd>
                </div>
              ))}
            </dl>
          )}
          {signature && <p className="mt-10 font-heading text-2xl italic text-text">{signature}</p>}
          {content.cta && (
            <div className="mt-10">
              <CtaLink cta={content.cta} locale={locale} variant="link" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
