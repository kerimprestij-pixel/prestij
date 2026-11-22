// Panel reads of reviews (uncached; /panel/yorumlar and the sidebar badge). Callers check the role.
import "server-only";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { localize } from "@/i18n/localize";
import type { Tx } from "@/lib/panel/tx";
import type { ReviewStatus } from "./types";

const r = schema.reviews;
const p = schema.products;
const o = schema.orders;
const u = schema.user;

export const PANEL_REVIEW_PAGE_SIZE = 20;
export const REVIEW_STATUS_FILTERS = ["pending", "approved", "rejected", "all"] as const;
export type ReviewStatusFilter = (typeof REVIEW_STATUS_FILTERS)[number];

export type PanelReviewFilter = {
  status: ReviewStatusFilter;
  productId: number | null;
  rating: number | null;
  page: number;
};

export type PanelReviewRow = {
  id: number;
  productId: number;
  productName: string;
  productSlug: string;
  productAccent: string | null;
  productActive: boolean;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  locale: string;
  status: ReviewStatus;
  verified: boolean;
  orderId: number | null;
  orderNumber: string | null;
  /** Account e-mail of a signed-in reviewer (null for review-link reviews). */
  accountEmail: string | null;
  reply: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
};

export type PanelReviewList = {
  rows: PanelReviewRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Per status, honouring the product and rating filters. */
  counts: Record<ReviewStatusFilter, number>;
  /** Products that have reviews (for the product filter), Turkish name order. */
  products: { id: number; name: string; count: number; pending: number }[];
};

export async function listPanelReviews(filter: PanelReviewFilter, executor: Tx = db): Promise<PanelReviewList> {
  const base: SQL[] = [];
  if (filter.productId) base.push(eq(r.productId, filter.productId));
  if (filter.rating) base.push(eq(r.rating, filter.rating));
  const where = and(...base, filter.status === "all" ? undefined : eq(r.status, filter.status));

  const [statusRows, totalRow, productRows] = await Promise.all([
    executor
      .select({ status: r.status, n: count() })
      .from(r)
      .where(base.length ? and(...base) : undefined)
      .groupBy(r.status),
    executor.select({ n: count() }).from(r).where(where),
    executor
      .select({
        id: p.id,
        name: p.name,
        n: count(),
        pending: sql<number>`count(*) filter (where ${r.status} = 'pending')::int`,
      })
      .from(r)
      .innerJoin(p, eq(p.id, r.productId))
      .groupBy(p.id, p.name),
  ]);

  const total = Number(totalRow[0]?.n ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PANEL_REVIEW_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(filter.page) || 1), pageCount);

  const rows = await executor
    .select({
      id: r.id,
      productId: r.productId,
      productName: p.name,
      productSlug: p.slug,
      productAccent: p.accentColor,
      productStatus: p.status,
      rating: r.rating,
      title: r.title,
      body: r.body,
      authorName: r.authorName,
      locale: r.locale,
      status: r.status,
      verified: r.isVerifiedPurchase,
      orderId: r.orderId,
      orderNumber: o.orderNumber,
      accountEmail: u.email,
      reply: r.adminReply,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      approvedAt: r.approvedAt,
    })
    .from(r)
    .innerJoin(p, eq(p.id, r.productId))
    .leftJoin(o, eq(o.id, r.orderId))
    .leftJoin(u, eq(u.id, r.userId))
    .where(where)
    .orderBy(sql`case when ${r.status} = 'pending' then 0 else 1 end`, desc(r.createdAt), desc(r.id))
    .limit(PANEL_REVIEW_PAGE_SIZE)
    .offset((page - 1) * PANEL_REVIEW_PAGE_SIZE);

  const counts: Record<ReviewStatusFilter, number> = { pending: 0, approved: 0, rejected: 0, all: 0 };
  for (const row of statusRows) {
    const n = Number(row.n);
    counts[row.status] = n;
    counts.all += n;
  }

  return {
    rows: rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productName: localize(row.productName, "tr"),
      productSlug: row.productSlug,
      productAccent: row.productAccent,
      productActive: row.productStatus === "active",
      rating: row.rating,
      title: row.title,
      body: row.body,
      authorName: row.authorName,
      locale: row.locale,
      status: row.status,
      verified: row.verified,
      orderId: row.orderId,
      orderNumber: row.orderNumber ?? null,
      accountEmail: row.accountEmail ?? null,
      reply: row.reply,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    })),
    total,
    page,
    pageSize: PANEL_REVIEW_PAGE_SIZE,
    pageCount,
    counts,
    products: productRows
      .map((row) => ({ id: row.id, name: localize(row.name, "tr"), count: Number(row.n), pending: Number(row.pending) }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr")),
  };
}

/** Reviews waiting for moderation (sidebar badge). */
export async function countPendingReviews(executor: Tx = db): Promise<number> {
  const [row] = await executor.select({ n: count() }).from(r).where(eq(r.status, "pending"));
  return Number(row?.n ?? 0);
}

