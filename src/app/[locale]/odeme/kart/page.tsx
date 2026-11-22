// Card payment page (/odeme/kart, en/ar: /checkout/card) for PayTR:
//   ?order=PR-…&t=<order token>  shows PayTR's iframe in the brand frame (our redirect after placing the
//                                order, or after "retry");
//   ?r=<signed>&sonuc=ok|hata     PayTR's return URLs: waits for the notification, then the order page.
// While the latest attempt is inside its window without a result (paytr-window.ts) no new form is offered:
// the payment of the closed form may still be confirmed ("Ödemeniz doğrulanıyor").
// The URL carries a token: noindex, no referrer (also set in next.config.ts, with the CSP that allows the
// PayTR frame here only). iyzico and the simulator never use this page.
// Under the form: PayTR's contract notice and, when the owner picked one, PayTR's logo (PayTR-fix IMPL-B, S7;
// src/components/store/PaytrNotice.tsx). This page exists only for PayTR, so it shows whenever the form does.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import CardPaymentFrame from "@/components/checkout/CardPaymentFrame";
import CardReturnPoller from "@/components/checkout/CardReturnPoller";
import RetryPaymentForm from "@/components/order/RetryPaymentForm";
import { buttonClass } from "@/components/sections/button-styles";
import PaytrNotice from "@/components/store/PaytrNotice";
import { intlLocale, isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages, type Messages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import { getMediaById } from "@/lib/data/site";
import { getCardPageSession } from "@/lib/payments/card-page";
import { PAYTR_PATHS } from "@/lib/payments/paytr-crypto";
import { formatPrice } from "@/lib/pricing/money";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { getSettings } from "@/lib/settings/get-settings";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const messages = await getMessages(locale);
  const title = messages.checkout.cardPayment.metaTitle;
  return {
    title,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    alternates: { canonical: null, languages: {} },
    ...(await shareMetadata(locale, { title, path: href(locale, "checkout") })),
  };
}

export default function CardPaymentPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <CardPayment params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

async function CardPayment({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  // Request time only: the session reads the clock (form expiry) and the order state.
  await connection();
  const messages = await getMessages(locale);
  const t = messages.checkout.cardPayment;

  const r = first(query.r).slice(0, 2048);
  if (r) {
    // Always the client poller (never a server redirect): this response may be rendering inside the
    // PayTR iframe, and the poller first moves the whole tab here.
    return (
      <Shell narrow>
        <div className="rounded-lg border border-border bg-surface px-6 py-12 sm:px-10">
          <CardReturnPoller
            r={r}
            failed={first(query.sonuc) === "hata"}
            lookupHref={href(locale, "orderLookup")}
            labels={{
              checkingTitle: t.checkingTitle,
              checkingText: t.checkingText,
              slowTitle: t.slowTitle,
              slowText: t.slowText,
              verifyingTitle: t.verifyingTitle,
              verifyingText: t.verifyingText,
              verifyingFailedText: t.verifyingFailedText,
              viewOrder: t.viewOrder,
              invalidTitle: t.notFoundTitle,
              invalidText: t.notFoundText,
              orderLookup: t.orderLookup,
            }}
          />
        </div>
      </Shell>
    );
  }

  const session = await getCardPageSession({ orderNumber: first(query.order).slice(0, 32), token: first(query.t).slice(0, 64) });

  if (session.state === "not_found" || session.state === "not_pending") {
    const copy = session.state === "not_found" ? { title: t.notFoundTitle, text: t.notFoundText } : { title: t.notPendingTitle, text: t.notPendingText };
    return (
      <Shell narrow>
        <div className="rounded-lg border border-border bg-surface p-6 sm:p-10">
          <h1 className="font-heading text-3xl text-text">{copy.title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">{copy.text}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {session.state === "not_pending" ? (
              <Link href={session.orderHref} className={buttonClass("primary")}>
                {t.viewOrder}
              </Link>
            ) : (
              <Link href={href(locale, "orderLookup")} className={buttonClass("primary")}>
                {t.orderLookup}
              </Link>
            )}
            <Link href={href(locale, "home")} className={buttonClass("secondary")}>
              {t.home}
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (session.state === "expired") {
    return (
      <Shell narrow>
        <div className="rounded-lg border border-border bg-surface p-6 sm:p-10">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1 className="mt-2 font-heading text-3xl text-text">{t.expiredTitle}</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">{t.expiredText}</p>
          <OrderSummary t={t} locale={locale} orderNumber={session.orderNumber} amount={session.amount} />
          <div className="mt-8">
            <RetryPaymentForm locale={locale} orderNumber={session.orderNumber} token={session.token} labels={{ button: t.restart, pending: t.restarting }} />
          </div>
          <BackLink href={session.orderHref} label={t.backToOrder} />
        </div>
      </Shell>
    );
  }

  if (session.state === "verifying") {
    return (
      <Shell narrow>
        <div className="rounded-lg border border-border bg-surface p-6 sm:p-10">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1 className="mt-2 font-heading text-3xl text-text">{t.verifyingTitle}</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">{withTime(t.verifyingFormText, clockTime(session.retryAt, locale))}</p>
          <OrderSummary t={t} locale={locale} orderNumber={session.orderNumber} amount={session.amount} />
          <div className="mt-8">
            <Link href={session.orderHref} className={buttonClass("primary")}>
              {t.viewOrder}
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  const expires = clockTime(session.expiresAt, locale);
  const paytrLogo = await getMediaById((await getSettings("payments")).paytrLogoImageId);
  return (
    <Shell>
      <header className="text-center">
        <p className="eyebrow">{t.eyebrow}</p>
        <h1 className="mt-2 font-heading text-3xl leading-tight text-text sm:text-4xl">{t.title}</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-text-muted">{t.intro}</p>
      </header>
      <div className="mt-8 overflow-hidden rounded-lg border border-border bg-surface shadow-[0_24px_60px_-30px_rgb(3_38_95/0.35)]">
        <div className="border-b border-border bg-surface-2 px-5 py-4 sm:px-8">
          <OrderSummary t={t} locale={locale} orderNumber={session.orderNumber} amount={session.amount} compact />
        </div>
        {/* PayTR's form is light; keep it on a light sheet in dark mode too, so it looks intentional. */}
        <div className="bg-white px-2 py-3 sm:px-6 sm:py-5">
          <CardPaymentFrame
            src={session.iframeUrl}
            resizerSrc={`${session.frameOrigin}${PAYTR_PATHS.resizer}`}
            title={t.frameTitle}
            loadingLabel={t.loading}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border px-5 py-4 text-xs text-text-muted sm:px-8">
          <span className="inline-flex items-center gap-2">
            <LockKeyhole aria-hidden className="size-4 text-gold" strokeWidth={1.75} />
            {t.secure}
          </span>
          <span className="inline-flex items-center gap-2">
            <ShieldCheck aria-hidden className="size-4 text-gold" strokeWidth={1.75} />
            3-D Secure
          </span>
        </div>
        <PaytrNotice
          locale={locale}
          labels={messages.footer.paytr}
          newTabHint={messages.common.opensInNewTab}
          logo={paytrLogo}
          className="border-t border-border px-5 py-4 text-xs leading-relaxed text-text-muted sm:px-8"
        />
      </div>
      <p className="mt-4 text-center text-xs text-text-muted">{format(t.expiresAt, { time: expires }, locale)}</p>
      <div className="text-center">
        <BackLink href={session.orderHref} label={t.backToOrder} />
      </div>
    </Shell>
  );
}

/** "14:35" in Türkiye time. */
const clockTime = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(intlLocale(locale), { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** A UI string with a {time} placeholder, the time isolated (<bdi>) for right-to-left text. */
function withTime(template: string, time: string): ReactNode {
  const at = template.indexOf("{time}");
  if (at < 0) return template;
  return (
    <>
      {template.slice(0, at)}
      <bdi dir="ltr">{time}</bdi>
      {template.slice(at + "{time}".length)}
    </>
  );
}

function OrderSummary({ t, locale, orderNumber, amount, compact }: { t: Messages["checkout"]["cardPayment"]; locale: Locale; orderNumber: string; amount: number; compact?: boolean }) {
  return (
    <dl className={compact ? "flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2" : "mt-6 divide-y divide-border rounded-md border border-border"}>
      <div className={compact ? "min-w-0" : "flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3.5"}>
        <dt className="text-xs uppercase tracking-[0.14em] text-text-muted rtl:tracking-normal">{t.orderNumber}</dt>
        <dd className="mt-0.5 text-sm font-medium text-text" dir="ltr">
          {orderNumber}
        </dd>
      </div>
      <div className={compact ? "min-w-0 text-end" : "flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3.5"}>
        <dt className="text-xs uppercase tracking-[0.14em] text-text-muted rtl:tracking-normal">{t.amount}</dt>
        <dd className="mt-0.5 font-heading text-2xl text-text">{formatPrice(amount, locale)}</dd>
      </div>
    </dl>
  );
}

function BackLink({ href: target, label }: { href: string; label: string }) {
  return (
    <Link
      href={target}
      className="mt-6 inline-flex min-h-11 items-center text-sm text-text-muted underline decoration-border underline-offset-4 hover:text-text hover:decoration-gold"
    >
      {label}
    </Link>
  );
}

function Shell({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <div className={`container-x ${narrow ? "max-w-xl" : "max-w-2xl"} py-12 md:py-16`}>{children}</div>;
}

function CardSkeleton() {
  return (
    <div className="container-x max-w-2xl animate-pulse py-12 motion-reduce:animate-none md:py-16" aria-hidden>
      <div className="mx-auto h-10 max-w-sm rounded-md bg-surface-2" />
      <div className="mt-8 h-[36rem] rounded-lg bg-surface-2" />
    </div>
  );
}
