// Payment warnings for the panel (dashboard "Yapılacaklar", /panel/ayarlar/odeme), PayTR-fix IMPL-A2. No migration:
// everything lives in existing tables.
//
// 1. Refused PayTR notifications (audit_log, entity "payment_notification", action "refused", entity_id = kind, user_id
//    null). When /api/payments/paytr/notify answers "bad hash", "missing fields" or "keys not configured", PayTR (or a
//    forger) is told no, and the panel says "PayTR bildirimleri reddediliyor: Bildirim URL'sini ve anahtarları kontrol
//    edin" with the last time and a count. Never stored: the posted body or hash. Stored: the kind, the times, a count
//    and, only when it parses as one of our merchant_oids, that merchant_oid (≤ 64 characters).
//    PayTR-fix R5: the notify handler records a refusal only when the posted merchant_oid is a stored attempt of one
//    of our orders (callbacks.ts notePaytrNotifyRefusal), which is what a wrong key or URL produces, since PayTR always
//    posts our merchant_oid. An anonymous POST (empty, unreadable, a made-up merchant_oid) is logged only, so nobody
//    can raise the owner's warning with one request.
//    Forged posts cannot fill the database: at most ONE row per kind per NOTIFY_REFUSAL_WINDOW_MS (10 minutes; later
//    refusals in the window only raise its count), so at most 3 × 144 rows a day; and each server instance writes a
//    kind at most once per NOTIFY_REFUSAL_THROTTLE_MS (10 s), adding the refusals it skipped meanwhile to the next
//    write (a count lost with a stopped instance makes the shown count a lower bound). Concurrent writers of one kind
//    do not queue: pg_try_advisory_xact_lock, and a busy lock defers to the next write.
//    The warning shows while a refusal happened in the last NOTIFY_REFUSAL_SHOW_HOURS (72 h), so it goes away by itself
//    after a fix; a verified notification cannot tell a fix apart from a forger, so none is needed to clear it.
// 2. Order events written by the payment code (one per order and reference):
//    "payment_refused" (data.reason "test_payment_on_live", PayTR-fix C5): PayTR reported a test payment (test_mode=1)
//      for an attempt we sent live on a public site. No money moved; the order was not marked paid.
//    "payment_success_after_failure" (PayTR-fix C13a): a success arrived for a reference already recorded as failed.
//      PayTR counts only the first notification per merchant_oid, so nothing changes; a person checks at the provider.
import "server-only";
import { and, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";
import type { DbExecutor } from "@/lib/cart/settings";
import { safeErrorInfo } from "@/lib/db-errors";
import { parsePaytrMerchantOid, TEST_PAYMENT_ON_LIVE } from "./paytr-crypto";

export const NOTIFY_REFUSAL_ENTITY = "payment_notification";
export const NOTIFY_REFUSAL_ACTION = "refused";
export const NOTIFY_REFUSAL_KINDS = ["bad_hash", "missing_fields", "not_configured"] as const;
export type NotifyRefusalKind = (typeof NOTIFY_REFUSAL_KINDS)[number];
/** At most one audit row per kind in this window. */
export const NOTIFY_REFUSAL_WINDOW_MS = 10 * 60_000;
/** Per server instance: at most one database write per kind in this time. */
export const NOTIFY_REFUSAL_THROTTLE_MS = 10_000;
/** The panel warning covers refusals of the last 72 hours. */
export const NOTIFY_REFUSAL_SHOW_HOURS = 72;

export const PAYMENT_REFUSED_EVENT = "payment_refused";
export const PAYMENT_SUCCESS_AFTER_FAILURE_EVENT = "payment_success_after_failure";
/** "Canlı siparişe test ödemesi" stays on the dashboard this long after the event. */
export const TEST_ON_LIVE_ALERT_HOURS = 72;
/** "Başarısız sonrası başarılı bildirim" stays while the order has no paidAt, at most this long. */
export const SUCCESS_AFTER_FAILURE_ALERT_DAYS = 14;

/** First key of pg_try_advisory_xact_lock(int, int) ("PRPN"); the second is the kind's index. */
const LOCK_NAMESPACE = 0x5052504e;

type RefusalAfter = { kind: NotifyRefusalKind; count: number; firstAt: string; lastAt: string; merchantOid: string | null };
type Throttle = { lastWrite: number; pending: number };
/** Per executor (the db client in production; each DB test's transaction gets its own). */
const throttles = new WeakMap<object, Map<NotifyRefusalKind, Throttle>>();

export type NotifyRefusalWrite = "inserted" | "updated" | "throttled" | "busy" | "failed";

/**
 * Records one refused notification (see the header). Never throws: the endpoint answers PayTR in any case.
 * `merchantOid`: the posted value, kept only when it is one of ours. `now`: ms epoch (tests).
 */
export async function recordNotifyRefusal(exec: DbExecutor, kind: NotifyRefusalKind, merchantOid: unknown, now: number = Date.now()): Promise<NotifyRefusalWrite> {
  let byKind = throttles.get(exec);
  if (!byKind) throttles.set(exec, (byKind = new Map()));
  const throttle = byKind.get(kind) ?? { lastWrite: Number.NEGATIVE_INFINITY, pending: 0 };
  byKind.set(kind, throttle);
  throttle.pending++;
  if (now - throttle.lastWrite < NOTIFY_REFUSAL_THROTTLE_MS) return "throttled";
  const add = throttle.pending;
  throttle.pending = 0;
  throttle.lastWrite = now;
  const oid = parsePaytrMerchantOid(merchantOid) ? String(merchantOid).slice(0, 64) : null;
  const at = new Date(now);
  try {
    const written = await exec.transaction(async (tx): Promise<NotifyRefusalWrite> => {
      const [lock] = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${LOCK_NAMESPACE}::int, ${NOTIFY_REFUSAL_KINDS.indexOf(kind)}::int) as locked`,
      );
      if (!lock?.locked) return "busy";
      const a = schema.auditLog;
      const [recent] = await tx
        .select({ id: a.id, after: a.after })
        .from(a)
        .where(and(eq(a.entity, NOTIFY_REFUSAL_ENTITY), eq(a.action, NOTIFY_REFUSAL_ACTION), eq(a.entityId, kind), gt(a.createdAt, new Date(now - NOTIFY_REFUSAL_WINDOW_MS))))
        .orderBy(sql`${a.createdAt} desc, ${a.id} desc`)
        .limit(1);
      if (recent) {
        const prev = (recent.after ?? {}) as Partial<RefusalAfter>;
        const after: RefusalAfter = {
          kind,
          count: (typeof prev.count === "number" && Number.isSafeInteger(prev.count) ? prev.count : 0) + add,
          firstAt: typeof prev.firstAt === "string" ? prev.firstAt : at.toISOString(),
          lastAt: at.toISOString(),
          merchantOid: oid ?? (typeof prev.merchantOid === "string" ? prev.merchantOid : null),
        };
        await tx.update(a).set({ after }).where(eq(a.id, recent.id));
        return "updated";
      }
      const after: RefusalAfter = { kind, count: add, firstAt: at.toISOString(), lastAt: at.toISOString(), merchantOid: oid };
      await tx.insert(a).values({ userId: null, action: NOTIFY_REFUSAL_ACTION, entity: NOTIFY_REFUSAL_ENTITY, entityId: kind, before: null, after, createdAt: at });
      return "inserted";
    });
    if (written === "busy") throttle.pending += add;
    return written;
  } catch (error) {
    throttle.pending += add;
    console.error(`[payments] recording a refused paytr notification failed kind=${kind}`, safeErrorInfo(error));
    return "failed";
  }
}

export type NotifyRefusalSummary = {
  /** Refused notifications in the last `windowHours` (a lower bound, see the header). */
  count: number;
  /** NOTIFY_REFUSAL_SHOW_HOURS: the period the warning covers. */
  windowHours: number;
  /** ISO times of the first and the last of them. */
  firstAt: string;
  lastAt: string;
  kinds: NotifyRefusalKind[];
  /** The latest of our merchant_oids among them, if any. */
  merchantOid: string | null;
};

const isKind = (v: unknown): v is NotifyRefusalKind => typeof v === "string" && (NOTIFY_REFUSAL_KINDS as readonly string[]).includes(v);

/** The refused notifications of the last 72 hours, or null when there were none. */
export async function notifyRefusalSummary(exec: DbExecutor, now: number = Date.now()): Promise<NotifyRefusalSummary | null> {
  const a = schema.auditLog;
  const since = now - NOTIFY_REFUSAL_SHOW_HOURS * 3_600_000;
  // A row is created at its window's first refusal and updated for 10 minutes: older rows cannot hold a newer lastAt.
  const rows = await exec
    .select({ kind: a.entityId, after: a.after })
    .from(a)
    .where(and(eq(a.entity, NOTIFY_REFUSAL_ENTITY), eq(a.action, NOTIFY_REFUSAL_ACTION), gt(a.createdAt, new Date(since - NOTIFY_REFUSAL_WINDOW_MS))));
  let count = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  let lastOid: { at: number; oid: string } | null = null;
  const kinds = new Set<NotifyRefusalKind>();
  for (const row of rows) {
    const after = (row.after ?? {}) as Partial<RefusalAfter>;
    const lastAt = typeof after.lastAt === "string" ? Date.parse(after.lastAt) : NaN;
    if (!Number.isFinite(lastAt) || lastAt <= since || !isKind(row.kind)) continue;
    const firstAt = typeof after.firstAt === "string" ? Date.parse(after.firstAt) : NaN;
    count += typeof after.count === "number" && Number.isSafeInteger(after.count) && after.count > 0 ? after.count : 1;
    first = Math.min(first, Number.isFinite(firstAt) ? firstAt : lastAt);
    last = Math.max(last, lastAt);
    kinds.add(row.kind);
    if (typeof after.merchantOid === "string" && (!lastOid || lastAt > lastOid.at)) lastOid = { at: lastAt, oid: after.merchantOid };
  }
  if (count === 0) return null;
  return {
    count,
    windowHours: NOTIFY_REFUSAL_SHOW_HOURS,
    firstAt: new Date(first).toISOString(),
    lastAt: new Date(last).toISOString(),
    kinds: NOTIFY_REFUSAL_KINDS.filter((k) => kinds.has(k)),
    merchantOid: lastOid?.oid ?? null,
  };
}

export type PaymentEventAlerts = {
  /** Orders that got a PayTR test payment for a live attempt in the last TEST_ON_LIVE_ALERT_HOURS. */
  testOnLive: number;
  /** Orders without paidAt that got a success after a recorded failure in the last SUCCESS_AFTER_FAILURE_ALERT_DAYS. */
  successAfterFailure: number;
  /** PayTR-fix R-UX8: the order's id when exactly one order is counted (the dashboard line opens it), else null. */
  testOnLiveOrderId: number | null;
  successAfterFailureOrderId: number | null;
};

/** The two order-event warnings; the orders list filters by them (?uyari=…) when more than one order is affected. */
export type PaymentEventAlertKind = "testOnLive" | "successAfterFailure";

/**
 * Whether the order carries the warning, exactly as the dashboard counts it. For listPanelOrders' filter: a query on
 * "orders" without an alias (written out as "orders"."id": drizzle renders columns unqualified in single-table selects,
 * which inside the subquery would mean order_events.id).
 */
export function paymentEventAlertWhere(kind: PaymentEventAlertKind, now: number = Date.now()): SQL {
  const o = schema.orders;
  if (kind === "testOnLive") {
    const since = new Date(now - TEST_ON_LIVE_ALERT_HOURS * 3_600_000).toISOString();
    return sql`exists (select 1 from order_events ae where ae.order_id = "orders"."id" and ae.type = ${PAYMENT_REFUSED_EVENT} and ae.data->>'reason' = ${TEST_PAYMENT_ON_LIVE} and ae.created_at > ${since}::timestamptz)`;
  }
  const since = new Date(now - SUCCESS_AFTER_FAILURE_ALERT_DAYS * 86_400_000).toISOString();
  return sql`(${o.paidAt} is null and exists (select 1 from order_events ae where ae.order_id = "orders"."id" and ae.type = ${PAYMENT_SUCCESS_AFTER_FAILURE_EVENT} and ae.created_at > ${since}::timestamptz))`;
}

/** The dashboard counts of the two order-event warnings (see the header). */
export async function countPaymentEventAlerts(exec: DbExecutor, now: number = Date.now()): Promise<PaymentEventAlerts> {
  const e = schema.orderEvents;
  const o = schema.orders;
  const testSince = new Date(now - TEST_ON_LIVE_ALERT_HOURS * 3_600_000).toISOString();
  const testOnLive = sql`${e.type} = ${PAYMENT_REFUSED_EVENT} and ${e.data}->>'reason' = ${TEST_PAYMENT_ON_LIVE} and ${e.createdAt} > ${testSince}::timestamptz`;
  const afterFailure = sql`${e.type} = ${PAYMENT_SUCCESS_AFTER_FAILURE_EVENT} and ${o.paidAt} is null`;
  const [row] = await exec
    .select({
      testOnLive: sql<number>`count(distinct ${e.orderId}) filter (where ${testOnLive})`.mapWith(Number),
      testOnLiveOrderId: sql<number | null>`min(${e.orderId}) filter (where ${testOnLive})`,
      successAfterFailure: sql<number>`count(distinct ${e.orderId}) filter (where ${afterFailure})`.mapWith(Number),
      successAfterFailureOrderId: sql<number | null>`min(${e.orderId}) filter (where ${afterFailure})`,
    })
    .from(e)
    .innerJoin(o, eq(o.id, e.orderId))
    .where(and(inArray(e.type, [PAYMENT_REFUSED_EVENT, PAYMENT_SUCCESS_AFTER_FAILURE_EVENT]), gt(e.createdAt, new Date(now - SUCCESS_AFTER_FAILURE_ALERT_DAYS * 86_400_000))));
  const single = (n: number, id: unknown) => (n === 1 && id != null && Number.isSafeInteger(Number(id)) ? Number(id) : null);
  return {
    testOnLive: row?.testOnLive ?? 0,
    successAfterFailure: row?.successAfterFailure ?? 0,
    testOnLiveOrderId: single(row?.testOnLive ?? 0, row?.testOnLiveOrderId),
    successAfterFailureOrderId: single(row?.successAfterFailure ?? 0, row?.successAfterFailureOrderId),
  };
}
