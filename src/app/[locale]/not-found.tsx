import type { Metadata } from "next";
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
  return { title: messages.errors.notFound, robots: { index: false } };
}

export default async function NotFound() {
  const locale = await currentLocale();
  const messages = await getMessages(locale);

  return (
    <section className="container-x flex min-h-[65vh] flex-col items-center justify-center py-24 text-center md:py-32">
      <p className="eyebrow">404</p>
      <span aria-hidden className="mt-6 block h-px w-12 bg-gold/60" />
      <h1 className="mt-8 max-w-2xl text-balance font-heading text-4xl leading-tight md:text-6xl">
        {messages.errors.notFound}
      </h1>
      <p className="mt-6 max-w-md text-pretty leading-relaxed text-text-muted">{messages.errors.notFoundDescription}</p>
      <div className="mt-12 flex flex-wrap justify-center gap-3">
        <Link href={href(locale, "home")} className={primaryButton}>
          {messages.errors.goHome}
        </Link>
        <Link href={href(locale, "products")} className={secondaryButton}>
          {messages.nav.products}
        </Link>
      </div>
    </section>
  );
}
