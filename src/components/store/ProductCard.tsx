// Product tile for grids. Pure (no hooks), so it renders on the server and inside client trees.
import Link from "next/link";
import FavoriteButton from "@/components/store/account/FavoriteButton";
import BusinessCardPrice from "@/components/store/b2b/BusinessCardPrice";
import { productCardImageAlt } from "@/components/store/product-heading";
import CardRating, { type CardRatingLabels } from "@/components/store/reviews/CardRating";
import type { Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import { campaignBadgeText } from "@/lib/campaigns/display";
import { campaignDisplayPrice } from "@/lib/campaigns/pick";
import type { ProductCardData } from "@/lib/data/catalog";
import Img from "@/lib/media/Img";
import { formatPrice } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";

export const PRODUCT_CARD_SIZES = "(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 48vw";

export default function ProductCard({
  product,
  locale,
  fromLabel,
  regularPriceLabel,
  sizes = PRODUCT_CARD_SIZES,
  preload = false,
  ratingLabels = null,
  className,
}: {
  product: ProductCardData;
  locale: Locale;
  /** messages.product.from, shown when variants have different prices. */
  fromLabel: string;
  /** messages.campaign.regularPrice: read before the struck-through price (strikethrough is not announced). */
  regularPriceLabel: string;
  sizes?: string;
  preload?: boolean;
  /** Screen-reader texts of the review stars; null/omitted = no stars (reviews switched off). */
  ratingLabels?: CardRatingLabels | null;
  className?: string;
}) {
  const name = localize(product.name, locale);
  const subtitle = localize(product.subtitle, locale);
  const hasRange = product.minPrice != null && product.maxPrice != null && product.maxPrice > product.minPrice;
  // The cheapest variant's price as the cart charges it (retail campaign applied, same rounding).
  const shown =
    product.minPrice != null
      ? campaignDisplayPrice({ price: product.minPrice, compareAtPrice: product.compareAtPrice }, product.campaign?.percent)
      : null;
  const badge = product.campaign ? campaignBadgeText(product.campaign, locale) : null;

  return (
    <article className={cn("group relative", className)}>
      <Link
        href={href(locale, "product", { slug: product.slug })}
        className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <div
          className="relative aspect-[4/5] overflow-hidden rounded-md bg-surface-2"
          style={product.image?.dominantColor ? { backgroundColor: product.image.dominantColor } : undefined}
        >
          {product.image && (
            // The alt (name + type) is for image search; screen readers skip the photo, because the link
            // already reads the type line and the name right after it.
            <div
              aria-hidden
              className="absolute inset-0 transition-transform duration-[1200ms] ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            >
              <Img media={product.image} alt={productCardImageAlt(product, locale)} locale={locale} sizes={sizes} fill preload={preload} />
            </div>
          )}
          {product.hoverImage && (
            // Hover-only second photo: not displayed (so the lazy image is never fetched) unless the device
            // has a real hover pointer; there it fades in exactly as before.
            <div className="absolute inset-0 hidden opacity-0 transition-opacity duration-700 ease-out can-hover:block group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
              <Img media={product.hoverImage} alt="" locale={locale} sizes={sizes} fill placeholder={false} />
            </div>
          )}
          {badge && (
            <span className="absolute start-3 top-3 z-10 inline-flex max-w-[calc(100%-4.5rem)] items-center rounded-full bg-gold px-3 py-1 text-[0.6875rem] font-medium uppercase leading-tight tracking-[0.12em] text-gold-contrast shadow-sm">
              <span className="truncate">{badge}</span>
            </span>
          )}
          {product.accentColor && (
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 rtl:origin-right transition-transform duration-700 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
              style={{ backgroundColor: product.accentColor }}
            />
          )}
        </div>

        <div className="mt-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {subtitle && <p className="eyebrow mb-2 truncate">{subtitle}</p>}
            <h3 className="font-heading text-2xl leading-tight text-text md:text-[1.7rem]">{name}</h3>
          </div>
          {product.accentColor && (
            <span
              aria-hidden
              className="mt-1.5 size-3 shrink-0 rounded-full ring-1 ring-black/10 ring-offset-2 ring-offset-bg"
              style={{ backgroundColor: product.accentColor }}
            />
          )}
        </div>

        {ratingLabels && <CardRating average={product.ratingAverage} count={product.ratingCount} locale={locale} labels={ratingLabels} />}

        {shown && (
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm text-text-muted">
            {hasRange && <span className="text-xs uppercase tracking-[0.12em]">{fromLabel}</span>}
            <span className={cn("tabular-nums text-text", product.campaign && "font-medium")}>{formatPrice(shown.unitPrice, locale)}</span>
            {shown.compareAt != null && (
              <s className="tabular-nums">
                <span className="sr-only">{regularPriceLabel}: </span>
                {formatPrice(shown.compareAt, locale)}
              </s>
            )}
          </p>
        )}
        {/* B2B: the signed-in buyer's group price (client island; nothing for retail visitors). */}
        {shown && <BusinessCardPrice productId={product.id} locale={locale} fromLabel={fromLabel} />}
      </Link>
      {/* ACCOUNTS: the favorite heart (client island over the image; outside the link). */}
      <FavoriteButton productId={product.id} productName={name} className="absolute end-3 top-3 z-20" />
    </article>
  );
}
