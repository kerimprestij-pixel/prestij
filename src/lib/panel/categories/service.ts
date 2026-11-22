// Category rules for the panel (services take a transaction, no Next APIs; DB tests call them).
// - name/slug/image/accent/visibility/SEO, and since day 5 the editorial body (sanitized HTML) and the
//   FAQ, in one save locked by updated_at; a slug change records a redirect (recordMove);
// - reorder writes positions only (no updated_at bump, so open editors do not conflict);
// - delete only when no product uses the category, unless the caller moves the products first (in
//   the same transaction); refused while menus, announcements or sections link to it; its id is
//   removed from campaign/coupon scopes (a discount whose scope empties is switched off).
import "server-only";
import { and, asc, count, eq, inArray, max, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText, SeoFields } from "@/db/schema/common";
import { TAGS } from "@/lib/cache-tags";
import { localize } from "@/i18n/localize";
import { auditChanges, type AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import { getPanelMedia } from "@/lib/panel/media/queries";
import { canonicalPath, dropRedirectsTo, recordMove } from "@/lib/panel/redirects";
import { findLinksTo } from "@/lib/panel/content/pages-service";
import { detachFromDiscounts } from "@/lib/panel/discount-scope";
import type { Tx } from "@/lib/panel/tx";
import type { MediaLike } from "@/lib/media/types";
import type { CategoryDeleteInput, CategoryEditorState, CategoryFaqState, CategorySaveInput } from "./schema";

const C = schema.categories;
const P = schema.products;

export type PanelCategoryRow = {
  id: number;
  /** ISO; sent back with a delete from the list (stale-view guard). */
  updatedAt: string;
  slug: string;
  name: string;
  nameEn: string | null;
  isVisible: boolean;
  accentColor: string | null;
  image: MediaLike | null;
  productCount: number;
  activeCount: number;
};

export async function listPanelCategories(ex: Tx = db): Promise<PanelCategoryRow[]> {
  const rows = await ex
    .select({ id: C.id, updatedAt: C.updatedAt, slug: C.slug, name: C.name, isVisible: C.isVisible, accentColor: C.accentColor, imageId: C.imageId })
    .from(C)
    .orderBy(asc(C.position), asc(C.id));
  const counts = await ex
    .select({
      categoryId: P.categoryId,
      total: count(),
      active: sql<number>`count(*) filter (where ${P.status} = 'active')`.mapWith(Number),
    })
    .from(P)
    .groupBy(P.categoryId);
  const byId = new Map(counts.map((c) => [c.categoryId, c]));
  const media = await getPanelMedia(
    rows.map((r) => r.imageId).filter((id): id is number => id != null),
    ex,
  );
  const mediaById = new Map(media.map((m) => [m.id, m]));
  return rows.map((r) => ({
    id: r.id,
    updatedAt: r.updatedAt.toISOString(),
    slug: r.slug,
    name: localize(r.name, "tr"),
    nameEn: r.name.en ?? null,
    isVisible: r.isVisible,
    accentColor: r.accentColor,
    image: r.imageId != null ? (mediaById.get(r.imageId) ?? null) : null,
    productCount: byId.get(r.id)?.total ?? 0,
    activeCount: byId.get(r.id)?.active ?? 0,
  }));
}

const isLocalizedText = (value: unknown): value is LocalizedText =>
  value !== null && typeof value === "object" && typeof (value as { tr?: unknown }).tr === "string";

/** Stored FAQ items the editor can show (malformed jsonb entries are dropped, like the storefront read). */
function editorFaq(value: unknown): CategoryFaqState[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is CategoryFaqState => item != null && typeof item === "object" && isLocalizedText(item.question) && isLocalizedText(item.answer))
    .map((item) => ({ question: item.question, answer: item.answer }));
}

export async function loadCategoryState(ex: Tx, id: number): Promise<CategoryEditorState | null> {
  const [row] = await ex.select().from(C).where(eq(C.id, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    body: isLocalizedText(row.body) ? row.body : null,
    faq: editorFaq(row.faq),
    imageId: row.imageId,
    accentColor: row.accentColor ?? "",
    isVisible: row.isVisible,
    seo: {
      title: row.seo?.title ?? null,
      description: row.seo?.description ?? null,
      ogImageId: row.seo?.ogImageId ?? null,
      noIndex: row.seo?.noIndex ?? false,
    },
  };
}

export const EMPTY_CATEGORY: CategoryEditorState = {
  id: null,
  updatedAt: null,
  slug: "",
  name: { tr: "" },
  description: null,
  body: null,
  faq: [],
  imageId: null,
  accentColor: "",
  isVisible: true,
  seo: { title: null, description: null, ogImageId: null, noIndex: false },
};

export async function saveCategory(
  tx: Tx,
  input: CategorySaveInput,
): Promise<{ id: number; state: CategoryEditorState; tags: string[]; audit: AuditEntry; created: boolean }> {
  const seo: SeoFields = {};
  if (input.seo.title) seo.title = input.seo.title;
  if (input.seo.description) seo.description = input.seo.description;
  if (input.seo.ogImageId) seo.ogImageId = input.seo.ogImageId;
  if (input.seo.noIndex) seo.noIndex = true;

  // Media must exist and be images (path-specific messages; a video never goes into an image field).
  const wanted = [input.imageId, input.seo.ogImageId].filter((id): id is number => id !== null);
  if (wanted.length) {
    const rows = await tx.select({ id: schema.media.id, kind: schema.media.kind }).from(schema.media).where(inArray(schema.media.id, wanted)).for("share");
    const kindOf = new Map(rows.map((r) => [r.id, r.kind]));
    const problem = (id: number) =>
      !kindOf.has(id) ? "Bu görsel artık kütüphanede yok. Yeniden seçin." : kindOf.get(id) !== "image" ? "Bu alana yalnızca görsel seçilebilir; seçtiğiniz dosya bir video." : null;
    const errors: Record<string, string> = {};
    const imageProblem = input.imageId !== null ? problem(input.imageId) : null;
    const ogProblem = input.seo.ogImageId !== null ? problem(input.seo.ogImageId) : null;
    if (imageProblem) errors.imageId = imageProblem;
    if (ogProblem) errors["seo.ogImageId"] = ogProblem;
    if (Object.keys(errors).length) throw new PanelError("invalid", "Lütfen işaretli alanları düzeltin.", errors);
  }

  const [taken] = await tx
    .select({ id: C.id })
    .from(C)
    .where(input.id === null ? eq(C.slug, input.slug) : and(eq(C.slug, input.slug), ne(C.id, input.id)))
    .limit(1);
  if (taken) throw fieldError("slug", "Bu kısa ad başka bir kategoride kullanılıyor.");

  const values = {
    slug: input.slug,
    name: input.name,
    description: input.description,
    imageId: input.imageId,
    accentColor: input.accentColor,
    isVisible: input.isVisible,
    seo: Object.keys(seo).length ? seo : null,
  };
  const tags: string[] = [TAGS.categories, TAGS.products];

  if (input.id === null) {
    const [{ value: maxPosition } = { value: null }] = await tx.select({ value: max(C.position) }).from(C);
    const created = { ...values, body: input.body ?? null, faq: input.faq ?? [] };
    const [ins] = await tx
      .insert(C)
      .values({ ...created, position: (maxPosition ?? -1) + 1 })
      .returning({ id: C.id });
    const state = (await loadCategoryState(tx, ins.id))!;
    return { id: ins.id, state, tags, created: true, audit: { action: "create", entity: "category", entityId: ins.id, after: created } };
  }

  const [row] = await tx.select().from(C).where(eq(C.id, input.id)).for("update");
  if (!row) throw new PanelError("not_found", "Kategori bulunamadı; silinmiş olabilir.");
  assertFresh(row.updatedAt, input.updatedAt);
  // Body and FAQ (day 5) left out of the payload keep their stored values (and stay out of the audit diff).
  const next = {
    ...values,
    body: input.body === undefined ? row.body : input.body,
    faq: input.faq === undefined ? row.faq : input.faq,
  };
  await tx
    .update(C)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(C.id, row.id));
  if (row.slug !== input.slug && (await recordMove(tx, canonicalPath.category(row.slug), canonicalPath.category(input.slug)))) {
    tags.push(TAGS.redirects);
  }
  const state = (await loadCategoryState(tx, row.id))!;
  // The editable fields before the save (the same keys as `next`).
  const beforeValues = {
    slug: row.slug,
    name: row.name,
    description: row.description,
    body: row.body,
    faq: row.faq,
    imageId: row.imageId,
    accentColor: row.accentColor,
    isVisible: row.isVisible,
    seo: row.seo,
  };
  return {
    id: row.id,
    state,
    tags,
    created: false,
    audit: { action: "update", entity: "category", entityId: row.id, ...auditChanges(beforeValues, next) },
  };
}

export async function reorderCategories(tx: Tx, ids: number[]): Promise<{ moved: number }> {
  const rows = await tx.select({ id: C.id, position: C.position }).from(C).orderBy(asc(C.id)).for("update");
  const all = new Set(rows.map((r) => r.id));
  if (ids.length !== all.size || new Set(ids).size !== ids.length || ids.some((id) => !all.has(id))) {
    throw new PanelError("conflict", "Kategori listesi siz sıralarken değişti. Sayfayı yenileyip tekrar deneyin.");
  }
  const current = new Map(rows.map((r) => [r.id, r.position]));
  let moved = 0;
  for (const [position, id] of ids.entries()) {
    if (current.get(id) === position) continue;
    await tx.execute(sql`update categories set position = ${position} where id = ${id}`);
    moved++;
  }
  return { moved };
}

export async function deleteCategory(
  tx: Tx,
  input: CategoryDeleteInput,
): Promise<{ slug: string; movedProducts: { id: number; slug: string }[]; audit: AuditEntry[]; tags: string[]; note: string | null }> {
  const [row] = await tx.select().from(C).where(eq(C.id, input.id)).for("update");
  if (!row) throw new PanelError("not_found", "Kategori bulunamadı; silinmiş olabilir.");
  assertFresh(row.updatedAt, input.updatedAt);
  const places = await findLinksTo(tx, canonicalPath.category(row.slug));
  if (places.length > 0) {
    const shown = places.slice(0, 4).join(", ");
    const more = places.length > 4 ? ` ve ${places.length - 4} yer daha` : "";
    throw new PanelError("in_use", `Bu kategoriye bağlantı veren yerler var: ${shown}${more}. Önce bu bağlantıları kaldırın veya değiştirin.`);
  }
  const products = await tx.select({ id: P.id, slug: P.slug }).from(P).where(eq(P.categoryId, row.id)).for("update");
  const audit: AuditEntry[] = [];

  if (products.length > 0) {
    if (input.moveProductsTo === undefined) {
      throw new PanelError(
        "in_use",
        `Bu kategoride ${products.length} ürün var. Silmeden önce ürünleri başka bir kategoriye taşıyın.`,
      );
    }
    let target: number | null = null;
    if (input.moveProductsTo !== "none") {
      if (input.moveProductsTo === row.id) throw fieldError("moveProductsTo", "Ürünleri silinen kategoriye taşıyamazsınız.");
      const [t] = await tx.select({ id: C.id }).from(C).where(eq(C.id, input.moveProductsTo)).limit(1);
      if (!t) throw fieldError("moveProductsTo", "Hedef kategori artık yok.");
      target = t.id;
    }
    await tx.update(P).set({ categoryId: target }).where(eq(P.categoryId, row.id));
    audit.push({ action: "move", entity: "category", entityId: row.id, before: { categoryId: row.id }, after: { categoryId: target, products: products.map((p) => p.id) } });
  }
  const detached = await detachFromDiscounts(tx, "category", row.id);
  audit.push(...detached.audit);
  await tx.update(C).set({ parentId: null }).where(eq(C.parentId, row.id));
  await tx.delete(C).where(eq(C.id, row.id));
  await dropRedirectsTo(tx, canonicalPath.category(row.slug));
  audit.push({ action: "delete", entity: "category", entityId: row.id, before: { slug: row.slug, name: row.name } });
  const tags: string[] = [
    ...(detached.campaignsChanged ? [TAGS.campaigns] : []),
    ...(detached.themeAffected ? [TAGS.theme] : []),
  ];
  return { slug: row.slug, movedProducts: products, audit, tags, note: detached.summary };
}
