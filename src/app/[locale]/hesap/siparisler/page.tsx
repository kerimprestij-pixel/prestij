// /hesap/siparisler (en/ar: /account/orders): the customer's orders, newest first, 10 per page
// (?sayfa=N). Only orders whose user_id is the signed-in customer's.
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Package } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { buttonClass } from "@/components/sections/button-styles";
import AccountOrderCard from "@/components/store/account/AccountOrderCard";
import AccountShell, { AccountContentSkeleton, AccountPageHeader } from "@/components/store/account/AccountShell";
import { first, privateMetadata, type PageLocaleProps } from "@/components/store/account/page-helpers";
import { panelClass } from "@/components/store/account/styles";
import { db } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import { listAccountOrders } from "@/lib/account/orders";
import { requireAccountUser } from "@/lib/account/session";

export async function generateMetadata({ params }: Pick<PageLocaleProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return privateMetadata((await getMessages(locale)).account.orderList.title);
}

export default async function AccountOrdersPage({ params, searchParams }: PageLocaleProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AccountShell locale={locale} active="orders">
      <Suspense fallback={<AccountContentSkeleton />}>
        <Orders locale={locale} searchParams={searchParams} />
      </Suspense>
    </AccountShell>
  );
}

async function Orders({ locale, searchParams }: { locale: Locale; searchParams: PageLocaleProps["searchParams"] }) {
  const base = href(locale, "accountOrders");
  const query = await searchParams;
  const requested = Number.parseInt(first(query.sayfa) ?? "1", 10);
  const user = await requireAccountUser(locale, Number.isFinite(requested) && requested > 1 ? `${base}?sayfa=${requested}` : base);
  const [messages, result] = await Promise.all([getMessages(locale), listAccountOrders(db, user.id, { page: Number.isFinite(requested) ? requested : 1 })]);
  const m = messages.account.orderList;
  const pageHref = (page: number) => (page <= 1 ? base : `${base}?sayfa=${page}`);

  return (
    <>
      <AccountPageHeader title={m.title} intro={m.intro} />
      {result.items.length > 0 ? (
        <>
          <ul className="space-y-3">
            {result.items.map((order) => (
              <AccountOrderCard key={order.orderNumber} order={order} locale={locale} messages={messages} />
            ))}
          </ul>
          {result.pageCount > 1 ? (
            <nav aria-label={format(m.page, { page: result.page, count: result.pageCount })} className="mt-8 flex items-center justify-between gap-4">
              {result.page > 1 ? (
                <Link href={pageHref(result.page - 1)} className={buttonClass("secondary", "min-h-11 px-5 rtl:tracking-normal")} rel="prev">
                  <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
                  {m.previous}
                </Link>
              ) : (
                <span />
              )}
              <p className="text-sm text-text-muted tabular-nums">{format(m.page, { page: result.page, count: result.pageCount })}</p>
              {result.page < result.pageCount ? (
                <Link href={pageHref(result.page + 1)} className={buttonClass("secondary", "min-h-11 px-5 rtl:tracking-normal")} rel="next">
                  {m.next}
                  <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      ) : (
        <div className={`${panelClass} text-center`}>
          <span aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-gold/12 text-gold-text">
            <Package className="size-5" strokeWidth={1.5} />
          </span>
          <p className="mt-4 font-heading text-2xl text-text">{m.empty}</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">{m.emptyHint}</p>
          <Link href={href(locale, "products")} className={buttonClass("primary", "mt-6 rtl:tracking-normal")}>
            {messages.account.overview.startShopping}
          </Link>
        </div>
      )}
      <p className="mt-10 text-sm text-text-muted">
        {m.lookupHint}{" "}
        <Link href={href(locale, "orderLookup")} className="text-text underline decoration-gold underline-offset-4 hover:decoration-2">
          {m.lookupLink}
        </Link>
      </p>
    </>
  );
}
