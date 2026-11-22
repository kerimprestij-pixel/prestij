// Read models of subscriptions: the customer's /hesap/abonelikler and the panel list/detail.
import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AddressData, OrderStatus, PaymentMethod } from "@/db/schema/commerce";
import { intlLocale, type Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import type { Messages } from "@/i18n/messages";
import { href } from "@/i18n/paths";
import { loadVariantLines } from "@/lib/cart/load";
import type { DbExecutor } from "@/lib/cart/settings";
import { RETAIL_CUSTOMER } from "@/lib/cart/types";
import { paymentMethodLabel } from "@/lib/cart/view";
import type { MediaLike } from "@/lib/media/types";
import { escapeLike } from "@/lib/panel/format";
import { formatPrice } from "@/lib/pricing/money";
import { anchorDayOf, nextRunAfter } from "./schedule";
import type { SubscriptionItem } from "./service";
import type { SubscriptionStatus } from "./types";

const subs = schema.subscriptions;
const plans = schema.subscriptionPlans;
const o = schema.orders;

export type SubscriptionItemView = {
  variantId: number;
  name: string;
  detail: string | null;
  quantity: number;
  image: MediaLike | null;
  accentColor: string | null;
  href: string | null;
};

export type SubscriptionOrderView = {
  id: number;
  orderNumber: string;
  status: OrderStatus;
  grandTotal: number;
  createdAt: string;
  /** The order that started the subscription (else a renewal). */
  first: boolean;
};

export type SubscriptionDetail = {
  id: number;
  userId: string;
  status: SubscriptionStatus;
  planId: number;
  planName: { tr: string; en?: string; ar?: string };
  percent: number;
  interval: "week" | "month";
  intervalCount: number;
  nextRunAt: string;
  /** With skipNext: the renewal after the skipped one. */
  followingRunAt: string | null;
  skipNext: boolean;
  failedCount: number;
  reminderSentAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  email: string;
  locale: string;
  paymentMethod: PaymentMethod;
  shippingAddress: AddressData;
  items: SubscriptionItem[];
  orders: SubscriptionOrderView[];
};

type Row = typeof subs.$inferSelect & { planName: SubscriptionDetail["planName"]; percent: number; interval: "week" | "month"; intervalCount: number };

async function ordersFor(executor: DbExecutor, ids: number[]): Promise<Map<number, SubscriptionOrderView[]>> {
  const out = new Map<number, SubscriptionOrderView[]>();
  if (ids.length === 0) return out;
  const renewals = await executor
    .select({ id: o.id, orderNumber: o.orderNumber, status: o.status, grandTotal: o.grandTotal, createdAt: o.createdAt, subscriptionId: o.subscriptionId })
    .from(o)
    .where(inArray(o.subscriptionId, ids))
    .orderBy(desc(o.createdAt));
  // The first order is linked by its `subscription_created` event (orders.subscription_id is for renewals).
  const e = schema.orderEvents;
  const firsts = await executor
    .select({ id: o.id, orderNumber: o.orderNumber, status: o.status, grandTotal: o.grandTotal, createdAt: o.createdAt, data: e.data })
    .from(e)
    .innerJoin(o, eq(o.id, e.orderId))
    .where(
      and(
        eq(e.type, "subscription_created"),
        sql`exists (select 1 from jsonb_array_elements_text(${e.data}->'subscriptionIds') as x(v) where x.v::int in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )}))`,
      ),
    );
  const add = (subId: number, view: SubscriptionOrderView) => out.set(subId, [...(out.get(subId) ?? []), view]);
  for (const r of renewals) if (r.subscriptionId != null) add(r.subscriptionId, { ...r, createdAt: r.createdAt.toISOString(), first: false });
  for (const f of firsts) {
    const subIds = ((f.data as { subscriptionIds?: unknown } | null)?.subscriptionIds ?? []) as unknown[];
    for (const id of subIds) if (typeof id === "number" && ids.includes(id)) add(id, { id: f.id, orderNumber: f.orderNumber, status: f.status, grandTotal: f.grandTotal, createdAt: f.createdAt.toISOString(), first: true });
  }
  return out;
}

function toDetail(r: Row, orders: SubscriptionOrderView[]): SubscriptionDetail {
  return {
    id: r.id,
    userId: r.userId,
    status: r.status,
    planId: r.planId,
    planName: r.planName,
    percent: r.percent,
    interval: r.interval,
    intervalCount: r.intervalCount,
    nextRunAt: r.nextRunAt.toISOString(),
    followingRunAt: r.skipNext ? nextRunAfter(r.nextRunAt, r, r.nextRunAt, anchorDayOf(r.createdAt)).toISOString() : null,
    skipNext: r.skipNext,
    failedCount: r.failedCount,
    reminderSentAt: r.reminderSentAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    email: r.email,
    locale: r.locale,
    paymentMethod: r.paymentMethod,
    shippingAddress: r.shippingAddress,
    items: r.items,
    orders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

const rowColumns = {
  sub: subs,
  planName: plans.name,
  percent: plans.discountPercent,
  interval: plans.interval,
  intervalCount: plans.intervalCount,
};

async function loadRows(executor: DbExecutor, where: SQL | undefined, opts: { limit?: number; offset?: number } = {}): Promise<SubscriptionDetail[]> {
  const rows = await executor
    .select(rowColumns)
    .from(subs)
    .innerJoin(plans, eq(plans.id, subs.planId))
    .where(where)
    .orderBy(sql`case ${subs.status} when 'active' then 0 when 'past_due' then 1 when 'paused' then 2 else 3 end`, asc(subs.nextRunAt), desc(subs.id))
    .limit(opts.limit ?? 200)
    .offset(opts.offset ?? 0);
  const flat: Row[] = rows.map((r) => ({ ...r.sub, planName: r.planName, percent: r.percent, interval: r.interval, intervalCount: r.intervalCount }));
  const orders = await ordersFor(executor, flat.map((r) => r.id));
  return flat.map((r) => toDetail(r, orders.get(r.id) ?? []));
}

/** The customer's own subscriptions (active first). */
export async function listUserSubscriptions(userId: string, executor: DbExecutor = db): Promise<SubscriptionDetail[]> {
  return loadRows(executor, eq(subs.userId, userId));
}

/** One subscription for the panel (any owner), or null. */
export async function getSubscriptionDetail(id: number, executor: DbExecutor = db): Promise<SubscriptionDetail | null> {
  const [row] = await loadRows(executor, eq(subs.id, id), { limit: 1 });
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------
// Display helpers

/** Current names, variant labels and images of the items (localized; retail context, no prices). */
export async function describeItems(items: readonly SubscriptionItem[], locale: Locale, executor: DbExecutor = db): Promise<SubscriptionItemView[]> {
  const lines = await loadVariantLines(executor, items, RETAIL_CUSTOMER);
  return lines.map((l) => {
    const d = l.display;
    const detail = [localize(d.subtitle, locale), ...d.variantLabels.map((x) => localize(x, locale))].filter(Boolean).join(" · ");
    return {
      variantId: l.variantId,
      name: localize(d.name, locale),
      detail: detail || null,
      quantity: l.quantity,
      image: d.image,
      accentColor: d.accentColor,
      href: l.productType === "sample" ? null : href(locale, "product", { slug: d.productSlug }),
    };
  });
}

/** "12 Aralık 2026" in Europe/Istanbul. */
export function formatDay(iso: string | null, locale: Locale): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(new Date(iso));
}

export function addressLines(a: AddressData): string[] {
  return [a.fullName, [a.neighbourhood, a.line1].filter(Boolean).join(", "), [a.district, a.city].filter(Boolean).join(" / ") + (a.postalCode ? ` ${a.postalCode}` : ""), a.phone].filter(
    (x): x is string => Boolean(x && x.trim()),
  );
}

export function paymentText(method: PaymentMethod, messages: Messages): string {
  return paymentMethodLabel(method, messages);
}

export const money = formatPrice;

// ---------------------------------------------------------------------------------------------
// Panel list

export type PanelSubscriptionRow = {
  id: number;
  status: SubscriptionStatus;
  planName: string;
  percent: number;
  nextRunAt: string;
  skipNext: boolean;
  failedCount: number;
  paymentMethod: PaymentMethod;
  customerName: string;
  email: string;
  itemCount: number;
  renewals: number;
  createdAt: string;
};

export type PanelSubscriptionList = {
  rows: PanelSubscriptionRow[];
  counts: Record<SubscriptionStatus | "all", number>;
  total: number;
};

/** Panel list: optional status and search (customer name / e-mail / subscription no). */
export async function listPanelSubscriptions(opts: { status?: SubscriptionStatus | null; q?: string; limit?: number } = {}): Promise<PanelSubscriptionList> {
  const u = schema.user;
  const q = (opts.q ?? "").trim().slice(0, 80);
  const like = `%${escapeLike(q)}%`;
  const search: SQL | undefined = q
    ? or(ilike(u.name, like), ilike(subs.email, like), ilike(u.email, like), /^\d+$/.test(q) ? eq(subs.id, Number(q)) : undefined)
    : undefined;
  const where = and(search, opts.status ? eq(subs.status, opts.status) : undefined);
  const rows = await db
    .select({
      id: subs.id,
      status: subs.status,
      planName: plans.name,
      percent: plans.discountPercent,
      nextRunAt: subs.nextRunAt,
      skipNext: subs.skipNext,
      failedCount: subs.failedCount,
      paymentMethod: subs.paymentMethod,
      customerName: u.name,
      email: subs.email,
      items: subs.items,
      createdAt: subs.createdAt,
      // Correlated subqueries name their columns explicitly (drizzle may leave them unqualified).
      renewals: sql<number>`(select count(*)::int from orders ro where ro.subscription_id = "subscriptions"."id")`,
    })
    .from(subs)
    .innerJoin(plans, eq(plans.id, subs.planId))
    .leftJoin(u, eq(u.id, subs.userId))
    .where(where)
    .orderBy(sql`case ${subs.status} when 'active' then 0 when 'past_due' then 1 when 'paused' then 2 else 3 end`, asc(subs.nextRunAt), desc(subs.id))
    .limit(opts.limit ?? 200);
  const countRows = await db
    .select({ status: subs.status, n: count() })
    .from(subs)
    .leftJoin(u, eq(u.id, subs.userId))
    .where(search)
    .groupBy(subs.status);
  const counts: PanelSubscriptionList["counts"] = { all: 0, active: 0, paused: 0, past_due: 0, cancelled: 0 };
  for (const c of countRows) {
    counts[c.status] = c.n;
    counts.all += c.n;
  }
  return {
    rows: rows.map((r) => ({
      id: r.id,
      status: r.status,
      planName: localize(r.planName, "tr"),
      percent: r.percent,
      nextRunAt: r.nextRunAt.toISOString(),
      skipNext: r.skipNext,
      failedCount: r.failedCount,
      paymentMethod: r.paymentMethod,
      customerName: r.customerName ?? "—",
      email: r.email,
      itemCount: r.items.reduce((sum, i) => sum + i.quantity, 0),
      renewals: Number(r.renewals) || 0,
      createdAt: r.createdAt.toISOString(),
    })),
    counts,
    total: counts.all,
  };
}

/** Plans for the panel's Planlar tab, with how many subscriptions use each. */
export async function listPanelPlans(): Promise<
  { id: number; name: { tr: string; en?: string; ar?: string }; interval: "week" | "month"; intervalCount: number; discountPercent: number; isActive: boolean; position: number; updatedAt: string; inUse: number; activeUse: number }[]
> {
  const rows = await db
    .select({
      id: plans.id,
      name: plans.name,
      interval: plans.interval,
      intervalCount: plans.intervalCount,
      discountPercent: plans.discountPercent,
      isActive: plans.isActive,
      position: plans.position,
      updatedAt: plans.updatedAt,
      inUse: sql<number>`(select count(*)::int from subscriptions us where us.plan_id = "subscription_plans"."id")`,
      activeUse: sql<number>`(select count(*)::int from subscriptions us where us.plan_id = "subscription_plans"."id" and us.status <> 'cancelled')`,
    })
    .from(plans)
    .orderBy(asc(plans.position), asc(plans.id));
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString(), inUse: Number(r.inUse) || 0, activeUse: Number(r.activeUse) || 0 }));
}
