// Product detail. The whole page takes the product's color (product-scope). Static: every active
// product is prerendered; retail prices only (business prices are resolved per user later).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowRight, Building2, FlaskConical, Truck, Weight } from "lucide-react";
import { purchaseLimits } from "@/components/cart/purchase-limits";
import { buttonClass } from "@/components/sections/button-styles";
import ProductStructuredData from "@/components/seo/ProductStructuredData";
import FavoriteButton from "@/components/store/account/FavoriteButton";
import AddToCartButton from "@/components/store/AddToCartButton";
import BusinessPrice from "@/components/store/b2b/BusinessPrice";
import Breadcrumbs from "@/components/store/Breadcrumbs";
import ClaimBadges from "@/components/store/ClaimBadges";
import { formatVolume } from "@/components/store/format";
import { ProductSkeleton } from "@/components/store/ListingSkeleton";
import PackagingExplainer from "@/components/store/PackagingExplainer";
import ProductGallery from "@/components/store/ProductGallery";
import ProductGrid from "@/components/store/ProductGrid";
import ProductInfoAccordion, { type InfoPanel } from "@/components/store/ProductInfoAccordion";
import { SubscriptionArea } from "@/components/store/subscription/SubscriptionChoice";
import ProductReviews, { RatingLink } from "@/components/store/reviews/ProductReviews";
import { productGalleryImages, productHeading, productPhrase } from "@/components/store/product-heading";
import { pickerData } from "@/components/store/product-view-model";
import { VariantProvider } from "@/components/store/VariantContext";
import VariantPicker from "@/components/store/VariantPicker";
import { intlLocale, isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages, type Messages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href, localeAlternates, siteOrigin } from "@/i18n/paths";
import { getProduct, listProductSlugs, type ProductDetail } from "@/lib/data/catalog";
import { getMediaByIds } from "@/lib/data/media";
import { isVideoMedia } from "@/lib/media/types";
import { redirectIfMoved } from "@/lib/data/redirects";
import { formatPrice } from "@/lib/pricing/money";
import { loadProductReviewBlock } from "@/lib/reviews/page-data";
import { getSettings } from "@/lib/settings/get-settings";
import { subscriptionOffer } from "@/lib/subscriptions/offer";
import { getActiveSubscriptionPlans } from "@/lib/subscriptions/plans";
import { seoText } from "@/lib/seo/localized";
import { notFoundMetadata } from "@/lib/seo/not-found-metadata";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { productScopeStyle } from "@/lib/theme/engine";

type Props = { params: Promise<{ locale: string; slug: string }> };

const PLACEHOLDER_SLUG = "__placeholder__";
const FALLBACK_ACCENT = "#DDA82A";
const PURCHASE_ID = "satin-al";

// Wait for the complete static page instead of resuming the [slug] fallback shell. Next 16.4 resumes
// that shell with its build-time "use cache" results and no tag check, so the first request after a
// panel edit to a page not yet in the server's memory would show the old content once.
export const ensureStatic = "navigation";

export async function generateStaticParams() {
  const slugs = await listProductSlugs();
  return slugs.length ? slugs.map((slug) => ({ slug })) : [{ slug: PLACEHOLDER_SLUG }];
}

async function loadProduct(slug: string): Promise<ProductDetail | null> {
  const product = await getProduct(slug);
  return product && product.type !== "sample" ? product : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const product = await loadProduct(slug);
  if (!product) return notFoundMetadata(locale);
  // Without an SEO title, the title reads like the <h1>: "Lavanta Sıvı El Sabunu" (Arabic: one noun
  // phrase, not name + type, which reads as a sentence there; productPhrase). The share image alt too.
  const phrase = productPhrase({ ...product, seoTitle: product.seo?.title }, locale);
  const title = seoText(product.seo?.title, locale, phrase);
  const description = seoText(product.seo?.description, locale, localize(product.shortDescription, locale));
  const ogId = product.seo?.ogImageId;
  // product.media holds images only (day 6); a share image id that points to a video is ignored.
  const chosenOg = ogId ? (await getMediaByIds([ogId]))[ogId] : undefined;
  const og = (chosenOg && !isVideoMedia(chosenOg) ? chosenOg : undefined) ?? product.media[0]?.media;
  return {
    title,
    ...(description ? { description } : {}),
    alternates: localeAlternates(locale, "product", { slug }),
    ...(await shareMetadata(locale, { title, description, path: href(locale, "product", { slug }), image: og, imageAlt: phrase })),
    // A business-only product cannot be bought by retail visitors (the cart refuses it), so search
    // engines do not get it either: noindex here, and the sitemap, IndexNow and the feed leave it out.
    ...(product.seo?.noIndex || product.businessOnly ? { robots: { index: false } } : {}),
  };
}

export default function ProductPage({ params }: Props) {
  return (
    <Suspense fallback={<ProductSkeleton />}>
      <ProductView params={params} />
    </Suspense>
  );
}

async function ProductView({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const product = await loadProduct(slug);
  if (!product) {
    await redirectIfMoved(locale, `/urunler/${slug}`);
    notFound();
  }

  const [messages, shipping, general, b2b, samples, subscriptionSettings, subscriptionPlans] = await Promise.all([
    getMessages(locale),
    getSettings("shipping"),
    getSettings("general"),
    getSettings("b2b"),
    getSettings("samples"),
    getSettings("subscriptions"),
    getActiveSubscriptionPlans(),
  ]);

  const m = messages.product;
  const heading = productHeading(product, locale);
  const name = heading.name;
  const shortDescription = localize(product.shortDescription, locale);
  const accent = product.accentColor ?? FALLBACK_ACCENT;
  const { options, variants } = pickerData(product, locale, messages);
  const images = productGalleryImages(product, locale);
  const categoryName = product.category ? localize(product.category.name, locale) : "";
  // Reviews (cached, tag reviews:<id>): the section, the stars under the name and the JSON-LD agree.
  const reviewBlock = await loadProductReviewBlock(product.id);

  const crumbs = [
    { label: messages.common.home, href: href(locale, "home") },
    { label: messages.nav.products, href: href(locale, "products") },
    ...(product.category ? [{ label: categoryName, href: href(locale, "category", { slug: product.category.slug }) }] : []),
    { label: name },
  ];

  return (
    <div className="product-scope relative isolate" style={productScopeStyle(accent, product.themeOverrides)}>
      <ProductStructuredData product={product} locale={locale} reviews={reviewBlock.data} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh] bg-linear-to-b from-product-soft/80 to-transparent" />

      <div className="container-x pt-6 md:pt-8">
        <Breadcrumbs items={crumbs} label={messages.nav.breadcrumb} siteUrl={siteOrigin()} />
      </div>

      <VariantProvider defaultVariantId={product.defaultVariantId} variantIds={variants.map((v) => v.id)}>
        <section className="container-x grid grid-cols-1 gap-10 pt-6 pb-16 md:pt-10 lg:grid-cols-12 lg:gap-16 lg:pb-24">
          <div className="min-w-0 lg:col-span-7">
            <div className="lg:sticky lg:top-24">
              <ProductGallery
                images={images}
                locale={locale}
                labels={{
                  gallery: m.gallery,
                  previous: messages.common.previous,
                  next: messages.common.next,
                  video: m.video,
                  play: m.playVideo,
                  pause: m.pauseVideo,
                }}
              />
            </div>
          </div>

          <div id={PURCHASE_ID} className="flex min-w-0 scroll-mt-28 flex-col gap-8 lg:col-span-5">
            <header>
              {/* The category eyebrow only when there is no type line: it would say the same thing twice. */}
              {heading.eyebrow && <p className="eyebrow mb-4 text-product-strong">{heading.eyebrow}</p>}
              {/* One heading, "Lavanta Sıvı El Sabunu": the name large, the type as the small line below it
                  (same look as the separate name and subtitle before). The space keeps the words apart. */}
              <h1 className="text-text">
                <span className="block font-heading text-5xl leading-[1.02] tracking-tight md:text-6xl">{name}</span>
                {heading.type && (
                  <>
                    {" "}
                    <span className="mt-3 block font-body text-sm font-normal uppercase tracking-[0.18em] text-pretty text-text-muted [font-feature-settings:normal]">
                      {heading.type}
                    </span>
                  </>
                )}
              </h1>
              {reviewBlock.data && <RatingLink summary={reviewBlock.data.summary} locale={locale} messages={messages} />}
              {shortDescription && <p className="mt-6 text-base leading-relaxed text-pretty text-text-muted md:text-lg">{shortDescription}</p>}
            </header>

            {variants.length > 0 && (
              <VariantPicker
                options={options}
                variants={variants}
                labels={{
                  selectOption: m.selectOption,
                  inStock: m.inStock,
                  lowStock: m.lowStock,
                  outOfStock: m.outOfStock,
                  sku: m.sku,
                  barcode: m.barcode,
                  vatIncluded: m.vatIncluded,
                }}
              />
            )}

            {/* B2B: the signed-in buyer's group price for the selected variant (client island). */}
            {variants.length > 0 && (
              <BusinessPrice variantIds={variants.map((v) => v.id)} locale={locale} regularPriceLabel={messages.campaign.regularPrice} />
            )}

            {/* Subscribe and save: "Tek seferlik / Abone ol" above the button (client island). */}
            <SubscriptionArea locale={locale} offer={subscriptionOffer(product, subscriptionPlans, subscriptionSettings, messages, locale)}>
              <AddToCartButton
                locale={locale}
                limits={purchaseLimits(product.variants)}
                labels={{
                  addToCart: m.addToCart,
                  adding: m.adding,
                  added: m.added,
                  outOfStock: m.outOfStock,
                  quantity: m.quantity,
                  increase: m.increase,
                  decrease: m.decrease,
                  maxReached: messages.cart.maxReached,
                  minRequired: messages.cart.issues.quantity_adjusted_min,
                  error: messages.cart.errors.generic,
                }}
              />
            </SubscriptionArea>

            {/* ACCOUNTS: favorite heart (client island; signed out → sign-in and back). */}
            <FavoriteButton productId={product.id} variant="detail" className="-mt-4 self-start" />

            <ul className="flex flex-col gap-3 text-sm text-text-muted">
              {shipping.freeThreshold > 0 && (
                <li className="flex items-start gap-3">
                  <Truck aria-hidden className="mt-0.5 size-4 shrink-0 text-product-strong" strokeWidth={1.5} />
                  <span>
                    {format(m.freeShippingOver, { amount: formatPrice(shipping.freeThreshold, locale) })}
                    {" · "}
                    {format(m.shipsIn, { min: shipping.estimatedDays.min, max: shipping.estimatedDays.max })}
                  </span>
                </li>
              )}
              {/* A package that alone passes the heavy-parcel limit (5 L / 20 L): say next to the
                  free-shipping line that the surcharge applies anyway. */}
              {shipping.heavy.enabled &&
                shipping.heavy.feePerKg > 0 &&
                product.variants.some((v) => (v.weightGrams ?? 0) > shipping.heavy.thresholdGrams) && (
                  <li className="flex items-start gap-3">
                    <Weight aria-hidden className="mt-0.5 size-4 shrink-0 text-product-strong" strokeWidth={1.5} />
                    <span>
                      {format(m.heavyShippingNote, {
                        kg: Math.round(shipping.heavy.thresholdGrams / 100) / 10,
                        amount: formatPrice(shipping.heavy.feePerKg, locale),
                      })}
                    </span>
                  </li>
                )}
              {b2b.enabled && (
                <li className="flex items-start gap-3">
                  <Building2 aria-hidden className="mt-0.5 size-4 shrink-0 text-product-strong" strokeWidth={1.5} />
                  <span>
                    <span className="text-text">{m.businessPrice}:</span> {messages.b2b.loginForPrices}{" "}
                    <Link href={href(locale, "business")} className="text-text underline decoration-product underline-offset-4 hover:decoration-2">
                      {messages.b2b.cta}
                    </Link>
                  </span>
                </li>
              )}
              {samples.requestFormEnabled && (
                <li className="flex items-start gap-3">
                  <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-product-strong" strokeWidth={1.5} />
                  <span>
                    {messages.sample.subtitle}{" "}
                    <Link href={href(locale, "samples")} className="text-text underline decoration-product underline-offset-4 hover:decoration-2">
                      {m.requestSample}
                    </Link>
                  </span>
                </li>
              )}
            </ul>

            <ClaimBadges claims={product.claims} labels={m.claims} />

            <ProductInfoAccordion panels={infoPanels(product, locale, messages)} locale={locale} />
          </div>
        </section>

        {variants.length > 1 && (
          <div className="border-t border-border bg-surface/60">
            <PackagingExplainer title={m.packaging} variants={variants} targetId={PURCHASE_ID} className="container-x py-16 md:py-20" />
          </div>
        )}
      </VariantProvider>

      <ProductReviews block={reviewBlock} productId={product.id} slug={product.slug} locale={locale} messages={messages} siteName={general.siteName} />

      {samples.requestFormEnabled && <SampleBand locale={locale} messages={messages} />}

      {product.related.length > 0 && (
        <section className="container-x py-16 md:py-24">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 md:mb-14">
            <h2 className="font-heading text-4xl text-text md:text-5xl">{m.related}</h2>
            {/* The other scents are in the grid; this links the whole category ("Sıvı El Sabunu →"). */}
            {product.category && categoryName && (
              <Link href={href(locale, "category", { slug: product.category.slug })} className={buttonClass("link")}>
                {categoryName}
                <ArrowRight
                  aria-hidden
                  className="size-4 transition-transform duration-300 group-hover/link:translate-x-1 rtl:-scale-x-100 rtl:group-hover/link:-translate-x-1"
                />
              </Link>
            )}
          </div>
          <ProductGrid products={product.related} locale={locale} fromLabel={m.from} regularPriceLabel={messages.campaign.regularPrice} />
        </section>
      )}
    </div>
  );
}

function infoPanels(product: ProductDetail, locale: Locale, messages: Messages): InfoPanel[] {
  const m = messages.product;
  const numberLocale = intlLocale(locale);
  const specs = product.specs
    .map((s) => ({ label: localize(s.label, locale), value: localize(s.value, locale) }))
    .filter((s) => s.label && s.value);
  const bundle = product.bundleItems.map((item) => ({
    label: [localize(item.productName, locale), localize(item.productSubtitle, locale)].filter(Boolean).join(" · "),
    value: [formatVolume(item.volumeMl, numberLocale), `× ${item.quantity}`].filter(Boolean).join(" "),
  }));
  return [
    { id: "description", title: m.description, text: localize(product.description, locale) },
    { id: "bundle", title: m.bundleIncludes, rows: bundle },
    { id: "usage", title: m.usage, text: localize(product.usage, locale) },
    { id: "ingredients", title: m.ingredients, mono: product.ingredients },
    { id: "warnings", title: m.warnings, text: localize(product.warnings, locale) },
    { id: "details", title: m.details, rows: specs },
  ];
}

function SampleBand({ locale, messages }: { locale: Locale; messages: Messages }) {
  return (
    <section className="border-y border-border">
      <div className="container-x flex flex-col items-start justify-between gap-6 py-12 md:flex-row md:items-center md:py-14">
        <div>
          <p className="eyebrow text-product-strong">{messages.b2b.subtitle}</p>
          <p className="mt-3 font-heading text-3xl text-text md:text-4xl">{messages.sample.title}</p>
          <p className="mt-2 max-w-xl text-text-muted">{messages.sample.description}</p>
        </div>
        <Link
          href={href(locale, "samples")}
          className="group/link inline-flex min-h-12 shrink-0 items-center gap-3 rounded-control border border-text/25 px-7 text-sm font-medium uppercase tracking-[0.14em] text-text transition-colors hover:border-product focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          {messages.sample.cta}
          <ArrowRight aria-hidden className="size-4 transition-transform group-hover/link:translate-x-1 rtl:-scale-x-100 rtl:group-hover/link:-translate-x-1" />
        </Link>
      </div>
    </section>
  );
}
