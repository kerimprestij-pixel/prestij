import { localize } from "@/i18n/localize";
import { cn } from "@/lib/utils";
import { localizedRichTextHtml } from "./localize-links";
import type { RichTextContent } from "./schemas";
import { SectionHeading, type SectionProps } from "./ui";

export const richTextClass = cn(
  "text-base leading-relaxed text-text-muted md:text-lg [&>:first-child]:mt-0",
  "[&_a]:text-text [&_a]:underline [&_a]:decoration-gold [&_a]:underline-offset-4 hover:[&_a]:decoration-2",
  "[&_blockquote]:my-8 [&_blockquote]:border-s-2 [&_blockquote]:border-gold [&_blockquote]:ps-6 [&_blockquote]:font-heading [&_blockquote]:text-2xl [&_blockquote]:italic [&_blockquote]:[--font-heading:var(--font-heading-italic)] [&_blockquote]:text-text",
  "[&_h2]:mt-12 [&_h2]:mb-4 [&_h2]:font-heading [&_h2]:text-3xl [&_h2]:text-text md:[&_h2]:text-4xl",
  "[&_h3]:mt-10 [&_h3]:mb-3 [&_h3]:font-heading [&_h3]:text-2xl [&_h3]:text-text",
  "[&_h4]:mt-8 [&_h4]:mb-2 [&_h4]:text-sm [&_h4]:font-medium [&_h4]:uppercase [&_h4]:tracking-[0.14em] [&_h4]:text-text",
  "[&_hr]:my-10 [&_hr]:border-border [&_li]:mt-2 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:ps-6 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:ps-6",
  "[&_p+p]:mt-5 [&_ul+p]:mt-5 [&_ol+p]:mt-5 [&_strong]:font-semibold [&_strong]:text-text",
);

export default function RichText({ content, locale }: SectionProps<RichTextContent>) {
  const html = localizedRichTextHtml(localize(content.html, locale), locale);
  if (!html) return null;
  return (
    <section className="py-16 md:py-24">
      <div className={cn("container-x", content.width === "narrow" ? "max-w-3xl" : "max-w-5xl")}>
        <SectionHeading eyebrow={content.eyebrow} title={content.title} locale={locale} className="mb-10" />
        <div className={richTextClass} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </section>
  );
}
