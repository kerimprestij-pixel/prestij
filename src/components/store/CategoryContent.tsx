// Below a category's product grid: the editorial text (category editor → "Açıklama metni") and the
// frequently asked questions (→ "SSS"), in the Faq section's look. The FAQPage structured data comes
// from that Faq section, so the page has exactly one. Server component: never pass it CategoryData as
// a whole to a client component (the texts would be serialized into the page).
//
// Both blocks show only the visitor's own language (no Turkish fallback on /en or /ar): a page in
// one language with paragraphs in another reads badly and duplicates the Turkish page for search
// engines. The panel's SEO check reports the missing translations.
import Faq from "@/components/sections/Faq";
import { localizedRichTextHtml } from "@/components/sections/localize-links";
import { richTextClass } from "@/components/sections/RichText";
import type { FaqContent } from "@/components/sections/schemas";
import type { CategoryFaqItem } from "@/db/schema/catalog";
import type { LocalizedText } from "@/db/schema/common";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/get-messages";
import { ownLocaleText } from "@/lib/seo/localized";
import { cn } from "@/lib/utils";

/** Sanitized body HTML for `locale` (plain text becomes paragraphs; internal links point to `locale`); "" when none. */
export function categoryBodyHtml(body: LocalizedText | null | undefined, locale: Locale): string {
  return localizedRichTextHtml(ownLocaleText(body, locale), locale);
}

/** The FAQ items that have both a question and an answer in `locale`, in the Faq section's shape. */
export function categoryFaqItems(faq: readonly CategoryFaqItem[], locale: Locale): FaqContent["items"] {
  return faq
    .map((item) => ({ question: ownLocaleText(item.question, locale), answer: ownLocaleText(item.answer, locale) }))
    .filter((item) => item.question && item.answer)
    .map((item) => ({ question: { tr: item.question }, answer: { tr: item.answer } }));
}

/**
 * Fallback FAQ heading. The UI dictionary's `category.faqEyebrow` / `category.faqTitle` ("{category}"
 * placeholder; panel-editable under Metinler) hold the same defaults and win when set; these cover an
 * override saved as an empty string.
 */
const FAQ_HEADING: Record<Locale, { eyebrow: string; title: string }> = {
  tr: { eyebrow: "Sıkça sorulanlar", title: "{category} hakkında" },
  en: { eyebrow: "FAQ", title: "About {category}" },
  ar: { eyebrow: "الأسئلة الشائعة", title: "حول {category}" },
};

type OptionalCategoryMessages = Messages["category"] & { faqEyebrow?: string; faqTitle?: string };

export function categoryFaqHeading(categoryName: string, locale: Locale, messages: Messages): { eyebrow: string; title: string } {
  const m = messages.category as OptionalCategoryMessages;
  const fallback = FAQ_HEADING[locale];
  const title = format(m.faqTitle || fallback.title, { category: categoryName }, locale);
  return { eyebrow: m.faqEyebrow || fallback.eyebrow, title: categoryName ? title : "" };
}

export default function CategoryContent({
  categoryName,
  body,
  faq,
  locale,
  messages,
}: {
  /** Localized category name (the page's <h1>), used in the FAQ heading. */
  categoryName: string;
  body: LocalizedText | null;
  faq: readonly CategoryFaqItem[];
  locale: Locale;
  messages: Messages;
}) {
  const html = categoryBodyHtml(body, locale);
  const items = categoryFaqItems(faq, locale);
  if (!html && items.length === 0) return null;
  const heading = categoryFaqHeading(categoryName, locale, messages);

  return (
    <>
      {html && (
        <section className="border-t border-border">
          <div className="container-x py-16 md:py-24">
            <div className={cn(richTextClass, "mx-auto max-w-3xl")} dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </section>
      )}
      {items.length > 0 && (
        <div className="border-t border-border bg-surface/60">
          {/* `tr` holds the visitor's language here: localize() falls back to it in every locale. */}
          <Faq
            content={{ eyebrow: { tr: heading.eyebrow }, title: heading.title ? { tr: heading.title } : undefined, items }}
            locale={locale}
            messages={messages}
          />
        </div>
      )}
    </>
  );
}
