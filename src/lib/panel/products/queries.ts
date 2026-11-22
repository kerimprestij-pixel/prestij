// Product reads for the panel editor (uncached, drafts included). Every function takes an executor so
// the service can reuse them inside its transaction (and DB tests can call them directly). Callers
// have checked the role.
import "server-only";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import { localize } from "@/i18n/localize";
import { imageOnly } from "@/lib/data/media";
import { getPanelMedia } from "@/lib/panel/media/queries";
import type { Tx } from "@/lib/panel/tx";
import {
  keyOf,
  type BundleVariantChoice,
  type CustomerGroupOption,
  type OptionState,
  type ProductEditorContext,
  type ProductEditorState,
} from "./types";

const P = schema.products;
const O = schema.productOptions;
const OV = schema.productOptionValues;
const V = schema.productVariants;
const VOV = schema.variantOptionValues;
const PM = schema.productMedia;
const TP = schema.tierPrices;
const GP = schema.groupPrices;
const BI = schema.bundleItems;
const PR = schema.productRelations;

const tr = (text: LocalizedText | null | undefined) => localize(text, "tr");

/** The whole product as editor state, or null when it does not exist. */
export async function loadProductState(ex: Tx, id: number): Promise<ProductEditorState | null> {
  const [row] = await ex.select().from(P).where(eq(P.id, id)).limit(1);
  if (!row) return null;

  const [options, variants, media, bundle, related] = await Promise.all([
    ex.select().from(O).where(eq(O.productId, id)).orderBy(asc(O.position), asc(O.id)),
    ex.select().from(V).where(eq(V.productId, id)).orderBy(asc(V.position), asc(V.id)),
    ex.select().from(PM).where(eq(PM.productId, id)).orderBy(asc(PM.position), asc(PM.id)),
    ex.select().from(BI).where(eq(BI.bundleProductId, id)).orderBy(asc(BI.position), asc(BI.id)),
    ex
      .select({ id: PR.relatedProductId })
      .from(PR)
      .where(and(eq(PR.productId, id), eq(PR.kind, "related")))
      .orderBy(asc(PR.position), asc(PR.relatedProductId)),
  ]);
  const optionIds = options.map((o) => o.id);
  const variantIds = variants.map((v) => v.id);

  const [values, links, tiers, groupPrices] = await Promise.all([
    optionIds.length ? ex.select().from(OV).where(inArray(OV.optionId, optionIds)).orderBy(asc(OV.position), asc(OV.id)) : Promise.resolve([]),
    variantIds.length ? ex.select().from(VOV).where(inArray(VOV.variantId, variantIds)) : Promise.resolve([]),
    ex
      .select()
      .from(TP)
      .where(variantIds.length ? or(eq(TP.productId, id), inArray(TP.variantId, variantIds)) : eq(TP.productId, id))
      .orderBy(asc(TP.id)),
    variantIds.length ? ex.select().from(GP).where(inArray(GP.variantId, variantIds)) : Promise.resolve([]),
  ]);

  const optionState: OptionState[] = options.map((o) => ({
    key: keyOf.option(o.id),
    id: o.id,
    name: o.name,
    display: o.display,
    values: values
      .filter((v) => v.optionId === o.id)
      .map((v) => ({
        key: keyOf.value(v.id),
        id: v.id,
        value: v.value,
        swatchColor: v.swatchColor ?? "",
        swatchMediaId: v.swatchMediaId,
      })),
  }));
  // Option value keys of a variant, in option order (stable state for dirty checks).
  const valueOrder = new Map<number, number>();
  optionState.forEach((o, oi) => o.values.forEach((v) => valueOrder.set(v.id!, oi * 1000 + o.values.indexOf(v))));
  const variantPosition = new Map(variants.map((v, i) => [v.id, i]));

  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    slug: row.slug,
    type: row.type,
    status: row.status,
    name: row.name,
    subtitle: row.subtitle ?? null,
    shortDescription: row.shortDescription ?? null,
    description: row.description ?? null,
    categoryId: row.categoryId,
    isFeatured: row.isFeatured,
    businessOnly: row.businessOnly,
    allowSubscription: row.allowSubscription,
    accentColor: row.accentColor ?? "",
    tint: row.themeOverrides?.tint ?? "",
    tintDark: row.themeOverrides?.dark ?? "",
    scentTop: row.scentNotes?.top ?? null,
    scentHeart: row.scentNotes?.heart ?? null,
    scentBase: row.scentNotes?.base ?? null,
    usage: row.usage ?? null,
    warnings: row.warnings ?? null,
    ingredients: row.ingredients ?? "",
    claims: row.claims ?? [],
    specs: (row.specs ?? []).map((s) => ({ label: s.label, value: s.value })),
    seo: {
      title: row.seo?.title ?? null,
      description: row.seo?.description ?? null,
      ogImageId: row.seo?.ogImageId ?? null,
      noIndex: row.seo?.noIndex ?? false,
    },
    options: optionState,
    variants: variants.map((v) => ({
      key: keyOf.variant(v.id),
      id: v.id,
      sku: v.sku,
      barcode: v.barcode ?? "",
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      costPrice: v.costPrice,
      vatRate: v.vatRate,
      stock: v.stock,
      stockSeen: v.stock,
      trackStock: v.trackStock,
      allowBackorder: v.allowBackorder,
      lowStockThreshold: v.lowStockThreshold,
      volumeMl: v.volumeMl,
      weightGrams: v.weightGrams,
      desi: v.desi,
      minQuantity: v.minQuantity,
      maxQuantity: v.maxQuantity,
      imageId: v.imageId,
      isDefault: v.isDefault,
      isActive: v.isActive,
      optionValueKeys: links
        .filter((l) => l.variantId === v.id)
        .sort((a, b) => (valueOrder.get(a.optionValueId) ?? 0) - (valueOrder.get(b.optionValueId) ?? 0))
        .map((l) => keyOf.value(l.optionValueId)),
    })),
    media: media.map((m) => ({
      key: keyOf.media(m.id),
      id: m.id,
      mediaId: m.mediaId,
      role: m.role,
      variantKey: m.variantId != null && variantPosition.has(m.variantId) ? keyOf.variant(m.variantId) : null,
      autoplay: m.autoplay,
    })),
    tiers: tiers
      .filter((t) => t.variantId == null || variantPosition.has(t.variantId))
      .map((t) => ({
        key: keyOf.tier(t.id),
        variantKey: t.variantId != null ? keyOf.variant(t.variantId) : null,
        groupId: t.groupId,
        minQuantity: t.minQuantity,
        discountPercent: t.discountPercent,
      })),
    groupPrices: groupPrices
      .sort((a, b) => (variantPosition.get(a.variantId) ?? 0) - (variantPosition.get(b.variantId) ?? 0) || a.groupId - b.groupId)
      .map((g) => ({ key: keyOf.groupPrice(g.variantId, g.groupId), variantKey: keyOf.variant(g.variantId), groupId: g.groupId, price: g.price })),
    bundleItems: bundle.map((b) => ({ key: keyOf.bundle(b.id), variantId: b.variantId, quantity: b.quantity })),
    relatedIds: related.map((r) => r.id),
  };
}

/** Variant ids of a product that an order, a cart or another product's bundle references. */
export async function referencedVariantIds(ex: Tx, productId: number): Promise<Set<number>> {
  const rows = await ex.execute<{ id: number }>(sql`
    select v.id from product_variants v
    where v.product_id = ${productId} and (
      exists (select 1 from order_items oi where oi.variant_id = v.id)
      or exists (select 1 from cart_items ci where ci.variant_id = v.id)
      or exists (select 1 from bundle_items bi where bi.variant_id = v.id and bi.bundle_product_id <> v.product_id)
    )`);
  return new Set(rows.map((r) => Number(r.id)));
}

/** True when any order line belongs to the product (by snapshot product id or by one of its variants). */
export async function productInOrders(ex: Tx, productId: number): Promise<boolean> {
  const rows = await ex.execute<{ found: boolean }>(sql`
    select exists (
      select 1 from order_items oi
      where (oi.snapshot->>'productId') = ${String(productId)}
         or oi.variant_id in (select id from product_variants where product_id = ${productId})
    ) as found`);
  return Boolean(rows[0]?.found);
}

/** Other bundles that contain one of the product's variants. */
export async function bundlesUsingProduct(ex: Tx, productId: number): Promise<{ id: number; name: string }[]> {
  const rows = await ex
    .selectDistinct({ id: P.id, name: P.name })
    .from(BI)
    .innerJoin(V, eq(V.id, BI.variantId))
    .innerJoin(P, eq(P.id, BI.bundleProductId))
    .where(and(eq(V.productId, productId), ne(BI.bundleProductId, productId)));
  return rows.map((r) => ({ id: r.id, name: tr(r.name) }));
}

export async function listCustomerGroups(ex: Tx = db): Promise<CustomerGroupOption[]> {
  const g = schema.customerGroups;
  const rows = await ex.select({ id: g.id, name: g.name, isBusiness: g.isBusiness, discountPercent: g.discountPercent }).from(g).orderBy(asc(g.id));
  return rows.map((r) => ({ id: r.id, name: tr(r.name), isBusiness: r.isBusiness, discountPercent: r.discountPercent }));
}

/** "Pompalı Şişe 500 ml · Cam" per variant id (Turkish), for any set of variants. */
export async function variantLabels(ex: Tx, variantIds: number[]): Promise<Map<number, string>> {
  if (variantIds.length === 0) return new Map();
  const rows = await ex
    .select({ variantId: VOV.variantId, value: OV.value, optionPosition: O.position, optionId: O.id })
    .from(VOV)
    .innerJoin(OV, eq(OV.id, VOV.optionValueId))
    .innerJoin(O, eq(O.id, OV.optionId))
    .where(inArray(VOV.variantId, variantIds))
    .orderBy(asc(O.position), asc(O.id));
  const out = new Map<number, string[]>();
  for (const r of rows) out.set(r.variantId, [...(out.get(r.variantId) ?? []), tr(r.value)]);
  return new Map([...out].map(([id, parts]) => [id, parts.filter(Boolean).join(" · ")]));
}

/** Variants a bundle may contain: every variant of a non-bundle product other than `exceptProductId`. */
export async function bundleVariantChoices(ex: Tx, exceptProductId: number): Promise<BundleVariantChoice[]> {
  const rows = await ex
    .select({
      id: V.id,
      productId: P.id,
      productName: P.name,
      productStatus: P.status,
      sku: V.sku,
      isActive: V.isActive,
      volumeMl: V.volumeMl,
    })
    .from(V)
    .innerJoin(P, eq(P.id, V.productId))
    .where(and(ne(P.type, "bundle"), ne(P.id, exceptProductId)))
    .orderBy(sql`case ${P.status} when 'active' then 0 when 'draft' then 1 else 2 end`, asc(P.position), asc(P.id), asc(V.position), asc(V.id));
  const labels = await variantLabels(
    ex,
    rows.map((r) => r.id),
  );
  const thumbs = await firstMediaByProduct(ex, [...new Set(rows.map((r) => r.productId))]);
  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    productName: tr(r.productName),
    productStatus: r.productStatus,
    label: labels.get(r.id) || (r.volumeMl ? `${r.volumeMl} ml` : r.sku),
    sku: r.sku,
    isActive: r.isActive,
    thumb: thumbs.get(r.productId) ?? null,
  }));
}

/**
 * First image (by position) of each product. Day 6: images only, filtered inside the DISTINCT ON query,
 * so a product whose first gallery row is a video still gets its first image as the thumbnail.
 */
export async function firstMediaByProduct(ex: Tx, productIds: number[]) {
  const out = new Map<number, Awaited<ReturnType<typeof getPanelMedia>>[number]>();
  if (productIds.length === 0) return out;
  const rows = await ex
    .selectDistinctOn([PM.productId], { productId: PM.productId, mediaId: PM.mediaId })
    .from(PM)
    .innerJoin(schema.media, eq(schema.media.id, PM.mediaId))
    .where(and(inArray(PM.productId, productIds), imageOnly()))
    .orderBy(PM.productId, asc(PM.position), asc(PM.id));
  const media = await getPanelMedia(
    rows.map((r) => r.mediaId),
    ex,
  );
  const byId = new Map(media.map((m) => [m.id, m]));
  for (const r of rows) {
    const m = byId.get(r.mediaId);
    if (m) out.set(r.productId, m);
  }
  return out;
}

/** Every media id the editor state shows. */
export function mediaIdsOfState(state: ProductEditorState): number[] {
  const ids = new Set<number>();
  for (const m of state.media) ids.add(m.mediaId);
  for (const v of state.variants) if (v.imageId) ids.add(v.imageId);
  for (const o of state.options) for (const v of o.values) if (v.swatchMediaId) ids.add(v.swatchMediaId);
  if (state.seo.ogImageId) ids.add(state.seo.ogImageId);
  return [...ids];
}

/** Read-only context for the editor (everything except the SEO settings, which the page adds). */
export async function loadProductContext(
  ex: Tx,
  state: ProductEditorState,
): Promise<Omit<ProductEditorContext, "titleTemplate" | "siteUrl">> {
  const c = schema.categories;
  const [referenced, inOrders, media, customerGroups, categories, bundleChoices, usedInBundles, sample, relatedRows] = await Promise.all([
    referencedVariantIds(ex, state.id),
    productInOrders(ex, state.id),
    getPanelMedia(mediaIdsOfState(state), ex),
    listCustomerGroups(ex),
    ex.select({ id: c.id, name: c.name, slug: c.slug, isVisible: c.isVisible }).from(c).orderBy(asc(c.position), asc(c.id)),
    bundleVariantChoices(ex, state.id),
    bundlesUsingProduct(ex, state.id),
    ex
      .select({ slug: P.slug })
      .from(P)
      .where(and(eq(P.slug, `${state.slug}-numune`), eq(P.type, "sample")))
      .limit(1),
    state.relatedIds.length
      ? ex.select({ id: P.id, name: P.name, subtitle: P.subtitle, slug: P.slug, status: P.status, type: P.type }).from(P).where(inArray(P.id, state.relatedIds))
      : Promise.resolve([]),
  ]);
  const relatedThumbs = await firstMediaByProduct(
    ex,
    relatedRows.map((r) => r.id),
  );
  return {
    referencedVariantIds: [...referenced],
    inOrders,
    media,
    customerGroups,
    categories: categories.map((r) => ({ id: r.id, name: tr(r.name), slug: r.slug, isVisible: r.isVisible })),
    bundleChoices,
    usedInBundles,
    sampleSlug: sample[0]?.slug ?? null,
    relatedItems: relatedRows.map((r) => ({
      id: r.id,
      name: tr(r.name),
      subtitle: tr(r.subtitle) || null,
      slug: r.slug,
      status: r.status,
      type: r.type,
      thumb: relatedThumbs.get(r.id) ?? null,
    })),
  };
}
