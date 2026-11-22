// Payment simulator (/odeme/simulator?order=PR-…&t=<token>): a fake bank 3-D Secure screen for local
// development. Works only when core says the simulator is enabled (PAYMENT_SIMULATOR=true); it never
// asks for card data. The URL carries the order token, so: noindex and no referrer.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { FlaskConical, ShieldCheck } from "lucide-react";
import { buttonClass } from "@/components/sections/button-styles";
import SimulatorButtons from "@/components/checkout/SimulatorButtons";
import { isLocale } from "@/i18n/config";
import { getMessages, type Messages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import { isTokenShape, orderPageHref } from "@/lib/orders/token";
import { normalizeOrderNumber } from "@/lib/orders/number";
import { getSimulatorSession } from "@/lib/payments";
import { formatPrice } from "@/lib/pricing/money";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { getSettings } from "@/lib/settings/get-settings";
import { simulatePaymentAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const messages = await getMessages(locale);
  const title = messages.checkout.simulator.metaTitle;
  return {
    title,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    // Not the home page's canonical/alternates/share card; never the token URL either.
    alternates: { canonical: null, languages: {} },
    ...(await shareMetadata(locale, { title, path: href(locale, "checkout") })),
  };
}

export default function PaymentSimulatorPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<SimulatorSkeleton />}>
      <Simulator params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

async function Simulator({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const orderNumber = first(query.order).slice(0, 32);
  const token = first(query.t).slice(0, 64);
  const [session, messages, general] = await Promise.all([getSimulatorSession({ orderNumber, token }), getMessages(locale), getSettings("general")]);
  const t = messages.checkout.simulator;

  if (!session.ok) {
    const normalized = normalizeOrderNumber(orderNumber);
    const orderHref = normalized && isTokenShape(token) ? orderPageHref(locale, normalized, token) : null;
    const copy =
      session.code === "disabled"
        ? { title: t.disabledTitle, text: t.disabledText }
        : session.code === "not_pending"
          ? { title: t.notPendingTitle, text: t.notPendingText }
          : { title: t.notFoundTitle, text: t.notFoundText };
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-surface p-6 sm:p-10">
          <h1 className="font-heading text-3xl text-text">{copy.title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">{copy.text}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {session.code === "not_pending" && orderHref ? (
              <Link href={orderHref} className={buttonClass("primary")}>
                {t.viewOrder}
              </Link>
            ) : session.code === "not_found" ? (
              <Link href={href(locale, "orderLookup")} className={buttonClass("primary")}>
                {t.orderLookup}
              </Link>
            ) : null}
            <Link href={href(locale, "home")} className={buttonClass("secondary")}>
              {t.home}
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <TestBanner messages={messages} />
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-[0_24px_60px_-30px_rgb(3_38_95/0.35)]">
        <div className="flex items-center justify-between gap-4 border-b border-border bg-surface-2 px-6 py-4 sm:px-8">
          <p className="flex items-center gap-2 text-sm font-semibold text-text">
            <ShieldCheck aria-hidden className="size-5 text-emerald-700 dark:text-emerald-400" strokeWidth={1.75} />
            {t.bank}
          </p>
          <span className="rounded-sm border-2 border-dashed border-red-700 px-2 py-0.5 text-xs font-bold tracking-[0.2em] text-red-700 dark:border-red-400 dark:text-red-400">
            {t.badge}
          </span>
        </div>
        <div className="px-6 py-8 sm:px-8 sm:py-10">
          <h1 className="font-heading text-3xl leading-tight text-text sm:text-4xl">{t.title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">{t.intro}</p>

          <dl className="mt-8 divide-y divide-border rounded-md border border-border">
            <Row label={t.merchant} value={general.legalName || general.siteName} />
            <Row label={t.orderNumber} value={<span dir="ltr">{session.orderNumber}</span>} />
            <Row label={t.amount} value={<span className="font-heading text-2xl text-text">{formatPrice(session.amount, locale)}</span>} />
          </dl>

          <form action={simulatePaymentAction} className="mt-8">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="order" value={session.orderNumber} />
            <input type="hidden" name="t" value={token} />
            <SimulatorButtons approve={t.approve} fail={t.fail} processing={t.processing} />
          </form>

          <Link
            href={orderPageHref(locale, session.orderNumber, token)}
            className="mt-6 inline-flex min-h-11 items-center text-sm text-text-muted underline decoration-border underline-offset-4 hover:text-text hover:decoration-gold"
          >
            {t.backToOrder}
          </Link>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="container-x max-w-2xl py-12 md:py-20">{children}</div>;
}

function TestBanner({ messages }: { messages: Messages }) {
  const t = messages.checkout.simulator;
  return (
    <p role="note" className="mb-6 flex items-start gap-3 rounded-md border border-red-700/30 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-900 dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-200">
      <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      {t.devOnly}
    </p>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3.5 sm:px-5">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-sm font-medium text-text">{value}</dd>
    </div>
  );
}

function SimulatorSkeleton() {
  return (
    <div className="container-x max-w-2xl animate-pulse py-12 motion-reduce:animate-none md:py-20" aria-hidden>
      <div className="h-12 rounded-md bg-surface-2" />
      <div className="mt-6 h-96 rounded-lg bg-surface-2" />
    </div>
  );
}

