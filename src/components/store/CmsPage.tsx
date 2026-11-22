// Storefront routes whose content is a page-builder page with a reserved slug: /kurumsal, /numune,
// /iletisim (src/lib/reserved-pages.ts). All reads are cached, so the routes are static; the panel's
// page save invalidates `pages` / `page:<slug>`.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AudienceGate from "@/components/sections/AudienceGate";
import { leadingGuestSection } from "@/components/sections/audience-gate-rules";
import SectionRenderer, { isRenderable } from "@/components/sections/SectionRenderer";
import { isLocale, type Locale } from "@/i18n/config";
import { getMessages, type Messages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href, localeAlternates } from "@/i18n/paths";
import { getMediaByIds } from "@/lib/data/media";
import { getPage, getStorefrontPage, type PageSectionData } from "@/lib/data/pages";
import { RESERVED_PAGES, type ReservedPageSlug } from "@/lib/reserved-pages";
import { ownLocaleText, seoText } from "@/lib/seo/localized";
import { shareMetadata } from "@/lib/seo/share-metadata";
import ListingHeader from "./ListingHeader";

type Params = Promise<{ locale: string }>;

/** Title and intro used when the page row is missing (only /iletisim renders without one). */
function fallbackCopy(slug: ReservedPageSlug, messages: Messages): { title: string; intro?: string } {
  if (slug === "kurumsal") return { title: messages.nav.business };
  if (slug === "numune") return { title: messages.sample.title, intro: messages.sample.subtitle };
  return { title: messages.contact.title, intro: messages.contact.subtitle };
}

/**
 * The contact page keeps working without its page row (the form is a function, not marketing copy):
 * contact channels from settings plus the form with the default subjects.
 */
function contactFallback(messages: Messages): PageSectionData[] {
  const m = messages.contact;
  return [
    { id: -1, type: "contact_info", content: {}, audience: "all" },
    {
      id: -2,
      type: "contact_form",
      audience: "all",
      content: {
        // The visitor's language sits in `tr`: localize() falls back to it for every locale.
        title: { tr: m.placeholderGeneral },
        subjects: [
          { key: "general", label: { tr: m.subjectGeneral } },
          { key: "quote", label: { tr: m.subjectQuote } },
          { key: "sample", label: { tr: m.subjectSample } },
          { key: "other", label: { tr: m.subjectOther } },
        ],
      },
    },
  ];
}

export async function cmsPageMetadata(params: Params, slug: ReservedPageSlug): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const route = RESERVED_PAGES[slug];
  const [page, messages] = await Promise.all([getPage(slug), getMessages(locale)]);
  if (!page && slug !== "iletisim") return {};
  const fallback = fallbackCopy(slug, messages);
  const title = seoText(page?.seo?.title, locale, localize(page?.title, locale), fallback.title);
  const description = seoText(page?.seo?.description, locale, fallback.intro);
  const ogId = page?.seo?.ogImageId;
  const og = ogId ? (await getMediaByIds([ogId]))[ogId] : undefined;
  return {
    title,
    ...(description ? { description } : {}),
    alternates: localeAlternates(locale, route),
    ...(await shareMetadata(locale, { title, description, path: href(locale, route), image: og })),
    ...(page?.seo?.noIndex ? { robots: { index: false } } : {}),
  };
}

/**
 * Renders the page's visible sections (business-only ones through <AudienceGate>). When the first one
 * guests see is not a hero (which carries its own h1), an editorial header with the page title and
 * SEO description comes first.
 * Render inside <Suspense>: it awaits the route params.
 */
export async function CmsPageView({ params, slug }: { params: Params; slug: ReservedPageSlug }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  // Without /numune calls to action while samples are off (PayTR-fix IMPL-B, S17); /numune itself stays as stored.
  const [page, messages] = await Promise.all([getStorefrontPage(slug), getMessages(locale)]);
  if (!page && slug !== "iletisim") notFound();

  const visible = page?.sections.filter((s) => isRenderable(s)) ?? [];
  const sections = visible.length > 0 || page ? visible : contactFallback(messages);
  const fallback = fallbackCopy(slug, messages);
  // The hero that opens the page for guests carries the h1. A retail-only hero is hidden from approved
  // business customers, so they get the editorial header in its place; that header must not claim the
  // page heading (page-heading.ts), or the guests' hero would render its headline as <h2>.
  const leading = leadingGuestSection(sections);
  const heroFor = leading?.type === "hero" ? leading.audience : null;
  const header = (
    <ListingHeader
      claimHeading={heroFor === null}
      locale={locale}
      title={localize(page?.title, locale) || fallback.title}
      intro={ownLocaleText(page?.seo?.description, locale) || fallback.intro}
    />
  );

  return (
    <>
      {heroFor === null ? header : heroFor === "retail" ? <AudienceGate audience="business">{header}</AudienceGate> : null}
      <SectionRenderer sections={sections} locale={locale} messages={messages} leadsPage />
    </>
  );
}
