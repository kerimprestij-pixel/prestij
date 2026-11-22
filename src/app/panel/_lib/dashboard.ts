// Dashboard reads. Uncached on purpose: staff must see live numbers.
// Callers are panel components that have already passed requireStaff().
// Every "today / last N days" boundary is computed by PostgreSQL in Europe/Istanbul (no server clock,
// no prerender time involved).
import "server-only";
import { and, asc, count, desc, eq, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { companies, contactMessages, orders, products, productVariants, quoteRequests, reviews, sampleRequests } from "@/db/schema";
import type { OrderStatus } from "@/db/schema/commerce";
import { countOverdueBankTransfers } from "@/lib/orders/bank-transfer-overdue";
import { countPaymentEventAlerts, notifyRefusalSummary, type NotifyRefusalSummary } from "@/lib/payments/alerts";
import { countUnverifiedCardPayments } from "@/lib/payments/unverified";
import { getSettings } from "@/lib/settings/get-settings";

/** Orders counted as sales (contract: paid, processing, shipped, delivered). Cancelled/refunded never count. */
export const REVENUE_STATUSES = ["paid", "processing", "shipped", "delivered"] as const satisfies readonly OrderStatus[];
const REVENUE = sql.raw(`status in ('paid', 'processing', 'shipped', 'delivered')`);

/** Midnight today in Türkiye. */
const TODAY_SQL = `(date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul')`;
const startOfToday = sql.raw(TODAY_SQL);
/** Midnight `n` days before today in Türkiye. */
const daysBack = (n: number) => sql.raw(`(${TODAY_SQL} - interval '${Math.trunc(n)} days')`);

const lowStockWhere = and(
  eq(productVariants.isActive, true),
  eq(productVariants.trackStock, true),
  lte(productVariants.stock, productVariants.lowStockThreshold),
  ne(products.status, "archived"),
);

export type SalesWindow = {
  /** Kuruş. */
  revenue: number;
  orders: number;
  /** Average order value in kuruş (0 without orders). */
  average: number;
};

export type SalesSummary = {
  today: SalesWindow;
  yesterday: SalesWindow;
  /** Today and the 6 days before. */
  last7: SalesWindow;
  previous7: SalesWindow;
  /** Today and the 29 days before. */
  last30: SalesWindow;
  previous30: SalesWindow;
};

const windowOf = (revenue: number, orders: number): SalesWindow => ({
  revenue,
  orders,
  average: orders > 0 ? Math.round(revenue / orders) : 0,
});

export async function getSalesSummary(): Promise<SalesSummary> {
  const t0 = startOfToday;
  const sumIn = (from: SQL, to: SQL | null) =>
    to
      ? sql`coalesce(sum(${orders.grandTotal}) filter (where ${orders.createdAt} >= ${from} and ${orders.createdAt} < ${to}), 0)`
      : sql`coalesce(sum(${orders.grandTotal}) filter (where ${orders.createdAt} >= ${from}), 0)`;
  const countIn = (from: SQL, to: SQL | null) =>
    to
      ? sql`count(*) filter (where ${orders.createdAt} >= ${from} and ${orders.createdAt} < ${to})`
      : sql`count(*) filter (where ${orders.createdAt} >= ${from})`;
  const d1 = daysBack(1);
  const d6 = daysBack(6);
  const d13 = daysBack(13);
  const d29 = daysBack(29);
  const d59 = daysBack(59);

  const [row] = await db
    .select({
      todayRevenue: sumIn(t0, null).mapWith(Number),
      todayOrders: countIn(t0, null).mapWith(Number),
      yesterdayRevenue: sumIn(d1, t0).mapWith(Number),
      yesterdayOrders: countIn(d1, t0).mapWith(Number),
      last7Revenue: sumIn(d6, null).mapWith(Number),
      last7Orders: countIn(d6, null).mapWith(Number),
      prev7Revenue: sumIn(d13, d6).mapWith(Number),
      prev7Orders: countIn(d13, d6).mapWith(Number),
      last30Revenue: sumIn(d29, null).mapWith(Number),
      last30Orders: countIn(d29, null).mapWith(Number),
      prev30Revenue: sumIn(d59, d29).mapWith(Number),
      prev30Orders: countIn(d59, d29).mapWith(Number),
    })
    .from(orders)
    .where(and(REVENUE, sql`${orders.createdAt} >= ${d59}`));

  return {
    today: windowOf(row?.todayRevenue ?? 0, row?.todayOrders ?? 0),
    yesterday: windowOf(row?.yesterdayRevenue ?? 0, row?.yesterdayOrders ?? 0),
    last7: windowOf(row?.last7Revenue ?? 0, row?.last7Orders ?? 0),
    previous7: windowOf(row?.prev7Revenue ?? 0, row?.prev7Orders ?? 0),
    last30: windowOf(row?.last30Revenue ?? 0, row?.last30Orders ?? 0),
    previous30: windowOf(row?.prev30Revenue ?? 0, row?.prev30Orders ?? 0),
  };
}

export type DailySales = { day: string; revenue: number; orders: number };

/** One row per Istanbul calendar day for the last `days` days (oldest first), zero-filled. */
export async function getDailySales(days = 30): Promise<DailySales[]> {
  const span = Math.max(1, Math.min(90, Math.trunc(days))) - 1;
  const rows = await db.execute<{ day: string; revenue: string; orders: string }>(sql`
    with days as (
      select generate_series(
        (now() at time zone 'Europe/Istanbul')::date - ${span}::int,
        (now() at time zone 'Europe/Istanbul')::date,
        interval '1 day'
      )::date as day
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
           coalesce(sum(o.grand_total), 0)::text as revenue,
           count(o.id)::text as orders
    from days d
    left join ${orders} o
      on (o.created_at at time zone 'Europe/Istanbul')::date = d.day
     and o.status in ('paid', 'processing', 'shipped', 'delivered')
    group by d.day
    order by d.day
  `);
  return rows.map((r) => ({ day: r.day, revenue: Number(r.revenue), orders: Number(r.orders) }));
}

export type DashboardTodo = {
  /** Havale/EFT orders waiting for the money to be confirmed. */
  awaitingTransfer: number;
  /** SR-2: of those, the ones past their payment deadline (call the customer or cancel; never cancelled automatically). */
  overdueTransfers: number;
  /** Paid (or kapıda ödeme / vadeli) orders to prepare and ship. */
  toShip: number;
  /** Card checkouts started but not completed. */
  pendingPayment: number;
  unreadMessages: number;
  pendingSamples: number;
  /** Approved sample requests that still have to be shipped. */
  samplesToShip: number;
  /** Cancelled orders whose (card) money arrived anyway: refund it, then mark the order refunded. */
  paidCancelled: number;
  /**
   * Card orders still waiting whose PayTR result could not be checked for 24 hours (order_events
   * "payment_unverified", raised by the expiry job, which never cancels them): check at PayTR, then mark paid or cancel.
   */
  unverifiedCard: number;
  /**
   * PayTR-fix IMPL-A2 (src/lib/payments/alerts.ts): the notify endpoint refused PayTR notifications (bad hash, missing
   * fields, keys not configured) in the last 72 hours: "PayTR bildirimleri reddediliyor" with the last time and a count.
   * Only refusals naming a stored attempt of one of our orders are counted (R5).
   */
  paytrNotifyRefused: NotifyRefusalSummary | null;
  /** C5: orders that got a PayTR test payment for an attempt sent live (not marked paid), last 72 hours. */
  paytrTestOnLive: number;
  /** C13a: unpaid orders where a success arrived after a recorded failure for the same payment, last 14 days. */
  paymentSuccessAfterFailure: number;
  /** PayTR-fix R-UX8: the affected order when exactly one order carries the warning (the line opens it), else null. */
  paytrTestOnLiveOrderId: number | null;
  paymentSuccessAfterFailureOrderId: number | null;
  pendingCompanies: number;
  /** Quote requests that nobody has answered yet (new or in review). */
  pendingQuotes: number;
  /** Reviews waiting for moderation (shown to editors and admins only). */
  pendingReviews: number;
  lowStockVariants: number;
  activeProducts: number;
};

/** `now`: the request time (the havale payment deadline is a calendar rule, SR-2). */
export async function getDashboardTodo(now: Date): Promise<DashboardTodo> {
  const paymentDays = (await getSettings("payments")).bankTransfer.paymentDays;
  const [[o], [messages], [samples], [pendingCompanies], [quotes], [pendingReviews], [lowStock], [active], overdueTransfers, unverifiedCard, notifyRefused, eventAlerts] = await Promise.all([
    db
      .select({
        awaitingTransfer: sql<number>`count(*) filter (where ${orders.status} = 'awaiting_transfer')`.mapWith(Number),
        toShip: sql<number>`count(*) filter (where ${orders.status} in ('paid', 'processing'))`.mapWith(Number),
        pendingPayment: sql<number>`count(*) filter (where ${orders.status} = 'pending_payment')`.mapWith(Number),
        paidCancelled: sql<number>`count(*) filter (where ${orders.status} = 'cancelled' and ${orders.paidAt} is not null)`.mapWith(Number),
      })
      .from(orders)
      .where(inArray(orders.status, ["awaiting_transfer", "paid", "processing", "pending_payment", "cancelled"])),
    db.select({ n: count() }).from(contactMessages).where(eq(contactMessages.isRead, false)),
    db
      .select({
        n: sql<number>`count(*) filter (where ${sampleRequests.status} in ('new', 'in_review'))`.mapWith(Number),
        toShip: sql<number>`count(*) filter (where ${sampleRequests.status} = 'approved')`.mapWith(Number),
      })
      .from(sampleRequests)
      .where(inArray(sampleRequests.status, ["new", "in_review", "approved"])),
    db.select({ n: count() }).from(companies).where(eq(companies.status, "pending")),
    db
      .select({ n: count() })
      .from(quoteRequests)
      .where(inArray(quoteRequests.status, ["new", "in_review"])),
    db.select({ n: count() }).from(reviews).where(eq(reviews.status, "pending")),
    db
      .select({ n: count() })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(lowStockWhere),
    db
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.status, "active"), ne(products.type, "sample"))),
    countOverdueBankTransfers(db, { paymentDays, now }),
    countUnverifiedCardPayments(db),
    notifyRefusalSummary(db, now.getTime()),
    countPaymentEventAlerts(db, now.getTime()),
  ]);

  return {
    awaitingTransfer: o?.awaitingTransfer ?? 0,
    overdueTransfers,
    toShip: o?.toShip ?? 0,
    pendingPayment: o?.pendingPayment ?? 0,
    unreadMessages: messages?.n ?? 0,
    pendingSamples: samples?.n ?? 0,
    samplesToShip: samples?.toShip ?? 0,
    paidCancelled: o?.paidCancelled ?? 0,
    unverifiedCard,
    paytrNotifyRefused: notifyRefused,
    paytrTestOnLive: eventAlerts.testOnLive,
    paymentSuccessAfterFailure: eventAlerts.successAfterFailure,
    paytrTestOnLiveOrderId: eventAlerts.testOnLiveOrderId,
    paymentSuccessAfterFailureOrderId: eventAlerts.successAfterFailureOrderId,
    pendingCompanies: pendingCompanies?.n ?? 0,
    pendingQuotes: quotes?.n ?? 0,
    pendingReviews: pendingReviews?.n ?? 0,
    lowStockVariants: lowStock?.n ?? 0,
    activeProducts: active?.n ?? 0,
  };
}

export async function getRecentOrders(limit = 8) {
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      email: orders.email,
      customerName: sql<string | null>`${orders.shippingAddress}->>'fullName'`,
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      grandTotal: orders.grandTotal,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

export type RecentOrder = Awaited<ReturnType<typeof getRecentOrders>>[number];

export async function getLowStockVariants(limit = 6) {
  return db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      stock: productVariants.stock,
      threshold: productVariants.lowStockThreshold,
      volumeMl: productVariants.volumeMl,
      productId: products.id,
      productName: products.name,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(lowStockWhere)
    .orderBy(asc(productVariants.stock), asc(productVariants.sku))
    .limit(limit);
}

export type LowStockVariant = Awaited<ReturnType<typeof getLowStockVariants>>[number];

export async function getRecentMessages(limit = 4) {
  return db
    .select({
      id: contactMessages.id,
      name: contactMessages.name,
      subject: contactMessages.subject,
      message: sql<string>`left(${contactMessages.message}, 160)`,
      isRead: contactMessages.isRead,
      createdAt: contactMessages.createdAt,
    })
    .from(contactMessages)
    .where(eq(contactMessages.isRead, false))
    .orderBy(desc(contactMessages.createdAt))
    .limit(limit);
}

export type RecentMessage = Awaited<ReturnType<typeof getRecentMessages>>[number];
