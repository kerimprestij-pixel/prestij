// Campaigns and coupons keep their product/category scope in int[] columns without a foreign key.
// When a category or product is deleted, its id is removed from those lists in the same transaction
// (with an audit row per changed record). A discount whose whole scope disappears is switched off
// instead of silently widening to every product (an empty scope means "all products").
import "server-only";
import { eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { AuditEntry } from "@/lib/panel/audit";
import type { Tx } from "@/lib/panel/tx";

export type DetachResult = {
  audit: AuditEntry[];
  /** Campaign rows changed (storefront prices may change: return TAGS.campaigns). */
  campaignsChanged: boolean;
  /** A changed campaign had a linked theme that may switch off (return TAGS.theme). */
  themeAffected: boolean;
  /** Turkish summary for the success message, e.g. "1 kampanya ve 2 kupondan çıkarıldı". */
  summary: string | null;
};

const listed = (list: readonly number[] | null | undefined): list is number[] => Array.isArray(list) && list.length > 0;

/** Pure: the scope after removing `id` from `field`, and whether the discount must be switched off. */
export function scopeWithout(
  row: { productIds: number[] | null; categoryIds: number[] | null; isActive: boolean },
  field: "productIds" | "categoryIds",
  id: number,
): { productIds: number[] | null; categoryIds: number[] | null; isActive: boolean } {
  const next = { productIds: row.productIds, categoryIds: row.categoryIds, isActive: row.isActive };
  const remaining = (row[field] ?? []).filter((x) => x !== id);
  next[field] = remaining.length ? remaining : null;
  const hadScope = listed(row.productIds) || listed(row.categoryIds);
  const hasScope = listed(next.productIds) || listed(next.categoryIds);
  if (hadScope && !hasScope) next.isActive = false;
  return next;
}

export async function detachFromDiscounts(tx: Tx, kind: "category" | "product", id: number): Promise<DetachResult> {
  const field = kind === "category" ? "categoryIds" : "productIds";
  const C = schema.campaigns;
  const K = schema.coupons;
  const audit: AuditEntry[] = [];
  let campaignsChanged = false;
  let themeAffected = false;
  let disabled = 0;

  const campaigns = await tx
    .select({ id: C.id, name: C.name, productIds: C.productIds, categoryIds: C.categoryIds, isActive: C.isActive, themeId: C.themeId })
    .from(C)
    .where(sql`${C[field]} @> array[${id}]::integer[]`)
    .for("update");
  for (const row of campaigns) {
    const next = scopeWithout(row, field, id);
    await tx.update(C).set({ ...next, updatedAt: new Date() }).where(eq(C.id, row.id));
    campaignsChanged = true;
    if (row.themeId != null && row.isActive !== next.isActive) themeAffected = true;
    if (row.isActive && !next.isActive) disabled++;
    audit.push({
      action: "update",
      entity: "campaign",
      entityId: row.id,
      before: { name: row.name, [field]: row[field], isActive: row.isActive },
      after: { name: row.name, [field]: next[field], isActive: next.isActive },
    });
  }

  const coupons = await tx
    .select({ id: K.id, code: K.code, productIds: K.productIds, categoryIds: K.categoryIds, isActive: K.isActive })
    .from(K)
    .where(sql`${K[field]} @> array[${id}]::integer[]`)
    .for("update");
  for (const row of coupons) {
    const next = scopeWithout(row, field, id);
    await tx.update(K).set({ ...next, updatedAt: new Date() }).where(eq(K.id, row.id));
    if (row.isActive && !next.isActive) disabled++;
    audit.push({
      action: "update",
      entity: "coupon",
      entityId: row.id,
      before: { code: row.code, [field]: row[field], isActive: row.isActive },
      after: { code: row.code, [field]: next[field], isActive: next.isActive },
    });
  }

  const parts = [campaigns.length ? `${campaigns.length} kampanya` : null, coupons.length ? `${coupons.length} kupon` : null].filter(Boolean);
  const summary = parts.length
    ? `${parts.join(" ve ")} kapsamından çıkarıldı${disabled ? `; kapsamı boşalan ${disabled} indirim pasif yapıldı` : ""}.`
    : null;
  return { audit, campaignsChanged, themeAffected, summary };
}
