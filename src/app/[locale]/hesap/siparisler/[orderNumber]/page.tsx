// /hesap/siparisler/PR-… (en/ar: /account/orders/…): one of the customer's orders, shown with the
// same view as the guest order page (status, payment, shipment, items, addresses, legal texts).
// Another customer's order number answers exactly like an unknown one (404).
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { connection } from "next/server";
import { Suspense } from "react";
import { whatsappHref } from "@/components/order/format";
import OrderPageView from "@/components/order/OrderPageView";
import OrderSkeleton from "@/components/order/OrderSkeleton";
import { first, privateMetadata, type SearchParams } from "@/components/store/account/page-helpers";
import { db } from "@/db";
import { defaultLocale, isLocale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import { accountOrderToken } from "@/lib/account/orders";
import { requireAccountUser } from "@/lib/account/session";
import { getCustomerContext } from "@/lib/customer/context";
import { getOrderByToken } from "@/lib/orders/read";
import { getSettings } from "@/lib/settings/get-settings";

type Props = { params: Promise<{ locale: string; orderNumber: string }>; searchParams: Promise<SearchParams> };

// Reads the root param only (the order number stays a runtime value inside Suspense).
export async function generateMetadata(): Promise<Metadata> {
  const value: unknown = await rootLocale();
  const locale = isLocale(value) ? value : defaultLocale;
  return privateMetadata((await getMessages(locale)).order.metaTitle);
}

/** The request time in ms. Reads the clock, so only after connection() (request time). */
async function requestNow(): Promise<number> {
  await connection();
  return Date.now();
}

export default function AccountOrderPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<OrderSkeleton />}>
      <AccountOrder params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AccountOrder({ params, searchParams }: Props) {
  const [{ locale, orderNumber }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const user = await requireAccountUser(locale, href(locale, "accountOrder", { orderNumber }));
  const token = await accountOrderToken(db, user.id, orderNumber);
  if (!token) notFound();
  // The request time: the havale panel says when the payment deadline has passed, and whether a PayTR payment
  // is still being verified (no retry then).
  const now = await requestNow();
  // The viewer decides only whether a card retry is offered while the test mode is on (staff may test; CF-11).
  const order = await getOrderByToken(orderNumber, token, await getCustomerContext(), now);
  if (!order) notFound();

  const [messages, whatsapp, general] = await Promise.all([getMessages(locale), getSettings("whatsapp"), getSettings("general")]);
  const help = {
    whatsappHref: whatsapp.enabled ? whatsappHref(whatsapp.phone, format(messages.order.help.whatsappMessage, { orderNumber: order.orderNumber }, locale)) : null,
    phone: general.phone.trim() || null,
    email: general.email.trim() || null,
  };

  return (
    <>
      <div className="container-x pt-6 md:pt-8 print:hidden">
        <Link
          href={href(locale, "accountOrders")}
          className="inline-flex min-h-11 items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-text-muted transition-colors hover:text-text rtl:tracking-normal"
        >
          <ArrowLeft aria-hidden className="size-3.5 rtl:-scale-x-100" strokeWidth={1.75} />
          {messages.account.orderList.back}
        </Link>
      </div>
      <OrderPageView
        order={order}
        locale={locale}
        messages={messages}
        token={token}
        isNew={false}
        paymentFailed={first(query.payment) === "failed"}
        paymentChecking={first(query.payment) === "checking"}
        help={help}
        now={now}
      />
    </>
  );
}
