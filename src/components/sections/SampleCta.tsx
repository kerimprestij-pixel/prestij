// An elegant card inviting businesses to request free samples.
import { getMediaByIds } from "@/lib/data/media";
import { localize } from "@/i18n/localize";
import Img from "@/lib/media/Img";
import { cn } from "@/lib/utils";
import type { SampleCtaContent } from "./schemas";
import { CtaLink, GoldRule, Paragraphs, type SectionProps } from "./ui";

export default async function SampleCta({ content, locale }: SectionProps<SampleCtaContent>) {
  const media = content.imageId ? await getMediaByIds([content.imageId]) : {};
  const image = content.imageId ? media[content.imageId] : undefined;
  const eyebrow = localize(content.eyebrow, locale);
  const note = localize(content.note, locale);

  return (
    <section className="py-20 md:py-28">
      <div className="container-x">
        <div
          className={cn(
            "relative grid overflow-hidden rounded-md border border-border bg-surface",
            image && "md:grid-cols-2",
          )}
        >
          {image && (
            <div className="relative min-h-72 md:min-h-[30rem]">
              <Img media={image} alt={localize(image.alt, locale)} locale={locale} sizes="(min-width: 768px) 45vw, 100vw" fill />
            </div>
          )}
          <div className={cn("flex flex-col justify-center gap-6 p-8 sm:p-12 lg:p-16", !image && "items-center text-center")}>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 className="font-heading text-4xl leading-[1.05] tracking-tight text-balance text-text md:text-5xl">
              {localize(content.title, locale)}
            </h2>
            <GoldRule />
            {content.body && (
              <div className="max-w-lg space-y-4 leading-relaxed text-text-muted">
                <Paragraphs text={content.body} locale={locale} />
              </div>
            )}
            <div className="mt-2 flex flex-col items-start gap-4">
              <CtaLink cta={content.cta} locale={locale} variant="primary" />
              {note && <p className="text-xs uppercase tracking-[0.14em] text-text-muted">{note}</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
