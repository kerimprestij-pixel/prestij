// The pre-information form and distance sales agreement exactly as accepted at checkout (the
// sanitized HTML snapshot stored with the order), collapsed by default. They are printed too (opened
// for printing): until the e-mail copy exists, the printed/saved order page is the buyer's copy.
import { ChevronDown, FileText } from "lucide-react";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import type { LegalSnapshot } from "@/lib/orders/read";
import PrintDetails from "./PrintDetails";
import { cardClass, cardTitleClass, legalHtmlClass } from "./ui";

type OrderLegalProps = { legal: LegalSnapshot | null; labels: Messages["order"]["legal"] };

export default function OrderLegal({ legal, labels }: OrderLegalProps) {
  if (!legal) return null;
  const docs = [
    { id: "pre-information", title: labels.preInformation, doc: legal.preInformation },
    { id: "distance-sales", title: labels.distanceSales, doc: legal.distanceSales },
  ];

  return (
    <section aria-labelledby="order-legal-title" className={`${cardClass} print:break-before-page`}>
      <PrintDetails />
      <h2 id="order-legal-title" className={cardTitleClass}>
        {labels.title}
      </h2>
      <div className="mt-5 divide-y divide-border border-y border-border">
        {docs.map(({ id, title, doc }) => (
          <details key={id} data-print-open className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 text-sm font-medium text-text [&::-webkit-details-marker]:hidden">
              <FileText aria-hidden className="size-4 shrink-0 text-gold-text" strokeWidth={1.5} />
              <span className="flex-1">{title}</span>
              <span className="text-xs font-normal text-text-muted">{format(labels.version, { version: doc.version })}</span>
              <ChevronDown aria-hidden className="size-4 shrink-0 text-text-muted transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" strokeWidth={1.5} />
            </summary>
            {/* Scrollable, so it is focusable for keyboard users. */}
            <div
              role="region"
              aria-label={title}
              tabIndex={0}
              className={`${legalHtmlClass} mb-4 max-h-[28rem] overflow-y-auto rounded-sm pb-6 pe-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring print:max-h-none print:overflow-visible`}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(doc.html) }}
            />
          </details>
        ))}
      </div>
    </section>
  );
}
