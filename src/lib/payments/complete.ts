// Starting a card payment, and the single place that turns a provider result into an order state
// change (completeCardPayment).
import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PaymentProvider } from "@/db/schema/commerce";
import { isLocale, type Locale } from "@/i18n/config";
import { href } from "@/i18n/paths";
import { localize } from "@/i18n/localize";
import type { DbExecutor } from "@/lib/cart/settings";
import { safeErrorInfo } from "@/lib/db-errors";
import { scheduleNotification } from "@/lib/orders/effects";
import { activatePendingSubscriptions } from "@/lib/subscriptions/service";
import { PAYMENT_REFUSED_EVENT, PAYMENT_SUCCESS_AFTER_FAILURE_EVENT } from "./alerts";
import { attemptsOf, isSupersededPayment, withAttempt } from "./attempts";
import { buildBasketLines, clip, gatewayAddress, gatewayPhone, identityNumberOf } from "./basket";
import { getCardGateway, isProviderConfigured, type PaymentSettings } from "./gateway";
import type { TEST_PAYMENT_ON_LIVE } from "./paytr-crypto";
import { paytrAttemptState } from "./paytr-window";
import { providerRefusalOf } from "./refusal";
import type { CardProvider, GatewayOrder } from "./types";

const o = schema.orders;
const pay = schema.payments;

/** Records an "initiated" payment row inside the order transaction (placeOrder, retries). Returns its id. */
export async function recordPaymentInitiated(tx: DbExecutor, orderId: number, provider: PaymentProvider, amount: number): Promise<number> {
  const [row] = await tx.insert(pay).values({ orderId, provider, status: "initiated", amount }).returning({ id: pay.id });
  await tx.insert(schema.orderEvents).values({ orderId, type: "payment_initiated", data: { provider, amount } });
  return row.id;
}

/**
 * PayTR-fix R2: payments.raw.startingAt (ISO) is written on the payment row, under the order row lock, before the
 * provider session is requested (PayTR get-token may take up to 20 s), and removed once the attempt is stored or the
 * request failed. While it is younger than ATTEMPT_STARTING_MS a retry (notWhileVerifying) is refused with
 * "verifying", so two tabs cannot open two forms with different merchant_oids. A marker left by a crashed request
 * expires by itself. No migration: a jsonb key.
 */
export const ATTEMPT_STARTING_MS = 60_000;

/** A payment row of the order is starting a provider session right now (raw.startingAt younger than ATTEMPT_STARTING_MS). */
export function attemptStarting(rows: readonly { raw: unknown }[], now: number): boolean {
  return rows.some((r) => {
    const at = r.raw && typeof r.raw === "object" ? (r.raw as { startingAt?: unknown }).startingAt : undefined;
    const t = typeof at === "string" ? Date.parse(at) : NaN;
    return Number.isFinite(t) && now - t < ATTEMPT_STARTING_MS && t - now < ATTEMPT_STARTING_MS;
  });
}

const rawObject = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});

/** payments.raw without the R2 marker. */
function withoutStarting(raw: unknown): Record<string, unknown> {
  const { startingAt, ...rest } = rawObject(raw);
  void startingAt;
  return rest;
}

/**
 * After a failed start: removes the R2 marker and, when the provider gave one, keeps its refusal reason on the payment
 * row: payments.raw.lastError = { at, message } (other raw keys, the attempts list among them, stay). Never throws:
 * the buyer still gets the order page.
 */
async function recordInitiateRefusal(paymentId: number, message: string | null): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx.select({ raw: pay.raw }).from(pay).where(eq(pay.id, paymentId)).for("update").limit(1);
      const base = withoutStarting(current?.raw);
      await tx
        .update(pay)
        .set({ raw: message ? { ...base, lastError: { at: new Date().toISOString(), message } } : base })
        .where(eq(pay.id, paymentId));
    });
  } catch (error) {
    console.error(`[payments] storing the refusal reason failed payment=${paymentId}`, safeErrorInfo(error));
  }
}

/** The PayTR card page for an order: /tr/odeme/kart?order=PR-…&t=<token> (en: /en/checkout/card). */
export function cardPageHref(locale: Locale, orderNumber: string, token: string): string {
  return `${href(locale, "cardPayment")}?${new URLSearchParams({ order: orderNumber, t: token }).toString()}`;
}

export type InitiateCardPaymentResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; code: "not_found" | "not_card" | "not_pending" | "not_configured" | "gateway_error" | "verifying" };

export type InitiateCardPaymentOptions = {
  /** The buyer's trusted client IP (clientIp() in the action); the providers require one. */
  clientIp?: string | null;
  /** Payment settings already read by the caller (placeOrder); read fresh otherwise. */
  payments?: PaymentSettings;
  /** Language of the PayTR card page link (default: the order's language). */
  locale?: Locale;
  /**
   * The buyer's retry: refuse ("verifying") while the latest PayTR attempt is inside its window without a result
   * (paytr-window.ts), and while another request of this order is still starting its provider session (R2 marker,
   * raw.startingAt), both checked under the order row lock, so two tabs cannot both open a new form.
   */
  notWhileVerifying?: boolean;
};

/**
 * Starts (or restarts, e.g. the order page's retry button) a card payment for a pending order and
 * returns where to send the buyer: the provider's page (iyzico, simulator) or /odeme/kart (PayTR
 * iframe). Callers must have verified access (order token or staff).
 */
export async function initiateCardPayment(orderId: number, options: InitiateCardPaymentOptions = {}): Promise<InitiateCardPaymentResult> {
  const gateway = await getCardGateway(options.payments);
  if (!gateway) return { ok: false, code: "not_configured" };
  const prepared = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: o.id,
        orderNumber: o.orderNumber,
        accessToken: o.accessToken,
        status: o.status,
        paymentMethod: o.paymentMethod,
        grandTotal: o.grandTotal,
        shippingTotal: o.shippingTotal,
        paymentFee: o.paymentFee,
        locale: o.locale,
        email: o.email,
        phone: o.phone,
        userId: o.userId,
        shippingAddress: o.shippingAddress,
        invoice: o.invoice,
      })
      .from(o)
      .where(eq(o.id, orderId))
      .for("update")
      .limit(1);
    if (!row) return { error: "not_found" as const };
    if (row.paymentMethod !== "card") return { error: "not_card" as const };
    if (row.status !== "pending_payment") return { error: "not_pending" as const };
    const rows = await tx
      .select({ id: pay.id, status: pay.status, provider: pay.provider, providerRef: pay.providerRef, raw: pay.raw, updatedAt: pay.updatedAt })
      .from(pay)
      .where(eq(pay.orderId, row.id))
      .orderBy(desc(pay.id));
    const now = Date.now();
    if (options.notWhileVerifying && (paytrAttemptState(rows, now).verifying || attemptStarting(rows, now))) return { error: "verifying" as const };
    // A superseded failure row (an older attempt that failed late) says nothing about the open attempt.
    const last = rows.find((r) => !isSupersededPayment(r.raw));
    let paymentId: number;
    let base: Record<string, unknown> = {};
    if (!last || last.status !== "initiated" || last.provider !== gateway.provider) {
      paymentId = await recordPaymentInitiated(tx, row.id, gateway.provider, row.grandTotal);
    } else {
      // A retry of the open attempt: touched below, so the expiry job counts from now (payment in progress).
      paymentId = last.id;
      base = rawObject(last.raw);
    }
    // R2: this request is starting a provider session (cleared when the attempt is stored or the start failed).
    await tx
      .update(pay)
      .set({ raw: { ...base, startingAt: new Date(now).toISOString() }, updatedAt: new Date(now) })
      .where(eq(pay.id, paymentId));
    const attempt = 1 + rows.filter((r) => r.provider === gateway.provider).reduce((n, r) => n + attemptsOf(r.raw).length, 0);
    const items = await tx
      .select({ id: schema.orderItems.id, snapshot: schema.orderItems.snapshot, quantity: schema.orderItems.quantity, lineTotal: schema.orderItems.lineTotal, isSample: schema.orderItems.isSample })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, row.id))
      .orderBy(schema.orderItems.id);
    const [account] = row.userId
      ? await tx.select({ createdAt: schema.user.createdAt }).from(schema.user).where(eq(schema.user.id, row.userId)).limit(1)
      : [];
    return { row, paymentId, attempt, items, registeredAt: account?.createdAt ?? null };
  });
  if ("error" in prepared) return { ok: false, code: prepared.error ?? "not_found" };

  const { row: r, items } = prepared;
  const orderLocale: Locale = isLocale(r.locale) ? r.locale : "tr";
  const billing = r.invoice?.address ?? r.shippingAddress;
  const buyerName =
    (r.invoice?.type === "individual" ? r.invoice.fullName : null) || clip(billing.fullName, 100) || clip(r.shippingAddress.fullName, 100) || r.email;
  const gatewayOrder: GatewayOrder = {
    id: r.id,
    orderNumber: r.orderNumber,
    accessToken: r.accessToken,
    amount: r.grandTotal,
    locale: orderLocale,
    email: r.email,
    details: {
      buyer: {
        id: r.userId ?? `guest-${r.orderNumber}`,
        fullName: buyerName,
        email: r.email,
        phone: gatewayPhone(r.phone ?? r.shippingAddress.phone),
        identityNumber: identityNumberOf(r.invoice),
        registeredAt: prepared.registeredAt,
      },
      shippingAddress: gatewayAddress(r.shippingAddress, buyerName),
      billingAddress: gatewayAddress(billing, buyerName),
      lines: buildBasketLines({
        orderNumber: r.orderNumber,
        amount: r.grandTotal,
        shippingTotal: r.shippingTotal,
        paymentFee: r.paymentFee,
        items: items.map((i) => ({
          id: i.id,
          name: [localize(i.snapshot.productName, "tr"), localize(i.snapshot.variantTitle, "tr")].filter(Boolean).join(" · "),
          quantity: i.quantity,
          lineTotal: i.lineTotal,
          isSample: i.isSample,
        })),
      }),
      clientIp: options.clientIp && options.clientIp !== "unknown" ? options.clientIp : null,
      attempt: prepared.attempt,
    },
  };

  let result: Awaited<ReturnType<typeof gateway.initiate>>;
  try {
    result = await gateway.initiate(gatewayOrder);
  } catch (error) {
    // Error class only: messages may echo request data. A provider's refusal reason (its own text about our
    // request, masked and cut to 200 characters by GatewayRefusedError) is logged and kept on the payment row
    // as raw.lastError; the panel order page shows it under the payment record (go-live CF-12).
    const refusal = providerRefusalOf(error);
    console.error(`[payments] initiate failed order=${r.id} provider=${gateway.provider}`, {
      ...safeErrorInfo(error),
      ...(refusal ? { reason: refusal.message } : {}),
    });
    await recordInitiateRefusal(prepared.paymentId, refusal?.message ?? null);
    return { ok: false, code: "gateway_error" };
  }
  try {
    const attempt = result.attempt;
    await db.transaction(async (tx) => {
      const [current] = await tx.select({ raw: pay.raw }).from(pay).where(eq(pay.id, prepared.paymentId)).for("update").limit(1);
      const base = withoutStarting(current?.raw);
      await tx
        .update(pay)
        .set({
          raw: attempt ? withAttempt(base, { n: prepared.attempt, ref: attempt.ref, testMode: attempt.testMode, at: new Date().toISOString(), ...attempt.raw }) : base,
        })
        .where(eq(pay.id, prepared.paymentId));
    });
  } catch (error) {
    // The provider session exists; callbacks still verify it with the provider (attempt lookup is advisory). A marker
    // left behind expires after ATTEMPT_STARTING_MS.
    console.error(`[payments] storing attempt failed order=${r.id}`, safeErrorInfo(error));
  }
  const redirectUrl = result.redirectUrl ?? cardPageHref(options.locale ?? orderLocale, r.orderNumber, r.accessToken);
  return { ok: true, redirectUrl };
}

export type CompleteCardPaymentInput = {
  orderId: number;
  /** The provider's payment id; one per attempt. Replays with the same ref are idempotent. */
  providerRef: string;
  success: boolean;
  /** Amount the provider charged (kuruş). Must equal orders.grandTotal. */
  amount: number;
  raw?: Record<string, unknown>;
  /** Defaults to the active gateway. A provider without configuration here is refused. */
  provider?: CardProvider;
  /**
   * The attempt this result belongs to (iyzico token / PayTR merchant_oid, as stored in
   * payments.raw.attempts). A failure of an attempt older than the latest one is recorded on its own
   * row and leaves the open attempt alone (no "payment failed" mail while the buyer is still paying).
   */
  attemptRef?: string | null;
};

export type CompleteCardPaymentResult =
  | { ok: true; status: "paid" | "failed"; alreadyProcessed: boolean; orderId: number; orderNumber: string }
  | { ok: false; code: "not_configured" | "invalid_input" | "not_found" | "not_card" | "amount_mismatch" | "not_pending" | "order_cancelled" };

/**
 * Applies a verified provider result. Idempotent (same providerRef → same answer, no second event);
 * a providerRef already recorded for another order is refused (invalid_input).
 * Success with the exact grandTotal moves pending_payment → paid; a different amount is recorded as a
 * failed payment ("payment_amount_mismatch") and the order stays unpaid. A failure keeps the order in
 * pending_payment so the buyer can retry; a late failure for an order that is no longer pending is
 * only recorded (no event, no notification). Money arriving for a cancelled order is recorded, the
 * order's paidAt is set (so an admin can mark it refunded) and a payment_after_cancel event flags the
 * manual refund; a second charge on a paid order gets payment_duplicate. A success for a reference already
 * recorded as failed changes nothing (PayTR acts on the first notification only) but gets one
 * payment_success_after_failure event (dashboard warning, alerts.ts); except (PayTR-fix R1) an amount mismatch that
 * a Durum Sorgu answer recorded, which a non-inquiry result with the exact total replaces.
 * The provider must be configured here (keys / simulator), but need not be the one the panel selects
 * now: a payment started before a provider switch still completes. Fails closed otherwise.
 * `options.executor`: run inside that transaction (a savepoint) instead of a new one (DB tests roll it back).
 */
export async function completeCardPayment(
  input: CompleteCardPaymentInput,
  options: { effects?: boolean; executor?: DbExecutor } = {},
): Promise<CompleteCardPaymentResult> {
  const provider = input.provider ?? (await getCardGateway())?.provider;
  if (!provider || !isProviderConfigured(provider)) return { ok: false, code: "not_configured" };
  const providerRef = typeof input.providerRef === "string" ? input.providerRef.trim() : "";
  if (
    !Number.isSafeInteger(input.orderId) ||
    !providerRef ||
    providerRef.length > 200 ||
    typeof input.success !== "boolean" ||
    !Number.isSafeInteger(input.amount) ||
    input.amount < 0
  ) {
    return { ok: false, code: "invalid_input" };
  }
  const raw = input.raw ?? {};

  const result = await (options.executor ?? db).transaction(async (tx): Promise<CompleteCardPaymentResult & { notify?: "paid" | "payment_failed" }> => {
    const [order] = await tx
      .select({ id: o.id, orderNumber: o.orderNumber, status: o.status, paymentMethod: o.paymentMethod, grandTotal: o.grandTotal, paidAt: o.paidAt })
      .from(o)
      .where(eq(o.id, input.orderId))
      .for("update")
      .limit(1);
    if (!order) return { ok: false, code: "not_found" };
    if (order.paymentMethod !== "card") return { ok: false, code: "not_card" };

    const [seen] = await tx
      .select({ id: pay.id, status: pay.status, orderId: pay.orderId, raw: pay.raw })
      .from(pay)
      .where(and(eq(pay.provider, provider), eq(pay.providerRef, providerRef)))
      .limit(1);
    // A reference belongs to one order: never answer for order A with order B's payment.
    if (seen && seen.orderId !== order.id) return { ok: false, code: "invalid_input" };
    // PayTR-fix R1 (defence in depth): an amount mismatch recorded from a Durum Sorgu answer (an inquiry no longer
    // records one, but older rows may exist) is not a final result. A result that is not itself an inquiry (the
    // hash-verified notification) with the exact order total replaces it on the same row and is applied normally.
    const seenRaw = rawObject(seen?.raw);
    const upgrade =
      seen?.status === "failed" &&
      seenRaw.source === "durum-sorgu" &&
      seenRaw.reason === "amount_mismatch" &&
      input.success &&
      raw.source !== "durum-sorgu" &&
      input.amount === order.grandTotal
        ? { id: seen.id, raw: seen.raw }
        : null;
    if (upgrade) console.warn(`[payments] ${provider} result replaces an inquiry's amount mismatch order=${order.id} ref=${providerRef.slice(0, 64)}`);
    if (seen && !upgrade) {
      if (seen.status === "succeeded" && order.status !== "cancelled" && order.status !== "refunded") {
        return { ok: true, status: "paid", alreadyProcessed: true, orderId: order.id, orderNumber: order.orderNumber };
      }
      if (seen.status === "failed") {
        // PayTR-fix C13a: PayTR acts on the first notification per merchant_oid only, so a success after a recorded
        // failure changes nothing here; it gets an order event (once per reference) and a log line for a person to
        // check at the provider. Replays of a success we did not apply (a recorded amount mismatch, or a result
        // refused on purpose such as a C5 test payment, raw.refused) are not "after a failure".
        const r = seen.raw && typeof seen.raw === "object" && !Array.isArray(seen.raw) ? (seen.raw as Record<string, unknown>) : {};
        if (input.success && !("refused" in r) && r.reason !== "amount_mismatch") await noteSuccessAfterFailure(tx, order.id, provider, providerRef, input.amount);
        if (input.success && input.amount !== order.grandTotal) return { ok: false, code: "amount_mismatch" };
        return { ok: true, status: "failed", alreadyProcessed: true, orderId: order.id, orderNumber: order.orderNumber };
      }
      return { ok: false, code: "order_cancelled" };
    }

    // Reuse the open "initiated" row of this provider when there is one (keeping its attempts list); for an upgrade
    // (R1), the inquiry's mismatch row of this reference (it holds the attempts list since it was the open row).
    const [open] = upgrade
      ? [upgrade]
      : await tx
          .select({ id: pay.id, raw: pay.raw })
          .from(pay)
          .where(and(eq(pay.orderId, order.id), eq(pay.provider, provider), eq(pay.status, "initiated")))
          .orderBy(desc(pay.id))
          .limit(1);
    const record = async (status: "succeeded" | "failed", extra: Record<string, unknown> = {}) => {
      const attempts = attemptsOf(open?.raw);
      const values = { status, amount: input.amount, providerRef, raw: { ...(attempts.length ? { attempts } : {}), ...raw, ...extra } };
      if (open) await tx.update(pay).set(values).where(eq(pay.id, open.id));
      else await tx.insert(pay).values({ orderId: order.id, provider, ...values });
    };

    if (input.success && input.amount !== order.grandTotal) {
      await record("failed", { reason: "amount_mismatch", expected: order.grandTotal });
      await tx.insert(schema.orderEvents).values({
        orderId: order.id,
        type: "payment_amount_mismatch",
        data: { provider, providerRef, expected: order.grandTotal, received: input.amount },
      });
      return { ok: false, code: "amount_mismatch" };
    }

    if (!input.success && order.status !== "pending_payment") {
      // A late failure (an older attempt, a second tab) after the order was paid or cancelled: keep it
      // for the audit trail only. The buyer must not be told that a payment failed.
      await tx.insert(pay).values({ orderId: order.id, provider, status: "failed", amount: input.amount, providerRef, raw: { ...raw, late: true, orderStatus: order.status } });
      return { ok: false, code: order.status === "cancelled" || order.status === "refunded" ? "order_cancelled" : "not_pending" };
    }

    if (!input.success) {
      const attempts = attemptsOf(open?.raw);
      const index = input.attemptRef ? attempts.findIndex((a) => a.ref === input.attemptRef) : -1;
      if (open && index >= 0 && index < attempts.length - 1) {
        // An older attempt failed after the buyer had started a newer one (a second tab, a PayTR
        // time-out). The open row stays "initiated" (the expiry job keeps counting from the newer
        // attempt) and nobody is told that the payment failed.
        await tx.insert(pay).values({ orderId: order.id, provider, status: "failed", amount: input.amount, providerRef, raw: { ...raw, superseded: true } });
        return { ok: true, status: "failed", alreadyProcessed: false, orderId: order.id, orderNumber: order.orderNumber };
      }
      await record("failed");
      await tx.insert(schema.orderEvents).values({ orderId: order.id, type: "payment_failed", data: { provider, providerRef } });
      return { ok: true, status: "failed", alreadyProcessed: false, orderId: order.id, orderNumber: order.orderNumber, notify: "payment_failed" };
    }

    await record("succeeded");
    if (order.status !== "pending_payment") {
      // Money for an order that is no longer waiting (expired/cancelled, or paid twice): keep the
      // record and flag it for a manual refund.
      const cancelled = order.status === "cancelled" || order.status === "refunded";
      if (order.status === "cancelled" && !order.paidAt) {
        // The money was captured: record it on the order so the refund can be marked in the panel
        // (mark_refunded from cancelled needs paidAt).
        await tx.update(o).set({ paidAt: new Date(), paymentProvider: provider, paymentRef: providerRef }).where(eq(o.id, order.id));
      }
      await tx.insert(schema.orderEvents).values({
        orderId: order.id,
        type: cancelled ? "payment_after_cancel" : "payment_duplicate",
        data: { provider, providerRef, amount: input.amount, status: order.status },
      });
      return { ok: false, code: cancelled ? "order_cancelled" : "not_pending" };
    }

    const now = new Date();
    await tx
      .update(o)
      .set({ status: "paid", paidAt: now, paymentProvider: provider, paymentRef: providerRef })
      .where(and(eq(o.id, order.id), eq(o.status, "pending_payment")));
    await tx.insert(schema.orderEvents).values([
      { orderId: order.id, type: "payment_succeeded", data: { provider, providerRef, amount: input.amount } },
      { orderId: order.id, type: "status_changed", data: { action: "payment", from: "pending_payment", to: "paid" }, createdBy: "system" },
    ]);
    // Subscribe and save: a paid first order starts its subscriptions (no-op for other orders).
    await activatePendingSubscriptions(tx, order.id, now);
    return { ok: true, status: "paid", alreadyProcessed: false, orderId: order.id, orderNumber: order.orderNumber, notify: "paid" };
  });

  if (result.ok && result.notify && options.effects !== false) scheduleNotification(result.notify, result.orderId);
  if (result.ok) {
    const { notify, ...rest } = result;
    void notify;
    return rest;
  }
  return result;
}

/** The C13a event (alerts.ts), written once per order and reference inside completeCardPayment's transaction. */
async function noteSuccessAfterFailure(tx: DbExecutor, orderId: number, provider: CardProvider, providerRef: string, amount: number): Promise<void> {
  const e = schema.orderEvents;
  const [noted] = await tx
    .select({ id: e.id })
    .from(e)
    .where(and(eq(e.orderId, orderId), eq(e.type, PAYMENT_SUCCESS_AFTER_FAILURE_EVENT), sql`${e.data}->>'providerRef' = ${providerRef}`))
    .limit(1);
  console.error(`[payments] ${provider} success after a recorded failure order=${orderId} ref=${providerRef.slice(0, 64)}: not applied (the first result counts); check the payment at the provider`);
  if (noted) return;
  await tx.insert(e).values({ orderId, type: PAYMENT_SUCCESS_AFTER_FAILURE_EVENT, data: { provider, providerRef, amount }, createdBy: "system" });
}

export type RefuseCardResultInput = {
  orderId: number;
  provider: CardProvider;
  /** The provider's reference of the result (PayTR merchant_oid); one row per reference, replays are idempotent. */
  providerRef: string;
  /** Kuruş: the amount we asked for (else what the provider reported). */
  amount: number;
  reason: typeof TEST_PAYMENT_ON_LIVE;
  raw?: Record<string, unknown>;
  /** The attempt the result belongs to (payments.raw.attempts[].ref). */
  attemptRef?: string | null;
};

export type RefuseCardResultOutcome =
  | { ok: true; alreadyProcessed: boolean; orderId: number; orderNumber: string }
  | { ok: false; code: "invalid_input" | "not_found" | "not_card" };

/**
 * PayTR-fix C5: records a verified provider result we refuse to apply (a PayTR test payment for an attempt sent live:
 * no money moved). The order is never marked paid, nobody is e-mailed. The latest open attempt's row becomes "failed"
 * (raw.refused = reason), like a decline, so the buyer's return page says the payment did not go through and a retry
 * may start; a refused result for an older attempt, or for an order that no longer waits, gets a row of its own. One
 * "payment_refused" order event (the dashboard counts it). A replay of the same reference changes nothing.
 * `options.executor`: run inside that transaction (a savepoint).
 */
export async function refuseCardResult(input: RefuseCardResultInput, options: { executor?: DbExecutor } = {}): Promise<RefuseCardResultOutcome> {
  const providerRef = typeof input.providerRef === "string" ? input.providerRef.trim() : "";
  if (!Number.isSafeInteger(input.orderId) || !providerRef || providerRef.length > 200 || !Number.isSafeInteger(input.amount) || input.amount < 0) {
    return { ok: false, code: "invalid_input" };
  }
  const provider = input.provider;
  return (options.executor ?? db).transaction(async (tx): Promise<RefuseCardResultOutcome> => {
    const [order] = await tx
      .select({ id: o.id, orderNumber: o.orderNumber, status: o.status, paymentMethod: o.paymentMethod })
      .from(o)
      .where(eq(o.id, input.orderId))
      .for("update")
      .limit(1);
    if (!order) return { ok: false, code: "not_found" };
    if (order.paymentMethod !== "card") return { ok: false, code: "not_card" };
    const [seen] = await tx
      .select({ orderId: pay.orderId })
      .from(pay)
      .where(and(eq(pay.provider, provider), eq(pay.providerRef, providerRef)))
      .limit(1);
    if (seen && seen.orderId !== order.id) return { ok: false, code: "invalid_input" };
    if (seen) return { ok: true, alreadyProcessed: true, orderId: order.id, orderNumber: order.orderNumber };

    const [open] = await tx
      .select({ id: pay.id, raw: pay.raw })
      .from(pay)
      .where(and(eq(pay.orderId, order.id), eq(pay.provider, provider), eq(pay.status, "initiated")))
      .orderBy(desc(pay.id))
      .limit(1);
    const attempts = attemptsOf(open?.raw);
    const index = input.attemptRef ? attempts.findIndex((a) => a.ref === input.attemptRef) : -1;
    const pending = order.status === "pending_payment";
    const raw = { ...(input.raw ?? {}), refused: input.reason };
    if (open && pending && index >= 0 && index === attempts.length - 1) {
      await tx
        .update(pay)
        .set({ status: "failed", amount: input.amount, providerRef, raw: { attempts, ...raw } })
        .where(eq(pay.id, open.id));
    } else {
      await tx.insert(pay).values({
        orderId: order.id,
        provider,
        status: "failed",
        amount: input.amount,
        providerRef,
        // Says nothing about the open attempt (card-page.ts skips superseded rows).
        raw: { ...raw, ...(pending ? { superseded: true } : { late: true, orderStatus: order.status }) },
      });
    }
    await tx.insert(schema.orderEvents).values({
      orderId: order.id,
      type: PAYMENT_REFUSED_EVENT,
      data: { provider, providerRef, reason: input.reason, amount: input.amount },
      createdBy: "system",
    });
    console.error(`[payments] ${provider} result refused order=${order.id} reason=${input.reason}: not applied, the order stays ${order.status}`);
    return { ok: true, alreadyProcessed: false, orderId: order.id, orderNumber: order.orderNumber };
  });
}
