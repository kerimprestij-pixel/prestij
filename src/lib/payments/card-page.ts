// Data for the PayTR card page (/odeme/kart). Two entry points:
//   ?order=PR-…&t=<order token>   our own redirect after placing the order / "retry": shows the iframe.
//   ?r=<signed>&sonuc=ok|hata      PayTR's merchant_ok_url / merchant_fail_url: waits for the notification.
// While the latest attempt is inside its window without a result (paytr-window.ts), neither offers a new form.
import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { normalizeOrderNumber } from "@/lib/orders/number";
import { orderPageHref, tokensMatch } from "@/lib/orders/token";
import { verifyToken } from "@/lib/signed-token";
import { attemptsOf, isSupersededPayment } from "./attempts";
import { CARD_RETURN_PURPOSE } from "./paytr-gateway";
import { PAYTR_FORM_USABLE_MS as USABLE_MS, paytrAttemptState } from "./paytr-window";

type OrderRow = { id: number; orderNumber: string; accessToken: string; status: string; paymentMethod: string; grandTotal: number; locale: Locale };

async function orderBy(where: { id: number } | { orderNumber: string }): Promise<OrderRow | null> {
  const o = schema.orders;
  const [row] = await db
    .select({ id: o.id, orderNumber: o.orderNumber, accessToken: o.accessToken, status: o.status, paymentMethod: o.paymentMethod, grandTotal: o.grandTotal, locale: o.locale })
    .from(o)
    .where("id" in where ? eq(o.id, where.id) : eq(o.orderNumber, where.orderNumber))
    .limit(1);
  return row ? { ...row, locale: isLocale(row.locale) ? row.locale : "tr" } : null;
}

/** The order's newest payment rows (newest first). */
async function paymentRows(orderId: number) {
  const p = schema.payments;
  return db
    .select({ id: p.id, status: p.status, provider: p.provider, providerRef: p.providerRef, raw: p.raw, updatedAt: p.updatedAt })
    .from(p)
    .where(eq(p.orderId, orderId))
    .orderBy(desc(p.id))
    .limit(20);
}

/** The newest payment row that speaks for the open attempt (superseded failures of older attempts are skipped). */
const latestOf = (rows: Awaited<ReturnType<typeof paymentRows>>) => rows.find((r) => !isSupersededPayment(r.raw)) ?? null;

export type CardPageSession =
  | { state: "ready"; orderNumber: string; amount: number; iframeUrl: string; frameOrigin: string; orderHref: string; expiresAt: string }
  | { state: "expired"; orderNumber: string; amount: number; token: string; orderHref: string }
  /** The form closed, but its payment may still be confirmed: no new form until `retryAt` (ISO). */
  | { state: "verifying"; orderNumber: string; amount: number; orderHref: string; retryAt: string }
  | { state: "not_pending"; orderHref: string; status: string }
  | { state: "not_found" };

/** ?order=&t= : the PayTR iframe of the latest attempt, while it is still usable. */
export async function getCardPageSession(input: { orderNumber: unknown; token: unknown }, now: Date = new Date()): Promise<CardPageSession> {
  const number = normalizeOrderNumber(input.orderNumber);
  const order = number ? await orderBy({ orderNumber: number }) : null;
  if (!order || order.paymentMethod !== "card" || !tokensMatch(input.token, order.accessToken)) return { state: "not_found" };
  const orderHref = orderPageHref(order.locale, order.orderNumber, order.accessToken);
  if (order.status !== "pending_payment") return { state: "not_pending", orderHref, status: order.status };
  const rows = await paymentRows(order.id);
  const last = latestOf(rows);
  const attempt = last && last.provider === "paytr" && last.status === "initiated" ? attemptsOf(last.raw).at(-1) : undefined;
  const startedAt = attempt ? Date.parse(attempt.at) : NaN;
  const iframeUrl = attempt?.iframeUrl;
  if (!attempt || !iframeUrl || !Number.isFinite(startedAt) || now.getTime() - startedAt > USABLE_MS) {
    const window = paytrAttemptState(rows, now.getTime());
    if (window.verifying && window.verifyUntil !== null) {
      return { state: "verifying", orderNumber: order.orderNumber, amount: order.grandTotal, orderHref, retryAt: new Date(window.verifyUntil).toISOString() };
    }
    return { state: "expired", orderNumber: order.orderNumber, amount: order.grandTotal, token: order.accessToken, orderHref };
  }
  let frameOrigin: string;
  try {
    frameOrigin = new URL(iframeUrl).origin;
  } catch {
    return { state: "expired", orderNumber: order.orderNumber, amount: order.grandTotal, token: order.accessToken, orderHref };
  }
  return {
    state: "ready",
    orderNumber: order.orderNumber,
    amount: order.grandTotal,
    iframeUrl,
    frameOrigin,
    orderHref,
    expiresAt: new Date(startedAt + USABLE_MS).toISOString(),
  };
}

export type CardReturnState =
  | {
      state: "paid" | "failed" | "waiting" | "closed";
      orderId: number;
      orderNumber: string;
      locale: Locale;
      redirectTo: string;
      /** waiting: the latest PayTR attempt is inside its window without a result ("Ödemeniz doğrulanıyor", no new form). */
      verifying?: boolean;
    }
  | { state: "invalid" };

/**
 * ?r= : where the order stands after PayTR sent the buyer back. "waiting" while the latest attempt is
 * still open (the notification has not arrived yet); "closed" when the order is neither paid nor waiting
 * (cancelled, expired). The order token is only handed out for a valid, unexpired signed link.
 */
export async function getCardReturnState(r: unknown, now: number = Date.now()): Promise<CardReturnState> {
  const verified = verifyToken<{ o?: unknown }>(CARD_RETURN_PURPOSE, r);
  if (!verified.ok || typeof verified.payload.o !== "number") return { state: "invalid" };
  const order = await orderBy({ id: verified.payload.o });
  if (!order || order.paymentMethod !== "card") return { state: "invalid" };
  const base = { orderId: order.id, orderNumber: order.orderNumber, locale: order.locale };
  const page = (flags: { new?: boolean; paymentFailed?: boolean } = {}) => orderPageHref(order.locale, order.orderNumber, order.accessToken, flags);
  if (order.status === "paid" || order.status === "processing" || order.status === "shipped" || order.status === "delivered") {
    return { state: "paid", ...base, redirectTo: page({ new: order.status === "paid" }) };
  }
  if (order.status !== "pending_payment") return { state: "closed", ...base, redirectTo: page() };
  const rows = await paymentRows(order.id);
  if (latestOf(rows)?.status === "failed") return { state: "failed", ...base, redirectTo: page({ paymentFailed: true }) };
  return { state: "waiting", ...base, redirectTo: page(), verifying: paytrAttemptState(rows, now).verifying };
}
