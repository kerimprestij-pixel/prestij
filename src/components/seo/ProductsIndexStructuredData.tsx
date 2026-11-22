// /urunler: a CollectionPage with the ItemList of every listed product. Server component, no data reads
// of its own. Placed in src/app/[locale]/urunler/page.tsx (CORE); the body is SEO-TECH's.
import type { Locale } from "@/i18n/config";
import { href } from "@/i18n/paths";
import type { ProductCardData } from "@/lib/data/catalog";
import { collectionPageJsonLd } from "@/lib/seo/structured-data";
import JsonLdScript from "./JsonLdScript";

export type ProductsIndexStructuredDataProps = {
  locale: Locale;
  /** The page title as shown (the H1). */
  name: string;
  /** The page's description, when it has one ("" or null = none). */
  description?: string | null;
  /** The products in grid order. */
  products: ProductCardData[];
};

export default function ProductsIndexStructuredData({ locale, name, description, products }: ProductsIndexStructuredDataProps) {
  return <JsonLdScript data={collectionPageJsonLd({ locale, name, description, path: href(locale, "products"), products })} />;
}
