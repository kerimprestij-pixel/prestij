// Order reads for the storefront order page (token link), the order lookup form and the panel.
// Uncached on purpose (live status). Every function returns plain JSON (ISO date strings).
import "server-only";
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AddressData, CouponType, InvoiceData, OrderBreakdown, OrderItemSnapshot, OrderStatus, PaymentMethod, PaymentProvider } from "@/db/schema/commerce";
import type { LocalizedText } from "@/db/schema/common";
import { isLocale, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import type { MediaLike } from "@/lib/media/types";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { summaryRows, type SummaryRow } from "@/lib/cart/view";
import { hasTestPayment, isTestPayment, lastErrorOf } from "@/lib/payments/attempts";
import { cardTestModeHidden, isCardPaymentReady } from "@/lib/payments/gateway";
import { paytrAttemptState } from "@/lib/payments/paytr-window";
import { bankTransferDeadline, orderPaymentDays } from "./bank-transfer-deadline";
import { normalizeOrderNumber } from "./number";
import { allowedActions, buildTimeline, ORDER_STATUSES, type OrderAction, type TimelineStep } from "./status-machine";
import { orderPageHref, tokensMatch } from "./token";

const o = schema.orders;

export type OrderItemView = {
  id: number;
  variantId: number | null;
  productId: number;
  productSlug: string | null;
  name: LocalizedText;
  subtitle: LocalizedText | null;
  /** Option values joined (" · ") per locale. */
  variantTitle: LocalizedText;
  variantLabels: LocalizedText[];
  sku: string;
  barcode: string | null;
  image: MediaLike | null;
  accentColor: string | null;
  isSample: boolean;
  quantity: number;
  unitPrice: number;
  compareAt: number | null;
  /** unitPrice × quantity. */
  lineSubtotal: number;
  couponDiscount: number;
  bankTransferDiscount: number;
  /** Share of the order discounts (coupon + havale). */
  discount: number;
  /** lineSubtotal − discount (what this line costs in the grand total). */
  lineTotal: number;
  vatRate: number;
};

export type OrderTotals = {
  currency: string;
  subtotal: number;
  couponCode: string | null;
  couponType: CouponType | null;
  couponDiscount: number;
  bankTransferDiscount: number;
  bankTransferPercent: number;
  discountTotal: number;
  shippingFlat: number;
  shippingHeavy: number;
  heavyKg: number;
  shippingTotal: number;
  freeShipping: boolean;
  freeShippingReason: "threshold" | "coupon" | null;
  paymentFee: number;
  vatTotal: number;
  grandTotal: number;
  totalWeightGrams: number;
  itemCount: number;
};

export type OrderEventView = {
  id: number;
  /** placed | legal_snapshot | payment_initiated | payment_succeeded | payment_failed | payment_amount_mismatch | payment_after_cancel | payment_duplicate | payment_unverified | payment_refused | payment_success_after_failure | status_changed | note */
  type: string;
  message: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  /** User id, "system", or null (the customer). */
  createdBy: string | null;
  actorName: string | null;
};

export type CarrierInfo = { key: string; name: string; trackingNumber: string; trackingUrl: string | null };

export type LegalSnapshot = {
  preInformation: { key: string; version: string; html: string };
  distanceSales: { key: string; version: string; html: string };
};

/** Everything the customer order page needs (getOrderByToken). No staff notes, no internal events. */
export type OrderView = {
  id: number;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentProvider: PaymentProvider | null;
  locale: Locale;
  email: string;
  phone: string | null;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  shippingAddress: AddressData;
  invoice: InvoiceData;
  customerNote: string | null;
  items: OrderItemView[];
  totals: OrderTotals;
  carrier: CarrierInfo | null;
  timeline: TimelineStep[];
  /** Customer-safe events (placed, payments, status changes without notes). */
  events: OrderEventView[];
  payment: {
    method: PaymentMethod;
    /** Card order still pending and a card gateway is configured: show "retry payment". */
    canRetry: boolean;
    /**
     * Card order still pending while its latest PayTR attempt is inside its window without a result
     * (paytr-window.ts): the page says "Ödemeniz doğrulanıyor" and offers no retry (the server refuses one).
     * `until`: when a new payment may start (ISO); `formOpen`: that attempt's form is still usable on the card page.
     */
    verifying: { until: string; formOpen: boolean } | null;
    /**
     * Havale orders: accounts and instructions from settings (only while awaiting the transfer), and the payment
     * deadline (SR-2: end of the last day, Türkiye time, of the day count the order was placed with,
     * breakdown.bankTransferDays; the current setting for older orders; ISO).
     */
    bankTransfer: { accounts: { bank: string; holder: string; iban: string }[]; instructions: LocalizedText; deadline: string } | null;
  };
  legal: LegalSnapshot | null;
};

export type PaymentRecord = {
  id: number;
  provider: PaymentProvider;
  status: "initiated" | "succeeded" | "failed" | "refunded";
  amount: number;
  providerRef: string | null;
  createdAt: string;
  updatedAt: string;
  /** Go-live CF-11: the simulator or a provider result in test mode (no money moved). */
  test: boolean;
  /** Go-live CF-12: why the provider refused to start the last attempt (its own text, masked), or null. */
  lastError: string | null;
};

/** Panel detail (getOrderDetail): the customer view plus everything internal. */
export type OrderDetail = Omit<OrderView, "events"> & {
  accessToken: string;
  /** Customer order page (Turkish URL) to share with the buyer. */
  customerHref: string;
  userId: string | null;
  companyId: number | null;
  customerGroupId: number | null;
  couponId: number | null;
  adminNote: string | null;
  consents: { key: string; version: string; acceptedAt: string }[];
  /** All events incl. notes and payment anomalies, oldest first (legal_snapshot excluded: see `legal`). */
  events: OrderEventView[];
  payments: PaymentRecord[];
  /** Go-live CF-11: the order was paid by a test payment (red "TEST ÖDEMESİ – para çekilmedi" badge). */
  testPayment: boolean;
  /**
   * PayTR-fix R-UX7: merchant_oids of the PayTR attempts without a recorded result, newest first. They, not the order
   * number, are what PayTR's İşlemler page knows ("Kart ödemesi doğrulanamadı" notice).
   */
  paytrUnsettledRefs: string[];
  /** Actions to offer per panel role (mark_refunded only for admin). */
  actionsByRole: Record<"staff" | "editor" | "admin", OrderAction[]>;
  /** For the ship form's carrier select. */
  carriers: { key: string; name: string }[];
  customerName: string;
  updatedAt: string;
  /**
   * SR-2: havale orders (any status): the payment deadline (ISO) and the day count it came from (the one stored with
   * the order at placement, FIX F4; the current setting for older orders). null for other payment methods. The panel
   * marks an unpaid awaiting_transfer order past it.
   */
  transferDeadline: { deadline: string; paymentDays: number } | null;
};

const PUBLIC_EVENTS = new Set(["placed", "payment_succeeded", "payment_failed", "status_changed"]);

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

type OrderRow = typeof o.$inferSelect;
type ItemRow = typeof schema.orderItems.$inferSelect;
type EventRow = typeof schema.orderEvents.$inferSelect;

function itemView(row: ItemRow): OrderItemView {
  const s = row.snapshot as OrderItemSnapshot;
  const lineSubtotal = row.unitPrice * row.quantity;
  return {
    id: row.id,
    variantId: row.variantId,
    productId: s.productId,
    productSlug: s.productSlug ?? null,
    name: s.productName,
    subtitle: s.productSubtitle ?? null,
    variantTitle: s.variantTitle,
    variantLabels: s.variantLabels ?? [],
    sku: s.sku,
    barcode: s.barcode ?? null,
    image: s.image ?? null,
    accentColor: s.accentColor ?? null,
    isSample: row.isSample,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    compareAt: s.compareAt ?? null,
    lineSubtotal,
    couponDiscount: s.couponDiscount ?? 0,
    bankTransferDiscount: s.bankTransferDiscount ?? Math.max(0, row.discount - (s.couponDiscount ?? 0)),
    discount: row.discount,
    lineTotal: row.lineTotal,
    vatRate: row.vatRate,
  };
}

function totalsOf(row: OrderRow, items: OrderItemView[]): OrderTotals {
  const b: Partial<OrderBreakdown> = row.breakdown ?? {};
  return {
    currency: row.currency,
    subtotal: row.subtotal,
    couponCode: row.couponCode,
    couponType: b.couponType ?? null,
    couponDiscount: b.couponDiscount ?? (row.couponCode ? row.discountTotal : 0),
    bankTransferDiscount: b.bankTransferDiscount ?? 0,
    bankTransferPercent: b.bankTransferPercent ?? 0,
    discountTotal: row.discountTotal,
    shippingFlat: b.shippingFlat ?? row.shippingTotal,
    shippingHeavy: b.shippingHeavy ?? 0,
    heavyKg: b.heavyKg ?? 0,
    shippingTotal: row.shippingTotal,
    freeShipping: b.freeShipping ?? row.shippingTotal === 0,
    freeShippingReason: b.freeShippingReason ?? null,
    paymentFee: row.paymentFee,
    vatTotal: row.vatTotal,
    grandTotal: row.grandTotal,
    totalWeightGrams: b.totalWeightGrams ?? 0,
    itemCount: b.itemCount ?? items.reduce((sum, i) => sum + i.quantity, 0),
  };
}

/** Totals table rows for an order (same labels as the cart/checkout). */
export function orderSummaryRows(totals: OrderTotals, locale: Locale, messages: Messages): SummaryRow[] {
  return summaryRows(
    {
      subtotal: totals.subtotal,
      couponDiscount: totals.couponDiscount,
      couponCode: totals.couponCode,
      bankTransferDiscount: totals.bankTransferDiscount,
      bankTransferPercent: totals.bankTransferPercent,
      shippingFlat: totals.shippingFlat,
      shippingHeavy: totals.shippingHeavy,
      heavyKg: totals.heavyKg,
      freeShipping: totals.freeShipping,
      freeShippingCoupon: totals.freeShippingReason === "coupon" ? totals.couponCode : null,
      hasShipment: true,
      paymentFee: totals.paymentFee,
      vatTotal: totals.vatTotal,
      grandTotal: totals.grandTotal,
    },
    locale,
    messages,
  );
}

function eventView(row: EventRow, names: Map<string, string>): OrderEventView {
  const data = row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : null;
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    data,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    actorName: row.createdBy ? (names.get(row.createdBy) ?? (typeof data?.actorName === "string" ? data.actorName : null)) : null,
  };
}

function publicEvent(e: OrderEventView): OrderEventView {
  const d = e.data ?? {};
  const keep: Record<string, unknown> = {};
  for (const k of ["from", "to", "action", "carrier", "trackingNumber", "status", "paymentMethod"]) if (k in d) keep[k] = d[k];
  return { ...e, message: null, data: keep, createdBy: null, actorName: null };
}

function legalOf(events: EventRow[]): LegalSnapshot | null {
  const e = events.find((x) => x.type === "legal_snapshot");
  const d = e?.data as Partial<LegalSnapshot> | undefined;
  return d?.preInformation && d?.distanceSales ? { preInformation: d.preInformation, distanceSales: d.distanceSales } : null;
}

async function loadOrderParts(orderId: number) {
  const [items, events] = await Promise.all([
    db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)).orderBy(asc(schema.orderItems.isSample), asc(schema.orderItems.id)),
    db.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, orderId)).orderBy(asc(schema.orderEvents.createdAt), asc(schema.orderEvents.id)),
  ]);
  return { items, events };
}

/** Who is looking at the order page (from getCustomerContext() in the page; services take no Next APIs). */
export type OrderViewer = { staff?: boolean } | null | undefined;

/** Where a pending card order's latest PayTR attempt stands at `now` (ms epoch); null when it is not being verified. */
async function paytrVerifying(orderId: number, now: number): Promise<OrderView["payment"]["verifying"]> {
  const p = schema.payments;
  const rows = await db
    .select({ provider: p.provider, status: p.status, providerRef: p.providerRef, raw: p.raw, updatedAt: p.updatedAt })
    .from(p)
    .where(and(eq(p.orderId, orderId), eq(p.provider, "paytr")));
  const state = paytrAttemptState(rows, now);
  return state.verifying && state.verifyUntil !== null ? { until: new Date(state.verifyUntil).toISOString(), formOpen: state.formOpen } : null;
}

async function buildView(row: OrderRow, items: ItemRow[], events: EventRow[], names: Map<string, string> = new Map(), viewer?: OrderViewer, now?: number) {
  const settings = await loadCommerceSettings();
  const pendingCard = row.paymentMethod === "card" && row.status === "pending_payment";
  const itemViews = items.map(itemView);
  const carrierCfg = row.carrier ? settings.shipping.carriers.find((c) => c.key === row.carrier) : undefined;
  const carrier: CarrierInfo | null =
    row.carrier && row.trackingNumber
      ? {
          key: row.carrier,
          name: carrierCfg?.name ?? row.carrier,
          trackingNumber: row.trackingNumber,
          trackingUrl: carrierCfg?.trackingUrl ? carrierCfg.trackingUrl.replace("{code}", encodeURIComponent(row.trackingNumber)) : null,
        }
      : null;
  const allEvents = events.filter((e) => e.type !== "legal_snapshot").map((e) => eventView(e, names));
  const view: OrderView = {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    paymentMethod: row.paymentMethod,
    paymentProvider: row.paymentProvider,
    locale: isLocale(row.locale) ? row.locale : "tr",
    email: row.email,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
    paidAt: iso(row.paidAt),
    shippedAt: iso(row.shippedAt),
    deliveredAt: iso(row.deliveredAt),
    cancelledAt: iso(row.cancelledAt),
    shippingAddress: row.shippingAddress,
    invoice: row.invoice,
    customerNote: row.customerNote,
    items: itemViews,
    totals: totalsOf(row, itemViews),
    carrier,
    timeline: buildTimeline(row, events),
    events: allEvents.filter((e) => PUBLIC_EVENTS.has(e.type)).map(publicEvent),
    payment: {
      method: row.paymentMethod,
      // Go-live CF-11: while the test mode is on on a live site only staff may retry (a test payment moves no
      // money; retryCardPayment applies the same rule with the same viewer).
      canRetry:
        row.paymentMethod === "card" &&
        row.status === "pending_payment" &&
        !cardTestModeHidden(settings.payments, viewer) &&
        (await isCardPaymentReady(settings.payments)),
      verifying: pendingCard ? await paytrVerifying(row.id, now ?? Date.now()) : null,
      bankTransfer:
        row.paymentMethod === "bank_transfer" && row.status === "awaiting_transfer"
          ? {
              accounts: settings.payments.bankTransfer.accounts,
              instructions: settings.payments.bankTransfer.instructions,
              deadline: bankTransferDeadline(row.createdAt, orderPaymentDays(row.breakdown, settings.payments.bankTransfer.paymentDays)).toISOString(),
            }
          : null,
    },
    legal: legalOf(events),
  };
  return { view, allEvents, settings };
}

/**
 * The order for the guest order page, or null when the number is unknown or the token does not
 * match (constant-time compare). Never tells the two cases apart. `viewer` (the page passes
 * getCustomerContext()) only decides whether a card payment retry is offered in test mode (CF-11).
 * `now` (the request time, ms) decides whether a PayTR payment is still being verified (payment.verifying).
 */
export async function getOrderByToken(orderNumber: string, token: string, viewer?: OrderViewer, now?: number): Promise<OrderView | null> {
  const number = normalizeOrderNumber(orderNumber);
  if (!number || typeof token !== "string") return null;
  const [row] = await db.select().from(o).where(eq(o.orderNumber, number)).limit(1);
  if (!row || !tokensMatch(token, row.accessToken)) return null;
  const { items, events } = await loadOrderParts(row.id);
  return (await buildView(row, items, events, undefined, viewer, now)).view;
}

/**
 * Order lookup form: order number + e-mail (case-insensitive). Returns what is needed to redirect
 * to the token link (orderPageHref(locale, orderNumber, accessToken)), or null.
 */
export async function lookupOrder(orderNumber: string, email: string): Promise<{ orderNumber: string; accessToken: string; locale: Locale } | null> {
  const number = normalizeOrderNumber(orderNumber);
  const mail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!number || !mail || mail.length > 254) return null;
  const [row] = await db
    .select({ orderNumber: o.orderNumber, accessToken: o.accessToken, email: o.email, locale: o.locale })
    .from(o)
    .where(eq(o.orderNumber, number))
    .limit(1);
  if (!row || row.email.trim().toLowerCase() !== mail) return null;
  return { orderNumber: row.orderNumber, accessToken: row.accessToken, locale: isLocale(row.locale) ? row.locale : "tr" };
}

/** The legal texts stored when the order was placed (what the buyer accepted). */
export async function getOrderLegalSnapshot(orderId: number): Promise<LegalSnapshot | null> {
  const rows = await db
    .select()
    .from(schema.orderEvents)
    .where(and(eq(schema.orderEvents.orderId, orderId), eq(schema.orderEvents.type, "legal_snapshot")))
    .limit(1);
  return legalOf(rows);
}

// ---------------------------------------------------------------------------------------------
// Panel

export type OrderListItem = {
  id: number;
  orderNumber: string;
  createdAt: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  email: string;
  phone: string | null;
  customerName: string | null;
  city: string | null;
  companyName: string | null;
  grandTotal: number;
  itemCount: number;
  couponCode: string | null;
};

export type OrderList = {
  items: OrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Counts per status for the tabs ("all" included); they honour `q` but not `status`. */
  counts: Record<OrderStatus | "all", number>;
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function searchCondition(q: string | undefined): SQL | undefined {
  const term = (q ?? "").trim().slice(0, 100);
  if (!term) return undefined;
  const like = `%${escapeLike(term)}%`;
  const digits = term.replace(/\D/g, "");
  const parts: SQL[] = [
    sql`${o.orderNumber} ilike ${like}`,
    sql`${o.email} ilike ${like}`,
    sql`${o.shippingAddress}->>'fullName' ilike ${like}`,
    sql`${o.invoice}->>'companyName' ilike ${like}`,
  ];
  if (digits.length >= 4) parts.push(sql`regexp_replace(coalesce(${o.phone}, ''), '\\D', '', 'g') like ${`%${digits.slice(-10)}%`}`);
  return or(...parts);
}

/** Paged order list for /panel/siparisler (newest first). Caller must have passed requireStaff(). */
export async function listOrders(input: { status?: OrderStatus | "all" | null; q?: string | null; page?: number; pageSize?: number } = {}): Promise<OrderList> {
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 20)));
  const status = input.status && (ORDER_STATUSES as readonly string[]).includes(input.status) ? (input.status as OrderStatus) : null;
  const search = searchCondition(input.q ?? undefined);
  const where = and(search, status ? eq(o.status, status) : undefined);

  const [countRows, [{ total }]] = await Promise.all([
    db.select({ status: o.status, n: count() }).from(o).where(search).groupBy(o.status),
    db.select({ total: count() }).from(o).where(where),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(input.page ?? 1)));
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
      city: sql<string | null>`${o.shippingAddress}->>'city'`,
      companyName: sql<string | null>`${o.invoice}->>'companyName'`,
      grandTotal: o.grandTotal,
      breakdownCount: sql<number | null>`(${o.breakdown}->>'itemCount')::int`,
      couponCode: o.couponCode,
    })
    .from(o)
    .where(where)
    .orderBy(desc(o.createdAt), desc(o.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const missing = rows.filter((r) => r.breakdownCount == null).map((r) => r.id);
  const fallbackCounts = missing.length
    ? await db
        .select({ orderId: schema.orderItems.orderId, n: sql<number>`sum(${schema.orderItems.quantity})::int` })
        .from(schema.orderItems)
        .where(inArray(schema.orderItems.orderId, missing))
        .groupBy(schema.orderItems.orderId)
    : [];
  const fallback = new Map(fallbackCounts.map((r) => [r.orderId, r.n]));

  const counts = Object.fromEntries([["all", 0], ...ORDER_STATUSES.map((s) => [s, 0])]) as Record<OrderStatus | "all", number>;
  for (const r of countRows) {
    counts[r.status] = r.n;
    counts.all += r.n;
  }

  return {
    items: rows.map(({ breakdownCount, ...r }) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      itemCount: breakdownCount ?? fallback.get(r.id) ?? 0,
    })),
    total,
    page,
    pageSize,
    pageCount,
    counts,
  };
}

/** Everything the panel order detail page needs, or null. Caller must have passed requireStaff(). */
export async function getOrderDetail(id: number): Promise<OrderDetail | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await db.select().from(o).where(eq(o.id, id)).limit(1);
  if (!row) return null;
  const [{ items, events }, payments] = await Promise.all([
    loadOrderParts(row.id),
    db.select().from(schema.payments).where(eq(schema.payments.orderId, row.id)).orderBy(asc(schema.payments.id)),
  ]);
  const actorIds = [...new Set(events.map((e) => e.createdBy).filter((x): x is string => !!x && x !== "system"))];
  const users = actorIds.length
    ? await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, actorIds))
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  const { view, allEvents, settings } = await buildView(row, items, events, names);

  return {
    ...view,
    events: allEvents,
    accessToken: row.accessToken,
    customerHref: orderPageHref("tr", row.orderNumber, row.accessToken),
    userId: row.userId,
    companyId: row.companyId,
    customerGroupId: row.customerGroupId,
    couponId: row.couponId,
    adminNote: row.adminNote,
    consents: row.consents ?? [],
    payments: payments.map((p) => ({
      id: p.id,
      provider: p.provider,
      status: p.status,
      amount: p.amount,
      providerRef: p.providerRef,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      test: isTestPayment(p.provider, p.raw),
      lastError: lastErrorOf(p.raw),
    })),
    testPayment: hasTestPayment(payments),
    // The clock only affects the window fields of the state, not which attempts are unsettled.
    paytrUnsettledRefs: paytrAttemptState(payments, 0).unsettled.map((a) => a.ref),
    actionsByRole: {
      staff: allowedActions(row, "staff"),
      editor: allowedActions(row, "editor"),
      admin: allowedActions(row, "admin"),
    },
    carriers: settings.shipping.carriers.map((c) => ({ key: c.key, name: c.name })),
    customerName: row.shippingAddress?.fullName ?? row.email,
    updatedAt: row.updatedAt.toISOString(),
    transferDeadline:
      row.paymentMethod === "bank_transfer"
        ? {
            deadline: bankTransferDeadline(row.createdAt, orderPaymentDays(row.breakdown, settings.payments.bankTransfer.paymentDays)).toISOString(),
            paymentDays: orderPaymentDays(row.breakdown, settings.payments.bankTransfer.paymentDays),
          }
        : null,
  };
}
