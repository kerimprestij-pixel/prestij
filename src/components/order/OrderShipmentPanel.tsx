// Carrier, tracking number and the carrier's tracking link (shipping.carriers, {code} replaced by core).
import { ArrowUpRight, Truck } from "lucide-react";
import { buttonClass } from "@/components/sections/button-styles";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import type { OrderView } from "@/lib/orders/read";
import CopyButton from "./CopyButton";
import { formatOrderDate } from "./format";
import { cardClass, cardTitleClass, labelClass } from "./ui";

type OrderShipmentPanelProps = { order: OrderView; locale: Locale; messages: Messages };

export default function OrderShipmentPanel({ order, locale, messages }: OrderShipmentPanelProps) {
  const carrier = order.carrier;
  if (!carrier) return null;
  const m = messages.order;
  const s = m.shipment;

  return (
    <section aria-labelledby="order-shipment-title" className={cardClass}>
      <div className="flex items-start gap-3">
        <Truck aria-hidden className="mt-1 size-5 shrink-0 text-gold-text" strokeWidth={1.5} />
        <h2 id="order-shipment-title" className={cardTitleClass}>
          {s.title}
        </h2>
      </div>
      <dl className="mt-5 grid gap-4 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className={labelClass}>{s.carrier}</dt>
          <dd className="font-medium text-text">
            <bdi>{carrier.name}</bdi>
          </dd>
        </div>
        <div>
          <dt className={labelClass}>{s.trackingNumber}</dt>
          <dd className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <span dir="ltr" className="font-mono text-[0.9375rem] tracking-wide text-text [overflow-wrap:anywhere]">
              {carrier.trackingNumber}
            </span>
            <CopyButton value={carrier.trackingNumber} label={s.copyTracking} text={m.copy} copiedText={m.copied} failedText={m.copyFailed} />
          </dd>
        </div>
        {order.shippedAt && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className={labelClass}>{s.shippedOn}</dt>
            <dd className="text-text">
              <time dateTime={order.shippedAt}>{formatOrderDate(order.shippedAt, locale)}</time>
            </dd>
          </div>
        )}
        {order.deliveredAt && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className={labelClass}>{s.deliveredOn}</dt>
            <dd className="text-text">
              <time dateTime={order.deliveredAt}>{formatOrderDate(order.deliveredAt, locale)}</time>
            </dd>
          </div>
        )}
      </dl>
      {carrier.trackingUrl && (
        <a
          href={carrier.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          className={buttonClass("primary", "mt-6 w-full rtl:tracking-normal print:hidden")}
        >
          {s.track}
          <ArrowUpRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
          <span className="sr-only"> {messages.common.opensInNewTab}</span>
        </a>
      )}
    </section>
  );
}
