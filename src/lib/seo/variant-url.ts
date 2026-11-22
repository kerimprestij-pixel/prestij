// Links to one variant of a product: the product page plus `?varyant=<variant id>`. Used by the merchant
// feed (`link`), the ProductGroup structured data (`hasVariant[].url`) and the product page's variant
// picker (preselect from the URL, `history.replaceState` on change). The page itself stays static and its
// canonical stays the clean product URL; the parameter is read on the client only.
// Pure (no DB, no Next APIs): safe in client components and unit tests.
import type { Locale } from "@/i18n/config";
import { absoluteUrl, href } from "@/i18n/paths";

/** The query parameter that names the preselected variant (same name in every locale). */
export const VARIANT_QUERY_PARAM = "varyant";

const isVariantId = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/**
 * Public path of a product page with a variant preselected:
 * `variantPath("en", "lavanta", 12)` → `"/en/products/lavanta?varyant=12"`.
 * A variant id that is not a positive integer gives the plain product path (never `?varyant=NaN`).
 */
export function variantPath(locale: Locale, slug: string, variantId: number): string {
  const path = href(locale, "product", { slug });
  return isVariantId(variantId) ? `${path}?${VARIANT_QUERY_PARAM}=${variantId}` : path;
}

/** Absolute URL of `variantPath` (feed links, structured data): `"https://…/tr/urunler/lavanta?varyant=12"`. */
export function variantUrl(locale: Locale, slug: string, variantId: number): string {
  return absoluteUrl(variantPath(locale, slug, variantId));
}

/**
 * The variant id in a `?varyant=` value, or null when it is missing or not a plain positive integer.
 * Accepts what the APIs hand you: `URLSearchParams.get()` (string | null), a Next `searchParams` entry
 * (string | string[] | undefined; the first value counts). Only digits are accepted ("12"; not " 12",
 * "1e3", "0x1f", "12abc", "-3", "0"). The caller still checks that the id belongs to the product.
 * `const id = parseVariantParam(new URLSearchParams(location.search).get(VARIANT_QUERY_PARAM));`
 */
export function parseVariantParam(value: string | readonly string[] | null | undefined): number | null {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
  if (typeof raw !== "string" || !/^[1-9]\d{0,14}$/.test(raw)) return null;
  const id = Number(raw);
  return isVariantId(id) ? id : null;
}
