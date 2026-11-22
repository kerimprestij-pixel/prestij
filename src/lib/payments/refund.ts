// "Kart iadesi yap" (panel, admin): refunds a card payment in full at the provider that took it, then
// runs the existing mark_refunded transition. No Next APIs here (DB tests call it directly).
//
// Flow (the provider call happens outside any DB transaction):
//   1. lock the order + its succeeded card payment, check mark_refunded is allowed, mark the refund
//      "pending" in payments.raw.refund (a second click within 3 minutes is refused: in_progress);
//   2. gateway.refund() at the provider and environment of the payment;
//   3. record the outcome (payments.status = refunded on success, payment_refunded / payment_refund_failed
//      order event, audit row);
//   4. on success transitionOrder(mark_refunded). A refund that succeeded at the provider is remembered
//      (state "done"), so a retry after a failed step 4 never refunds twice.
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OrderStatus } from "@/db/schema/commerce";
import { safeErrorInfo } from "@/lib/db-errors";
import { checkTransition } from "@/lib/orders/status-machine";
import { transitionOrder, type OrderActor } from "@/lib/orders/status";
import { writeAudit } from "@/lib/panel/audit";
import { gatewayFor, loadPaymentSettings } from "./gateway";
import type { CardProvider } from "./types";

const o = schema.orders;
const pay = schema.payments;

export const CARD_PROVIDER_LABELS: Record<CardProvider, string> = { iyzico: "iyzico", paytr: "PayTR", simulator: "Ödeme simülatörü" };
const CARD_PROVIDERS: CardProvider[] = ["iyzico", "paytr", "simulator"];
/** A "pending" refund older than this is considered abandoned (the request died) and may be retried. */
const PENDING_LOCK_MS = 3 * 60_000;

type RefundState = { state?: "pending" | "done" | "failed"; startedAt?: string; finishedAt?: string; ref?: string; error?: string; by?: string | null; [key: string]: unknown };
type Json = Record<string, unknown>;

const refundStateOf = (raw: unknown): RefundState => {
  const r = raw && typeof raw === "object" ? (raw as Json).refund : undefined;
  return r && typeof r === "object" && !Array.isArray(r) ? (r as RefundState) : {};
};

const asJson = (raw: unknown): Json => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Json) : {});

async function findRefundablePayment(executor: Pick<typeof db, "select">, order: { id: number; paymentRef: string | null }, lock: boolean) {
  const base = executor
    .select({ id: pay.id, provider: pay.provider, status: pay.status, amount: pay.amount, providerRef: pay.providerRef, raw: pay.raw })
    .from(pay)
    .where(and(eq(pay.orderId, order.id), inArray(pay.provider, CARD_PROVIDERS), inArray(pay.status, ["succeeded", "refunded"])))
    .orderBy(desc(pay.id));
  const rows = lock ? await base.for("update") : await base;
  return rows.find((r) => order.paymentRef && r.providerRef === order.paymentRef) ?? rows.find((r) => r.status === "succeeded") ?? rows[0] ?? null;
}

export type CardRefundInfo = {
  provider: CardProvider;
  providerLabel: string;
  amount: number;
  providerRef: string | null;
  /** The provider can be reached from this server (keys / simulator). */
  configured: boolean;
  /** Refund already done at the provider (payment row refunded or state done). */
  refunded: boolean;
  /** The last attempt failed with this Turkish message. */
  lastError: string | null;
  /** mark_refunded is allowed for an admin now (status and paidAt). */
  allowed: boolean;
};

/** For the panel order page: whether "Kart iadesi yap" applies to this order. Null for non-card orders. */
export async function getCardRefundInfo(orderId: number): Promise<CardRefundInfo | null> {
  const [order] = await db
    .select({ id: o.id, status: o.status, paymentMethod: o.paymentMethod, paidAt: o.paidAt, paymentRef: o.paymentRef })
    .from(o)
    .where(eq(o.id, orderId))
    .limit(1);
  if (!order || order.paymentMethod !== "card" || !order.paidAt) return null;
  const payment = await findRefundablePayment(db, order, false);
  if (!payment) return null;
  const provider = payment.provider as CardProvider;
  const state = refundStateOf(payment.raw);
  return {
    provider,
    providerLabel: CARD_PROVIDER_LABELS[provider] ?? provider,
    amount: payment.amount,
    providerRef: payment.providerRef,
    configured: gatewayFor(provider, { testMode: true, installments: false, maxInstallments: 1 }) !== null,
    refunded: payment.status === "refunded" || state.state === "done",
    lastError: state.state === "failed" && typeof state.error === "string" ? state.error : null,
    allowed: checkTransition({ status: order.status, paidAt: order.paidAt }, "mark_refunded", "admin").ok,
  };
}

export type RefundCardPaymentResult =
  | { ok: true; orderNumber: string; ref: string; provider: CardProvider; transitioned: boolean; status: OrderStatus; message: string }
  | { ok: false; code: "forbidden" | "not_found" | "not_card" | "not_paid" | "invalid_transition" | "no_payment" | "in_progress" | "not_configured" | "provider_error"; error: string };

const fail = (code: Exclude<RefundCardPaymentResult, { ok: true }>["code"], error: string): RefundCardPaymentResult => ({ ok: false, code, error });

/** Full card refund at the provider + mark_refunded (see the header). Admin only (checked again here). */
export async function refundCardPayment(
  orderId: number,
  actor: OrderActor,
  options: { expectedStatus?: OrderStatus | null; clientIp?: string | null; effects?: boolean; now?: () => Date } = {},
): Promise<RefundCardPaymentResult> {
  const now = options.now ?? (() => new Date());
  if (actor.role !== "admin") return fail("forbidden", "Kart iadesini yalnızca yöneticiler yapabilir.");
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return fail("not_found", "Sipariş bulunamadı.");

  // 1. Lock, check, mark pending.
  const prepared = await db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: o.id, orderNumber: o.orderNumber, status: o.status, paymentMethod: o.paymentMethod, paidAt: o.paidAt, paymentRef: o.paymentRef, grandTotal: o.grandTotal })
      .from(o)
      .where(eq(o.id, orderId))
      .for("update")
      .limit(1);
    if (!order) return fail("not_found", "Sipariş bulunamadı. Silinmiş olabilir.");
    if (order.paymentMethod !== "card") return fail("not_card", "Bu sipariş kartla ödenmemiş; kart iadesi yapılamaz.");
    if (options.expectedStatus && order.status !== options.expectedStatus) {
      return fail("invalid_transition", "Sipariş siz sayfayı açtıktan sonra değişmiş. Sayfa yenilendi, güncel durumu kontrol edin.");
    }
    const check = checkTransition({ status: order.status, paidAt: order.paidAt }, "mark_refunded", actor.role);
    if (!check.ok) {
      if (check.code === "not_paid") return fail("not_paid", "Bu siparişin ödemesi alınmamış; iade edilecek tutar yok.");
      if (check.code === "forbidden") return fail("forbidden", "Kart iadesini yalnızca yöneticiler yapabilir.");
      return fail("invalid_transition", "Siparişin şu anki durumunda iade yapılamaz.");
    }
    const payment = await findRefundablePayment(tx, order, true);
    if (!payment || !payment.providerRef) return fail("no_payment", "Bu siparişte iade edilebilecek bir kart ödemesi kaydı bulunamadı.");
    const raw = asJson(payment.raw);
    const state = refundStateOf(raw);
    const done = payment.status === "refunded" || state.state === "done";
    if (!done && state.state === "pending" && state.startedAt && now().getTime() - Date.parse(state.startedAt) < PENDING_LOCK_MS) {
      return fail("in_progress", "Bu sipariş için bir iade işlemi zaten sürüyor. Birkaç dakika sonra sayfayı yenileyin.");
    }
    if (!done) {
      await tx
        .update(pay)
        .set({ raw: { ...raw, refund: { ...state, state: "pending", startedAt: now().toISOString(), by: actor.userId, error: undefined } } })
        .where(eq(pay.id, payment.id));
    }
    return { order, payment: { ...payment, raw, providerRef: payment.providerRef }, done, state };
  });
  if ("ok" in prepared) return prepared;
  const { order, payment } = prepared;
  const provider = payment.provider as CardProvider;
  const label = CARD_PROVIDER_LABELS[provider] ?? provider;

  // 2. The provider (skipped when an earlier attempt already refunded the money).
  let outcome: { ok: true; ref: string; raw?: Json } | { ok: false; error: string; raw?: Json };
  let notConfigured = false;
  if (prepared.done) {
    outcome = { ok: true, ref: prepared.state.ref ?? "önceden iade edildi" };
  } else {
    const testMode = typeof payment.raw.testMode === "boolean" ? payment.raw.testMode : (await loadPaymentSettings()).card.testMode;
    const gateway = gatewayFor(provider, { testMode, installments: false, maxInstallments: 1 });
    if (!gateway) {
      notConfigured = true;
      outcome = { ok: false, error: `${label} anahtarları bu sunucuda tanımlı değil; iade yapılamadı.` };
    } else {
      try {
        outcome = await gateway.refund({ orderId: order.id, providerRef: payment.providerRef, amount: payment.amount, raw: payment.raw, clientIp: options.clientIp ?? null });
      } catch (error) {
        console.error(`[payments] refund threw order=${order.id}`, safeErrorInfo(error));
        outcome = { ok: false, error: `${label} ile bağlantı kurulamadı. Bir süre sonra tekrar deneyin.` };
      }
    }
  }

  // 3. Record the outcome.
  await db.transaction(async (tx) => {
    const [current] = await tx.select({ raw: pay.raw, status: pay.status }).from(pay).where(eq(pay.id, payment.id)).for("update").limit(1);
    const raw = asJson(current?.raw);
    const state = refundStateOf(raw);
    const at = now().toISOString();
    const refund: RefundState = outcome.ok
      ? { ...state, ...outcome.raw, state: "done", ref: outcome.ref, finishedAt: at, error: undefined }
      : { ...state, ...outcome.raw, state: "failed", error: outcome.error.slice(0, 300), finishedAt: at };
    await tx
      .update(pay)
      .set({ raw: { ...raw, refund }, ...(outcome.ok ? { status: "refunded" as const } : {}) })
      .where(eq(pay.id, payment.id));
    if (!prepared.done) {
      await tx.insert(schema.orderEvents).values(
        outcome.ok
          ? { orderId: order.id, type: "payment_refunded", data: { provider, providerRef: payment.providerRef, refundRef: outcome.ref, amount: payment.amount }, createdBy: actor.userId ?? "system" }
          : { orderId: order.id, type: "payment_refund_failed", data: { provider, providerRef: payment.providerRef, error: outcome.error.slice(0, 300) }, createdBy: actor.userId ?? "system" },
      );
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "status",
        entity: "order",
        entityId: order.id,
        after: { cardRefund: outcome.ok ? "done" : "failed", provider, amount: payment.amount, ...(outcome.ok ? { ref: outcome.ref } : { error: outcome.error.slice(0, 300) }) },
      });
    }
  });
  if (!outcome.ok) return fail(notConfigured ? "not_configured" : "provider_error", `İade yapılamadı: ${outcome.error}`);

  // 4. The order status.
  const transition = await transitionOrder(
    order.id,
    "mark_refunded",
    { actor, note: `Kart iadesi ${label} üzerinden yapıldı (ref: ${outcome.ref}).`, reason: "card_refund" },
    { effects: options.effects },
  );
  if (!transition.ok) {
    return {
      ok: true,
      orderNumber: order.orderNumber,
      ref: outcome.ref,
      provider,
      transitioned: false,
      status: order.status,
      message: `Tutar ${label} üzerinden iade edildi, ancak sipariş durumu güncellenemedi. Sayfayı yenileyip “İade edildi” ile işaretleyin.`,
    };
  }
  return {
    ok: true,
    orderNumber: order.orderNumber,
    ref: outcome.ref,
    provider,
    transitioned: true,
    status: transition.status,
    message: transition.restocked
      ? `Tutar ${label} üzerinden müşterinin kartına iade edildi. Sipariş iade edildi olarak işaretlendi, ürünler stoğa geri eklendi.`
      : `Tutar ${label} üzerinden müşterinin kartına iade edildi. Sipariş iade edildi olarak işaretlendi.`,
  };
}
