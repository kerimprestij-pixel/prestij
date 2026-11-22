// Category page: a CollectionPage with the ItemList of the products in the grid. Server component, no
// data reads of its own. Placed in src/app/[locale]/kategori/[slug]/page.tsx (CORE); the body is
// SEO-TECH's. (The category's FAQPage comes from the Faq section STORE-UI renders, not from here.)
import type { Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import type { CategoryData, ProductCardData } from "@/lib/data/catalog";
import { seoText } from "@/lib/seo/localized";
import { collectionPageJsonLd } from "@/lib/seo/structured-data";
import JsonLdScript from "./JsonLdScript";

export type CategoryStructuredDataProps = {
  category: CategoryData;
  /** The products in grid order (what the page lists). */
  products: ProductCardData[];
  locale: Locale;
};

export default function CategoryStructuredData({ category, products, locale }: CategoryStructuredDataProps) {
  return (
    <JsonLdScript
      data={collectionPageJsonLd({
        locale,
        name: localize(category.name, locale),
        description: seoText(category.seo?.description, locale, localize(category.description, locale)),
        path: href(locale, "category", { slug: category.slug }),
        products,
      })}
    />
  );
}
