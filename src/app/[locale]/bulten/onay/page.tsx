// /bulten/onay (en/ar: /newsletter/confirm): landing page of the newsletter confirmation mail (?t=<token>).
// The visitor confirms with a button (link scanners must not confirm on their own). noindex and
// no-referrer (the token is in the URL); the token is read inside Suspense, so the shell stays static.
import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import NewsletterLinkForm, { LinkRow } from "@/components/store/newsletter/NewsletterLinkForm";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { NewsletterLinkCard, NewsletterLinkSkeleton } from "../shared";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const messages = await getMessages(locale);
  const title = messages.newsletter.confirmPage.metaTitle;
  return {
    title,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    // Own URL only: without these the page would inherit the layout's home canonical, hreflang and og:url
    // (a noindex page pointing its canonical at /tr), like the checkout and order pages avoid.
    alternates: { canonical: null, languages: {} },
    ...(await shareMetadata(locale, { title, path: href(locale, "newsletterConfirm") })),
  };
}

export default function NewsletterConfirmPage({ params, searchParams }: Props) {
  return (
    <NewsletterLinkCard>
      <Suspense fallback={<NewsletterLinkSkeleton />}>
        <Confirm params={params} searchParams={searchParams} />
      </Suspense>
    </NewsletterLinkCard>
  );
}

const first = (value: string | string[] | undefined) => (typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined);

async function Confirm({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [messages, query] = await Promise.all([getMessages(locale), searchParams]);
  const m = messages.newsletter.confirmPage;
  const token = first(query.t)?.trim() || null;
  const links = [
    { href: href(locale, "products"), label: m.shop, primary: true },
    { href: href(locale, "home"), label: m.home },
  ];
  return (
    <>
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-gold/12 text-gold-text">
        <MailCheck aria-hidden className="size-7" strokeWidth={1.5} />
      </span>
      <p className="eyebrow mt-6 mb-3">{m.eyebrow}</p>
      {token ? (
        <NewsletterLinkForm kind="confirm" token={token} labels={m} links={links} />
      ) : (
        <div className="space-y-6">
          <h1 className="font-heading text-3xl leading-tight text-balance text-text md:text-4xl">{m.invalidTitle}</h1>
          <p className="mx-auto max-w-md text-base leading-relaxed text-pretty text-text-muted">{m.invalidText}</p>
          <LinkRow links={links} />
        </div>
      )}
    </>
  );
}
