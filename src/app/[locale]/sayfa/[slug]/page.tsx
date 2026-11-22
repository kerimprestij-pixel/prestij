// Page-builder pages (legal texts, custom pages) at /sayfa/<slug> (en/ar: /page/<slug>).
// Reserved slugs (kurumsal, numune, iletisim) have their own routes: /sayfa/<reserved> redirects there,
// and so does /sayfa/urunler (the products page's copy, shown at /urunler).
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import SectionRenderer, { isRenderable } from "@/components/sections/SectionRenderer";
import Breadcrumbs from "@/components/store/Breadcrumbs";
import ListingHeader from "@/components/store/ListingHeader";
import { ListingSkeleton } from "@/components/store/ListingSkeleton";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href, localeAlternates, siteOrigin, type StaticRoute } from "@/i18n/paths";
import { getMediaByIds } from "@/lib/data/media";
import { getPage, getStorefrontPage, listPageSlugs, type PageData } from "@/lib/data/pages";
import { redirectIfMoved } from "@/lib/data/redirects";
import { isReservedPageSlug, RESERVED_PAGES } from "@/lib/reserved-pages";
import { ownLocaleText, seoText } from "@/lib/seo/localized";
import { notFoundMetadata } from "@/lib/seo/not-found-metadata";
import { shareMetadata } from "@/lib/seo/share-metadata";

type Props = { params: Promise<{ locale: string; slug: string }> };

/** generateStaticParams must return at least one entry; this slug never matches and 404s. */
const PLACEHOLDER_SLUG = "__placeholder__";

/**
 * The page row behind /urunler (src/app/[locale]/urunler/page.tsx). Served here too it would be a
 * second URL with the same title and sections (duplicate content); the sitemap already leaves it out.
 */
const PRODUCTS_PAGE_SLUG = "urunler";

/** Slugs whose content lives on a dedicated route, never at /sayfa/<slug>. */
function routeOf(slug: string): StaticRoute | null {
  if (isReservedPageSlug(slug)) return RESERVED_PAGES[slug];
  return slug === PRODUCTS_PAGE_SLUG ? "products" : null;
}

// Wait for the complete static page instead of resuming the [slug] fallback shell. Next 16.4 resumes
// that shell with its build-time "use cache" results and no tag check, so the first request after a
// panel edit to a page not yet in the server's memory would show the old content once.
export const ensureStatic = "navigation";

export async function generateStaticParams() {
  const slugs = (await listPageSlugs()).filter((slug) => !routeOf(slug));
  return (slugs.length ? slugs : [PLACEHOLDER_SLUG]).map((slug) => ({ slug }));
}

/** The home page and the route-backed pages have their own routes; everything else published is served here. */
async function findPage(slug: string, load: (slug: string) => Promise<PageData | null> = getPage) {
  if (routeOf(slug)) return null;
  const page = await load(slug);
  return page && page.kind !== "home" ? page : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const page = await findPage(slug);
  if (!page) return notFoundMetadata(locale);
  const title = seoText(page.seo?.title, locale, localize(page.title, locale));
  const description = seoText(page.seo?.description, locale);
  const ogId = page.seo?.ogImageId;
  const og = ogId ? (await getMediaByIds([ogId]))[ogId] : undefined;
  return {
    title,
    ...(description ? { description } : {}),
    alternates: localeAlternates(locale, "page", { slug }),
    ...(await shareMetadata(locale, { title, description, path: href(locale, "page", { slug }), image: og })),
    ...(page.seo?.noIndex ? { robots: { index: false } } : {}),
  };
}

export default function ContentPage({ params }: Props) {
  return (
    <Suspense fallback={<ListingSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  // Inside Suspense this arrives as a client-side redirect after the 200 (see redirectIfMoved).
  const route = routeOf(slug);
  if (route) permanentRedirect(href(locale, route));
  // Rendering: without /numune calls to action while samples are off (PayTR-fix IMPL-B, S17).
  const page = await findPage(slug, getStorefrontPage);
  if (!page) {
    await redirectIfMoved(locale, `/sayfa/${slug}`);
    notFound();
  }
  const messages = await getMessages(locale);
  const title = localize(page.title, locale);
  // A page that opens with a hero has its title there (the hero's <h1>), like /kurumsal and /numune.
  // "retail" = the guest view, which is the static HTML (a business-only hero is not in it).
  const startsWithHero = page.sections.find((s) => isRenderable(s, "retail"))?.type === "hero";
  const breadcrumbs = (
    <Breadcrumbs
      label={messages.nav.breadcrumb}
      siteUrl={siteOrigin()}
      items={[{ label: messages.common.home, href: href(locale, "home") }, { label: title }]}
    />
  );

  return (
    <>
      {startsWithHero ? (
        <div className="container-x pt-6 pb-4 md:pt-8">{breadcrumbs}</div>
      ) : (
        <ListingHeader
          locale={locale}
          eyebrow={page.kind === "legal" ? messages.footer.legal : undefined}
          title={title}
          intro={ownLocaleText(page.seo?.description, locale) || undefined}
          breadcrumbs={breadcrumbs}
        />
      )}
      {/* The ListingHeader above has no image: the first section's image can be the LCP. */}
      <SectionRenderer sections={page.sections} locale={locale} messages={messages} leadsPage />
    </>
  );
}
