// Panel reads for campaigns and coupons (uncached, all locales). Callers have passed requireStaff("editor").
import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import type { CouponSource, CouponType, OrderStatus } from "@/db/schema/commerce";
import type { WheelBoundVia } from "@/db/schema/wheel";
import type { Tx } from "@/lib/panel/tx";
import { scheduleStatus, wheelCouponStatus, type ScheduleStatus, type WheelCouponStatus } from "./status";

export type CampaignStatus = Exclude<ScheduleStatus, "exhausted">;

export type NamedOption = { id: number; name: string };

/** Customer groups for the group checkboxes (Turkish names). */
export async function customerGroupOptions(executor: Tx = db): Promise<(NamedOption & { isBusiness: boolean; discountPercent: number })[]> {
  const g = schema.customerGroups;
  const rows = await executor
    .select({ id: g.id, name: g.name, isBusiness: g.isBusiness, discountPercent: g.discountPercent })
    .from(g)
    .orderBy(asc(g.id));
  return rows.map((r) => ({ ...r, name: r.name.tr }));
}

/** Themes a campaign may switch on (the default theme is always on, so it is not offered). */
export async function themeOptions(executor: Tx = db): Promise<(NamedOption & { isDefault: boolean })[]> {
  const t = schema.themes;
  const rows = await executor.select({ id: t.id, name: t.name, isDefault: t.isDefault }).from(t).orderBy(asc(t.priority), asc(t.id));
  return rows;
}

async function namesOf(executor: Tx, productIds: number[], categoryIds: number[]) {
  const { products: p, categories: c } = schema;
  const [products, categories] = await Promise.all([
    productIds.length ? executor.select({ id: p.id, name: p.name }).from(p).where(inArray(p.id, productIds)) : Promise.resolve([]),
    categoryIds.length ? executor.select({ id: c.id, name: c.name }).from(c).where(inArray(c.id, categoryIds)) : Promise.resolve([]),
  ]);
  return {
    products: new Map(products.map((r) => [r.id, r.name.tr])),
    categories: new Map(categories.map((r) => [r.id, r.name.tr])),
  };
}

// ---------------------------------------------------------------------------------------------------
// Campaigns

export type CampaignListRow = {
  id: number;
  name: string;
  label: LocalizedText | null;
  discountPercent: number;
  productNames: string[];
  categoryNames: string[];
  customerGroupNames: string[];
  themeName: string | null;
  priority: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
  /** Status now (server clock). */
  status: CampaignStatus;
};

export async function listPanelCampaigns(executor: Tx = db): Promise<CampaignListRow[]> {
  const c = schema.campaigns;
  const rows = await executor.select().from(c).orderBy(desc(c.isActive), desc(c.priority), desc(c.id));
  const productIds = [...new Set(rows.flatMap((r) => r.productIds ?? []))];
  const categoryIds = [...new Set(rows.flatMap((r) => r.categoryIds ?? []))];
  const [names, groups, themes] = await Promise.all([namesOf(executor, productIds, categoryIds), customerGroupOptions(executor), themeOptions(executor)]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const themeName = new Map(themes.map((t) => [t.id, t.name]));
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    label: r.label,
    discountPercent: r.discountPercent,
    productNames: (r.productIds ?? []).map((id) => names.products.get(id) ?? `#${id}`),
    categoryNames: (r.categoryIds ?? []).map((id) => names.categories.get(id) ?? `#${id}`),
    customerGroupNames: (r.customerGroupIds ?? []).map((id) => groupName.get(id) ?? `#${id}`),
    themeName: r.themeId != null ? (themeName.get(r.themeId) ?? null) : null,
    priority: r.priority,
    isActive: r.isActive,
    startsAt: r.startsAt?.toISOString() ?? null,
    endsAt: r.endsAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
    status: scheduleStatus(r, now) as CampaignStatus,
  }));
}

/** Editor state for one campaign (Dates as ISO strings), or null. */
export async function getPanelCampaign(id: number, executor: Tx = db) {
  const c = schema.campaigns;
  const [r] = await executor.select().from(c).where(eq(c.id, id)).limit(1);
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    label: r.label,
    discountPercent: r.discountPercent,
    productIds: r.productIds ?? [],
    categoryIds: r.categoryIds ?? [],
    customerGroupIds: r.customerGroupIds ?? [],
    schedule: { startsAt: r.startsAt?.toISOString() ?? null, endsAt: r.endsAt?.toISOString() ?? null },
    priority: r.priority,
    isActive: r.isActive,
    themeId: r.themeId,
    updatedAt: r.updatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    status: scheduleStatus(r, Date.now()) as CampaignStatus,
  };
}

// ---------------------------------------------------------------------------------------------------
// Coupons

export type CouponListRow = {
  id: number;
  code: string;
  description: string | null;
  type: CouponType;
  value: number;
  minOrderTotal: number;
  maxUses: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
  scoped: boolean;
  grouped: boolean;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
  orderCount: number;
  /** Status now (server clock). */
  status: ScheduleStatus;
};

/**
 * The Kuponlar list: codes made in the panel only (source "manual"). Gift wheel prizes (one per winner)
 * live under Pazarlama → Hediye Çarkı; one can still be opened read-only by its code (findCouponByCode).
 */
export async function listPanelCoupons(executor: Tx = db): Promise<CouponListRow[]> {
  const k = schema.coupons;
  const o = schema.orders;
  const [rows, usage] = await Promise.all([
    executor.select().from(k).where(eq(k.source, "manual")).orderBy(desc(k.isActive), desc(k.createdAt), desc(k.id)),
    executor
      .select({ couponId: o.couponId, n: count() })
      .from(o)
      .innerJoin(k, eq(k.id, o.couponId))
      .where(and(isNotNull(o.couponId), eq(k.source, "manual")))
      .groupBy(o.couponId),
  ]);
  const orders = new Map(usage.map((u) => [u.couponId, u.n]));
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    description: r.description,
    type: r.type,
    value: r.value,
    minOrderTotal: r.minOrderTotal,
    maxUses: r.maxUses,
    usedCount: r.usedCount,
    perCustomerLimit: r.perCustomerLimit,
    scoped: Boolean(r.productIds?.length || r.categoryIds?.length),
    grouped: Boolean(r.customerGroupIds?.length),
    isActive: r.isActive,
    startsAt: r.startsAt?.toISOString() ?? null,
    endsAt: r.endsAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
    orderCount: orders.get(r.id) ?? 0,
    status: scheduleStatus(r, now),
  }));
}

/** Editor state for one coupon (Dates as ISO strings), or null. */
export async function getPanelCoupon(id: number, executor: Tx = db) {
  const k = schema.coupons;
  const [r] = await executor.select().from(k).where(eq(k.id, id)).limit(1);
  if (!r) return null;
  const [{ n }] = await executor.select({ n: count() }).from(schema.orders).where(eq(schema.orders.couponId, id));
  return {
    id: r.id,
    code: r.code,
    description: r.description ?? "",
    type: r.type,
    value: r.value,
    minOrderTotal: r.minOrderTotal,
    maxUses: r.maxUses,
    perCustomerLimit: r.perCustomerLimit,
    productIds: r.productIds ?? [],
    categoryIds: r.categoryIds ?? [],
    customerGroupIds: r.customerGroupIds ?? [],
    schedule: { startsAt: r.startsAt?.toISOString() ?? null, endsAt: r.endsAt?.toISOString() ?? null },
    isActive: r.isActive,
    updatedAt: r.updatedAt.toISOString(),
    usedCount: r.usedCount,
    orderCount: n,
    createdAt: r.createdAt.toISOString(),
    status: scheduleStatus(r, Date.now()),
    /** Day 6: "wheel" = a gift wheel prize (read-only in the panel: deactivate only). */
    source: r.source,
  };
}

/** A coupon by its exact code (case-insensitive), for the Kuponlar search: finds gift wheel prizes too. */
export async function findCouponByCode(code: string, executor: Tx = db): Promise<{ id: number; code: string; source: CouponSource } | null> {
  const wanted = code.trim();
  if (!wanted || wanted.length > 64) return null;
  const k = schema.coupons;
  const [row] = await executor
    .select({ id: k.id, code: k.code, source: k.source })
    .from(k)
    .where(sql`upper(${k.code}) = upper(${wanted})`)
    .limit(1);
  return row ?? null;
}

export type WheelCouponDetail = {
  id: number;
  code: string;
  type: CouponType;
  value: number;
  minOrderTotal: number;
  isActive: boolean;
  usedCount: number;
  maxUses: number | null;
  /** Issue (claim) time and expiry, ISO. */
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: WheelCouponStatus;
  owner: { id: string; name: string; email: string } | null;
  spin: {
    id: number;
    round: number;
    sliceKey: string;
    label: LocalizedText;
    boundVia: WheelBoundVia | null;
    locale: string;
    spunAt: string;
    claimedAt: string | null;
  } | null;
  /** Orders that used the code (newest first; a cancelled one gives the prize back until it expires). */
  orders: { id: number; orderNumber: string; status: OrderStatus; grandTotal: number; createdAt: string }[];
};

/** A gift wheel prize coupon with its owner, spin and orders, or null (no such coupon, or a manual one). */
export async function getWheelCouponDetail(id: number, executor: Tx = db, now = Date.now()): Promise<WheelCouponDetail | null> {
  const k = schema.coupons;
  const [r] = await executor.select().from(k).where(and(eq(k.id, id), eq(k.source, "wheel"))).limit(1);
  if (!r) return null;
  const u = schema.user;
  const s = schema.wheelSpins;
  const o = schema.orders;
  const [owners, spins, orders] = await Promise.all([
    r.userId ? executor.select({ id: u.id, name: u.name, email: u.email }).from(u).where(eq(u.id, r.userId)).limit(1) : Promise.resolve([]),
    executor
      .select({ id: s.id, round: s.round, sliceKey: s.sliceKey, prize: s.prize, boundVia: s.boundVia, locale: s.locale, createdAt: s.createdAt, claimedAt: s.claimedAt })
      .from(s)
      .where(eq(s.couponId, r.id))
      .limit(1),
    executor
      .select({ id: o.id, orderNumber: o.orderNumber, status: o.status, grandTotal: o.grandTotal, createdAt: o.createdAt })
      .from(o)
      .where(eq(o.couponId, r.id))
      .orderBy(desc(o.createdAt), desc(o.id))
      .limit(20),
  ]);
  const spin = spins[0];
  return {
    id: r.id,
    code: r.code,
    type: r.type,
    value: r.value,
    minOrderTotal: r.minOrderTotal,
    isActive: r.isActive,
    usedCount: r.usedCount,
    maxUses: r.maxUses,
    startsAt: r.startsAt?.toISOString() ?? null,
    endsAt: r.endsAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    status: wheelCouponStatus(r, now),
    owner: owners[0] ?? null,
    spin: spin
      ? {
          id: spin.id,
          round: spin.round,
          sliceKey: spin.sliceKey,
          label: spin.prize.label,
          boundVia: spin.boundVia,
          locale: spin.locale,
          spunAt: spin.createdAt.toISOString(),
          claimedAt: spin.claimedAt?.toISOString() ?? null,
        }
      : null,
    orders: orders.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })),
  };
}
