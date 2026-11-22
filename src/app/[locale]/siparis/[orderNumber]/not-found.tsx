// Neutral answer for an unknown order number, a missing token and a wrong token alike: it never says
// whether the order exists. Points to the lookup form instead.
import type { Metadata } from "next";
import { Search } from "lucide-react";
import Link from "next/link";
import { locale as rootLocale } from "next/root-params";
import { primaryButton, secondaryButton } from "@/components/store/shell-styles";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";

async function currentLocale(): Promise<Locale> {
  const value: unknown = await rootLocale();
  return isLocale(value) ? value : defaultLocale;
}

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages(await currentLocale());
  return { title: messages.order.notFound.title, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function OrderNotFound() {
  const locale = await currentLocale();
  const messages = await getMessages(locale);
  const m = messages.order.notFound;

  return (
    <section className="container-x flex min-h-[60vh] flex-col items-center justify-center py-24 text-center md:py-32">
      <p className="eyebrow">{messages.order.eyebrow}</p>
      <span aria-hidden className="mt-6 block h-px w-12 bg-gold/60" />
      <h1 className="mt-8 max-w-2xl text-balance font-heading text-4xl leading-tight text-text md:text-6xl">{m.title}</h1>
      <p className="mt-6 max-w-md text-pretty leading-relaxed text-text-muted">{m.text}</p>
      <div className="mt-12 flex flex-wrap justify-center gap-3">
        <Link href={href(locale, "orderLookup")} className={primaryButton}>
          <Search aria-hidden className="size-4" strokeWidth={1.75} />
          {m.cta}
        </Link>
        <Link href={href(locale, "home")} className={secondaryButton}>
          {messages.errors.goHome}
        </Link>
      </div>
    </section>
  );
}
