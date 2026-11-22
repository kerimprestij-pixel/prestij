// Product business rules for the panel. Services take a transaction and never touch Next APIs, so the
// DB tests call them directly; the actions in src/app/panel/(dashboard)/urunler/actions.ts add the
// session check, the audit rows and the cache tags.
//
// Rules (docs/DAY3-PANEL.md, PRODUCTS):
// - one save with the whole product, locked by products.updated_at (assertFresh);
// - SKUs unique ignoring case (also against other products); barcodes valid EAN-13 and unique;
// - exactly one default variant, and it is active; every active variant has one value per option;
// - variants that orders, carts or other bundles reference are deactivated instead of deleted;
// - stock is written only when the user changed it, and only if it still equals the value they saw
//   (orders decrement stock concurrently);
// - a slug change records a redirect (recordMove);
// - delete only drafts that no order references; otherwise archive;
// - day 6 (videos): the gallery's first row is an image, at most MAX_PRODUCT_VIDEOS videos, each with a
//   cover image; variant images, swatches and the share image are never videos; videos are stored with
//   role "gallery" and `autoplay` (images always autoplay = false).
import "server-only";
import { and, asc, eq, inArray, max, ne, notInArray, or, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { LocalizedText, SeoFields } from "@/db/schema/common";
import type { ProductStatus } from "@/db/schema/catalog";
import { TAGS } from "@/lib/cache-tags";
import { localize } from "@/i18n/localize";
import { auditChanges, type AuditEntry } from "@/lib/panel/audit";
import { assertFresh, assertUnchanged } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import { slugify } from "@/lib/panel/format";
import { canonicalPath, dropRedirectsTo, recordMove } from "@/lib/panel/redirects";
import { findLinksTo } from "@/lib/panel/content/pages-service";
import { detachFromDiscounts } from "@/lib/panel/discount-scope";
import type { Tx } from "@/lib/panel/tx";
import { loadProductState, productInOrders, referencedVariantIds, bundlesUsingProduct } from "./queries";
import type { ProductCreateInput, ProductSaveInput, QuickStockInput } from "./schema";
import { PRODUCT_MEDIA_MESSAGES, productMediaKindErrors, variantTitle, type ProductEditorState, type ProductMediaFacts } from "./types";

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
const MEDIA = schema.media;

const tr = (text: LocalizedText | null | undefined) => localize(text, "tr");

const STALE = "Bu kayıt artık yok veya başka bir ürüne ait. Sayfayı yenileyin.";

/** Stock conflict message for one variant. */
export const stockConflictMessage = (current: number) =>
  `Stok siz düzenlerken değişti (şu an ${current.toLocaleString("tr-TR")}). Güncel değeri kontrol edip tekrar kaydedin.`;

async function lockProduct(tx: Tx, id: number) {
  const [row] = await tx.select().from(P).where(eq(P.id, id)).for("update");
  if (!row) throw new PanelError("not_found", "Ürün bulunamadı; silinmiş olabilir.");
  return row;
}

/** A copy of `value` without `keys` (keeps the order of the other keys). */
function omitKeys<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * Facts about the media rows among `ids` (absent = no such row): whether each is a video and, for a
 * video, whether its cover is an existing image row (day 6).
 */
async function mediaFacts(tx: Tx, ids: (number | null | undefined)[]): Promise<Map<number, ProductMediaFacts>> {
  const wanted = [...new Set(ids.filter((id): id is number => typeof id === "number"))];
  if (wanted.length === 0) return new Map();
  // FOR SHARE: serializes with a concurrent media delete (see ensureMediaExist).
  const rows = await tx.select({ id: MEDIA.id, kind: MEDIA.kind, posterId: MEDIA.posterId }).from(MEDIA).where(inArray(MEDIA.id, wanted)).for("share");
  const posterIds = [...new Set(rows.filter((r) => r.kind === "video" && r.posterId != null).map((r) => r.posterId as number))];
  const posters = posterIds.length
    ? new Set((await tx.select({ id: MEDIA.id }).from(MEDIA).where(and(inArray(MEDIA.id, posterIds), eq(MEDIA.kind, "image")))).map((r) => r.id))
    : new Set<number>();
  return new Map(rows.map((r) => [r.id, { video: r.kind === "video", hasPoster: r.posterId != null && posters.has(r.posterId) }]));
}

const MEDIA_GONE = "Bu görsel artık kütüphanede yok. Yeniden seçin.";

/** Compact projection of the editor state for the audit log (no client keys). */
function auditView(state: ProductEditorState) {
  const { options, variants, media, tiers, groupPrices, bundleItems, ...rest } = omitKeys(state, ["updatedAt", "id"]);
  const vKey = new Map(variants.map((v) => [v.key, v.sku]));
  return {
    ...rest,
    options: options.map((o) => ({ name: o.name.tr, display: o.display, values: o.values.map((v) => ({ value: v.value, swatchColor: v.swatchColor || null, swatchMediaId: v.swatchMediaId })) })),
    variants: variants.map((variant) => {
      const { optionValueKeys, ...v } = omitKeys(variant, ["key", "stockSeen"]);
      return { ...v, title: variantTitle({ optionValueKeys }, options) };
    }),
    media: media.map((m) => ({
      mediaId: m.mediaId,
      role: m.role,
      variant: m.variantKey ? (vKey.get(m.variantKey) ?? null) : null,
      ...(m.autoplay ? { autoplay: true } : {}),
    })),
    tiers: tiers.map((t) => ({ variant: t.variantKey ? (vKey.get(t.variantKey) ?? null) : null, groupId: t.groupId, minQuantity: t.minQuantity, discountPercent: t.discountPercent })),
    groupPrices: groupPrices.map((g) => ({ variant: vKey.get(g.variantKey) ?? null, groupId: g.groupId, price: g.price })),
    bundleItems: bundleItems.map((b) => ({ variantId: b.variantId, quantity: b.quantity })),
  };
}

function compactLocalized(text: LocalizedText | null): LocalizedText | undefined {
  return text ?? undefined;
}

// -----------------------------------------------------------------------------------------------
// Save (the whole editor)

export type SaveProductResult = { state: ProductEditorState; tags: string[]; audit: AuditEntry; notes: string[] };

export async function saveProduct(tx: Tx, input: ProductSaveInput): Promise<SaveProductResult> {
  const row = await lockProduct(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  const before = (await loadProductState(tx, input.id))!;
  const productId = row.id;

  // --- Product-level references -----------------------------------------------------------------
  const [slugTaken] = await tx.select({ id: P.id }).from(P).where(and(eq(P.slug, input.slug), ne(P.id, productId))).limit(1);
  if (slugTaken) throw fieldError("slug", "Bu kısa ad başka bir üründe kullanılıyor.");
  if (input.categoryId !== null) {
    const [cat] = await tx.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.id, input.categoryId)).limit(1);
    if (!cat) throw fieldError("categoryId", "Seçilen kategori artık yok.");
  }

  const errors: Record<string, string> = {};
  const referencedMedia = [
    input.seo.ogImageId,
    ...input.media.map((m) => m.mediaId),
    ...input.variants.map((v) => v.imageId),
    ...input.options.flatMap((o) => o.values.map((v) => v.swatchMediaId)),
  ].filter((id): id is number => typeof id === "number");
  const facts = await mediaFacts(tx, referencedMedia);
  const gone = new Set(referencedMedia.filter((id) => !facts.has(id)));
  if (gone.size) {
    if (input.seo.ogImageId && gone.has(input.seo.ogImageId)) errors["seo.ogImageId"] = MEDIA_GONE;
    input.media.forEach((m, i) => gone.has(m.mediaId) && (errors[`media.${i}.mediaId`] = MEDIA_GONE));
    input.variants.forEach((v, i) => v.imageId && gone.has(v.imageId) && (errors[`variants.${i}.imageId`] = MEDIA_GONE));
    input.options.forEach((o, oi) =>
      o.values.forEach((v, vi) => v.swatchMediaId && gone.has(v.swatchMediaId) && (errors[`options.${oi}.values.${vi}.swatchMediaId`] = MEDIA_GONE)),
    );
    throw new PanelError("invalid", MEDIA_GONE, errors);
  }

  // --- Day 6: media kinds (videos only in the gallery, never first, with a cover, at most three) ---
  const isVideo = (id: number | null | undefined) => typeof id === "number" && facts.get(id)?.video === true;
  const kindErrors = productMediaKindErrors(input.media, (id) => facts.get(id));
  if (isVideo(input.seo.ogImageId)) kindErrors["seo.ogImageId"] = PRODUCT_MEDIA_MESSAGES.shareImageIsVideo;
  input.variants.forEach((v, i) => {
    if (isVideo(v.imageId)) kindErrors[`variants.${i}.imageId`] = PRODUCT_MEDIA_MESSAGES.variantImageIsVideo;
  });
  input.options.forEach((o, oi) =>
    o.values.forEach((v, vi) => {
      if (isVideo(v.swatchMediaId)) kindErrors[`options.${oi}.values.${vi}.swatchMediaId`] = PRODUCT_MEDIA_MESSAGES.swatchIsVideo;
    }),
  );
  const kindMessages = Object.values(kindErrors);
  if (kindMessages.length) {
    throw new PanelError("invalid", kindMessages.length === 1 ? kindMessages[0] : `Görsellerde ve videolarda ${kindMessages.length} sorun var; işaretli alanları düzeltin.`, kindErrors);
  }

  // --- Existing rows (locked) and ownership of every id in the payload ---------------------------
  const existingOptions = await tx.select().from(O).where(eq(O.productId, productId)).for("update");
  const existingValues = existingOptions.length
    ? await tx.select().from(OV).where(inArray(OV.optionId, existingOptions.map((o) => o.id))).for("update")
    : [];
  const existingVariants = await tx.select().from(V).where(eq(V.productId, productId)).for("update");
  const existingMedia = await tx.select().from(PM).where(eq(PM.productId, productId));

  const optionById = new Map(existingOptions.map((o) => [o.id, o]));
  const variantById = new Map(existingVariants.map((v) => [v.id, v]));
  const mediaById = new Map(existingMedia.map((m) => [m.id, m]));
  const assertOwned = (ok: boolean) => {
    if (!ok) throw new PanelError("invalid", STALE);
  };
  const seenIds = { option: new Set<number>(), value: new Set<number>(), variant: new Set<number>(), media: new Set<number>() };
  for (const o of input.options) {
    if (o.id === null) {
      if (o.values.some((v) => v.id !== null)) assertOwned(false);
      continue;
    }
    assertOwned(optionById.has(o.id) && !seenIds.option.has(o.id));
    seenIds.option.add(o.id);
    for (const v of o.values) {
      if (v.id === null) continue;
      assertOwned(existingValues.some((ev) => ev.id === v.id && ev.optionId === o.id) && !seenIds.value.has(v.id));
      seenIds.value.add(v.id);
    }
  }
  for (const v of input.variants) {
    if (v.id === null) continue;
    assertOwned(variantById.has(v.id) && !seenIds.variant.has(v.id));
    seenIds.variant.add(v.id);
  }
  for (const m of input.media) {
    if (m.id === null) continue;
    assertOwned(mediaById.has(m.id) && !seenIds.media.has(m.id));
    seenIds.media.add(m.id);
  }

  // --- Variant checks that need the database -----------------------------------------------------
  const keptVariantIds = [...seenIds.variant];
  const removedVariants = existingVariants.filter((v) => !seenIds.variant.has(v.id));
  const referenced = await referencedVariantIds(tx, productId);
  const toDeactivate = removedVariants.filter((v) => referenced.has(v.id));
  const toDelete = removedVariants.filter((v) => !referenced.has(v.id));

  // SKUs: compare with every variant that will still exist and is not part of this payload.
  const skus = input.variants.map((v) => v.sku.toUpperCase());
  const deletedIds = toDelete.map((v) => v.id);
  const skuClashes = await tx
    .select({ id: V.id, sku: V.sku, productId: V.productId, productName: P.name })
    .from(V)
    .innerJoin(P, eq(P.id, V.productId))
    .where(
      and(
        inArray(sql`upper(${V.sku})`, skus),
        keptVariantIds.length ? notInArray(V.id, keptVariantIds) : undefined,
        deletedIds.length ? notInArray(V.id, deletedIds) : undefined,
      ),
    );
  for (const clash of skuClashes) {
    const i = skus.indexOf(clash.sku.toUpperCase());
    if (i < 0) continue;
    errors[`variants.${i}.sku`] =
      clash.productId === productId
        ? "Bu SKU bu ürünün pasif bir varyantında kullanılıyor."
        : `Bu SKU "${tr(clash.productName)}" ürününde kullanılıyor.`;
  }
  const barcodes = input.variants.map((v) => v.barcode).filter((b): b is string => Boolean(b));
  if (barcodes.length) {
    // product_variants.barcode has no unique index (schema change pending), so saves that carry
    // barcodes take one transaction-scoped lock: two products saved at once cannot both pass the
    // check below with the same EAN. Released at commit/rollback.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('prestij:product-barcodes'))`);
    const barcodeClashes = await tx
      .select({ id: V.id, barcode: V.barcode, productId: V.productId, productName: P.name })
      .from(V)
      .innerJoin(P, eq(P.id, V.productId))
      .where(
        and(
          inArray(V.barcode, barcodes),
          keptVariantIds.length ? notInArray(V.id, keptVariantIds) : undefined,
          deletedIds.length ? notInArray(V.id, deletedIds) : undefined,
        ),
      );
    for (const clash of barcodeClashes) {
      const i = input.variants.findIndex((v) => v.barcode === clash.barcode);
      if (i < 0) continue;
      errors[`variants.${i}.barcode`] =
        clash.productId === productId
          ? "Bu barkod bu ürünün pasif bir varyantında kullanılıyor."
          : `Bu barkod "${tr(clash.productName)}" ürününde kullanılıyor.`;
    }
  }

  // Stock: written only when changed, and only when it still equals what the editor loaded.
  let stockConflict = false;
  const writeStock = new Map<string, number>();
  input.variants.forEach((v, i) => {
    const current = v.id !== null ? variantById.get(v.id)! : null;
    if (current) {
      if (v.stock === v.stockSeen) return;
      try {
        assertUnchanged(current.stock, v.stockSeen);
      } catch {
        stockConflict = true;
        errors[`variants.${i}.stock`] = stockConflictMessage(current.stock);
        return;
      }
    }
    if (v.stock < 0) {
      errors[`variants.${i}.stock`] = "Stok negatif olamaz.";
      return;
    }
    writeStock.set(v.key, v.stock);
  });

  // Customer groups, related products and bundle contents must exist.
  const groupIds = [...new Set([...input.tiers.map((t) => t.groupId), ...input.groupPrices.map((g) => g.groupId)].filter((g): g is number => g !== null))];
  if (groupIds.length) {
    const found = new Set((await tx.select({ id: schema.customerGroups.id }).from(schema.customerGroups).where(inArray(schema.customerGroups.id, groupIds))).map((r) => r.id));
    input.tiers.forEach((t, i) => t.groupId !== null && !found.has(t.groupId) && (errors[`tiers.${i}.groupId`] = "Müşteri grubu artık yok."));
    input.groupPrices.forEach((g, i) => !found.has(g.groupId) && (errors[`groupPrices.${i}.groupId`] = "Müşteri grubu artık yok."));
  }
  if (input.relatedIds.length) {
    const found = new Set((await tx.select({ id: P.id }).from(P).where(inArray(P.id, input.relatedIds))).map((r) => r.id));
    if (input.relatedIds.some((id) => !found.has(id))) errors.relatedIds = "Seçilen ürünlerden biri artık yok. Listeyi kontrol edin.";
  }
  if (input.type === "bundle" && input.bundleItems.length) {
    const rows = await tx
      .select({ id: V.id, productId: V.productId, type: P.type })
      .from(V)
      .innerJoin(P, eq(P.id, V.productId))
      .where(inArray(V.id, input.bundleItems.map((b) => b.variantId)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    input.bundleItems.forEach((b, i) => {
      const r = byId.get(b.variantId);
      if (!r) errors[`bundleItems.${i}.variantId`] = "Bu ürün artık yok.";
      else if (r.productId === productId) errors[`bundleItems.${i}.variantId`] = "Set kendi varyantını içeremez.";
      else if (r.type === "bundle") errors[`bundleItems.${i}.variantId`] = "Bir set başka bir seti içeremez.";
    });
  }
  // (A set that becomes a normal product loses its contents below: they no longer make sense.)
  if (input.type === "bundle" && row.type !== "bundle" && (await bundlesUsingProduct(tx, productId)).length > 0) {
    errors.type = "Bu ürünün varyantları başka bir sette kullanılıyor; set türüne çevrilemez.";
  }

  if (Object.keys(errors).length) {
    const conflict = stockConflict && Object.keys(errors).every((k) => /^variants\.\d+\.stock$/.test(k));
    throw new PanelError(
      conflict ? "conflict" : "invalid",
      conflict ? "Bazı varyantların stoğu siz düzenlerken değişti (yeni sipariş gelmiş olabilir). İşaretli alanları kontrol edin." : "Lütfen işaretli alanları düzeltin.",
      errors,
    );
  }

  // --- Removed variants: delete, or deactivate when referenced -----------------------------------
  if (toDelete.length) await tx.delete(V).where(inArray(V.id, toDelete.map((v) => v.id)));
  if (toDeactivate.length) {
    await tx.update(V).set({ isActive: false, isDefault: false }).where(inArray(V.id, toDeactivate.map((v) => v.id)));
  }

  // --- Options and values ------------------------------------------------------------------------
  const keptOptionIds = [...seenIds.option];
  const dropOptions = existingOptions.filter((o) => !seenIds.option.has(o.id)).map((o) => o.id);
  if (dropOptions.length) await tx.delete(O).where(inArray(O.id, dropOptions));
  const dropValues = existingValues.filter((v) => keptOptionIds.includes(v.optionId) && !seenIds.value.has(v.id)).map((v) => v.id);
  if (dropValues.length) await tx.delete(OV).where(inArray(OV.id, dropValues));

  const valueIdByKey = new Map<string, number>();
  for (const [oi, o] of input.options.entries()) {
    let optionId = o.id;
    if (optionId !== null) {
      await tx.update(O).set({ name: o.name, display: o.display, position: oi }).where(eq(O.id, optionId));
    } else {
      const [ins] = await tx.insert(O).values({ productId, name: o.name, display: o.display, position: oi }).returning({ id: O.id });
      optionId = ins.id;
    }
    for (const [vi, val] of o.values.entries()) {
      const values = { value: val.value, swatchColor: val.swatchColor, swatchMediaId: val.swatchMediaId, position: vi };
      if (val.id !== null) {
        await tx.update(OV).set(values).where(eq(OV.id, val.id));
        valueIdByKey.set(val.key, val.id);
      } else {
        const [ins] = await tx.insert(OV).values({ optionId, ...values }).returning({ id: OV.id });
        valueIdByKey.set(val.key, ins.id);
      }
    }
  }

  // --- Variants ----------------------------------------------------------------------------------
  // Free the SKUs that change first so swapping codes between two variants cannot hit the unique index.
  for (const v of input.variants) {
    if (v.id === null) continue;
    const current = variantById.get(v.id)!;
    if (current.sku !== v.sku) {
      await tx.update(V).set({ sku: `~${v.id}` }).where(eq(V.id, v.id));
    }
  }
  const variantIdByKey = new Map<string, number>();
  for (const [i, v] of input.variants.entries()) {
    const values = {
      sku: v.sku,
      barcode: v.barcode,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      costPrice: v.costPrice,
      vatRate: v.vatRate,
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
      position: i,
      ...(writeStock.has(v.key) ? { stock: writeStock.get(v.key)! } : {}),
    };
    if (v.id !== null) {
      const current = variantById.get(v.id)!;
      const changed =
        writeStock.has(v.key) ||
        current.sku !== v.sku ||
        (Object.keys(values) as (keyof typeof values)[]).some((k) => k !== "stock" && k !== "sku" && current[k] !== values[k]);
      // Only touch rows that changed: an untouched variant keeps its updated_at.
      if (changed) await tx.update(V).set(values).where(eq(V.id, v.id));
      variantIdByKey.set(v.key, v.id);
    } else {
      const [ins] = await tx
        .insert(V)
        .values({ productId, ...values, stock: writeStock.get(v.key) ?? 0 })
        .returning({ id: V.id });
      variantIdByKey.set(v.key, ins.id);
    }
  }

  // Option values per variant (only for variants in the payload; deactivated ones keep theirs).
  const payloadVariantIds = [...variantIdByKey.values()];
  const existingLinks = payloadVariantIds.length ? await tx.select().from(VOV).where(inArray(VOV.variantId, payloadVariantIds)) : [];
  for (const v of input.variants) {
    const variantId = variantIdByKey.get(v.key)!;
    const wanted = v.optionValueKeys.map((k) => valueIdByKey.get(k)!).filter(Boolean).sort((a, b) => a - b);
    const have = existingLinks.filter((l) => l.variantId === variantId).map((l) => l.optionValueId).sort((a, b) => a - b);
    if (wanted.join(",") === have.join(",")) continue;
    await tx.delete(VOV).where(eq(VOV.variantId, variantId));
    if (wanted.length) await tx.insert(VOV).values(wanted.map((optionValueId) => ({ variantId, optionValueId })));
  }

  // --- Images and videos -------------------------------------------------------------------------
  const dropMedia = existingMedia.filter((m) => !seenIds.media.has(m.id)).map((m) => m.id);
  if (dropMedia.length) await tx.delete(PM).where(inArray(PM.id, dropMedia));
  for (const [i, m] of input.media.entries()) {
    const video = isVideo(m.mediaId);
    const values = {
      mediaId: m.mediaId,
      // A video has no role choice in the editor; "gallery" keeps it out of every card rule.
      role: video ? ("gallery" as const) : m.role,
      variantId: m.variantKey ? (variantIdByKey.get(m.variantKey) ?? null) : null,
      position: i,
      autoplay: video && m.autoplay === true,
    };
    if (m.id !== null) {
      const current = mediaById.get(m.id)!;
      if (
        current.mediaId !== values.mediaId ||
        current.role !== values.role ||
        current.variantId !== values.variantId ||
        current.position !== i ||
        current.autoplay !== values.autoplay
      ) {
        await tx.update(PM).set(values).where(eq(PM.id, m.id));
      }
    } else {
      await tx.insert(PM).values({ productId, ...values });
    }
  }

  // --- Tier and group prices (replaced as a whole) ----------------------------------------------
  const allVariantIds = [...payloadVariantIds, ...toDeactivate.map((v) => v.id)];
  await tx.delete(TP).where(allVariantIds.length ? or(eq(TP.productId, productId), inArray(TP.variantId, allVariantIds)) : eq(TP.productId, productId));
  if (input.tiers.length) {
    await tx.insert(TP).values(
      input.tiers.map((t) => ({
        productId: t.variantKey ? null : productId,
        variantId: t.variantKey ? variantIdByKey.get(t.variantKey)! : null,
        groupId: t.groupId,
        minQuantity: t.minQuantity,
        discountPercent: t.discountPercent,
      })),
    );
  }
  if (allVariantIds.length) await tx.delete(GP).where(inArray(GP.variantId, allVariantIds));
  if (input.groupPrices.length) {
    await tx.insert(GP).values(input.groupPrices.map((g) => ({ variantId: variantIdByKey.get(g.variantKey)!, groupId: g.groupId, price: g.price })));
  }

  // --- Bundle contents and related products -----------------------------------------------------
  await tx.delete(BI).where(eq(BI.bundleProductId, productId));
  if (input.type === "bundle" && input.bundleItems.length) {
    await tx.insert(BI).values(input.bundleItems.map((b, i) => ({ bundleProductId: productId, variantId: b.variantId, quantity: b.quantity, position: i })));
  }
  await tx.delete(PR).where(and(eq(PR.productId, productId), eq(PR.kind, "related")));
  if (input.relatedIds.length) {
    await tx.insert(PR).values(input.relatedIds.map((relatedProductId, i) => ({ productId, relatedProductId, kind: "related" as const, position: i })));
  }

  // --- The product row ---------------------------------------------------------------------------
  const seo: SeoFields = {};
  if (input.seo.title) seo.title = input.seo.title;
  if (input.seo.description) seo.description = input.seo.description;
  if (input.seo.ogImageId) seo.ogImageId = input.seo.ogImageId;
  if (input.seo.noIndex) seo.noIndex = true;
  const scent = { top: compactLocalized(input.scentTop), heart: compactLocalized(input.scentHeart), base: compactLocalized(input.scentBase) };
  const overrides = { ...(input.tint ? { tint: input.tint } : {}), ...(input.tintDark ? { dark: input.tintDark } : {}) };
  await tx
    .update(P)
    .set({
      slug: input.slug,
      type: input.type,
      status: input.status,
      name: input.name,
      subtitle: input.subtitle,
      shortDescription: input.shortDescription,
      description: input.description,
      categoryId: input.categoryId,
      isFeatured: input.isFeatured,
      businessOnly: input.businessOnly,
      allowSubscription: input.allowSubscription,
      accentColor: input.accentColor,
      themeOverrides: Object.keys(overrides).length ? overrides : null,
      scentNotes: scent.top || scent.heart || scent.base ? JSON.parse(JSON.stringify(scent)) : null,
      usage: input.usage,
      warnings: input.warnings,
      ingredients: input.ingredients,
      claims: input.claims,
      specs: input.specs,
      seo: Object.keys(seo).length ? seo : null,
      updatedAt: new Date(),
    })
    .where(eq(P.id, productId));

  // --- Redirects, tags, audit --------------------------------------------------------------------
  const tags: string[] = [TAGS.products, TAGS.product(row.slug), TAGS.product(input.slug)];
  if (row.slug !== input.slug && (await recordMove(tx, canonicalPath.product(row.slug), canonicalPath.product(input.slug)))) {
    tags.push(TAGS.redirects);
  }
  // Category pages count and list products: any change of category, status, type or visibility.
  if (
    row.categoryId !== input.categoryId ||
    row.status !== input.status ||
    row.type !== input.type ||
    row.businessOnly !== input.businessOnly
  ) {
    tags.push(TAGS.categories);
  }

  const state = (await loadProductState(tx, productId))!;
  const notes: string[] = [];
  if (toDeactivate.length) {
    notes.push(
      `${toDeactivate.length} varyant siparişlerde, sepetlerde veya setlerde geçtiği için silinmedi; pasif yapıldı (${toDeactivate.map((v) => v.sku).join(", ")}).`,
    );
  }
  const audit: AuditEntry = { action: "update", entity: "product", entityId: productId, ...auditChanges(auditView(before), auditView(state)) };
  return { state, tags, audit, notes };
}

// -----------------------------------------------------------------------------------------------
// Create, duplicate

async function uniqueSlug(tx: Tx, base: string): Promise<string> {
  const root = base.slice(0, 70).replace(/-+$/, "") || "urun";
  const rows = await tx
    .select({ slug: P.slug })
    .from(P)
    .where(or(eq(P.slug, root), sql`${P.slug} like ${`${root}-%`}`));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(root)) return root;
  for (let n = 2; n < 10_000; n++) if (!taken.has(`${root}-${n}`)) return `${root}-${n}`;
  throw new PanelError("conflict", "Benzersiz bir kısa ad bulunamadı.");
}

async function uniqueSkus(tx: Tx, wanted: string[]): Promise<string[]> {
  const out: string[] = [];
  const rows = await tx.select({ sku: V.sku }).from(V);
  const taken = new Set(rows.map((r) => r.sku.toUpperCase()));
  for (const base of wanted) {
    const root = base.toUpperCase().slice(0, 34).replace(/[-_.]+$/, "") || "PR";
    let sku = root;
    for (let n = 2; taken.has(sku); n++) sku = `${root}-${n}`;
    taken.add(sku);
    out.push(sku);
  }
  return out;
}

async function nextPosition(tx: Tx): Promise<number> {
  const [r] = await tx.select({ max: max(P.position) }).from(P);
  return (r?.max ?? -1) + 1;
}

export async function createProduct(tx: Tx, input: ProductCreateInput): Promise<{ id: number; slug: string; audit: AuditEntry }> {
  if (input.categoryId !== null) {
    const [cat] = await tx.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.id, input.categoryId)).limit(1);
    if (!cat) throw fieldError("categoryId", "Seçilen kategori artık yok.");
  }
  const slug = await uniqueSlug(tx, slugify(input.name) || "urun");
  const [sku] = await uniqueSkus(tx, [`PR-${slug}`]);
  const [product] = await tx
    .insert(P)
    .values({ slug, type: input.type, status: "draft", name: { tr: input.name }, categoryId: input.categoryId, position: await nextPosition(tx) })
    .returning({ id: P.id });
  await tx.insert(V).values({ productId: product.id, sku, price: 0, stock: 0, isDefault: true, isActive: true, position: 0 });
  return {
    id: product.id,
    slug,
    audit: { action: "create", entity: "product", entityId: product.id, after: { name: input.name, slug, type: input.type, categoryId: input.categoryId, sku } },
  };
}

export async function duplicateProduct(tx: Tx, id: number): Promise<{ id: number; slug: string; audit: AuditEntry }> {
  const row = await lockProduct(tx, id);
  const slug = await uniqueSlug(tx, `${row.slug.slice(0, 64)}-kopya`);
  const name: LocalizedText = { ...row.name, tr: `${row.name.tr} (kopya)` };
  const copy = omitKeys(row, ["id", "createdAt", "updatedAt", "slug", "status", "position", "ratingAverage", "ratingCount"]);
  const [product] = await tx
    .insert(P)
    .values({ ...copy, name, slug, status: "draft", position: await nextPosition(tx) })
    .returning({ id: P.id });
  const newId = product.id;

  const options = await tx.select().from(O).where(eq(O.productId, id)).orderBy(asc(O.position), asc(O.id));
  const valueMap = new Map<number, number>();
  for (const o of options) {
    const [ins] = await tx.insert(O).values({ productId: newId, name: o.name, display: o.display, position: o.position }).returning({ id: O.id });
    const values = await tx.select().from(OV).where(eq(OV.optionId, o.id)).orderBy(asc(OV.position), asc(OV.id));
    for (const v of values) {
      const [insV] = await tx
        .insert(OV)
        .values({ optionId: ins.id, value: v.value, swatchColor: v.swatchColor, swatchMediaId: v.swatchMediaId, position: v.position })
        .returning({ id: OV.id });
      valueMap.set(v.id, insV.id);
    }
  }

  const variants = await tx.select().from(V).where(eq(V.productId, id)).orderBy(asc(V.position), asc(V.id));
  const skus = await uniqueSkus(tx, variants.map((v) => `${v.sku.slice(0, 28)}-KOPYA`));
  const variantMap = new Map<number, number>();
  for (const [i, v] of variants.entries()) {
    const { id: vid, ...vcopy } = omitKeys(v, ["productId", "createdAt", "updatedAt", "sku", "barcode", "stock"]);
    // Barcodes identify one real product (EAN), stock belongs to the original: the copy starts empty.
    const [ins] = await tx.insert(V).values({ ...vcopy, productId: newId, sku: skus[i], barcode: null, stock: 0 }).returning({ id: V.id });
    variantMap.set(vid, ins.id);
  }
  if (variants.length) {
    const links = await tx.select().from(VOV).where(inArray(VOV.variantId, variants.map((v) => v.id)));
    const rows = links.flatMap((l) => {
      const variantId = variantMap.get(l.variantId);
      const optionValueId = valueMap.get(l.optionValueId);
      return variantId && optionValueId ? [{ variantId, optionValueId }] : [];
    });
    if (rows.length) await tx.insert(VOV).values(rows);

    const gps = await tx.select().from(GP).where(inArray(GP.variantId, variants.map((v) => v.id)));
    if (gps.length) await tx.insert(GP).values(gps.map((g) => ({ variantId: variantMap.get(g.variantId)!, groupId: g.groupId, price: g.price })));
  }
  const tiers = await tx
    .select()
    .from(TP)
    .where(variants.length ? or(eq(TP.productId, id), inArray(TP.variantId, variants.map((v) => v.id))) : eq(TP.productId, id));
  if (tiers.length) {
    await tx.insert(TP).values(
      tiers.map((t) => ({
        productId: t.productId === id ? newId : null,
        variantId: t.variantId != null ? (variantMap.get(t.variantId) ?? null) : null,
        groupId: t.groupId,
        minQuantity: t.minQuantity,
        discountPercent: t.discountPercent,
      })),
    );
  }
  const media = await tx.select().from(PM).where(eq(PM.productId, id)).orderBy(asc(PM.position), asc(PM.id));
  if (media.length) {
    await tx.insert(PM).values(
      media.map((m) => ({
        productId: newId,
        mediaId: m.mediaId,
        role: m.role,
        position: m.position,
        variantId: m.variantId != null ? (variantMap.get(m.variantId) ?? null) : null,
        autoplay: m.autoplay,
      })),
    );
  }
  const bundle = await tx.select().from(BI).where(eq(BI.bundleProductId, id));
  if (bundle.length) await tx.insert(BI).values(bundle.map((b) => ({ bundleProductId: newId, variantId: b.variantId, quantity: b.quantity, position: b.position })));
  const relations = await tx.select().from(PR).where(eq(PR.productId, id));
  if (relations.length) await tx.insert(PR).values(relations.map((r) => ({ productId: newId, relatedProductId: r.relatedProductId, kind: r.kind, position: r.position })));

  return {
    id: newId,
    slug,
    audit: { action: "duplicate", entity: "product", entityId: newId, after: { from: id, fromSlug: row.slug, slug, skus } },
  };
}

// -----------------------------------------------------------------------------------------------
// Status (archive, bulk), delete, reorder

/** Why a product cannot go live, or null when it can. */
async function activationProblem(tx: Tx, product: { id: number; type: string }): Promise<string | null> {
  const variants = await tx.select({ price: V.price, isActive: V.isActive }).from(V).where(eq(V.productId, product.id));
  const active = variants.filter((v) => v.isActive);
  if (active.length === 0) return "aktif varyantı yok";
  if (product.type !== "sample" && active.some((v) => v.price <= 0)) return "fiyatı girilmemiş varyantı var";
  if (product.type === "bundle") {
    const [b] = await tx.select({ id: BI.id }).from(BI).where(eq(BI.bundleProductId, product.id)).limit(1);
    if (!b) return "setin içeriği boş";
  }
  return null;
}

export type StatusChangeResult = {
  changed: { id: number; slug: string; name: string; from: ProductStatus }[];
  skipped: { id: number; name: string; reason: string }[];
};

export async function setProductStatus(tx: Tx, ids: number[], status: ProductStatus): Promise<StatusChangeResult> {
  const rows = await tx.select({ id: P.id, slug: P.slug, name: P.name, status: P.status, type: P.type }).from(P).where(inArray(P.id, ids)).orderBy(asc(P.id)).for("update");
  if (rows.length === 0) throw new PanelError("not_found", "Seçilen ürünler bulunamadı.");
  const out: StatusChangeResult = { changed: [], skipped: [] };
  for (const r of rows) {
    if (r.status === status) continue;
    if (status === "active") {
      const problem = await activationProblem(tx, r);
      if (problem) {
        out.skipped.push({ id: r.id, name: tr(r.name), reason: problem });
        continue;
      }
    }
    await tx.update(P).set({ status, updatedAt: new Date() }).where(eq(P.id, r.id));
    out.changed.push({ id: r.id, slug: r.slug, name: tr(r.name), from: r.status });
  }
  return out;
}

export async function deleteProduct(
  tx: Tx,
  input: { id: number; updatedAt: Date },
): Promise<{ slug: string; audit: AuditEntry[]; redirectsDropped: number; tags: string[] }> {
  const id = input.id;
  const row = await lockProduct(tx, id);
  assertFresh(row.updatedAt, input.updatedAt);
  if (row.status !== "draft") {
    throw new PanelError("in_use", "Yalnızca taslak ürünler silinebilir. Bu ürünü arşivleyebilirsiniz; arşivdeki ürünler mağazada görünmez.");
  }
  if (await productInOrders(tx, id)) {
    throw new PanelError("in_use", "Bu ürün siparişlerde geçtiği için silinemez. Arşivleyebilirsiniz; sipariş geçmişi korunur.");
  }
  const bundles = await bundlesUsingProduct(tx, id);
  if (bundles.length) {
    throw new PanelError("in_use", `Bu ürün ${bundles.map((b) => `"${b.name}"`).join(", ")} setinde kullanılıyor. Önce setten çıkarın.`);
  }
  const places = await findLinksTo(tx, canonicalPath.product(row.slug));
  if (places.length > 0) {
    const shown = places.slice(0, 4).join(", ");
    const more = places.length > 4 ? ` ve ${places.length - 4} yer daha` : "";
    throw new PanelError("in_use", `Bu ürüne bağlantı veren yerler var: ${shown}${more}. Önce bu bağlantıları kaldırın.`);
  }
  const detached = await detachFromDiscounts(tx, "product", id);
  const variants = await tx.select({ sku: V.sku }).from(V).where(eq(V.productId, id));
  await tx.delete(P).where(eq(P.id, id));
  const redirectsDropped = await dropRedirectsTo(tx, canonicalPath.product(row.slug));
  return {
    slug: row.slug,
    redirectsDropped,
    tags: [...(detached.campaignsChanged ? [TAGS.campaigns] : []), ...(detached.themeAffected ? [TAGS.theme] : [])],
    audit: [
      ...detached.audit,
      { action: "delete", entity: "product", entityId: id, before: { name: row.name, slug: row.slug, type: row.type, skus: variants.map((v) => v.sku) } },
    ],
  };
}

export async function reorderProducts(tx: Tx, ids: number[]): Promise<{ moved: number }> {
  const rows = await tx.select({ id: P.id, position: P.position }).from(P).orderBy(asc(P.id)).for("update");
  const all = new Set(rows.map((r) => r.id));
  if (ids.length !== all.size || new Set(ids).size !== ids.length || ids.some((id) => !all.has(id))) {
    throw new PanelError("conflict", "Ürün listesi siz sıralarken değişti. Sayfayı yenileyip tekrar deneyin.");
  }
  const current = new Map(rows.map((r) => [r.id, r.position]));
  let moved = 0;
  for (const [position, id] of ids.entries()) {
    if (current.get(id) === position) continue;
    // Position only: the editor's updated_at lock must not trip over a reorder.
    await tx.execute(sql`update products set position = ${position} where id = ${id}`);
    moved++;
  }
  return { moved };
}

// -----------------------------------------------------------------------------------------------
// Quick stock edit (staff+)

export async function quickStockEdit(
  tx: Tx,
  input: QuickStockInput,
): Promise<{ slug: string; audit: AuditEntry[]; stocks: { variantId: number; stock: number }[] }> {
  const [product] = await tx.select({ id: P.id, slug: P.slug }).from(P).where(eq(P.id, input.productId)).limit(1);
  if (!product) throw new PanelError("not_found", "Ürün bulunamadı; silinmiş olabilir.");
  const ids = [...new Set(input.items.map((i) => i.variantId))];
  if (ids.length !== input.items.length) throw new PanelError("invalid", STALE);
  const rows = await tx
    .select({ id: V.id, sku: V.sku, stock: V.stock })
    .from(V)
    .where(and(eq(V.productId, product.id), inArray(V.id, ids)))
    .orderBy(asc(V.id))
    .for("update");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const errors: Record<string, string> = {};
  input.items.forEach((item, i) => {
    const row = byId.get(item.variantId);
    if (!row) throw new PanelError("invalid", STALE);
    try {
      assertUnchanged(row.stock, item.seenStock);
    } catch {
      errors[`items.${i}.stock`] = stockConflictMessage(row.stock);
    }
  });
  if (Object.keys(errors).length) {
    throw new PanelError("conflict", "Stok siz düzenlerken değişti (yeni sipariş gelmiş olabilir). Güncel değerleri kontrol edin.", errors);
  }
  const audit: AuditEntry[] = [];
  const stocks: { variantId: number; stock: number }[] = [];
  for (const item of input.items) {
    const row = byId.get(item.variantId)!;
    if (row.stock === item.stock) continue;
    // Guarded again in SQL: an order that slipped in after the lock-free read cannot be overwritten.
    const updated = await tx
      .update(V)
      .set({ stock: item.stock })
      .where(and(eq(V.id, item.variantId), eq(V.stock, item.seenStock)))
      .returning({ id: V.id });
    if (updated.length === 0) throw new PanelError("conflict", stockConflictMessage(row.stock));
    audit.push({ action: "update", entity: "product_variant", entityId: item.variantId, before: { sku: row.sku, stock: row.stock }, after: { sku: row.sku, stock: item.stock } });
    stocks.push({ variantId: item.variantId, stock: item.stock });
  }
  return { slug: product.slug, audit, stocks };
}
