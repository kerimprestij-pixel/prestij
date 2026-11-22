// What the buyer has to do (or has done) about payment: retry a card payment, transfer to our bank
// account, pay at the door, or nothing (deferred / already paid). While a card result is being confirmed
// (?payment=checking after iyzico, or a PayTR attempt inside its window) there is no retry button: a new
// payment could charge the card twice.
import { AlertTriangle, ArrowRight, Banknote, Building2, CreditCard, Landmark } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/sections/button-styles";
import { intlLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { href } from "@/i18n/paths";
import { localize } from "@/i18n/localize";
import type { Messages } from "@/i18n/messages";
import { paymentMethodLabel } from "@/lib/cart/view";
import type { OrderView } from "@/lib/orders/read";
import { formatPrice } from "@/lib/pricing/money";
import { formatIban } from "@/lib/validation/tr";
import { cn } from "@/lib/utils";
import CardPaymentCheck from "./CardPaymentCheck";
import CopyButton from "./CopyButton";
import { formatOrderDate, formatOrderDay } from "./format";
import RetryPaymentForm from "./RetryPaymentForm";
import { cardClass, cardTitleClass, labelClass } from "./ui";

type OrderPaymentPanelProps = {
  order: OrderView;
  locale: Locale;
  messages: Messages;
  token: string;
  /** Came back from a failed card payment (?payment=failed). */
  paymentFailed: boolean;
  /** Came back from a card payment whose result is not known yet (?payment=checking). */
  paymentChecking?: boolean;
  /**
   * Request time in ms (the pages read the clock after connection()): with it, a havale order past its deadline
   * shows "Son ödeme tarihi geçti …" instead of the future-tense note (FIX B-F7). Omitted = the note.
   */
  now?: number;
};

const METHOD_ICON = { card: CreditCard, bank_transfer: Landmark, cash_on_delivery: Banknote, deferred: Building2 } as const;

const PAID_STATUSES = new Set(["paid", "processing", "shipped", "delivered"]);

export default function OrderPaymentPanel({ order, locale, messages, token, paymentFailed, paymentChecking = false, now }: OrderPaymentPanelProps) {
  const m = messages.order;
  const p = m.payment;
  const copy = { text: m.copy, copiedText: m.copied, failedText: m.copyFailed };
  const Icon = METHOD_ICON[order.paymentMethod];
  const total = formatPrice(order.totals.grandTotal, locale);
  const pendingCard = order.paymentMethod === "card" && order.status === "pending_payment";
  // PayTR: the latest attempt may still be paid (paytr-window.ts). Wins over a stale ?payment=failed.
  const verifying = pendingCard ? order.payment.verifying : null;
  const failed = pendingCard && paymentFailed && !verifying;
  const checking = pendingCard && !failed && !verifying && paymentChecking;

  let body: ReactNode = null;
  let title = p.title;

  if (verifying) {
    // Polls the server (which also asks PayTR's Durum Sorgu); never a retry form in this window.
    title = p.checkingTitle;
    const formHref = `${href(locale, "cardPayment")}?${new URLSearchParams({ order: order.orderNumber, t: token }).toString()}`;
    body = (
      <>
        <CardPaymentCheck
          locale={locale}
          orderNumber={order.orderNumber}
          token={token}
          labels={{ checkingText: p.verifyingText, slowText: p.verifyingSlowText }}
          fallback={null}
        />
        {verifying.formOpen ? (
          // PayTR-fix R-UX6: secondary, under the waiting text: for a buyer who has not paid or was declined (same
          // merchant_oid, so no second charge); a buyer who paid only waits.
          <div className="mt-5 print:hidden">
            <p className="text-sm leading-relaxed text-text-muted">{p.resumeText}</p>
            <Link href={formHref} prefetch={false} className={buttonClass("secondary", "mt-3 w-full rtl:tracking-normal")}>
              <span>{p.resumeButton}</span>
              <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
            </Link>
          </div>
        ) : (
          <p className="mt-4 text-xs leading-relaxed text-text-muted">{withTime(p.verifyingRetryAt, clockTime(verifying.until, locale))}</p>
        )}
        <AmountRow label={messages.cart.summary.total} value={total} />
      </>
    );
  } else if (checking) {
    // The card may have been charged: no retry button until the server has asked the provider again.
    title = p.checkingTitle;
    const retry = order.payment.canRetry ? (
      <div className="mt-6">
        <RetryPaymentForm locale={locale} orderNumber={order.orderNumber} token={token} labels={{ button: p.retryButton, pending: p.retrying }} />
      </div>
    ) : null;
    body = (
      <>
        <CardPaymentCheck
          locale={locale}
          orderNumber={order.orderNumber}
          token={token}
          labels={{ checkingText: p.checkingText, slowText: p.checkingSlowText }}
          fallback={retry}
        />
        <AmountRow label={messages.cart.summary.total} value={total} />
      </>
    );
  } else if (pendingCard) {
    title = failed ? p.failedTitle : p.retryTitle;
    body = (
      <>
        <p className="text-sm leading-relaxed text-text-muted">{failed ? p.failedText : p.retryText}</p>
        <AmountRow label={messages.cart.summary.total} value={total} />
        {order.payment.canRetry ? (
          <div className="mt-6">
            <RetryPaymentForm locale={locale} orderNumber={order.orderNumber} token={token} labels={{ button: p.retryButton, pending: p.retrying }} />
          </div>
        ) : (
          <p className="mt-5 text-sm leading-relaxed text-text">{p.retryUnavailable}</p>
        )}
      </>
    );
  } else if (order.paymentMethod === "bank_transfer" && order.status === "awaiting_transfer") {
    title = p.bankTitle;
    const bank = order.payment.bankTransfer;
    const accounts = bank?.accounts ?? [];
    const instructions = localize(bank?.instructions, locale) || format(p.bankReference, { orderNumber: order.orderNumber });
    const deadlinePassed = Boolean(bank?.deadline) && now !== undefined && now > Date.parse(bank?.deadline ?? "");
    body = (
      <>
        <p className="text-sm leading-relaxed text-text-muted">{p.bankIntro}</p>
        <AmountRow label={p.bankAmount} value={total} />
        {bank?.deadline ? (
          // SR-2: the same date as the e-mail and the contract (the order's own day count, end of the day in Türkiye).
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className={labelClass}>{p.bankDeadline}</span>
            <time dateTime={bank.deadline} className={cn("font-medium", deadlinePassed ? "text-red-700 dark:text-red-400" : "text-text")}>
              {formatOrderDay(bank.deadline, locale)}
            </time>
            {deadlinePassed ? (
              <p role="note" className="flex w-full items-start gap-2 text-sm leading-relaxed text-text">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-400" strokeWidth={1.5} />
                <span>{p.bankDeadlinePassed}</span>
              </p>
            ) : (
              <p className="w-full text-xs leading-relaxed text-text-muted">{p.bankDeadlineNote}</p>
            )}
          </div>
        ) : null}
        {accounts.length > 0 ? (
          <ul className="mt-6 space-y-3">
            {accounts.map((account, index) => (
              <li key={`${account.iban}-${index}`} className="rounded-md border border-border bg-bg/60 p-4 print:break-inside-avoid">
                <dl className="grid gap-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <dt className={labelClass}>{p.bank}</dt>
                    <dd className="font-medium text-text">
                      <bdi>{account.bank}</bdi>
                    </dd>
                  </div>
                  <div>
                    <dt className={labelClass}>{p.holder}</dt>
                    <dd className="mt-1 text-text">
                      <bdi>{account.holder}</bdi>
                    </dd>
                  </div>
                  <div>
                    <dt className={labelClass}>{p.iban}</dt>
                    <dd className="mt-2 flex flex-wrap items-center justify-between gap-3">
                      <span
                        dir="ltr"
                        className="font-mono text-[0.8125rem] leading-relaxed text-text tabular-nums [overflow-wrap:anywhere] sm:text-[0.9375rem] sm:tracking-wide"
                      >
                        {formatIban(account.iban)}
                      </span>
                      <CopyButton value={account.iban.replace(/\s+/g, "").toUpperCase()} label={p.copyIban} {...copy} />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 rounded-md border border-border bg-bg/60 p-4 text-sm leading-relaxed text-text">{p.noAccounts}</p>
        )}
        <div className="mt-6 rounded-md border border-gold/40 bg-gold/10 p-4">
          <p className="text-sm leading-relaxed text-text">{instructions}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span dir="ltr" className="font-heading text-2xl leading-none text-text">
              {order.orderNumber}
            </span>
            <CopyButton value={order.orderNumber} label={m.copyOrderNumber} {...copy} />
          </div>
        </div>
      </>
    );
  } else if (order.paymentMethod === "cash_on_delivery" && (order.status === "processing" || order.status === "shipped")) {
    title = p.codTitle;
    body = (
      <>
        <p className="text-sm leading-relaxed text-text">{format(p.codText, { amount: total }, locale)}</p>
        {order.totals.paymentFee > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            {format(p.codFee, { fee: formatPrice(order.totals.paymentFee, locale) }, locale)}
          </p>
        )}
        <AmountRow label={messages.cart.summary.total} value={total} />
        <p className="mt-4 text-xs leading-relaxed text-text-muted">{p.codHint}</p>
      </>
    );
  } else if (order.paymentMethod === "deferred" && order.status !== "cancelled" && order.status !== "refunded") {
    title = p.deferredTitle;
    body = <p className="text-sm leading-relaxed text-text-muted">{p.deferredText}</p>;
  } else if (order.paidAt && PAID_STATUSES.has(order.status)) {
    body = (
      <p className="text-sm leading-relaxed text-text-muted">
        {order.paymentMethod === "card" ? p.cardPaid : m.statusInfo.paid}{" "}
        <span className="text-text">
          {p.paidOn}: <time dateTime={order.paidAt}>{formatOrderDate(order.paidAt, locale)}</time>
        </span>
      </p>
    );
  }

  return (
    <section
      aria-labelledby="order-payment-title"
      className={cn(cardClass, failed && "border-red-700/40 dark:border-red-400/40", pendingCard && !failed && "border-gold/50")}
    >
      <div className="flex items-start gap-3">
        {failed ? (
          <AlertTriangle aria-hidden className="mt-1 size-5 shrink-0 text-red-700 dark:text-red-400" strokeWidth={1.5} />
        ) : (
          <Icon aria-hidden className="mt-1 size-5 shrink-0 text-gold-text" strokeWidth={1.5} />
        )}
        <div className="min-w-0">
          <h2 id="order-payment-title" className={cardTitleClass}>
            {title}
          </h2>
          {/* Method-specific titles (havale, kapıda ödeme, vadeli) already name the method. */}
          {(title === p.title || pendingCard) && (
            <p className="mt-1 text-sm text-text-muted">
              <span className="sr-only">{p.method}: </span>
              {paymentMethodLabel(order.paymentMethod, messages)}
            </p>
          )}
        </div>
      </div>
      {body && <div className="mt-5">{body}</div>}
    </section>
  );
}

/** "14:35" in Türkiye time. */
const clockTime = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(intlLocale(locale), { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** A UI string with a {time} placeholder, the time isolated (<bdi>) for right-to-left text. */
function withTime(template: string, time: string): ReactNode {
  const at = template.indexOf("{time}");
  if (at < 0) return template;
  return (
    <>
      {template.slice(0, at)}
      <bdi dir="ltr">{time}</bdi>
      {template.slice(at + "{time}".length)}
    </>
  );
}

function AmountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-5 flex items-baseline justify-between gap-4 border-t border-border pt-4">
      <span className={labelClass}>{label}</span>
      <span className="font-heading text-3xl leading-none text-text tabular-nums">{value}</span>
    </div>
  );
}
