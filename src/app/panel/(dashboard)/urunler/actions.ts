"use server";
// Product Server Actions. Each one checks the session and role (panelAction), validates the JSON
// payload with zod and runs the service in one transaction with its audit rows; the storefront tags
// are expired after commit (products, product:<slug> old and new, categories, redirects).
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { TAGS } from "@/lib/cache-tags";
import { panelAction, requirePanelActor } from "@/lib/panel/action";
import { idInput } from "@/lib/panel/schemas";
import {
  bulkStatusSchema,
  productCreateSchema,
  productDeleteSchema,
  productIdSchema,
  productSaveSchema,
  quickStockSchema,
  reorderSchema,
} from "@/lib/panel/products/schema";
import {
  createProduct,
  deleteProduct,
  duplicateProduct,
  quickStockEdit,
  reorderProducts,
  saveProduct,
  setProductStatus,
} from "@/lib/panel/products/service";
import type { ProductEditorState } from "@/lib/panel/products/types";

const STATUS_LABEL = { draft: "taslağa alındı", active: "yayına alındı", archived: "arşivlendi" } as const;

export const createProductAction = panelAction({
  minRole: "editor",
  schema: productCreateSchema,
  run: async (input, { tx }) => {
    const { id, audit } = await createProduct(tx, input);
    return { data: { id }, message: "Taslak ürün oluşturuldu. Fiyat ve görselleri ekleyip yayına alabilirsiniz.", tags: [TAGS.products], audit };
  },
});

export const saveProductAction = panelAction<typeof productSaveSchema, { state: ProductEditorState; notes: string[] }>({
  minRole: "editor",
  schema: productSaveSchema,
  run: async (input, { tx }) => {
    const { state, tags, audit, notes } = await saveProduct(tx, input);
    return {
      data: { state, notes },
      message: notes.length ? `Ürün kaydedildi. ${notes.join(" ")}` : "Ürün kaydedildi.",
      tags,
      audit,
    };
  },
});

export const duplicateProductAction = panelAction({
  minRole: "editor",
  schema: productIdSchema,
  run: async (input, { tx }) => {
    const { id, audit } = await duplicateProduct(tx, input.id);
    return { data: { id }, message: "Kopya taslak olarak oluşturuldu.", tags: [TAGS.products], audit };
  },
});

export const setProductStatusAction = panelAction({
  minRole: "editor",
  schema: bulkStatusSchema,
  run: async (input, { tx }) => {
    const { changed, skipped } = await setProductStatus(tx, input.ids, input.status);
    const parts: string[] = [];
    if (changed.length === 1) parts.push(`"${changed[0].name}" ${STATUS_LABEL[input.status]}.`);
    else if (changed.length > 1) parts.push(`${changed.length} ürün ${STATUS_LABEL[input.status]}.`);
    else if (skipped.length === 0) parts.push("Seçilen ürünler zaten bu durumda.");
    if (skipped.length) {
      parts.push(`Yayına alınamayanlar: ${skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.`);
    }
    return {
      data: { changed: changed.map((c) => c.id), skipped },
      message: parts.join(" "),
      tags: changed.length ? [TAGS.products, TAGS.categories, ...changed.map((c) => TAGS.product(c.slug))] : [],
      audit: changed.map((c) => ({
        action: input.status === "archived" ? "archive" : "status",
        entity: "product",
        entityId: c.id,
        before: { status: c.from },
        after: { status: input.status },
      })),
    };
  },
});

export const deleteProductAction = panelAction({
  minRole: "editor",
  schema: productDeleteSchema,
  run: async (input, { tx }) => {
    const { slug, audit, tags } = await deleteProduct(tx, input);
    return {
      message: "Taslak ürün silindi.",
      tags: [TAGS.products, TAGS.product(slug), TAGS.categories, TAGS.redirects, ...tags],
      audit,
    };
  },
});

export const reorderProductsAction = panelAction({
  minRole: "editor",
  schema: reorderSchema,
  run: async (input, { tx }) => {
    const { moved } = await reorderProducts(tx, input.ids);
    return {
      message: "Sıralama kaydedildi.",
      tags: moved ? [TAGS.products] : [],
      audit: moved ? { action: "reorder", entity: "product", after: { ids: input.ids } } : undefined,
    };
  },
});

/** Current stock of a product's variants (the editor adopts it after a stock conflict). */
export async function currentVariantStocks(productId: number): Promise<{ variantId: number; stock: number }[]> {
  await requirePanelActor("staff");
  const id = idInput.parse(productId);
  const v = schema.productVariants;
  const rows = await db.select({ variantId: v.id, stock: v.stock }).from(v).where(eq(v.productId, id));
  return rows;
}

export const quickStockAction = panelAction({
  minRole: "staff",
  schema: quickStockSchema,
  run: async (input, { tx }) => {
    const { slug, audit, stocks } = await quickStockEdit(tx, input);
    return {
      data: { stocks },
      message: stocks.length ? "Stok güncellendi." : "Değişiklik yok.",
      tags: stocks.length ? [TAGS.products, TAGS.product(slug)] : [],
      audit,
    };
  },
});
