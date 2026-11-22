// Accessible FAQ accordion (native <details>) with FAQPage structured data.
import { Plus } from "lucide-react";
import { jsonLd } from "@/components/store/format";
import { localize } from "@/i18n/localize";
import { richTextClass } from "./RichText";
import { localizedRichTextHtml } from "./localize-links";
import type { FaqContent } from "./schemas";
import { SectionHeading, type SectionProps } from "./ui";

export default function Faq({ content, locale }: SectionProps<FaqContent>) {
  const items = content.items
    .map((item) => ({ q: localize(item.question, locale), a: localize(item.answer, locale) }))
    .filter((item) => item.q && item.a);
  if (items.length === 0) return null;

  const structured = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <section className="py-20 md:py-28">
      <div className="container-x grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <SectionHeading eyebrow={content.eyebrow} title={content.title} locale={locale} />
        </div>
        <div className="divide-y divide-border border-y border-border lg:col-span-8">
          {items.map((item, i) => (
            <details key={i} className="group/faq">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-6 font-heading text-xl text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:text-2xl [&::-webkit-details-marker]:hidden">
                <span>{item.q}</span>
                <Plus
                  aria-hidden
                  className="mt-1.5 size-5 shrink-0 text-gold transition-transform duration-300 group-open/faq:rotate-45 motion-reduce:transition-none"
                  strokeWidth={1.5}
                />
              </summary>
              <div className={`pb-7 ${richTextClass}`} dangerouslySetInnerHTML={{ __html: localizedRichTextHtml(item.a, locale) }} />
            </details>
          ))}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
    </section>
  );
}
