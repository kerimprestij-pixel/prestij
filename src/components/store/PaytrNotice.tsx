// PayTR's contract notice (PayTR-fix IMPL-B, S7; Çerçeve Sözleşme Art. 10.2 and 10.3): the optional PayTR logo the
// owner picks in Ayarlar › Ödeme yöntemleri (an image uploaded from PayTR's own logo files, PayTR panel or the
// PayTR_Gorselleri.zip linked from the dev.paytr.com FAQ; nothing renders without
// one), and the sentence footer.paytr.notice whose {company} is the link to https://www.paytr.com. The company name
// is Turkish inside Arabic text, so it sits in <bdi>. Server component, hook-free, no client JS. Where it shows and
// why: src/lib/payments/paytr-notice.ts.
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/get-messages";
import Img from "@/lib/media/Img";
import type { MediaLike } from "@/lib/media/types";
import { PAYTR_WEBSITE_URL } from "@/lib/payments/paytr-notice";
import { cn } from "@/lib/utils";

const COMPANY = "{company}";

/** The notice around its {company} placeholder; a text without it (only possible by hand) gets the link after it. */
export function splitPaytrNotice(template: string): { before: string; after: string } {
  const at = template.indexOf(COMPANY);
  if (at < 0) return { before: `${template.trimEnd()} `, after: "" };
  return { before: template.slice(0, at), after: template.slice(at + COMPANY.length) };
}

type PaytrNoticeProps = {
  locale: Locale;
  labels: Messages["footer"]["paytr"];
  newTabHint: string;
  /** settings.payments.paytrLogoImageId as media, or null (no logo). */
  logo: MediaLike | null;
  /** "inverse" = on the navy footer. */
  tone?: "default" | "inverse";
  className?: string;
};

export default function PaytrNotice({ locale, labels, newTabHint, logo, tone = "default", className }: PaytrNoticeProps) {
  const { before, after } = splitPaytrNotice(labels.notice);
  return (
    <div data-paytr-notice className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      {logo ? (
        // PayTR's logo files are made for light backgrounds: a white plate keeps them readable on navy and in dark mode.
        <span className="inline-flex shrink-0 items-center rounded-sm bg-white px-2 py-1">
          <Img media={logo} alt={labels.logoAlt} locale={locale} sizes="112px" placeholder={false} className="h-5 w-auto max-w-28 object-contain" />
        </span>
      ) : null}
      <p className="min-w-0">
        {before}
        <a
          href={PAYTR_WEBSITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "rounded-sm underline underline-offset-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
            tone === "inverse"
              ? "decoration-brand-contrast/30 hover:text-brand-contrast hover:decoration-gold focus-visible:outline-gold"
              : "decoration-border hover:text-text hover:decoration-gold focus-visible:outline-ring",
          )}
        >
          <bdi>{labels.company}</bdi>
          <span className="sr-only"> {newTabHint}</span>
        </a>
        {after}
      </p>
    </div>
  );
}
