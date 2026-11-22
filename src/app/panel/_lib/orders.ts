// Panel order list reads. Uncached on purpose (live statuses). Callers have passed requireStaff().
// The core listOrders filters by one status; the panel tabs group several (Hazırlanacak = paid +
// processing, İptal/İade = cancelled + refunded), so the list query lives here.
import "server-only";
import { and, count, desc, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OrderStatus, PaymentMethod } from "@/db/schema/commerce";
import { NEEDS_ACTION_STATUSES, ORDER_TABS, type OrderAlertKey, type OrderTab, type OrderTabKey } from "@/components/panel/orders/labels";
import { overdueBankTransferFlag, overdueBankTransferWhere, type OverdueInput } from "@/lib/orders/bank-transfer-overdue";
import { paymentEventAlertWhere } from "@/lib/payments/alerts";

export const ORDERS_PAGE_SIZE = 20;

const o = schema.orders;

export type PanelOrderRow = {
  id: number;
  orderNumber: string;
  createdAt: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  email: string;
  phone: string | null;
  customerName: string | null;
  companyName: string | null;
  city: string | null;
  grandTotal: number;
  /** Paid units (samples excluded). */
  units: number;
  /** Free sample lines. */
  samples: number;
  /** SR-2: an unpaid havale order past its payment deadline ("Ödeme süresi doldu"). */
  transferOverdue: boolean;
};

export type PanelOrderList = {
  rows: PanelOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Per tab; honours the search but not the selected tab. */
  tabCounts: Record<OrderTabKey, number>;
  /** SR-2: havale orders past their payment deadline (honours the search, not the tab or the overdue filter). */
  overdueCount: number;
};

// Turkish-insensitive matching: "ozturk" finds "Öztürk", "ISIK" finds "Işık".
const FOLD_FROM = "İIıŞşĞğÜüÖöÇç";
const FOLD_TO = "iiissgguuoocc";

function foldText(value: string): string {
  let out = "";
  for (const ch of value) {
    const i = FOLD_FROM.indexOf(ch);
    out += i >= 0 ? FOLD_TO[i] : ch;
  }
  return out.toLowerCase();
}

const fold = (expr: SQL) => sql`lower(translate(coalesce(${expr}, ''), ${FOLD_FROM}, ${FOLD_TO}))`;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Order number, e-mail, delivery/invoice name, company name, phone digits. */
function searchWhere(q: string): SQL | undefined {
  const term = q.trim().slice(0, 100);
  if (!term) return undefined;
  const like = `%${escapeLike(foldText(term))}%`;
  const parts: SQL[] = [
    sql`${fold(sql`${o.orderNumber}`)} like ${like}`,
    sql`${fold(sql`${o.email}`)} like ${like}`,
    sql`${fold(sql`${o.shippingAddress}->>'fullName'`)} like ${like}`,
    sql`${fold(sql`${o.invoice}->>'fullName'`)} like ${like}`,
    sql`${fold(sql`${o.invoice}->>'companyName'`)} like ${like}`,
  ];
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 4) {
    // Phones are stored as +905xxxxxxxxx: compare the last 10 digits of what was typed.
    parts.push(sql`regexp_replace(coalesce(${o.phone}, ''), '\\D', '', 'g') like ${`%${digits.slice(-10)}%`}`);
    // "PR 261001" or "261001" for PR-261001.
    parts.push(sql`regexp_replace(${o.orderNumber}, '\\D', '', 'g') like ${`%${digits}%`}`);
  }
  return or(...parts);
}

const statusWhere = (statuses: readonly OrderStatus[] | null) => (statuses ? inArray(o.status, [...statuses]) : undefined);

/**
 * `overdueAt`: { now, paymentDays: settings.payments.bankTransfer.paymentDays } (SR-2): rows get their "Ödeme süresi
 * doldu" flag from it (each order by the day count it was placed with; the setting only for older orders), and
 * `overdueOnly` keeps only those orders. `alert` (PayTR-fix R-UX8) keeps the orders carrying that dashboard payment
 * warning, counted as the dashboard counts it (`overdueAt.now` is the clock).
 */
export async function listPanelOrders(input: {
  tab: OrderTab;
  q?: string | null;
  page?: number | null;
  overdueAt: OverdueInput;
  overdueOnly?: boolean;
  alert?: OrderAlertKey | null;
}): Promise<PanelOrderList> {
  const search = searchWhere(input.q ?? "");
  const where = and(
    search,
    statusWhere(input.tab.statuses),
    input.overdueOnly ? overdueBankTransferWhere(input.overdueAt) : undefined,
    input.alert ? paymentEventAlertWhere(input.alert, input.overdueAt.now.getTime()) : undefined,
  );

  const [countRows, [{ total }], [{ overdue }]] = await Promise.all([
    db.select({ status: o.status, n: count() }).from(o).where(search).groupBy(o.status),
    db.select({ total: count() }).from(o).where(where),
    db.select({ overdue: count() }).from(o).where(and(search, overdueBankTransferWhere(input.overdueAt))),
  ]);

  const pageSize = ORDERS_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isSafeInteger(input.page) && (input.page ?? 0) > 0 ? (input.page as number) : 1;
  const page = Math.min(pageCount, requested);

  const rows = await db
    .select({
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      status: o.status,
      paymentMethod: o.paymentMethod,
      email: o.email,
      phone: o.phone,
      customerName: sql<string | null>`${o.shippingAddress}->>'fullName'`,
      companyName: sql<string | null>`nullif(${o.invoice}->>'companyName', '')`,
      city: sql<string | null>`${o.shippingAddress}->>'city'`,
      grandTotal: o.grandTotal,
      // Written out with explicit aliases: drizzle renders columns unqualified in single-table
      // selects, so `${oi.orderId} = ${o.id}` would compare order_items.order_id with order_items.id.
      units: sql<number>`(select coalesce(sum(oi.quantity) filter (where not oi.is_sample), 0)::int from order_items oi where oi.order_id = "orders"."id")`,
      samples: sql<number>`(select count(*) filter (where oi.is_sample)::int from order_items oi where oi.order_id = "orders"."id")`,
      transferOverdue: overdueBankTransferFlag(input.overdueAt),
    })
    .from(o)
    .where(where)
    .orderBy(desc(o.createdAt), desc(o.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const byStatus = new Map(countRows.map((r) => [r.status, r.n]));
  const tabCounts = Object.fromEntries(
    ORDER_TABS.map((tab) => [
      tab.key,
      tab.statuses ? tab.statuses.reduce((sum, s) => sum + (byStatus.get(s) ?? 0), 0) : countRows.reduce((sum, r) => sum + r.n, 0),
    ]),
  ) as Record<OrderTabKey, number>;

  return {
    rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), units: Number(r.units), samples: Number(r.samples), transferOverdue: Boolean(r.transferOverdue) })),
    total,
    page,
    pageSize,
    pageCount,
    tabCounts,
    overdueCount: overdue,
  };
}

export type OrderWorkload = {
  /** Havale/EFT orders waiting for the money to be confirmed. */
  awaitingTransfer: number;
  /** Paid or processing: to prepare and ship. */
  toPrepare: number;
  total: number;
};

/** Orders that wait for staff (sidebar badge, dashboard). */
export async function getOrderWorkload(): Promise<OrderWorkload> {
  const [row] = await db
    .select({
      awaitingTransfer: sql<number>`count(*) filter (where ${o.status} = 'awaiting_transfer')`.mapWith(Number),
      toPrepare: sql<number>`count(*) filter (where ${o.status} in ('paid', 'processing'))`.mapWith(Number),
    })
    .from(o)
    .where(inArray(o.status, [...NEEDS_ACTION_STATUSES]));
  const awaitingTransfer = row?.awaitingTransfer ?? 0;
  const toPrepare = row?.toPrepare ?? 0;
  return { awaitingTransfer, toPrepare, total: awaitingTransfer + toPrepare };
}
