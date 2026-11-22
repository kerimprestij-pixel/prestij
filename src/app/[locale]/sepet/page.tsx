// Cart page (/sepet, en/ar: /cart). noindex. The heading is part of the static shell; the cart itself
// is per visitor (cookie + session), so it streams inside <Suspense> behind a skeleton.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import CartPageClient from "@/components/cart/CartPageClient";
import { CartPageSkeleton } from "@/components/cart/CartSkeleton";
import { cartUiLabels } from "@/components/cart/labels";
import { isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages, type Messages } from "@/i18n/get-messages";
import { href, localeAlternates } from "@/i18n/paths";
import { getCartView } from "@/lib/cart/queries";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { getSettings } from "@/lib/settings/get-settings";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const messages = await getMessages(locale);
  const title = messages.cart.title;
  return {
    title,
    robots: { index: false, follow: true },
    alternates: localeAlternates(locale, "cart"),
    ...(await shareMetadata(locale, { title, path: href(locale, "cart") })),
  };
}

export default function CartPage({ params }: Props) {
  return (
    <div className="pb-20 md:pb-28">
      <Suspense fallback={<HeadingFallback />}>
        <CartHeading params={params} />
      </Suspense>
      <Suspense fallback={<CartPageSkeleton />}>
        <CartBody params={params} />
      </Suspense>
    </div>
  );
}

async function resolve(params: Props["params"]): Promise<{ locale: Locale; messages: Messages }> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return { locale, messages: await getMessages(locale) };
}

function HeadingFallback() {
  return (
    <div className="container-x pt-12 pb-10 md:pt-16 md:pb-12" aria-hidden>
      <div className="h-14 w-56 animate-pulse rounded bg-surface-2 motion-reduce:animate-none md:h-16" />
    </div>
  );
}

/** Cached data only, so it renders into the static shell. */
async function CartHeading({ params }: Props) {
  const { messages } = await resolve(params);
  return (
    <header className="container-x pt-12 pb-10 md:pt-16 md:pb-12">
      <h1 className="font-heading text-5xl leading-[1.02] tracking-tight text-text md:text-6xl">{messages.cart.title}</h1>
    </header>
  );
}

/** Per visitor: reads the cart cookie and the session (request time). */
async function CartBody({ params }: Props) {
  const { locale, messages } = await resolve(params);
  const [view, shipping] = await Promise.all([getCartView(locale), getSettings("shipping")]);
  const { min, max } = shipping.estimatedDays;
  return (
    <div className="container-x">
      <CartPageClient
        locale={locale}
        initialView={view}
        labels={cartUiLabels(messages)}
        links={{ cart: href(locale, "cart"), checkout: href(locale, "checkout"), products: href(locale, "products") }}
        shipsIn={max > 0 ? format(messages.product.shipsIn, { min, max }, locale) : null}
      />
    </div>
  );
}
