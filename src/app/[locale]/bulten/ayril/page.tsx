// /bulten/ayril (en/ar: /newsletter/unsubscribe): the visible unsubscribe link of every campaign
// (?t=<signed token>). One button press unsubscribes (no login); mail clients use the RFC 8058
// one-click POST (/api/newsletter/unsubscribe) instead. noindex, no-referrer, token read in Suspense.
import type { Metadata } from "next";
import { MailX } from "lucide-react";
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
  const title = messages.newsletter.unsubscribePage.metaTitle;
  return {
    title,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    // Own URL only: without these the page would inherit the layout's home canonical, hreflang and og:url
    // (a noindex page pointing its canonical at /tr), like the checkout and order pages avoid.
    alternates: { canonical: null, languages: {} },
    ...(await shareMetadata(locale, { title, path: href(locale, "newsletterUnsubscribe") })),
  };
}

export default function NewsletterUnsubscribePage({ params, searchParams }: Props) {
  return (
    <NewsletterLinkCard>
      <Suspense fallback={<NewsletterLinkSkeleton />}>
        <Unsubscribe params={params} searchParams={searchParams} />
      </Suspense>
    </NewsletterLinkCard>
  );
}

const first = (value: string | string[] | undefined) => (typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined);

async function Unsubscribe({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [messages, query] = await Promise.all([getMessages(locale), searchParams]);
  const m = messages.newsletter.unsubscribePage;
  const token = first(query.t)?.trim() || null;
  const links = [{ href: href(locale, "home"), label: m.home }];
  return (
    <>
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-surface-2 text-text-muted">
        <MailX aria-hidden className="size-7" strokeWidth={1.5} />
      </span>
      <p className="eyebrow mt-6 mb-3">{m.eyebrow}</p>
      {token ? (
        <NewsletterLinkForm kind="unsubscribe" token={token} labels={m} links={links} />
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
