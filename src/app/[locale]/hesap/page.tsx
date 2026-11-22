// /hesap (en/ar: /account): the account overview. Dynamic and noindex: the shell (navigation) is
// static, the greeting, orders and counts stream in after the server session check.
import type { Metadata } from "next";
import { ArrowRight, Building2, Heart, MapPin, Package, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { buttonClass } from "@/components/sections/button-styles";
import AccountOrderCard from "@/components/store/account/AccountOrderCard";
import AccountShell, { AccountContentSkeleton, AccountPageHeader } from "@/components/store/account/AccountShell";
import { first, privateMetadata, type PageLocaleProps } from "@/components/store/account/page-helpers";
import { panelClass, sectionTitleClass } from "@/components/store/account/styles";
import { FormAlert } from "@/components/store/account/ui";
import AccountWheelCard from "@/components/store/wheel/AccountWheelCard";
import { db, schema } from "@/db";
import { intlLocale, isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import { countAddresses } from "@/lib/account/addresses";
import { firstNameOf } from "@/lib/customer/viewer";
import { listFavoriteIds } from "@/lib/account/favorites";
import { listAccountOrders } from "@/lib/account/orders";
import { requireAccountUser } from "@/lib/account/session";
import { getSettings } from "@/lib/settings/get-settings";

/** "Kasım 2026" in Türkiye time. */
function formatMonthYear(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(new Date(iso));
}

export async function generateMetadata({ params }: Pick<PageLocaleProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return privateMetadata((await getMessages(locale)).account.metaTitle);
}

export default async function AccountPage({ params, searchParams }: PageLocaleProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AccountShell locale={locale} active="overview">
      <Suspense fallback={<AccountContentSkeleton />}>
        <Overview locale={locale} searchParams={searchParams} />
      </Suspense>
    </AccountShell>
  );
}

async function Overview({ locale, searchParams }: { locale: Locale; searchParams: PageLocaleProps["searchParams"] }) {
  const user = await requireAccountUser(locale, href(locale, "account"));
  const [messages, query, orders, favorites, addressCount, b2b, company] = await Promise.all([
    getMessages(locale),
    searchParams,
    listAccountOrders(db, user.id, { page: 1, pageSize: 3 }),
    listFavoriteIds(db, user.id),
    countAddresses(db, user.id),
    getSettings("b2b"),
    user.companyId != null
      ? db
          .select({ status: schema.companies.status })
          .from(schema.companies)
          .where(eq(schema.companies.id, user.companyId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);
  const m = messages.account;
  const o = m.overview;
  const name = firstNameOf(user.name);
  const justVerified = first(query.dogrulandi) === "1";

  const shortcuts: { route: "accountOrders" | "accountFavorites" | "accountAddresses" | "accountProfile"; icon: LucideIcon; title: string; hint: string }[] = [
    { route: "accountOrders", icon: Package, title: m.nav.orders, hint: o.ordersHint },
    { route: "accountFavorites", icon: Heart, title: m.nav.favorites, hint: format(o.favoritesHint, { count: favorites.length }, locale) },
    { route: "accountAddresses", icon: MapPin, title: m.nav.addresses, hint: format(o.addressesHint, { count: addressCount }, locale) },
    { route: "accountProfile", icon: UserRound, title: m.nav.profile, hint: o.profileHint },
  ];
  const businessText =
    company?.status === "approved" ? o.business.approved : company?.status === "pending" ? o.business.pending : company?.status === "rejected" ? o.business.rejected : o.business.none;

  return (
    <>
      <AccountPageHeader
        eyebrow={o.eyebrow}
        title={name ? format(o.greeting, { name }) : m.title}
        intro={`${o.intro} ${format(o.memberSince, { date: formatMonthYear(user.createdAt, locale) })}`}
      />

      {justVerified ? (
        <div className="mb-8 space-y-3">
          <FormAlert tone="success">{o.verified}</FormAlert>
          {orders.total > 0 ? <FormAlert tone="info">{format(o.linkedOrders, { count: orders.total }, locale)}</FormAlert> : null}
        </div>
      ) : null}

      {/* WHEEL-UI: the gift wheel prize (code, live countdown to its real end), when the account has one. */}
      <AccountWheelCard locale={locale} messages={messages} userId={user.id} />

      <section aria-labelledby="account-recent" className="mb-12">
        <div className="mb-5 flex items-end justify-between gap-4">
          <h2 id="account-recent" className={sectionTitleClass}>
            {o.recentOrders}
          </h2>
          {orders.total > 0 ? (
            <Link href={href(locale, "accountOrders")} className="inline-flex min-h-11 items-center gap-2 text-sm text-text underline decoration-gold underline-offset-4 hover:decoration-2">
              {o.allOrders}
              <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
            </Link>
          ) : null}
        </div>
        {orders.items.length > 0 ? (
          <ul className="space-y-3">
            {orders.items.map((order) => (
              <AccountOrderCard key={order.orderNumber} order={order} locale={locale} messages={messages} />
            ))}
          </ul>
        ) : (
          <div className={`${panelClass} flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between`}>
            <p className="max-w-lg text-sm leading-relaxed text-text-muted">{o.noOrders}</p>
            <Link href={href(locale, "products")} className={buttonClass("secondary", "shrink-0 rtl:tracking-normal")}>
              {o.startShopping}
            </Link>
          </div>
        )}
      </section>

      <section aria-labelledby="account-shortcuts" className="mb-12">
        <h2 id="account-shortcuts" className={`${sectionTitleClass} mb-5`}>
          {o.shortcuts}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {shortcuts.map(({ route, icon: Icon, title, hint }) => (
            <li key={route}>
              <Link
                href={href(locale, route)}
                className="group flex h-full min-h-24 items-start gap-4 rounded-md border border-border bg-surface p-5 transition-[border-color,box-shadow] duration-300 hover:border-gold/60 hover:shadow-[0_18px_40px_-32px_rgb(3_38_95/0.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
              >
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-gold/12 text-gold-text">
                  <Icon className="size-4.5" strokeWidth={1.6} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-text">{title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-text-muted">{hint}</span>
                </span>
                <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-text-muted transition-transform duration-300 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5 motion-reduce:transition-none" strokeWidth={1.75} />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {b2b.enabled ? (
        <section aria-labelledby="account-business" className={`${panelClass} flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between`}>
          <div className="flex items-start gap-4">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-brand/8 text-brand dark:text-text">
              <Building2 className="size-4.5" strokeWidth={1.6} />
            </span>
            <div>
              <h2 id="account-business" className="font-medium text-text">
                {o.business.title}
              </h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-muted">{businessText}</p>
            </div>
          </div>
          <Link href={href(locale, "accountBusiness")} className={buttonClass("secondary", "shrink-0 rtl:tracking-normal")}>
            {company ? o.business.view : o.business.apply}
          </Link>
        </section>
      ) : null}
    </>
  );
}
