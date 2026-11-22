// Category listing. Every visible category is prerendered; the page takes the category's accent color.
// Below the grid: the category's editorial text and FAQ (CategoryContent).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import CategoryStructuredData from "@/components/seo/CategoryStructuredData";
import Breadcrumbs from "@/components/store/Breadcrumbs";
import CategoryChips from "@/components/store/CategoryChips";
import CategoryContent from "@/components/store/CategoryContent";
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
import { redirectIfMoved } from "@/lib/data/redirects";
import { seoText } from "@/lib/seo/localized";
import { notFoundMetadata } from "@/lib/seo/not-found-metadata";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { productScopeStyle } from "@/lib/theme/engine";

type Props = { params: Promise<{ locale: string; slug: string }> };

/** generateStaticParams must return at least one entry; this slug never matches and 404s. */
const PLACEHOLDER_SLUG = "__placeholder__";

// Wait for the complete static page instead of resuming the [slug] fallback shell. Next 16.4 resumes
// that shell with its build-time "use cache" results and no tag check, so the first request after a
// panel edit to a page not yet in the server's memory would show the old content once.
export const ensureStatic = "navigation";

export async function generateStaticParams() {
  const categories = await listCategories();
  return categories.length ? categories.map((c) => ({ slug: c.slug })) : [{ slug: PLACEHOLDER_SLUG }];
}

async function findCategory(slug: string) {
  const categories = await listCategories();
  return { categories, category: categories.find((c) => c.slug === slug) ?? null };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const { category } = await findCategory(slug);
  if (!category) return notFoundMetadata(locale);
  const title = seoText(category.seo?.title, locale, localize(category.name, locale));
  const description = seoText(category.seo?.description, locale, localize(category.description, locale));
  const ogId = category.seo?.ogImageId;
  const og = ogId ? (await getMediaByIds([ogId]))[ogId] : category.image;
  return {
    title,
    ...(description ? { description } : {}),
    alternates: localeAlternates(locale, "category", { slug }),
    ...(await shareMetadata(locale, { title, description, path: href(locale, "category", { slug }), image: og })),
    ...(category.seo?.noIndex ? { robots: { index: false } } : {}),
  };
}

export default function CategoryPage({ params }: Props) {
  return (
    <Suspense fallback={<ListingSkeleton />}>
      <Category params={params} />
    </Suspense>
  );
}

async function Category({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const { categories, category } = await findCategory(slug);
  if (!category) {
    await redirectIfMoved(locale, `/kategori/${slug}`);
    notFound();
  }
  const [messages, products] = await Promise.all([getMessages(locale), listProducts({ categorySlug: slug })]);
  const name = localize(category.name, locale);

  return (
    <div className="product-scope" style={category.accentColor ? productScopeStyle(category.accentColor) : undefined}>
      <CategoryStructuredData category={category} products={products} locale={locale} />
      <ListingHeader
        locale={locale}
        eyebrow={format(messages.category.productCount, { count: products.length }, locale)}
        title={name}
        intro={localize(category.description, locale) || undefined}
        image={category.image}
        breadcrumbs={
          <Breadcrumbs
            label={messages.nav.breadcrumb}
            siteUrl={siteOrigin()}
            items={[
              { label: messages.common.home, href: href(locale, "home") },
              { label: messages.nav.products, href: href(locale, "products") },
              { label: name },
            ]}
          />
        }
      >
        <CategoryChips
          categories={categories}
          locale={locale}
          activeSlug={category.slug}
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

      <CategoryContent categoryName={name} body={category.body} faq={category.faq} locale={locale} messages={messages} />
    </div>
  );
}
