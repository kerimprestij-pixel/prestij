// One order in the account's order list / overview: thumbnails, number, date, status, total.
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { formatOrderDate } from "@/components/order/format";
import { statusBadgeClass } from "@/components/order/ui";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { localize } from "@/i18n/localize";
import type { Messages } from "@/i18n/messages";
import { href } from "@/i18n/paths";
import type { AccountOrderListItem } from "@/lib/account/orders";
import Img from "@/lib/media/Img";
import { formatPrice } from "@/lib/pricing/money";

export default function AccountOrderCard({ order, locale, messages }: { order: AccountOrderListItem; locale: Locale; messages: Messages }) {
  const m = messages.account.orderList;
  const detail = href(locale, "accountOrder", { orderNumber: order.orderNumber });
  return (
    <li className="group relative rounded-md border border-border bg-surface p-4 transition-[border-color,box-shadow] duration-300 hover:border-gold/60 hover:shadow-[0_18px_40px_-32px_rgb(3_38_95/0.45)] motion-reduce:transition-none sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex shrink-0 -space-x-3 rtl:space-x-reverse" aria-hidden>
          {order.preview.map((line, i) => (
            <span
              key={i}
              className="relative size-14 overflow-hidden rounded-md border-2 border-surface bg-surface-2"
              style={line.accentColor ? { backgroundColor: line.accentColor } : undefined}
            >
              {line.image ? <Img media={line.image} alt="" locale={locale} sizes="56px" fill placeholder={false} /> : null}
            </span>
          ))}
          {order.moreLines > 0 ? (
            <span className="relative grid size-14 place-items-center rounded-md border-2 border-surface bg-surface-2 text-xs font-medium text-text-muted">
              {format(m.moreLines, { count: order.moreLines }, locale)}
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p dir="ltr" className="font-heading text-xl leading-none text-text tabular-nums">
              {order.orderNumber}
            </p>
            <p className={statusBadgeClass(order.status)}>
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {messages.order.status[order.status]}
            </p>
          </div>
          <p className="mt-2 text-sm text-text-muted">
            <span className="sr-only">{m.placedOn}: </span>
            <time dateTime={order.createdAt}>{formatOrderDate(order.createdAt, locale)}</time>
            <span aria-hidden> · </span>
            {format(m.items, { count: order.itemCount }, locale)}
            {order.preview[0] ? (
              <span className="hidden md:inline">
                <span aria-hidden> · </span>
                {localize(order.preview[0].name, locale)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-1.5">
          <p className="text-base font-medium text-text tabular-nums">
            <span className="sr-only">{m.total}: </span>
            {formatPrice(order.grandTotal, locale)}
          </p>
          <Link
            href={detail}
            className="inline-flex min-h-11 items-center gap-2 text-sm text-text underline decoration-gold underline-offset-4 after:absolute after:inset-0 after:rounded-md hover:decoration-2 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
          >
            {m.view}
            <span className="sr-only"> {order.orderNumber}</span>
            <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
          </Link>
        </div>
      </div>
    </li>
  );
}
