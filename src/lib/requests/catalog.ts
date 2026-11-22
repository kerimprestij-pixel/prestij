// Products the quote and sample forms offer (cached, so /kurumsal and /numune stay static). Takes no
// arguments on purpose: Next registers every "use cache" function as a callable server reference, so
// it returns only what is public anyway (active, listable, never business-only or sample products).
// The sections pick and order their own subset from it.
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import type { LocalizedText, ProductType } from "@/db/schema";
import { TAGS } from "@/lib/cache-tags";
import { imageOnly, mediaColumns } from "@/lib/data/media";
import type { MediaLike } from "@/lib/media/types";
import type { Tx } from "@/lib/panel/tx";

export type RequestCatalogVariant = {
  id: number;
  sku: string;
  /** Option value labels in option order, e.g. [{ tr: "5 L Bidon", en: "5 L Canister" }]. */
  labels: LocalizedText[];
  volumeMl: number | null;
};

export type RequestCatalogProduct = {
  id: number;
  slug: string;
  type: ProductType;
  name: LocalizedText;
  subtitle: LocalizedText | null;
  accentColor: string | null;
  image: MediaLike | null;
  variants: RequestCatalogVariant[];
};

const OFFERED_TYPES: ProductType[] = ["standard", "bundle"];

export async function getRequestCatalog(): Promise<RequestCatalogProduct[]> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.products, TAGS.media);
  return loadRequestCatalog();
}

/** Uncached read (also used by the services to re-check submitted ids). */
export async function loadRequestCatalog(executor: Tx = db): Promise<RequestCatalogProduct[]> {
  const { products: p, productVariants: v, variantOptionValues: vov, productOptionValues: ov, productOptions: o, productMedia: pm } = schema;
  const rows = await executor
    .select({ id: p.id, slug: p.slug, type: p.type, name: p.name, subtitle: p.subtitle, accentColor: p.accentColor })
    .from(p)
    .where(and(eq(p.status, "active"), inArray(p.type, OFFERED_TYPES), eq(p.businessOnly, false)))
    .orderBy(asc(p.position), asc(p.id));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [variants, media] = await Promise.all([
    executor
      .select({ id: v.id, productId: v.productId, sku: v.sku, volumeMl: v.volumeMl })
      .from(v)
      .where(and(inArray(v.productId, ids), eq(v.isActive, true)))
      .orderBy(asc(v.productId), asc(v.position), asc(v.id)),
    executor
      .select({ productId: pm.productId, variantId: pm.variantId, role: pm.role, media: mediaColumns })
      .from(pm)
      .innerJoin(schema.media, eq(pm.mediaId, schema.media.id))
      // Images only (day 6): a product video never becomes a form thumbnail.
      .where(and(inArray(pm.productId, ids), imageOnly()))
      .orderBy(asc(pm.productId), asc(pm.position), asc(pm.id)),
  ]);

  const labels = new Map<number, LocalizedText[]>();
  if (variants.length) {
    const links = await executor
      .select({ variantId: vov.variantId, value: ov.value })
      .from(vov)
      .innerJoin(ov, eq(ov.id, vov.optionValueId))
      .innerJoin(o, eq(o.id, ov.optionId))
      .where(
        inArray(
          vov.variantId,
          variants.map((x) => x.id),
        ),
      )
      .orderBy(asc(vov.variantId), asc(o.position), asc(o.id));
    for (const l of links) labels.set(l.variantId, [...(labels.get(l.variantId) ?? []), l.value]);
  }

  return rows
    .map((r) => {
      const own = media.filter((m) => m.productId === r.id);
      const shared = own.filter((m) => m.variantId == null);
      const pool = shared.length ? shared : own;
      const image = (pool.find((m) => m.role === "packshot") ?? pool[0])?.media ?? null;
      return {
        ...r,
        image,
        variants: variants
          .filter((x) => x.productId === r.id)
          .map((x) => ({ id: x.id, sku: x.sku, labels: labels.get(x.id) ?? [], volumeMl: x.volumeMl })),
      };
    })
    .filter((r) => r.variants.length > 0);
}

/** The catalog limited to `ids` in that order (unknown ids skipped); every product when `ids` is empty. */
export function pickCatalogProducts<T extends { id: number }>(catalog: T[], ids: readonly number[]): T[] {
  if (ids.length === 0) return catalog;
  const byId = new Map(catalog.map((p) => [p.id, p]));
  return [...new Set(ids)].map((id) => byId.get(id)).filter((p): p is T => p !== undefined);
}
