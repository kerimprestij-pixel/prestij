// Shared class strings for the order pages.
import type { OrderStatus } from "@/db/schema/commerce";
import { cn } from "@/lib/utils";

/** Bordered surface card; prints as plain sections. */
export const cardClass =
  "rounded-md border border-border bg-surface p-5 sm:p-6 lg:p-8 print:rounded-none print:border-0 print:border-b print:px-0 print:py-5";

export const cardTitleClass = "font-heading text-2xl leading-tight text-text";

/** Small label above a value ("Sipariş numarası", "IBAN"). */
export const labelClass = "font-body text-xs leading-normal font-semibold uppercase tracking-[0.16em] text-text-muted rtl:tracking-normal";

const STATUS_TONE: Record<OrderStatus, string> = {
  pending_payment: "bg-gold/15 text-gold-text ring-gold/35",
  awaiting_transfer: "bg-gold/15 text-gold-text ring-gold/35",
  paid: "bg-brand/10 text-brand ring-brand/20",
  processing: "bg-brand/10 text-brand ring-brand/20",
  shipped: "bg-brand/10 text-brand ring-brand/20",
  delivered: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25 dark:text-emerald-300",
  cancelled: "bg-red-600/10 text-red-800 ring-red-600/25 dark:text-red-300",
  refunded: "bg-surface-2 text-text-muted ring-border",
};

export function statusBadgeClass(status: OrderStatus, className?: string): string {
  return cn(
    "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset print:ring-border",
    STATUS_TONE[status],
    className,
  );
}

/** Rich-text styles for the stored legal HTML: 16 px or more (MSY m.6(1): at least 12 punto), each paragraph keeps its own direction. */
export const legalHtmlClass = cn(
  "text-base leading-relaxed text-text-muted [&_li]:[unicode-bidi:plaintext] [&_p]:[unicode-bidi:plaintext]",
  "[&_a]:text-text [&_a]:underline [&_a]:decoration-gold [&_a]:underline-offset-4",
  "[&_h2]:mt-2 [&_h2]:mb-4 [&_h2]:font-heading [&_h2]:text-2xl [&_h2]:text-text",
  "[&_h3]:mt-7 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-text",
  "[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:font-medium [&_h4]:text-text",
  "[&_hr]:my-8 [&_hr]:border-border [&_li]:mt-1.5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:ps-5",
  "[&_p]:mt-3 [&_strong]:font-semibold [&_strong]:text-text [&_*]:break-words",
  "[&_aside]:my-4 [&_aside]:rounded-sm [&_aside]:border-s-4 [&_aside]:border-gold [&_aside]:bg-surface-2 [&_aside]:p-4",
);
