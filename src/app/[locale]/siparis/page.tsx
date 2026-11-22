// Order lookup: /siparis (en/ar: /order). Order number + e-mail → redirect to the token link.
// Static shell (all reads are cached); the form posts to a Server Action (./actions.ts).
import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { whatsappHref } from "@/components/order/format";
import OrderHelp from "@/components/order/OrderHelp";
import OrderLookupForm from "@/components/order/OrderLookupForm";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href, localeAlternates } from "@/i18n/paths";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { getSettings } from "@/lib/settings/get-settings";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const messages = await getMessages(locale);
  const title = messages.order.lookup.title;
  const description = messages.order.lookup.intro;
  return {
    title,
    description,
    alternates: localeAlternates(locale, "orderLookup"),
    ...(await shareMetadata(locale, { title, description, path: href(locale, "orderLookup") })),
    robots: { index: false, follow: true },
  };
}

export default function OrderLookupPage({ params }: Props) {
  return (
    <Suspense fallback={<LookupSkeleton />}>
      <Lookup params={params} />
    </Suspense>
  );
}

async function Lookup({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [messages, whatsapp, general] = await Promise.all([getMessages(locale), getSettings("whatsapp"), getSettings("general")]);
  const m = messages.order.lookup;
  const help = {
    whatsappHref: whatsapp.enabled ? whatsappHref(whatsapp.phone, localize(whatsapp.message, locale)) : null,
    phone: general.phone.trim() || null,
    email: general.email.trim() || null,
  };

  return (
    <div className="relative isolate">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[60vh] bg-linear-to-b from-gold/10 to-transparent" />
      <div className="container-x grid gap-12 py-14 md:py-20 lg:grid-cols-12 lg:gap-16">
        <div className="min-w-0 lg:col-span-6 xl:col-span-5">
          <p className="eyebrow">{messages.order.eyebrow}</p>
          <h1 className="mt-4 font-heading text-5xl leading-[1.02] tracking-tight text-balance text-text md:text-6xl lg:text-7xl">{m.title}</h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-pretty text-text-muted md:text-lg">{m.intro}</p>
          <p className="mt-8 flex max-w-lg items-start gap-3 text-sm leading-relaxed text-text-muted">
            <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-gold-text" strokeWidth={1.5} />
            <span>{m.privacy}</span>
          </p>
          <OrderHelp
            id="lookup-help"
            title={m.helpTitle}
            text={m.helpText}
            contact={help}
            labels={{
              whatsapp: messages.order.help.whatsapp,
              call: messages.order.help.call,
              email: messages.order.help.email,
              newTab: messages.common.opensInNewTab,
            }}
            className="mt-10 hidden max-w-lg lg:block"
          />
        </div>

        <div className="min-w-0 lg:col-span-6 xl:col-span-6 xl:col-start-7">
          <div className="rounded-md border border-border bg-surface p-6 shadow-[0_24px_60px_-40px_rgb(3_38_95/0.35)] sm:p-8 lg:p-10">
            <OrderLookupForm locale={locale} labels={m} />
          </div>
          <OrderHelp
            id="lookup-help-mobile"
            title={m.helpTitle}
            text={m.helpText}
            contact={help}
            labels={{
              whatsapp: messages.order.help.whatsapp,
              call: messages.order.help.call,
              email: messages.order.help.email,
              newTab: messages.common.opensInNewTab,
            }}
            className="mt-8 lg:hidden"
          />
        </div>
      </div>
    </div>
  );
}

function LookupSkeleton() {
  return (
    <div aria-hidden className="container-x grid animate-pulse gap-12 py-14 motion-reduce:animate-none md:py-20 lg:grid-cols-12 lg:gap-16">
      <div className="lg:col-span-5">
        <div className="h-3 w-28 rounded bg-surface-2" />
        <div className="mt-6 h-16 w-3/4 rounded bg-surface-2" />
        <div className="mt-6 h-4 w-full rounded bg-surface-2" />
        <div className="mt-2 h-4 w-2/3 rounded bg-surface-2" />
      </div>
      <div className="h-96 rounded-md bg-surface-2 lg:col-span-6 lg:col-start-7" />
    </div>
  );
}
