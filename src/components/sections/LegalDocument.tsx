// Renders the current version of a legal text by key. A leading <aside class="legal-draft"> in the
// stored HTML (the "draft, needs legal review" notice) is lifted out and shown as a styled note.
import { localize } from "@/i18n/localize";
import { getLegalDocument } from "@/lib/data/legal";
import { richTextClass } from "./RichText";
import { localizeBodyLinks } from "./localize-links";
import { sanitizeHtml } from "./sanitize-html";
import type { LegalDocumentContent } from "./schemas";
import type { SectionProps } from "./ui";

const DRAFT_NOTICE = /<aside\b[^>]*\blegal-draft\b[^>]*>([\s\S]*?)<\/aside\s*>/i;

export default async function LegalDocument({ content, locale }: SectionProps<LegalDocumentContent>) {
  const doc = await getLegalDocument(content.key);
  if (!doc) return null;

  const raw = localize(doc.body, locale);
  const notice = raw.match(DRAFT_NOTICE)?.[1];
  const body = localizeBodyLinks(sanitizeHtml(notice === undefined ? raw : raw.replace(DRAFT_NOTICE, "")), locale);
  if (!body) return null;

  return (
    <section className="py-12 md:py-20" data-legal-version={doc.version}>
      <div className="container-x max-w-3xl">
        {notice && (
          <aside
            role="note"
            className="legal-draft mb-12 rounded-md border border-border border-s-4 border-s-gold bg-surface p-5 text-sm leading-relaxed text-text md:p-6 [&_strong]:font-semibold"
            dangerouslySetInnerHTML={{ __html: localizeBodyLinks(sanitizeHtml(notice), locale) }}
          />
        )}
        <div className={richTextClass} dangerouslySetInnerHTML={{ __html: body }} />
      </div>
    </section>
  );
}
