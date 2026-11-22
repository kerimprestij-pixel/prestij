// Home: the "home" page's sections from the page builder. Static (all reads are cached); params are
// awaited inside <Suspense> so the App Shell stays reusable. The opening hero is the page's <h1>
// (its eyebrow, the keyword line, inside it: see Hero.tsx); a home page without a hero gets a
// visually hidden <h1> with the site title so the page still has exactly one.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import SectionRenderer, { isRenderable } from "@/components/sections/SectionRenderer";
import SiteStructuredData from "@/components/seo/SiteStructuredData";
import { SectionsSkeleton } from "@/components/store/ListingSkeleton";
import { claimPageHeading } from "@/components/store/page-heading";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href, localeAlternates } from "@/i18n/paths";
import { getMediaByIds } from "@/lib/data/media";
import { getPage, getStorefrontPage, type PageSectionData } from "@/lib/data/pages";
import { ownLocaleText } from "@/lib/seo/localized";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { getSettings } from "@/lib/settings/get-settings";

type Props = { params: Promise<{ locale: string }> };

/** Shown when the home page has not been built in the panel yet. */
const FALLBACK_SECTIONS: PageSectionData[] = [{ id: 0, type: "featured_products", content: {}, audience: "all" }];

/** Claim token of the hidden fallback title. */
const HOME_TITLE = {};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const page = await getPage("home");
  const seo = page?.seo;
  // Only the visitor's own language; otherwise the site's localized default title/description apply.
  const title = ownLocaleText(seo?.title, locale);
  const description = ownLocaleText(seo?.description, locale);
  const og = seo?.ogImageId ? (await getMediaByIds([seo.ogImageId]))[seo.ogImageId] : undefined;
  const site = await getSettings("seo");
  const shareTitle = title || localize(site.defaultTitle, locale);
  return {
    ...(title ? { title: { absolute: title } } : {}),
    ...(description ? { description } : {}),
    alternates: localeAlternates(locale, "home"),
    ...(await shareMetadata(locale, { title: shareTitle, description, path: href(locale, "home"), image: og })),
    ...(seo?.noIndex ? { robots: { index: false } } : {}),
  };
}

export default function HomePage({ params }: Props) {
  return (
    <Suspense fallback={<SectionsSkeleton />}>
      <Home params={params} />
    </Suspense>
  );
}

async function Home({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [page, messages, seo, general] = await Promise.all([
    // Without /numune calls to action while samples are off (PayTR-fix IMPL-B, S17).
    getStorefrontPage("home"),
    getMessages(locale),
    getSettings("seo"),
    getSettings("general"),
  ]);
  // isRenderable(s): known type and valid content, any audience; with "retail": what guests see.
  const renderable = page?.sections.filter((s) => isRenderable(s)) ?? [];
  const guestVisible = renderable.some((s) => isRenderable(s, "retail"));
  // SectionRenderer gets the page's own list and decides per section (audience included), so
  // sections for signed-in business customers are not dropped here. A page with business-only
  // sections alone still gives guests (and crawlers) the fallback, hidden from business customers.
  const sections =
    !page || renderable.length === 0
      ? FALLBACK_SECTIONS
      : guestVisible
        ? page.sections
        : [...page.sections, ...FALLBACK_SECTIONS.map((s) => ({ ...s, audience: "retail" as const }))];
  // The static HTML is the guest view: a business-only hero is not in it, so it cannot be the <h1>.
  const fallbackTitle = renderable.some((s) => s.type === "hero" && isRenderable(s, "retail"))
    ? null
    : ownLocaleText(page?.seo?.title, locale) || localize(seo.defaultTitle, locale) || general.siteName;
  // Claimed before the sections render, so a hero shown later (e.g. to business customers) uses <h2>.
  if (fallbackTitle) claimPageHeading(HOME_TITLE);
  return (
    <>
      <SiteStructuredData locale={locale} />
      {fallbackTitle && <h1 className="sr-only">{fallbackTitle}</h1>}
      <SectionRenderer sections={sections} locale={locale} messages={messages} leadsPage />
    </>
  );
}
