"use client";

// Shares the selected variant between the gallery, picker, packaging cards and add-to-cart button
// on the product page. The page stays static: the server always renders the default variant, and a
// `?varyant=<id>` link (merchant feed, structured data, a shared link) preselects that variant on the
// client after hydration. Choosing a variant writes the parameter back with history.replaceState, so
// the address can be shared as is; the canonical URL in the page head stays the clean product URL.
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { parseVariantParam, VARIANT_QUERY_PARAM } from "@/lib/seo/variant-url";

type VariantSelection = { selectedId: number | null; select: (id: number) => void };

const VariantContext = createContext<VariantSelection>({ selectedId: null, select: () => {} });

/** The `?varyant=` id in the current address (client only). */
function readUrlVariant(): number | null {
  return parseVariantParam(new URLSearchParams(window.location.search).get(VARIANT_QUERY_PARAM));
}

/** Back/forward can change the address without remounting the page. */
function subscribeToHistory(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/** The server render (and hydration) never sees the parameter: the static HTML is the same for every link. */
const noUrlVariant = (): number | null => null;

/**
 * The address with `?varyant=<id>` set, keeping its other parameters (e.g. utm_*) and hash, as a
 * path ("/tr/urunler/lavanta?varyant=5#satin-al"); null when it already names that variant. Pure.
 */
export function addressWithVariant(href: string, id: number): string | null {
  const url = new URL(href);
  if (url.searchParams.get(VARIANT_QUERY_PARAM) === String(id)) return null;
  url.searchParams.set(VARIANT_QUERY_PARAM, String(id));
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The visitor's choice, else a valid `?varyant=` link, else the product's default variant. Pure. */
export function resolveSelectedVariant(
  chosenId: number | null,
  urlId: number | null,
  variantIds: readonly number[],
  defaultVariantId: number | null,
): number | null {
  if (chosenId != null) return chosenId;
  return urlId != null && variantIds.includes(urlId) ? urlId : defaultVariantId;
}

/** Next.js integrates native history calls into its router (no navigation, no server request). */
function writeUrlVariant(id: number) {
  const next = addressWithVariant(window.location.href, id);
  if (next) window.history.replaceState(null, "", next);
}

export function VariantProvider({
  defaultVariantId,
  variantIds,
  children,
}: {
  defaultVariantId: number | null;
  /** The product's selectable variant ids: a `?varyant=` value outside this list is ignored. */
  variantIds: number[];
  children: ReactNode;
}) {
  const [chosenId, setChosenId] = useState<number | null>(null);
  const urlId = useSyncExternalStore(subscribeToHistory, readUrlVariant, noUrlVariant);
  const selectedId = resolveSelectedVariant(chosenId, urlId, variantIds, defaultVariantId);

  const select = useCallback((id: number) => {
    setChosenId(id);
    writeUrlVariant(id);
  }, []);

  const value = useMemo(() => ({ selectedId, select }), [selectedId, select]);
  return <VariantContext value={value}>{children}</VariantContext>;
}

export function useVariantSelection(): VariantSelection {
  return useContext(VariantContext);
}
