// /hesap/favoriler (en/ar: /account/favorites): the customer's favorite products as product cards
// (the hearts on them remove a favorite). Products no longer on sale are counted, not shown.
import type { Metadata } from "next";
import { Heart } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { buttonClass } from "@/components/sections/button-styles";
import AccountShell, { AccountContentSkeleton, AccountPageHeader } from "@/components/store/account/AccountShell";
import { privateMetadata, type PageLocaleProps } from "@/components/store/account/page-helpers";
import ProductGrid from "@/components/store/ProductGrid";
import { db } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import { listFavoriteIds } from "@/lib/account/favorites";
import { requireAccountUser } from "@/lib/account/session";
import { listProducts } from "@/lib/data/catalog";

export async function generateMetadata({ params }: Pick<PageLocaleProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return privateMetadata((await getMessages(locale)).account.favoritesPage.title);
}

export default async function FavoritesPage({ params }: Pick<PageLocaleProps, "params">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AccountShell locale={locale} active="favorites">
      <Suspense fallback={<AccountContentSkeleton />}>
        <Favorites locale={locale} />
      </Suspense>
    </AccountShell>
  );
}

async function Favorites({ locale }: { locale: Locale }) {
  const user = await requireAccountUser(locale, href(locale, "accountFavorites"));
  const [messages, ids] = await Promise.all([getMessages(locale), listFavoriteIds(db, user.id)]);
  const cards = ids.length ? await listProducts({ ids }) : [];
  const byId = new Map(cards.map((card) => [card.id, card]));
  const products = ids.flatMap((id) => byId.get(id) ?? []);
  const unavailable = ids.length - products.length;
  const m = messages.account.favoritesPage;

  return (
    <>
      <AccountPageHeader title={m.title} intro={products.length ? `${m.intro} ${format(m.count, { count: products.length }, locale)}` : m.intro} />
      {unavailable > 0 ? <p className="mb-8 text-sm text-text-muted">{format(m.unavailable, { count: unavailable }, locale)}</p> : null}
      {products.length > 0 ? (
        <ProductGrid products={products} locale={locale} fromLabel={messages.product.from} regularPriceLabel={messages.campaign.regularPrice} columns={3} />
      ) : (
        <div className="rounded-md border border-dashed border-border bg-surface p-8 text-center sm:p-12">
          <span aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-gold/12 text-gold-text">
            <Heart className="size-5" strokeWidth={1.5} />
          </span>
          <p className="mt-4 font-heading text-2xl text-text">{m.empty}</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">{m.emptyHint}</p>
          <Link href={href(locale, "products")} className={buttonClass("primary", "mt-6 rtl:tracking-normal")}>
            {m.browse}
          </Link>
        </div>
      )}
    </>
  );
}
