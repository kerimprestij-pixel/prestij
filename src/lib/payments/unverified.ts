// The dashboard to-do "Kart ödemesi doğrulanamadı" (PayTR-fix C3). The expiry job never cancels a PayTR order
// whose result it cannot check (Durum Sorgu unanswered or unclear); once that has lasted
// PAYTR_UNVERIFIED_ALERT_HOURS since the order's latest attempt it writes one order_events row
// ("payment_unverified"), and the dashboard counts the orders that carry it while they still wait for payment.
// The owner checks the payment in PayTR's merchant panel and marks the order paid, or cancels it.
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { DbExecutor } from "@/lib/cart/settings";
import { PAYMENT_UNVERIFIED_EVENT, PAYTR_UNVERIFIED_ALERT_HOURS, type PaytrAttemptState } from "./paytr-window";

/** Writes the to-do row for an order once (the expiry job runs under its advisory lock). Returns true when written. */
export async function flagUnverifiedPayment(exec: DbExecutor, orderId: number, state: Pick<PaytrAttemptState, "latest" | "unsettled">): Promise<boolean> {
  const e = schema.orderEvents;
  const [seen] = await exec
    .select({ id: e.id })
    .from(e)
    .where(and(eq(e.orderId, orderId), eq(e.type, PAYMENT_UNVERIFIED_EVENT)))
    .limit(1);
  if (seen) return false;
  const since = state.latest?.startedAt;
  await exec.insert(e).values({
    orderId,
    type: PAYMENT_UNVERIFIED_EVENT,
    data: { provider: "paytr", merchantOid: state.latest?.ref ?? null, since: since != null ? new Date(since).toISOString() : null, attempts: state.unsettled.length },
    createdBy: "system",
  });
  console.error(`[orders] card payment unverified for ${PAYTR_UNVERIFIED_ALERT_HOURS} h order=${orderId}: dashboard to-do raised`);
  return true;
}

/** Orders still in pending_payment that carry the to-do row (the dashboard line). */
export async function countUnverifiedCardPayments(exec: DbExecutor): Promise<number> {
  const o = schema.orders;
  const e = schema.orderEvents;
  const [row] = await exec
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(o)
    .where(and(eq(o.status, "pending_payment"), sql`exists (select 1 from ${e} where ${e.orderId} = ${o.id} and ${e.type} = ${PAYMENT_UNVERIFIED_EVENT})`));
  return row?.n ?? 0;
}
