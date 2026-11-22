// Order status changes (panel actions, expiry). Each change runs in one transaction that locks the
// order row first, then variants (ascending id), then the coupon: the same order placeOrder uses for
// variants → coupon, so concurrent writers cannot deadlock.
import "server-only";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OrderItemSnapshot, OrderStatus, PaymentMethod } from "@/db/schema/commerce";
import type { DbExecutor } from "@/lib/cart/settings";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { safeErrorInfo } from "@/lib/db-errors";
import type { OrderNotificationType } from "@/lib/notifications";
import { paytrAttemptState, paytrUnverifiedAlertDue, paytrWindowPassed } from "@/lib/payments/paytr-window";
import { flagUnverifiedPayment } from "@/lib/payments/unverified";
import { activatePendingSubscriptions } from "@/lib/subscriptions/service";
import { CONTROL_CHARS } from "./checkout-schema";
import { revalidateProducts, scheduleNotification } from "./effects";
import { checkTransition, ORDER_TRANSITIONS, type ActorRole, type OrderAction } from "./status-machine";

export { allowedActions, buildTimeline, checkTransition, ORDER_ACTIONS, ORDER_STATUSES, ORDER_TRANSITIONS } from "./status-machine";
export type { ActorRole, OrderAction, TimelineStep, TimelineStepKey } from "./status-machine";

const o = schema.orders;

/** Who changes the order. Panel: { userId: session.user.id, role: session.staffRole, name: session.user.name }. */
export type OrderActor = { userId: string | null; role: ActorRole; name?: string | null };
export const SYSTEM_ACTOR: OrderActor = Object.freeze({ userId: null, role: "system", name: "system" });

export type TransitionOptions = {
  actor: OrderActor;
  /** Required for cancel (the reason) and add_note. ≤ 1000 characters. */
  note?: string | null;
  /** ship: a key from shipping.carriers settings (e.g. "yurtici"). */
  carrier?: string | null;
  /** ship: tracking number (letters, digits, dashes; 4–40). */
  trackingNumber?: string | null;
  /** Machine-readable reason stored in the event data (e.g. "payment_timeout"). */
  reason?: string | null;
  /**
   * The status the actor saw (panel: the status rendered on the page). When the locked row is in
   * another status the action is refused with invalid_transition, so a stale screen never cancels an
   * order that was paid meanwhile.
   */
  expectedStatus?: OrderStatus | readonly OrderStatus[] | null;
};

export type TransitionErrorCode =
  | "not_found"
  | "invalid_transition"
  | "forbidden"
  | "not_paid"
  | "note_required"
  | "carrier_required"
  | "invalid_carrier"
  | "tracking_required"
  | "invalid_tracking";

export type TransitionResult =
  | { ok: true; orderId: number; orderNumber: string; status: OrderStatus; previousStatus: OrderStatus; restocked: boolean }
  | { ok: false; code: TransitionErrorCode };

const NOTIFY: Partial<Record<OrderStatus, OrderNotificationType>> = {
  paid: "paid",
  processing: "processing",
  shipped: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
  refunded: "refunded",
};

type LockedOrder = {
  id: number;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paidAt: Date | null;
  couponId: number | null;
  paymentProvider: string | null;
};

async function lockOrder(tx: DbExecutor, orderId: number): Promise<LockedOrder | null> {
  const [row] = await tx
    .select({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentMethod: o.paymentMethod,
      paidAt: o.paidAt,
      couponId: o.couponId,
      paymentProvider: o.paymentProvider,
    })
    .from(o)
    .where(eq(o.id, orderId))
    .for("update")
    .limit(1);
  return row ?? null;
}

/**
 * Puts an order's stock back (only lines whose stock was decremented) and releases its coupon use.
 * Must run inside the transaction that holds the order row lock. Returns the touched product slugs.
 */
export async function restockOrder(tx: DbExecutor, order: { id: number; couponId: number | null }): Promise<string[]> {
  const items = await tx
    .select({ variantId: schema.orderItems.variantId, quantity: schema.orderItems.quantity, snapshot: schema.orderItems.snapshot })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, order.id))
    .orderBy(asc(schema.orderItems.variantId));
  const perVariant = new Map<number, number>();
  const slugs: string[] = [];
  for (const item of items) {
    const snap = item.snapshot as OrderItemSnapshot;
    if (item.variantId == null || snap.stockTracked !== true || !(item.quantity > 0)) continue;
    perVariant.set(item.variantId, (perVariant.get(item.variantId) ?? 0) + item.quantity);
    if (snap.productSlug) slugs.push(snap.productSlug);
  }
  const v = schema.productVariants;
  for (const variantId of [...perVariant.keys()].sort((a, b) => a - b)) {
    await tx
      .update(v)
      .set({ stock: sql`${v.stock} + ${perVariant.get(variantId)!}` })
      .where(eq(v.id, variantId));
  }
  if (order.couponId != null) {
    const c = schema.coupons;
    await tx
      .update(c)
      .set({ usedCount: sql`greatest(${c.usedCount} - 1, 0)` })
      .where(eq(c.id, order.couponId));
  }
  return slugs;
}

/** Trimmed, at most 1000 characters, without control characters (PostgreSQL refuses NUL). */
const cleanNote = (note: string | null | undefined) =>
  typeof note === "string" ? note.replace(new RegExp(CONTROL_CHARS.source, "g"), "").trim().slice(0, 1000) : "";

/**
 * Runs a panel/system action on an order: checks the state machine and the actor's role (mark_refunded
 * needs admin), applies the change, writes an order_events row, restocks when the rule says so.
 * `options.effects` (default true) revalidates product pages after a restock and schedules the
 * notification hook; pass false outside Next (scripts, tests). `options.executor`: run inside that transaction
 * (a savepoint; DB tests roll it back).
 */
export async function transitionOrder(
  orderId: number,
  action: OrderAction,
  input: TransitionOptions,
  options: { effects?: boolean; /** internal (expiry job): extra condition re-checked under the row lock */ lockedGuard?: SQL; executor?: DbExecutor } = {},
): Promise<TransitionResult> {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return { ok: false, code: "not_found" };
  const rule = ORDER_TRANSITIONS[action];
  if (!rule) return { ok: false, code: "invalid_transition" };
  const note = cleanNote(input.note);
  if (rule.requires.includes("note") && !note) return { ok: false, code: "note_required" };

  let carrier: string | null = null;
  let trackingNumber: string | null = null;
  if (action === "ship") {
    carrier = typeof input.carrier === "string" ? input.carrier.trim() : "";
    if (!carrier) return { ok: false, code: "carrier_required" };
    const { shipping } = await loadCommerceSettings(options.executor);
    if (!shipping.carriers.some((c) => c.key === carrier)) return { ok: false, code: "invalid_carrier" };
    trackingNumber = typeof input.trackingNumber === "string" ? input.trackingNumber.replace(/\s+/g, "").toUpperCase() : "";
    if (!trackingNumber) return { ok: false, code: "tracking_required" };
    if (!/^[A-Z0-9-]{4,40}$/.test(trackingNumber)) return { ok: false, code: "invalid_tracking" };
  }

  const result = await (options.executor ?? db).transaction(async (tx): Promise<TransitionResult & { slugs?: string[] }> => {
    const order = await lockOrder(tx, orderId);
    if (!order) return { ok: false, code: "not_found" };
    if (input.expectedStatus != null) {
      const expected: readonly OrderStatus[] = typeof input.expectedStatus === "string" ? [input.expectedStatus] : input.expectedStatus;
      if (!expected.includes(order.status)) return { ok: false, code: "invalid_transition" };
    }
    if (options.lockedGuard) {
      const [hit] = await tx.select({ id: o.id }).from(o).where(and(eq(o.id, orderId), options.lockedGuard)).limit(1);
      if (!hit) return { ok: false, code: "invalid_transition" };
    }
    const check = checkTransition(order, action, input.actor.role);
    if (!check.ok) return check;

    const now = new Date();
    const createdBy = input.actor.userId ?? "system";
    if (action === "add_note") {
      await tx.insert(schema.orderEvents).values({ orderId, type: "note", message: note, createdBy });
      return { ok: true, orderId, orderNumber: order.orderNumber, status: order.status, previousStatus: order.status, restocked: false };
    }

    const set: Partial<typeof o.$inferInsert> = { status: check.to };
    if (action === "mark_paid") {
      set.paidAt = now;
      set.paymentProvider = (order.paymentProvider as typeof set.paymentProvider) ?? "manual";
    }
    if (action === "ship") Object.assign(set, { shippedAt: now, carrier, trackingNumber });
    if (action === "deliver") {
      set.deliveredAt = now;
      // Kapıda ödeme: the courier collected the money at the door.
      if (order.paymentMethod === "cash_on_delivery" && !order.paidAt) set.paidAt = now;
    }
    if (action === "cancel") set.cancelledAt = now;

    const updated = await tx
      .update(o)
      .set(set)
      .where(and(eq(o.id, orderId), eq(o.status, order.status)))
      .returning({ id: o.id });
    if (updated.length === 0) return { ok: false, code: "invalid_transition" };

    const slugs = check.restock ? await restockOrder(tx, order) : [];
    // Subscribe and save: a card first order marked paid by staff starts its subscriptions too.
    if (action === "mark_paid") await activatePendingSubscriptions(tx, orderId, now);
    await tx.insert(schema.orderEvents).values({
      orderId,
      type: "status_changed",
      message: note || null,
      data: {
        action,
        from: order.status,
        to: check.to,
        ...(carrier ? { carrier, trackingNumber } : {}),
        ...(check.restock ? { restocked: true, couponReleased: order.couponId != null } : {}),
        ...(input.actor.name ? { actorName: input.actor.name } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      },
      createdBy,
    });
    return { ok: true, orderId, orderNumber: order.orderNumber, status: check.to, previousStatus: order.status, restocked: check.restock, slugs };
  });

  if (result.ok && options.effects !== false) {
    if (result.slugs?.length) revalidateProducts(result.slugs);
    const type = result.status !== result.previousStatus ? NOTIFY[result.status] : undefined;
    if (type) scheduleNotification(type, result.orderId);
  }
  if (result.ok) {
    const { slugs, ...rest } = result;
    void slugs;
    return rest;
  }
  return result;
}

/** An iyzico order whose card result cannot be checked (iyzico unreachable) is kept at most this long. */
export const UNKNOWN_PAYMENT_GRACE_HOURS = 48;

/**
 * Bounds of one expiry run (the "frequent" cron may run every 5 minutes on Vercel Pro, and the opportunistic
 * run after an order shares the job lock): a PayTR or iyzico outage must never make the job run long. No order and
 * no provider inquiry (PayTR Durum Sorgu, iyzico retrieve) starts after the budget; each inquiry waits at most its
 * timeout or the time left, and each provider has a breaker. So a run ends within about budgetMs plus one timeout.
 */
export type ExpiryLimits = {
  /** Stale orders looked at per run; the next run continues with the rest. */
  maxOrders: number;
  /** Wall-clock budget (ms): no order is started after it, and no PayTR or iyzico inquiry either. */
  budgetMs: number;
  /** Orders handled at the same time (1 inside a caller's transaction). */
  concurrency: number;
  /** Per PayTR Durum Sorgu call. */
  inquiryTimeoutMs: number;
  /** Per iyzico checkout retrieve (PayTR-fix R4; the gateway default is 20 s). */
  iyzicoTimeoutMs: number;
  /** Unanswered inquiries per provider (timeout, network, HTTP error) after which this run stops asking that provider. */
  maxInquiryFailures: number;
};

export const EXPIRY_LIMITS: ExpiryLimits = { maxOrders: 100, budgetMs: 20_000, concurrency: 3, inquiryTimeoutMs: 5_000, iyzicoTimeoutMs: 10_000, maxInquiryFailures: 3 };

export type ExpiryResult = {
  expired: number;
  /** Cancelled orders, by id. */
  orderNumbers: string[];
  /** Paid by a result found while checking (iyzico retrieve, PayTR Durum Sorgu). */
  paid: number;
  /** PayTR orders whose latest attempt is still inside its window (PAYTR_VERIFY_WINDOW_MINUTES): not asked yet. */
  waiting: number;
  /** Kept because the card result could not be checked. */
  unknown: number;
  /** Not looked at in this run (maxOrders or the time budget); the next run takes them. */
  deferred: number;
  /** Orders whose handling threw (logged; the next run tries again). */
  failed: number;
};

/**
 * An unpaid card order is stale when neither the order nor its latest open payment attempt moved for
 * `mins` minutes (DB clock): a retry ("Ödemeyi tamamla") touches the initiated payment row, so a
 * buyer on the 3-D Secure page is not expired under their feet.
 */
function staleCondition(mins: number, renewalMins: number = mins): SQL {
  const p = schema.payments;
  // Subscription renewal orders (subscription_id set) wait subscriptions.cardPaymentWindowHours: the
  // customer pays them later from the e-mailed link, not right after checkout.
  return sql`greatest(${o.createdAt}, coalesce((select max(${p.updatedAt}) from ${p} where ${p.orderId} = ${o.id} and ${p.status} = 'initiated'), ${o.createdAt})) < now() - make_interval(mins => case when ${o.subscriptionId} is null then ${mins}::int else ${renewalMins}::int end)`;
}

/**
 * Cancels card orders that stayed pending_payment longer than `minutes` and restocks them. For the
 * "frequent" cron job. Safe against payment callbacks: the status (pending_payment) and the staleness are
 * re-checked after the order row is locked, so an order paid between the scan and the lock is skipped.
 * Subscription renewal orders use `options.renewalWindowHours` (default: settings
 * subscriptions.cardPaymentWindowHours, read fresh) instead of `minutes`. `only` limits the scan to
 * the given order ids (DB tests on the shared database).
 * Before an order is cancelled, the provider is asked about its unsettled attempts (reconcileCardOrder): a
 * charge whose callback or notification never arrived pays the order instead.
 *   iyzico: while iyzico cannot be reached the order is left for the next run (for at most
 *           UNKNOWN_PAYMENT_GRACE_HOURS).
 *   PayTR:  nothing happens until the latest PayTR attempt is PAYTR_VERIFY_WINDOW_MINUTES old (timeout_limit 30 +
 *           margin; renewal orders keep their own, longer window on top). Then the order is cancelled only when
 *           Durum Sorgu says "no successful payment" for every unsettled PayTR attempt. "Unknown" keeps it pending
 *           (the next run asks again) and never cancels; after PAYTR_UNVERIFIED_ALERT_HOURS of that, the dashboard
 *           shows "Kart ödemesi doğrulanamadı" (order_events "payment_unverified").
 * Bounded per run (EXPIRY_LIMITS: orders, time budget, small concurrency, PayTR timeouts and a breaker).
 */
export async function expireStalePendingOrders(
  minutes = 30,
  options: {
    effects?: boolean;
    renewalWindowHours?: number;
    only?: readonly number[];
    /** Run inside this transaction (DB tests roll it back); forces concurrency 1. */
    executor?: DbExecutor;
    /** Clock for the PayTR window and the iyzico grace (ms epoch, default now). */
    now?: number;
    /** Tests inject the providers' fetch. */
    fetch?: typeof fetch;
    limits?: Partial<ExpiryLimits>;
  } = {},
): Promise<ExpiryResult> {
  const exec = options.executor ?? db;
  const limits: ExpiryLimits = { ...EXPIRY_LIMITS, ...options.limits };
  const result: ExpiryResult = { expired: 0, orderNumbers: [], paid: 0, waiting: 0, unknown: 0, deferred: 0, failed: 0 };
  const mins = Math.max(1, Math.floor(minutes));
  const renewalHours = options.renewalWindowHours ?? (await loadCommerceSettings(exec)).subscriptions.cardPaymentWindowHours;
  const renewalMins = Math.max(mins, Math.floor(renewalHours * 60));
  if (options.only && options.only.length === 0) return result;
  const stale = await exec
    .select({ id: o.id, createdAt: o.createdAt })
    .from(o)
    .where(and(eq(o.status, "pending_payment"), eq(o.paymentMethod, "card"), staleCondition(mins, renewalMins), options.only ? inArray(o.id, [...options.only]) : undefined))
    .orderBy(asc(o.id))
    .limit(500);
  if (stale.length === 0) return result;

  const started = Date.now();
  const deadline = started + limits.budgetMs;
  // Imported lazily: the payments modules import order helpers themselves.
  const { reconcileCardOrder, inquiryBudget } = await import("@/lib/payments/reconcile");
  const budget = inquiryBudget({ budgetMs: limits.budgetMs, timeoutMs: limits.inquiryTimeoutMs, maxFailures: limits.maxInquiryFailures }, started);
  const iyzicoBudget = inquiryBudget({ budgetMs: limits.budgetMs, timeoutMs: limits.iyzicoTimeoutMs, maxFailures: limits.maxInquiryFailures }, started);
  const p = schema.payments;
  const cancelled: { id: number; orderNumber: string }[] = [];

  const handle = async ({ id, createdAt }: { id: number; createdAt: Date }): Promise<void> => {
    const now = options.now ?? Date.now();
    const rows = await exec
      .select({ provider: p.provider, status: p.status, providerRef: p.providerRef, raw: p.raw, updatedAt: p.updatedAt })
      .from(p)
      .where(eq(p.orderId, id));
    const paytr = paytrAttemptState(rows, now);
    const isPaytr = paytr.latest !== null;
    if (isPaytr && !paytrWindowPassed(paytr, now)) {
      result.waiting++;
      return;
    }
    const check = await reconcileCardOrder(id, { effects: options.effects, applyFailures: false, executor: options.executor, fetch: options.fetch, paytrBudget: budget, iyzicoBudget, now });
    if (check.state === "paid") {
      result.paid++;
      return;
    }
    if (check.state === "not_pending") return;
    if (check.state === "unknown") {
      if (isPaytr) {
        // PayTR: never cancelled on "unknown" (the money may be at PayTR); a person decides after 24 h.
        result.unknown++;
        if (paytrUnverifiedAlertDue(paytr, now)) await flagUnverifiedPayment(exec, id, paytr);
        else console.warn(`[orders] expiry postponed order=${id}: the PayTR result could not be checked`);
        return;
      }
      if (now - createdAt.getTime() < UNKNOWN_PAYMENT_GRACE_HOURS * 3_600_000) {
        result.unknown++;
        console.warn(`[orders] expiry postponed order=${id}: the card result could not be checked`);
        return;
      }
    }
    const done = await transitionOrder(
      id,
      "cancel",
      {
        actor: SYSTEM_ACTOR,
        note: "Ödeme süresinde tamamlanmadı; sipariş otomatik iptal edildi.",
        reason: "payment_timeout",
        expectedStatus: "pending_payment",
      },
      { effects: options.effects, lockedGuard: staleCondition(mins, renewalMins), executor: options.executor },
    );
    if (done.ok) cancelled.push({ id, orderNumber: done.orderNumber });
  };

  const queue = stale.slice(0, Math.max(1, limits.maxOrders));
  result.deferred = stale.length - queue.length;
  const worker = async () => {
    while (queue.length > 0) {
      if (Date.now() >= deadline) {
        result.deferred += queue.length;
        queue.length = 0;
        return;
      }
      const next = queue.shift()!;
      try {
        await handle(next);
      } catch (error) {
        // One order's failure (e.g. a lock timeout) must not stop the others; the next run tries again.
        result.failed++;
        console.error(`[orders] expiry failed order=${next.id}`, safeErrorInfo(error));
      }
    }
  };
  // Concurrent savepoints on one transaction would interleave: one at a time inside a caller's transaction.
  const workers = options.executor ? 1 : Math.max(1, Math.min(limits.concurrency, queue.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (result.deferred > 0) console.warn(`[orders] expiry deferred ${result.deferred} order(s) to the next run (limit or time budget)`);
  cancelled.sort((a, b) => a.id - b.id);
  result.orderNumbers = cancelled.map((c) => c.orderNumber);
  result.expired = cancelled.length;
  return result;
}
