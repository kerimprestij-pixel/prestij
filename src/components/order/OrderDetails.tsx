// Contact, delivery address, invoice details (TCKN/VKN masked except the last two digits) and the
// buyer's note.
import type { ReactNode } from "react";
import type { AddressData } from "@/db/schema/commerce";
import type { Messages } from "@/i18n/messages";
import type { OrderView } from "@/lib/orders/read";
import { addressLines, formatPhone, maskId, sameAddress } from "./format";
import { cardClass, labelClass } from "./ui";

type OrderDetailsProps = { order: OrderView; messages: Messages };

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className={labelClass}>{title}</h3>
      <div className="mt-3 space-y-1 text-sm leading-relaxed text-text [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function Address({ address, withPhone = true }: { address: AddressData; withPhone?: boolean }) {
  return (
    <address className="not-italic">
      <p className="font-medium">
        <bdi>{address.fullName}</bdi>
      </p>
      {addressLines(address).map((line, i) => (
        <p key={i} className="text-text-muted">
          <bdi>{line}</bdi>
        </p>
      ))}
      {withPhone && address.phone && (
        <p className="text-text-muted">
          <span dir="ltr">{formatPhone(address.phone)}</span>
        </p>
      )}
    </address>
  );
}

export default function OrderDetails({ order, messages }: OrderDetailsProps) {
  const d = messages.order.details;
  const inv = order.invoice;
  const corporate = inv.type === "corporate";
  const maskedId = maskId(corporate ? inv.taxNumber : inv.nationalId);
  const separateBilling = inv.address && !sameAddress(inv.address, order.shippingAddress);

  return (
    <section aria-label={`${d.delivery} · ${d.invoice}`} className={cardClass}>
      <div className="grid gap-8 sm:grid-cols-2">
        <Block title={d.delivery}>
          <Address address={order.shippingAddress} />
        </Block>

        <Block title={d.invoice}>
          <p className="font-medium">
            <bdi>{corporate ? inv.companyName : inv.fullName || order.shippingAddress.fullName}</bdi>
          </p>
          <p className="text-text-muted">{corporate ? d.corporate : d.individual}</p>
          {corporate && inv.taxOffice && (
            <p className="text-text-muted">
              {d.taxOffice}: <bdi className="text-text">{inv.taxOffice}</bdi>
            </p>
          )}
          {maskedId && (
            <p className="text-text-muted">
              {corporate ? d.taxNumber : d.nationalId}:{" "}
              <span dir="ltr" className="font-mono tracking-wider text-text">
                {maskedId}
              </span>
            </p>
          )}
          {corporate && inv.eInvoice && <p className="text-text-muted">{d.eInvoice}</p>}
          {separateBilling && inv.address ? (
            <div className="pt-3">
              <p className="text-xs font-medium text-text-muted">{d.invoiceAddress}</p>
              <div className="mt-1">
                <Address address={inv.address} withPhone={false} />
              </div>
            </div>
          ) : (
            <p className="pt-2 text-xs text-text-muted">{d.sameAsDelivery}</p>
          )}
        </Block>

        <Block title={d.contact}>
          <p>
            <span dir="ltr">{order.email}</span>
          </p>
          {order.phone && (
            <p className="text-text-muted">
              <span dir="ltr">{formatPhone(order.phone)}</span>
            </p>
          )}
        </Block>

        {order.customerNote && (
          <Block title={d.note}>
            <p className="whitespace-pre-line text-text-muted">
              <bdi>{order.customerNote}</bdi>
            </p>
          </Block>
        )}
      </div>
    </section>
  );
}
