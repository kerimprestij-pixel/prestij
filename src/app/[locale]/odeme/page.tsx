// Checkout (/odeme, en/ar: /checkout). noindex. The header is cached (static shell); the form needs the
// visitor's cart cookie, so it streams inside <Suspense>. An empty cart, or one that cannot check out
// (blocking issues, samples only), goes back to the cart page. While a contract text is missing or still a
// draft, a notice replaces the form (go-live CF-4).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Lock } from "lucide-react";
import CheckoutForm from "@/components/checkout/CheckoutForm";
import CheckoutSkeleton from "@/components/checkout/CheckoutSkeleton";
import type { CheckoutLabels } from "@/components/checkout/types";
import { buttonClass } from "@/components/sections/button-styles";
import { isLocale, type Locale } from "@/i18n/config";
import { getMessages, type Messages } from "@/i18n/get-messages";
import { href, localeAlternates, signInHref } from "@/i18n/paths";
import { loadCheckoutAccount } from "@/lib/account/checkout";
import { getCartView } from "@/lib/cart/queries";
import { telHref } from "@/lib/contact/links";
import { getSession } from "@/lib/session";
import { loadCheckoutLegalDocs } from "@/lib/orders/legal-docs";
import { checkoutLegalReady } from "@/lib/orders/legal-ready";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { getSettings } from "@/lib/settings/get-settings";

type Props = { params: Promise<{ locale: string }> };

/** Slug of the KVKK notice page (/sayfa/kvkk, seeded from scripts/seed-data/site.ts LEGAL_PAGES). */
const KVKK_PAGE_SLUG = "kvkk";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const messages = await getMessages(locale);
  const title = messages.checkout.title;
  // Own canonical, alternates and share card (the layout's are the home page's).
  return {
    title,
    robots: { index: false, follow: false },
    alternates: localeAlternates(locale, "checkout"),
    ...(await shareMetadata(locale, { title, path: href(locale, "checkout") })),
  };
}

export default function CheckoutPage({ params }: Props) {
  return (
    <>
      <Suspense fallback={<div className="h-40 md:h-48" aria-hidden />}>
        <CheckoutHeader params={params} />
      </Suspense>
      <Suspense fallback={<CheckoutSkeleton />}>
        <Checkout params={params} />
      </Suspense>
    </>
  );
}

async function CheckoutHeader({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = await getMessages(locale);
  const t = messages.checkout;
  return (
    <header className="container-x pt-8 pb-8 md:pt-12 md:pb-12">
      <Link
        href={href(locale, "cart")}
        className="inline-flex min-h-11 items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft aria-hidden className="size-3.5 rtl:-scale-x-100" strokeWidth={1.75} />
        {t.page.backToCart}
      </Link>
      <p className="eyebrow mt-6 flex items-center gap-2">
        <Lock aria-hidden className="size-3.5" strokeWidth={2} />
        {t.page.eyebrow}
      </p>
      <h1 className="mt-3 font-heading text-4xl leading-tight text-text md:text-5xl">{t.title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-muted md:text-base">{t.page.intro}</p>
    </header>
  );
}

async function Checkout({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [view, messages, general, legalDocs] = await Promise.all([getCartView(locale), getMessages(locale), getSettings("general"), loadCheckoutLegalDocs()]);
  if (view.isEmpty || !view.checkoutAllowed) redirect(href(locale, "cart"));

  const contact = [general.phone, general.email].filter(Boolean).join(" · ");
  // Go-live CF-4: no form while a contract text is missing or still a draft (placeOrder refuses too).
  if (!checkoutLegalReady(legalDocs)) {
    return <CheckoutClosed locale={locale} messages={messages} phone={general.phone} email={general.email} />;
  }

  const labels: CheckoutLabels = { ...messages.checkout };
  delete (labels as Partial<typeof messages.checkout>).legal; // the legal block stays on the server
  const { optional, close, opensInNewTab, free } = messages.common;
  const L = messages.checkout.legal;
  const newsletter = await getSettings("newsletter");
  // ACCOUNTS: signed in → the account e-mail, saved addresses and "Bu adresi kaydet"; guest → a
  // sign-in prompt that comes back to the checkout.
  const session = await getSession();
  const account = session?.user?.id && !session.user.banned ? await loadCheckoutAccount(session.user.id, messages) : null;
  const guestPrompt = account
    ? null
    : { text: messages.account.checkout.guestPrompt, linkLabel: messages.account.checkout.guestSignIn, href: signInHref(locale, href(locale, "checkout")) };
  return (
    <CheckoutForm
      account={account}
      guestPrompt={guestPrompt}
      locale={locale}
      initialView={view}
      labels={labels}
      common={{ optional, close, opensInNewTab, free }}
      cartHref={href(locale, "cart")}
      kvkkHref={href(locale, "page", { slug: KVKK_PAGE_SLUG })}
      withdrawal={{ title: L.withdrawal, text: L.withdrawalText, contact }}
      legalReady
      newsletterOptIn={newsletter.enabled ? messages.newsletter.checkoutOptIn : null}
    />
  );
}

/** The notice shown instead of the checkout form while orders cannot be taken (contract texts not final). */
function CheckoutClosed({ locale, messages, phone, email }: { locale: Locale; messages: Messages; phone: string; email: string }) {
  const t = messages.checkout.page;
  const tel = telHref(phone);
  return (
    <section aria-labelledby="checkout-closed-title" className="container-x pb-20 md:pb-28">
      <div role="status" className="max-w-2xl rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgb(3_38_95/0.04)] sm:p-9">
        <h2 id="checkout-closed-title" className="font-heading text-2xl leading-tight text-text md:text-3xl">
          {t.closedTitle}
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-text-muted md:text-base">{t.closedText}</p>
        {tel || email ? (
          <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-text">
            {tel ? (
              <a href={tel} className="underline decoration-gold/60 underline-offset-4 hover:decoration-gold" dir="ltr">
                {phone}
              </a>
            ) : null}
            {email ? (
              <a href={`mailto:${email}`} className="underline decoration-gold/60 underline-offset-4 hover:decoration-gold" dir="ltr">
                {email}
              </a>
            ) : null}
          </p>
        ) : null}
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href={href(locale, "contact")} className={buttonClass("primary")}>
            {t.closedContact}
          </Link>
          <Link href={href(locale, "cart")} className={buttonClass("secondary")}>
            {t.backToCart}
          </Link>
        </div>
      </div>
    </section>
  );
}
