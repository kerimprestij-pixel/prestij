// Editorial masonry of lifestyle images with captions; lazy images, gentle reveal on scroll.
import Link from "next/link";
import { getMediaByIds } from "@/lib/data/media";
import { localize } from "@/i18n/localize";
import Img from "@/lib/media/Img";
import { resolveLink } from "./links";
import Reveal from "./Reveal";
import SectionStyles from "./SectionStyles";
import type { LifestyleGalleryContent } from "./schemas";
import { ids, SectionHeading, type SectionProps } from "./ui";

export default async function LifestyleGallery({ content, locale }: SectionProps<LifestyleGalleryContent>) {
  const media = await getMediaByIds(ids(...content.items.map((i) => i.imageId)));
  const items = content.items.flatMap((item) => {
    const image = item.imageId ? media[item.imageId] : undefined;
    return image ? [{ ...item, image }] : [];
  });
  if (items.length === 0) return null;

  return (
    <section className="py-20 md:py-28">
      <SectionStyles />
      <div className="container-x">
        <SectionHeading eyebrow={content.eyebrow} title={content.title} intro={content.intro} locale={locale} />
        <div className="mt-12 columns-1 gap-5 sm:columns-2 md:mt-16 lg:columns-3 lg:gap-8">
          {items.map((item, i) => {
            const caption = localize(item.caption, locale);
            const figure = (
              <figure className="group">
                <div className="overflow-hidden rounded-md bg-surface-2">
                  <Img
                    media={item.image}
                    alt={localize(item.image.alt, locale) || caption}
                    locale={locale}
                    sizes="(min-width: 1024px) 30vw, (min-width: 640px) 46vw, 92vw"
                    className="w-full transition-transform duration-[1400ms] ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
                  />
                </div>
                {caption && (
                  <figcaption className="mt-3 flex items-baseline gap-3 text-sm text-text-muted">
                    <span aria-hidden className="font-heading text-gold">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{caption}</span>
                  </figcaption>
                )}
              </figure>
            );
            return (
              <Reveal key={i} delay={(i % 3) * 110} className="mb-5 break-inside-avoid lg:mb-8">
                {item.href ? (
                  <Link
                    href={resolveLink(locale, item.href)}
                    className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                  >
                    {figure}
                  </Link>
                ) : (
                  figure
                )}
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
