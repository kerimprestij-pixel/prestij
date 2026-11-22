// Guest order page: /siparis/PR-261001?t=<access token> (en/ar: /order/…). The token is the only
// credential, so the page is noindex, sends no Referer, and answers a missing or wrong token with the
// same neutral not-found as an unknown order number (getOrderByToken compares in constant time).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { connection } from "next/server";
import { Suspense } from "react";
import { whatsappHref } from "@/components/order/format";
import OrderPageView from "@/components/order/OrderPageView";
import OrderSkeleton from "@/components/order/OrderSkeleton";
import { defaultLocale, isLocale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import { getCustomerContext } from "@/lib/customer/context";
import { getOrderByToken } from "@/lib/orders/read";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { getSettings } from "@/lib/settings/get-settings";

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ locale: string; orderNumber: string }>; searchParams: Promise<SearchParams> };

/** The thank-you hero shows for `?new=1` links (set by checkout) within this window. */
const NEW_FLAG_WINDOW_MS = 48 * 60 * 60_000;
/** …and for any visit this soon after placing the order, even without the flag. */
const JUST_PLACED_MS = 15 * 60_000;

/** The request time in ms. Reads the clock, so only after connection() (request time). */
async function requestNow(): Promise<number> {
  await connection();
  return Date.now();
}

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata(): Promise<Metadata> {
  const value: unknown = await rootLocale();
  const locale = isLocale(value) ? value : defaultLocale;
  const messages = await getMessages(locale);
  const title = messages.order.metaTitle;
  return {
    title,
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    referrer: "no-referrer",
    alternates: { canonical: null, languages: {} },
    // A neutral share card (the lookup page), never the home page's and never the token link.
    ...(await shareMetadata(locale, { title, path: href(locale, "orderLookup") })),
  };
}

export default function OrderPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<OrderSkeleton />}>
      <OrderContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function OrderContent({ params, searchParams }: Props) {
  const [{ locale, orderNumber }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const token = first(query.t);
  if (!token) notFound();

  const now = await requestNow();
  // The viewer decides only whether a card retry is offered while the test mode is on (staff may test; CF-11);
  // the request time whether a PayTR payment is still being verified (no retry then).
  const order = await getOrderByToken(orderNumber, token, await getCustomerContext(), now);
  if (!order) notFound();

  const age = now - Date.parse(order.createdAt);
  const isNew = (first(query.new) === "1" && age < NEW_FLAG_WINDOW_MS) || age < JUST_PLACED_MS;
  const paymentFailed = first(query.payment) === "failed";
  const paymentChecking = first(query.payment) === "checking";

  const [messages, whatsapp, general] = await Promise.all([getMessages(locale), getSettings("whatsapp"), getSettings("general")]);
  const help = {
    whatsappHref: whatsapp.enabled
      ? whatsappHref(whatsapp.phone, format(messages.order.help.whatsappMessage, { orderNumber: order.orderNumber }, locale))
      : null,
    phone: general.phone.trim() || null,
    email: general.email.trim() || null,
  };

  return (
    <OrderPageView
      order={order}
      locale={locale}
      messages={messages}
      token={token}
      isNew={isNew}
      paymentFailed={paymentFailed}
      paymentChecking={paymentChecking}
      help={help}
      now={now}
    />
  );
}
