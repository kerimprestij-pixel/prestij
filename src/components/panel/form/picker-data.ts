// Session caches for picker data loaded through CORE-SERVER's server functions (one request per
// page view, shared by every picker on the page). Client-only module.
import { useEffect, useSyncExternalStore } from "react";
import { linkTargets, pickerCategories, pickerProducts, type LinkTargetGroup, type PickerCategory, type PickerProduct } from "@/lib/panel/pickers";

export type { LinkTargetGroup, PickerCategory, PickerProduct };

let linkTargetsPromise: Promise<LinkTargetGroup[]> | null = null;
let categoriesPromise: Promise<PickerCategory[]> | null = null;
let productsPromise: Promise<PickerProduct[]> | null = null;

function cached<T>(get: () => Promise<T> | null, set: (p: Promise<T> | null) => void, load: () => Promise<T>, force: boolean): Promise<T> {
  const existing = get();
  if (existing && !force) return existing;
  const promise = load().catch((error: unknown) => {
    set(null);
    throw error;
  });
  set(promise);
  return promise;
}

/** Internal link targets (static routes, products, categories, pages, legal pages, blog posts). */
export function loadLinkTargets(force = false): Promise<LinkTargetGroup[]> {
  return cached(() => linkTargetsPromise, (p) => (linkTargetsPromise = p), () => linkTargets(), force);
}

export function loadCategories(force = false): Promise<PickerCategory[]> {
  return cached(() => categoriesPromise, (p) => (categoriesPromise = p), () => pickerCategories(), force);
}

// Products seen so far (first page, searches, page-provided items) by id, for names of selected ids.
const products = new Map<number, PickerProduct>();
const productListeners = new Set<() => void>();
let productVersion = 0;

export function rememberProducts(list: readonly PickerProduct[]): void {
  let changed = false;
  for (const p of list) {
    if (products.get(p.id) !== p) {
      products.set(p.id, p);
      changed = true;
    }
  }
  if (changed) {
    productVersion++;
    for (const listener of productListeners) listener();
  }
}

/** First page of products (no query), cached for the page view. */
export function loadAllProducts(force = false): Promise<PickerProduct[]> {
  return cached(
    () => productsPromise,
    (p) => (productsPromise = p),
    () =>
      pickerProducts().then((list) => {
        rememberProducts(list);
        return list;
      }),
    force,
  );
}

/** Search by name, slug, SKU or barcode (not cached; results are remembered for lookups). */
export async function searchProducts(q: string): Promise<PickerProduct[]> {
  const list = q.trim() ? await pickerProducts(q) : await loadAllProducts();
  rememberProducts(list);
  return list;
}

/** Product for an id: known item, remembered product, or undefined (unknown). */
export function useProductLookup(ids: readonly number[], known?: readonly PickerProduct[]): (id: number) => PickerProduct | undefined {
  useSyncExternalStore(
    (listener) => {
      productListeners.add(listener);
      return () => productListeners.delete(listener);
    },
    () => productVersion,
    () => 0,
  );
  const key = ids.join(",");
  useEffect(() => {
    if (known?.length) rememberProducts(known);
    if (key) loadAllProducts().catch(() => undefined);
    // Re-run when the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (id: number) => known?.find((p) => p.id === id) ?? products.get(id);
}

/** Label for a stored href when it matches a known target ("Ürünler · Lavanta"). */
export function findLinkTarget(groups: LinkTargetGroup[] | null, href: string): { group: string; label: string } | null {
  if (!groups || !href) return null;
  const normalized = href.replace(/\/+$/, "") || "/";
  for (const group of groups) {
    for (const item of group.items) {
      if ((item.href.replace(/\/+$/, "") || "/") === normalized) return { group: group.label, label: item.label };
    }
  }
  return null;
}
