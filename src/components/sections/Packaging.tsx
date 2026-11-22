// Three packaging formats (pump bottle / 5 L / 20 L) with who each one is for.
import { getMediaByIds } from "@/lib/data/media";
import { localize } from "@/i18n/localize";
import Img from "@/lib/media/Img";
import { cn } from "@/lib/utils";
import Reveal from "./Reveal";
import SectionStyles from "./SectionStyles";
import type { PackagingContent } from "./schemas";
import { CtaLink, ids, SectionHeading, type SectionProps } from "./ui";

export default async function Packaging({ content, locale, priority = false }: SectionProps<PackagingContent>) {
  const media = await getMediaByIds(ids(...content.items.map((i) => i.imageId)));

  return (
    <section className="bg-surface py-20 md:py-28">
      <SectionStyles />
      <div className="container-x">
        <SectionHeading eyebrow={content.eyebrow} title={content.title} intro={content.intro} locale={locale} align="center" />
        <ul
          className={cn(
            "mt-14 grid gap-12 md:mt-20 md:gap-8",
            // The schema allows up to 4 cards: 4 sit 2 × 2 on tablets and in one row on desktops (never 3 + 1).
            content.items.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4 lg:gap-8" : content.items.length === 2 ? "md:grid-cols-2 lg:gap-12" : "md:grid-cols-3 lg:gap-12",
          )}
        >
          {content.items.map((item, i) => {
            const image = item.imageId ? media[item.imageId] : undefined;
            const title = localize(item.title, locale);
            return (
              <Reveal as="li" key={i} delay={i * 120} className="group flex flex-col">
                <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-surface-2">
                  {image && (
                    <div className="absolute inset-0 transition-transform duration-[1400ms] ease-out group-hover:scale-[1.04] motion-reduce:transition-none">
                      <Img
                        media={image}
                        alt={localize(image.alt, locale) || title}
                        locale={locale}
                        sizes="(min-width: 768px) 30vw, 92vw"
                        fill
                        preload={priority && i === 0}
                      />
                    </div>
                  )}
                  <span className="absolute start-5 top-5 font-heading text-sm text-white/90 drop-shadow">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <p className="eyebrow mt-7">{localize(item.audience, locale)}</p>
                <h3 className="mt-3 font-heading text-3xl text-text">{title}</h3>
                {item.description && (
                  <p className="mt-3 max-w-sm text-[0.95rem] leading-relaxed whitespace-pre-line text-text-muted">{localize(item.description, locale)}</p>
                )}
                {item.cta && (
                  <div className="mt-6">
                    <CtaLink cta={item.cta} locale={locale} variant="link" />
                  </div>
                )}
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
