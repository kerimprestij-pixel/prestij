// Product information as a native <details> accordion: accessible, keyboard-friendly, no JS.
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { localizedRichTextHtml } from "@/components/sections/localize-links";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

export type InfoPanel = {
  id: string;
  title: string;
  /** Rich text (sanitized here) or plain text with blank-line paragraphs. */
  text?: string | null;
  /** INCI list: shown verbatim in a small monospaced style. */
  mono?: string | null;
  /** Spec rows. */
  rows?: { label: string; value: string }[];
  children?: ReactNode;
};

/** The product editor's rich text (H2/H3, lists, quote, divider) at the accordion's smaller scale. */
export const proseClass = cn(
  "text-[0.95rem] leading-relaxed text-text-muted [&>:first-child]:mt-0",
  "[&_a]:text-text [&_a]:underline [&_a]:underline-offset-4 [&_strong]:font-semibold [&_strong]:text-text",
  "[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:font-heading [&_h2]:text-2xl [&_h2]:leading-snug [&_h2]:text-text",
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:font-heading [&_h3]:text-xl [&_h3]:text-text",
  "[&_h4]:mt-5 [&_h4]:mb-1.5 [&_h4]:text-xs [&_h4]:font-medium [&_h4]:uppercase [&_h4]:tracking-[0.14em] [&_h4]:text-text",
  "[&_blockquote]:my-6 [&_blockquote]:border-s-2 [&_blockquote]:border-product [&_blockquote]:ps-5 [&_blockquote]:font-heading [&_blockquote]:text-lg [&_blockquote]:italic [&_blockquote]:[--font-heading:var(--font-heading-italic)] [&_blockquote]:text-text",
  "[&_hr]:my-6 [&_hr]:border-border",
  "[&_li]:mt-1.5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:ps-5",
  "[&_p+p]:mt-4 [&_ul+p]:mt-4 [&_ol+p]:mt-4",
);

export default function ProductInfoAccordion({
  panels,
  locale,
  defaultOpen,
  className,
}: {
  panels: InfoPanel[];
  /** Internal links in rich text are localized for this language. */
  locale: Locale;
  /** Id of the panel open on load (defaults to the first). */
  defaultOpen?: string;
  className?: string;
}) {
  const visible = panels.filter((p) => p.text || p.mono || p.rows?.length || p.children);
  if (visible.length === 0) return null;
  const openId = defaultOpen ?? visible[0].id;

  return (
    <div className={cn("divide-y divide-border border-y border-border", className)}>
      {visible.map((panel) => (
        <details key={panel.id} className="group/acc" open={panel.id === openId}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-sm font-medium uppercase tracking-[0.14em] text-text marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            {panel.title}
            <Plus
              aria-hidden
              className="size-4 shrink-0 text-product-strong transition-transform duration-300 group-open/acc:rotate-45 motion-reduce:transition-none"
            />
          </summary>
          <div className="pb-6">
            {panel.text && <div className={proseClass} dangerouslySetInnerHTML={{ __html: localizedRichTextHtml(panel.text, locale) }} />}
            {panel.mono && (
              // INCI names are Latin: lang="en" keeps CSS uppercase from producing Turkish dotted İ.
              <p lang="en" dir="ltr" className="font-mono text-xs leading-relaxed tracking-wide break-words text-text-muted uppercase">
                {panel.mono}
              </p>
            )}
            {panel.rows && panel.rows.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                {panel.rows.map((row, i) => (
                  <div key={i} className="contents">
                    <dt className="text-text-muted">{row.label}</dt>
                    <dd className="text-text tabular-nums">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {panel.children}
          </div>
        </details>
      ))}
    </div>
  );
}
