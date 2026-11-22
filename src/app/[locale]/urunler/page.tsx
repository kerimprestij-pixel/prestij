// All products: editorial header, category chips (static category pages) and the product grid.
// Optional copy/sections come from a page-builder page with slug "urunler": its title is the <h1>, its
// sections render below the grid (a hero there renders its headline as <h2>: see page-heading.ts).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import SectionRenderer from "@/components/sections/SectionRenderer";
import ProductsIndexStructuredData from "@/components/seo/ProductsIndexStructuredData";
import Breadcrumbs from "@/components/store/Breadcrumbs";
import CategoryChips from "@/components/store/CategoryChips";
import ListingHeader from "@/components/store/ListingHeader";
import { ListingSkeleton } from "@/components/store/ListingSkeleton";
import ProductGrid from "@/components/store/ProductGrid";
import { isLocale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href, localeAlternates, siteOrigin } from "@/i18n/paths";
import { listCategories, listProducts } from "@/lib/data/catalog";
import { getMediaByIds } from "@/lib/data/media";
import { getPage, getStorefrontPage } from "@/lib/data/pages";
import { ownLocaleText, seoText } from "@/lib/seo/localized";
import { shareMetadata } from "@/lib/seo/share-metadata";

type Props = { params: Promise<{ locale: string }> };

const PAGE_SLUG = "urunler";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const [page, messages] = await Promise.all([getPage(PAGE_SLUG), getMessages(locale)]);
  // seoText: the visitor's own SEO text first (localize() would put Turkish SEO texts on /en and /ar).
  const title = seoText(page?.seo?.title, locale, localize(page?.title, locale), messages.nav.products);
  const description = seoText(page?.seo?.description, locale);
  // The page row's "Paylaşım görseli" and "Arama motorlarından gizle" (Sayfalar editor) apply here, as on
  // /sayfa/<slug>; a hidden /urunler is also left out of the sitemap (src/lib/data/sitemap.ts).
  const ogId = page?.seo?.ogImageId;
  const og = ogId ? (await getMediaByIds([ogId]))[ogId] : undefined;
  return {
    title,
    ...(description ? { description } : {}),
    alternates: localeAlternates(locale, "products"),
    ...(await shareMetadata(locale, { title, description, path: href(locale, "products"), image: og })),
    ...(page?.seo?.noIndex ? { robots: { index: false } } : {}),
  };
}

export default function ProductsPage({ params }: Props) {
  return (
    <Suspense fallback={<ListingSkeleton />}>
      <Products params={params} />
    </Suspense>
  );
}

async function Products({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [messages, categories, products, page] = await Promise.all([
    getMessages(locale),
    listCategories(),
    listProducts(),
    // Without /numune calls to action while samples are off (PayTR-fix IMPL-B, S17).
    getStorefrontPage(PAGE_SLUG),
  ]);
  // Text shown on the page (and its CollectionPage description) only in the visitor's own language.
  const intro = ownLocaleText(page?.seo?.description, locale);

  return (
    <>
      <ProductsIndexStructuredData locale={locale} name={localize(page?.title, locale) || messages.nav.products} description={intro} products={products} />
      <ListingHeader
        locale={locale}
        eyebrow={format(messages.category.productCount, { count: products.length }, locale)}
        title={localize(page?.title, locale) || messages.nav.products}
        intro={intro || undefined}
        breadcrumbs={
          <Breadcrumbs
            label={messages.nav.breadcrumb}
            siteUrl={siteOrigin()}
            items={[{ label: messages.common.home, href: href(locale, "home") }, { label: messages.nav.products }]}
          />
        }
      >
        <CategoryChips
          categories={categories}
          locale={locale}
          activeSlug={null}
          allLabel={messages.category.allProducts}
          label={messages.category.filters}
        />
      </ListingHeader>

      <section className="container-x py-14 md:py-20">
        {products.length > 0 ? (
          <ProductGrid products={products} locale={locale} fromLabel={messages.product.from} regularPriceLabel={messages.campaign.regularPrice} preloadFirst={2} />
        ) : (
          <p className="py-16 text-center text-text-muted">{messages.category.empty}</p>
        )}
      </section>

      {page && page.sections.length > 0 && <SectionRenderer sections={page.sections} locale={locale} messages={messages} />}
    </>
  );
}
