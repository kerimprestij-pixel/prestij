// Product reads for the panel list (uncached, all locales, drafts included).
// Callers are panel components that have already passed requireStaff().
import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ProductStatus, ProductType } from "@/db/schema/catalog";
import { localize } from "@/i18n/localize";
import type { MediaLike } from "@/lib/media/types";
import { foldText } from "@/lib/panel/format";
import { firstMediaByProduct, variantLabels } from "@/lib/panel/products/queries";

const { products: P, productVariants: V, categories: C } = schema;

export type ProductListStatus = "all" | ProductStatus | "low-stock";

export type ProductListQuery = {
  q: string;
  status: ProductListStatus;
  /** A category id, "none" (no category) or null (any). */
  category: number | "none" | null;
  type: ProductType | null;
};

export type PanelVariantRow = {
  id: number;
  sku: string;
  title: string;
  price: number;
  stock: number;
  trackStock: boolean;
  lowStockThreshold: number;
  isActive: boolean;
  isDefault: boolean;
  low: boolean;
};

export type PanelProductRow = {
  id: number;
  slug: string;
  type: ProductType;
  status: ProductStatus;
  name: string;
  subtitle: string;
  accentColor: string | null;
  categoryId: number | null;
  categoryName: string | null;
  thumbnail: MediaLike | null;
  /** Active variants. */
  variantCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  totalStock: number;
  lowStockVariants: number;
  variants: PanelVariantRow[];
};

export type PanelProductList = {
  rows: PanelProductRow[];
  /** Products per status tab (ignoring the other filters). */
  counts: Record<ProductListStatus, number>;
  /** Total products (no filter at all): drag reorder is offered only on the full list. */
  total: number;
  filtered: boolean;
};

export async function listPanelProducts(query: ProductListQuery): Promise<PanelProductList> {
  const rows = await db
    .select({
      id: P.id,
      slug: P.slug,
      type: P.type,
      status: P.status,
      name: P.name,
      subtitle: P.subtitle,
      accentColor: P.accentColor,
      categoryId: P.categoryId,
      categoryName: C.name,
    })
    .from(P)
    .leftJoin(C, eq(C.id, P.categoryId))
    .orderBy(asc(P.position), asc(P.id));
  const ids = rows.map((r) => r.id);
  const [variants, thumbs] = await Promise.all([
    ids.length
      ? db
          .select({
            id: V.id,
            productId: V.productId,
            sku: V.sku,
            barcode: V.barcode,
            price: V.price,
            stock: V.stock,
            trackStock: V.trackStock,
            lowStockThreshold: V.lowStockThreshold,
            isActive: V.isActive,
            isDefault: V.isDefault,
            volumeMl: V.volumeMl,
          })
          .from(V)
          .where(inArray(V.productId, ids))
          .orderBy(asc(V.productId), asc(V.position), asc(V.id))
      : Promise.resolve([]),
    firstMediaByProduct(db, ids),
  ]);
  const labels = await variantLabels(
    db,
    variants.map((v) => v.id),
  );

  const all: (PanelProductRow & { search: string })[] = rows.map((r) => {
    const own = variants.filter((v) => v.productId === r.id);
    const active = own.filter((v) => v.isActive);
    const prices = active.map((v) => v.price);
    const variantRows: PanelVariantRow[] = own.map((v) => ({
      id: v.id,
      sku: v.sku,
      title: labels.get(v.id) || (v.volumeMl ? `${v.volumeMl} ml` : ""),
      price: v.price,
      stock: v.stock,
      trackStock: v.trackStock,
      lowStockThreshold: v.lowStockThreshold,
      isActive: v.isActive,
      isDefault: v.isDefault,
      low: v.isActive && v.trackStock && v.stock <= v.lowStockThreshold,
    }));
    const names = [r.name.tr, r.name.en, r.name.ar, r.subtitle?.tr, r.subtitle?.en, r.slug, ...own.flatMap((v) => [v.sku, v.barcode ?? ""])];
    return {
      id: r.id,
      slug: r.slug,
      type: r.type,
      status: r.status,
      name: localize(r.name, "tr"),
      subtitle: localize(r.subtitle, "tr"),
      accentColor: r.accentColor,
      categoryId: r.categoryId,
      categoryName: r.categoryName ? localize(r.categoryName, "tr") : null,
      thumbnail: thumbs.get(r.id) ?? null,
      variantCount: active.length,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      totalStock: active.filter((v) => v.trackStock).reduce((sum, v) => sum + v.stock, 0),
      lowStockVariants: variantRows.filter((v) => v.low).length,
      variants: variantRows,
      search: foldText(names.filter(Boolean).join(" ").toLocaleLowerCase("tr-TR")).toLowerCase(),
    };
  });

  const term = foldText(query.q.trim().toLocaleLowerCase("tr-TR")).toLowerCase();
  const base = all.filter(
    (p) =>
      (!term || p.search.includes(term)) &&
      (query.category === null || (query.category === "none" ? p.categoryId === null : p.categoryId === query.category)) &&
      (query.type === null || p.type === query.type),
  );
  const isLow = (p: PanelProductRow) => p.lowStockVariants > 0 && p.status !== "archived";
  const counts: Record<ProductListStatus, number> = {
    all: base.length,
    active: base.filter((p) => p.status === "active").length,
    draft: base.filter((p) => p.status === "draft").length,
    archived: base.filter((p) => p.status === "archived").length,
    "low-stock": base.filter(isLow).length,
  };
  const filteredRows = base.filter((p) => (query.status === "all" ? true : query.status === "low-stock" ? isLow(p) : p.status === query.status));
  return {
    rows: filteredRows.map(({ search: _s, ...p }) => p),
    counts,
    total: all.length,
    filtered: Boolean(term) || query.category !== null || query.type !== null || query.status !== "all",
  };
}
