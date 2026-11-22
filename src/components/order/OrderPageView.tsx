// The guest order page body: hero (thank-you for new orders, else the current status), payment and
// shipment panels, timeline, items with totals, addresses, accepted legal texts and help.
import { Check } from "lucide-react";
import Link from "next/link";
import CreateAccountCta from "@/components/store/account/CreateAccountCta";
import { secondaryButton } from "@/components/store/shell-styles";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { href } from "@/i18n/paths";
import { orderSummaryRows, type OrderView } from "@/lib/orders/read";
import { cn } from "@/lib/utils";
import CopyButton from "./CopyButton";
import { formatOrderDate } from "./format";
import OrderDetails from "./OrderDetails";
import OrderHelp, { type HelpContact } from "./OrderHelp";
import OrderItems from "./OrderItems";
import OrderLegal from "./OrderLegal";
import OrderPaymentPanel from "./OrderPaymentPanel";
import OrderShipmentPanel from "./OrderShipmentPanel";
import OrderTimeline from "./OrderTimeline";
import PrintButton from "./PrintButton";
import { labelClass, statusBadgeClass } from "./ui";

export type OrderPageViewProps = {
  order: OrderView;
  locale: Locale;
  messages: Messages;
  /** The verified access token (needed by the retry-payment form). */
  token: string;
  /** Just placed (?new=1): show the thank-you hero. */
  isNew: boolean;
  /** Back from a failed card payment (?payment=failed). */
  paymentFailed: boolean;
  /** Back from a card payment whose result is not known yet (?payment=checking). */
  paymentChecking?: boolean;
  help: HelpContact;
  /** Request time in ms (read after connection()): lets the havale panel say the deadline has passed. */
  now?: number;
};

/**
 * Print: only the order content (no header, footer or floating buttons), light colors even in dark
 * mode. `html:root` / `html.dark` outrank the theme's `:root` / `.dark` rules.
 */
const PRINT_CSS = `@media print{
@page{margin:14mm}
html:root,html.dark{color-scheme:light;--bg:#fff;--surface:#fff;--surface-2:#f4f4f2;--text:#111827;--text-muted:#4b5563;--border:#d4d4d4;--border-strong:#737373;--brand:#03265f;--brand-contrast:#fff;--gold:#a17c28;--gold-contrast:#fff;--gold-text:#694f16}
body:has([data-order-page])>:not(main){display:none!important}
body:has([data-order-page]){background:#fff}
[data-order-page]{font-size:10.5pt}
}`;

function heroLead(order: OrderView, messages: Messages): { title: string; lead: string; thanks: boolean } {
  const m = messages.order;
  return { title: m.status[order.status], lead: m.statusInfo[order.status], thanks: false };
}

/** Statuses in which each method's thank-you text is still true (later on, the status hero shows). */
const THANKS_STATUSES: Record<OrderView["paymentMethod"], readonly OrderView["status"][]> = {
  card: ["paid", "processing"],
  bank_transfer: ["awaiting_transfer"],
  cash_on_delivery: ["processing"],
  deferred: ["processing"],
};

function thanksLead(order: OrderView, messages: Messages): string {
  const h = messages.order.hero;
  switch (order.paymentMethod) {
    case "card":
      return h.thanksCard;
    case "bank_transfer":
      return h.thanksBankTransfer;
    case "cash_on_delivery":
      return h.thanksCashOnDelivery;
    default:
      return h.thanksDeferred;
  }
}

export default function OrderPageView({ order, locale, messages, token, isNew, paymentFailed, paymentChecking = false, help, now }: OrderPageViewProps) {
  const m = messages.order;
  const thanks = isNew && THANKS_STATUSES[order.paymentMethod].includes(order.status);
  const hero = thanks ? { title: m.hero.thanksTitle, lead: thanksLead(order, messages), thanks: true } : heroLead(order, messages);
  const rows = orderSummaryRows(order.totals, locale, messages);
  const helpLabels = { whatsapp: m.help.whatsapp, call: m.help.call, email: m.help.email, newTab: messages.common.opensInNewTab };
  const copy = { text: m.copy, copiedText: m.copied, failedText: m.copyFailed };

  return (
    <div data-order-page>
      <style href="prestij-order-print" precedence="default">
        {PRINT_CSS}
      </style>

      <header className="relative isolate overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-full bg-linear-to-b from-gold/10 to-transparent print:hidden"
        />
        <div className="container-x grid gap-10 py-12 md:py-16 lg:grid-cols-12 lg:items-end lg:gap-16">
          <div className="min-w-0 lg:col-span-7">
            {hero.thanks ? (
              <span className="mb-7 grid size-14 place-items-center rounded-full border border-gold/50 bg-surface text-gold-text shadow-[0_12px_32px_-18px_rgb(0_0_0/0.35)] motion-safe:animate-fade-up">
                <Check aria-hidden className="size-6" strokeWidth={1.75} />
              </span>
            ) : null}
            <p className="eyebrow">{m.eyebrow}</p>
            <h1 className="mt-4 font-heading text-5xl leading-[1.02] tracking-tight text-balance text-text md:text-6xl lg:text-7xl">
              {hero.title}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-pretty text-text-muted md:text-lg">{hero.lead}</p>
            {hero.thanks && <p className="mt-4 max-w-xl text-sm leading-relaxed text-text-muted print:hidden">{m.hero.saveLink}</p>}
          </div>

          <div className="min-w-0 lg:col-span-5">
            <div className="rounded-md border border-border bg-surface p-5 sm:p-6 print:border-0 print:p-0">
              <p className={labelClass}>{m.orderNumber}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p dir="ltr" className="font-heading text-4xl leading-none text-text tabular-nums">
                  {order.orderNumber}
                </p>
                <CopyButton value={order.orderNumber} label={m.copyOrderNumber} {...copy} />
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
                <p className="text-text-muted">
                  <span className="sr-only">{m.placedOn}: </span>
                  <time dateTime={order.createdAt}>{formatOrderDate(order.createdAt, locale)}</time>
                </p>
                <p className={statusBadgeClass(order.status)}>
                  <span aria-hidden className="size-1.5 rounded-full bg-current" />
                  {m.status[order.status]}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="container-x grid gap-6 py-10 md:py-14 lg:grid-cols-12 lg:gap-x-10 lg:gap-y-6 print:block print:space-y-0">
        {/* Actionable panels first in the DOM (top on phones), the side column on desktop. */}
        <aside className="flex min-w-0 flex-col gap-6 lg:col-span-5 lg:col-start-8 lg:row-start-1 print:gap-0">
          <OrderPaymentPanel order={order} locale={locale} messages={messages} token={token} paymentFailed={paymentFailed} paymentChecking={paymentChecking} now={now} />
          <OrderShipmentPanel order={order} locale={locale} messages={messages} />
          {/* ACCOUNTS: guests (not signed in) are offered an account; the order links after verification. */}
          <CreateAccountCta email={order.email} registerHref={href(locale, "register")} labels={messages.account.createAccount} />
          <OrderHelp id="order-help-desktop" title={m.help.title} text={m.help.text} contact={help} labels={helpLabels} className="hidden lg:block" />
          <div className="hidden flex-wrap gap-3 lg:flex print:hidden">
            <PrintButton label={m.print} />
            <Link href={href(locale, "products")} className={secondaryButton}>
              {m.continueShopping}
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-7 lg:col-start-1 lg:row-start-1 print:gap-0">
          <OrderTimeline steps={order.timeline} locale={locale} labels={m.timeline} />
          <OrderItems order={order} rows={rows} locale={locale} messages={messages} />
          <OrderDetails order={order} messages={messages} />
          <OrderLegal legal={order.legal} labels={m.legal} />
          <OrderHelp id="order-help-mobile" title={m.help.title} text={m.help.text} contact={help} labels={helpLabels} className="lg:hidden" />
          <div className={cn("flex flex-wrap gap-3 lg:hidden print:hidden")}>
            <PrintButton label={m.print} className="flex-1" />
            <Link href={href(locale, "products")} className={cn(secondaryButton, "flex-1")}>
              {m.continueShopping}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
