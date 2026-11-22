// Coupon service (discount codes typed at checkout). Takes a transaction, never touches Next APIs.
// Checkout reads coupons itself (src/lib/coupons/validate.ts); nothing here is cached.
// Day 6: gift wheel prizes are coupons too (source "wheel", one per winner, issued by the wheel). The
// panel never edits, deletes or re-activates them: it may only deactivate one (e.g. abuse).
import "server-only";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { CouponType } from "@/db/schema/commerce";
import { auditChanges, type AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import type { CouponCreateInput, CouponUpdateInput } from "./schemas";

const k = schema.coupons;

type CouponColumns = {
  code: string;
  description: string | null;
  type: CouponType;
  value: number;
  minOrderTotal: number;
  maxUses: number | null;
  perCustomerLimit: number | null;
  productIds: number[] | null;
  categoryIds: number[] | null;
  customerGroupIds: number[] | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

const orNull = (ids: number[]) => (ids.length ? ids : null);

function toColumns(input: CouponCreateInput): CouponColumns {
  return {
    code: input.code,
    description: input.description,
    type: input.type,
    value: input.value,
    minOrderTotal: input.minOrderTotal,
    maxUses: input.maxUses,
    perCustomerLimit: input.perCustomerLimit,
    productIds: orNull(input.productIds),
    categoryIds: orNull(input.categoryIds),
    customerGroupIds: orNull(input.customerGroupIds),
    isActive: input.isActive,
    startsAt: input.schedule.startsAt,
    endsAt: input.schedule.endsAt,
  };
}

const editable = {
  id: k.id,
  code: k.code,
  description: k.description,
  type: k.type,
  value: k.value,
  minOrderTotal: k.minOrderTotal,
  maxUses: k.maxUses,
  usedCount: k.usedCount,
  perCustomerLimit: k.perCustomerLimit,
  productIds: k.productIds,
  categoryIds: k.categoryIds,
  customerGroupIds: k.customerGroupIds,
  isActive: k.isActive,
  startsAt: k.startsAt,
  endsAt: k.endsAt,
  updatedAt: k.updatedAt,
  source: k.source,
} as const;

/** Shown when an edit, a delete or a re-activation targets a gift wheel prize. */
export const WHEEL_COUPON_READ_ONLY = "Bu kod bir hediye çarkı ödülü; düzenlenemez, silinemez ve yeniden etkinleştirilemez. Gerekirse yalnızca pasifleştirebilirsiniz.";

/** Codes are matched case-insensitively at checkout, so they must be unique that way too. */
async function assertCodeFree(tx: Tx, code: string, exceptId?: number): Promise<void> {
  const same = sql`upper(${k.code}) = upper(${code})`;
  const [hit] = await tx
    .select({ id: k.id })
    .from(k)
    .where(exceptId != null ? and(same, ne(k.id, exceptId)) : same)
    .limit(1);
  if (hit) throw fieldError("code", "Bu kod başka bir kuponda kullanılıyor. Farklı bir kod girin.");
}

async function assertReferences(tx: Tx, input: CouponCreateInput): Promise<void> {
  const { products, categories, customerGroups } = schema;
  const [productRows, categoryRows, groupRows] = await Promise.all([
    input.productIds.length ? tx.select({ id: products.id }).from(products).where(inArray(products.id, input.productIds)) : Promise.resolve([]),
    input.categoryIds.length ? tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, input.categoryIds)) : Promise.resolve([]),
    input.customerGroupIds.length
      ? tx.select({ id: customerGroups.id }).from(customerGroups).where(inArray(customerGroups.id, input.customerGroupIds))
      : Promise.resolve([]),
  ]);
  if (productRows.length !== input.productIds.length) throw fieldError("productIds", "Seçilen ürünlerden biri artık yok. Listeyi kontrol edin.");
  if (categoryRows.length !== input.categoryIds.length) throw fieldError("categoryIds", "Seçilen kategorilerden biri artık yok. Listeyi kontrol edin.");
  if (groupRows.length !== input.customerGroupIds.length) throw fieldError("customerGroupIds", "Seçilen müşteri gruplarından biri artık yok.");
}

export type CouponSaveResult = { id: number; code: string; updatedAt: Date; audit: AuditEntry };

export async function createCoupon(tx: Tx, input: CouponCreateInput): Promise<CouponSaveResult> {
  await assertCodeFree(tx, input.code);
  await assertReferences(tx, input);
  const values = toColumns(input);
  const [row] = await tx.insert(k).values(values).returning({ id: k.id, updatedAt: k.updatedAt });
  return { id: row.id, code: values.code, updatedAt: row.updatedAt, audit: { action: "create", entity: "coupon", entityId: row.id, after: values } };
}

async function lockCoupon(tx: Tx, id: number) {
  const [row] = await tx.select(editable).from(k).where(eq(k.id, id)).for("update");
  if (!row) throw new PanelError("not_found", "Kupon bulunamadı; silinmiş olabilir.");
  return row;
}

export async function updateCoupon(tx: Tx, input: CouponUpdateInput): Promise<CouponSaveResult> {
  const before = await lockCoupon(tx, input.id);
  if (before.source === "wheel") throw new PanelError("forbidden", WHEEL_COUPON_READ_ONLY);
  assertFresh(before.updatedAt, input.updatedAt);
  if (input.code !== before.code) await assertCodeFree(tx, input.code, input.id);
  if (input.maxUses != null && input.maxUses < before.usedCount) {
    throw fieldError("maxUses", `Kupon şimdiye kadar ${before.usedCount} kez kullanıldı; limit bundan az olamaz.`);
  }
  await assertReferences(tx, input);
  const values = toColumns(input);
  const [row] = await tx
    .update(k)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(k.id, input.id))
    .returning({ id: k.id, updatedAt: k.updatedAt });
  const { updatedAt: _u, id: _i, usedCount: _c, source: _s, ...old } = before;
  void _u;
  void _i;
  void _c;
  void _s;
  return { id: row.id, code: values.code, updatedAt: row.updatedAt, audit: { action: "update", entity: "coupon", entityId: row.id, ...auditChanges(old, values) } };
}

export async function setCouponActive(tx: Tx, input: { id: number; isActive: boolean; updatedAt: Date }): Promise<CouponSaveResult> {
  const before = await lockCoupon(tx, input.id);
  if (before.source === "wheel" && input.isActive) throw new PanelError("forbidden", WHEEL_COUPON_READ_ONLY);
  assertFresh(before.updatedAt, input.updatedAt);
  const [row] = await tx
    .update(k)
    .set({ isActive: input.isActive, updatedAt: new Date() })
    .where(eq(k.id, input.id))
    .returning({ id: k.id, updatedAt: k.updatedAt });
  return {
    id: row.id,
    code: before.code,
    updatedAt: row.updatedAt,
    audit: { action: "status", entity: "coupon", entityId: row.id, before: { isActive: before.isActive }, after: { isActive: input.isActive } },
  };
}

/** Orders that used the coupon (the usage counter can lag behind cancelled orders, the FK cannot). */
export async function couponOrderCount(tx: Tx, id: number): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(schema.orders).where(eq(schema.orders.couponId, id));
  return row?.n ?? 0;
}

/** Only a coupon nobody has used may be deleted; otherwise deactivate it (orders keep their link). */
export async function deleteCoupon(tx: Tx, input: { id: number; updatedAt?: Date }): Promise<{ audit: AuditEntry }> {
  const before = await lockCoupon(tx, input.id);
  if (before.source === "wheel") throw new PanelError("forbidden", WHEEL_COUPON_READ_ONLY);
  if (input.updatedAt) assertFresh(before.updatedAt, input.updatedAt);
  const orders = await couponOrderCount(tx, input.id);
  if (before.usedCount > 0 || orders > 0) {
    const times = Math.max(before.usedCount, orders);
    throw new PanelError("in_use", `“${before.code}” ${times} siparişte kullanıldı; silinemez. Bunun yerine pasifleştirin.`);
  }
  await tx.delete(k).where(eq(k.id, input.id));
  const { updatedAt: _u, source: _s, ...old } = before;
  void _u;
  void _s;
  return { audit: { action: "delete", entity: "coupon", entityId: input.id, before: old } };
}
