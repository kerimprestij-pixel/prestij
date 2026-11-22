// Grid of product cards (server component: it reads the cached review settings and texts for the card
// stars, so callers stay unchanged and the pages stay static).
import type { Locale } from "@/i18n/config";
import type { ProductCardData } from "@/lib/data/catalog";
import { cardRatingLabels } from "@/lib/reviews/page-data";
import { cn } from "@/lib/utils";
import ProductCard from "./ProductCard";

export default async function ProductGrid({
  products,
  locale,
  fromLabel,
  regularPriceLabel,
  columns = 4,
  preloadFirst = 0,
  className,
}: {
  products: ProductCardData[];
  locale: Locale;
  fromLabel: string;
  regularPriceLabel: string;
  columns?: 3 | 4;
  /** Preload the first N images (above-the-fold listings). */
  preloadFirst?: number;
  className?: string;
}) {
  const sizes =
    columns === 3
      ? "(min-width: 1024px) 30vw, (min-width: 640px) 46vw, 92vw"
      : "(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw";
  const ratingLabels = await cardRatingLabels(locale);
  return (
    <ul
      className={cn(
        "grid gap-x-5 gap-y-12 md:gap-x-8 md:gap-y-16",
        columns === 3 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-4",
        className,
      )}
    >
      {products.map((product, i) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            locale={locale}
            fromLabel={fromLabel}
            regularPriceLabel={regularPriceLabel}
            sizes={sizes}
            preload={i < preloadFirst}
            ratingLabels={ratingLabels}
          />
        </li>
      ))}
    </ul>
  );
}
