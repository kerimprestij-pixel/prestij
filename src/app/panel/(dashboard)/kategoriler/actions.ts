"use server";
// Category Server Actions (editor+). Tags: categories and products (product pages show the category
// name and link), redirects when a slug moved or a category was deleted.
import { TAGS } from "@/lib/cache-tags";
import { panelAction } from "@/lib/panel/action";
import { categoryDeleteSchema, categoryReorderSchema, categorySaveSchema, type CategoryEditorState } from "@/lib/panel/categories/schema";
import { deleteCategory, reorderCategories, saveCategory } from "@/lib/panel/categories/service";

export const saveCategoryAction = panelAction<typeof categorySaveSchema, { id: number; state: CategoryEditorState; created: boolean }>({
  minRole: "editor",
  schema: categorySaveSchema,
  run: async (input, { tx }) => {
    const { id, state, tags, audit, created } = await saveCategory(tx, input);
    return { data: { id, state, created }, message: created ? "Kategori oluşturuldu." : "Kategori kaydedildi.", tags, audit };
  },
});

export const reorderCategoriesAction = panelAction({
  minRole: "editor",
  schema: categoryReorderSchema,
  run: async (input, { tx }) => {
    const { moved } = await reorderCategories(tx, input.ids);
    return {
      message: "Sıralama kaydedildi.",
      tags: moved ? [TAGS.categories, TAGS.products] : [],
      audit: moved ? { action: "reorder", entity: "category", after: { ids: input.ids } } : undefined,
    };
  },
});

export const deleteCategoryAction = panelAction({
  minRole: "editor",
  schema: categoryDeleteSchema,
  run: async (input, { tx }) => {
    const { slug, movedProducts, audit, tags, note } = await deleteCategory(tx, input);
    const base = movedProducts.length ? `${movedProducts.length} ürün taşındı ve kategori silindi.` : "Kategori silindi.";
    return {
      message: note ? `${base} Kategori ${note}` : base,
      tags: [TAGS.categories, TAGS.products, TAGS.redirects, ...movedProducts.map((p) => TAGS.product(p.slug)), ...tags],
      audit,
      data: { slug },
    };
  },
});
