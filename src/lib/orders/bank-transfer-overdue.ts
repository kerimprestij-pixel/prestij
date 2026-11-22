// Havale/EFT orders past their payment deadline (sales-ready SR-2), for the panel: the order list filter
// and badge, the order detail notice and the dashboard's "Yapılacaklar" line. Takes the executor (`db` or a
// transaction), the shop's settings.payments.bankTransfer.paymentDays and `now`; no Next APIs, no writes.
// Each order is judged by the day count it was placed with (orders.breakdown.bankTransferDays, FIX F4); the
// setting is only the fallback for orders placed before that field existed.
// Nothing here cancels an order: the owner does that in the panel (cancel restocks).
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";
import type { Tx } from "@/lib/panel/tx";
import { BANK_TRANSFER_PAYMENT_DAYS, bankTransferDeadline, istanbulDayStart, normalizePaymentDays, orderPaymentDays } from "./bank-transfer-deadline";

const o = schema.orders;

export type OverdueInput = {
  /** settings.payments.bankTransfer.paymentDays: the fallback for orders without a stored day count. */
  paymentDays: number;
  now: Date;
};

/** The day count of each row (SQL): breakdown.bankTransferDays when stored as a number (clamped to 1–14), else the fallback. */
function rowPaymentDays(fallbackDays: number): SQL<number> {
  const { min, max } = BANK_TRANSFER_PAYMENT_DAYS;
  return sql<number>`(case when jsonb_typeof(${o.breakdown}->'bankTransferDays') = 'number'
    then least(${max}::int, greatest(${min}::int, round((${o.breakdown}->>'bankTransferDays')::numeric)::int))
    else ${normalizePaymentDays(fallbackDays)}::int end)`;
}

/**
 * True when the row's deadline has passed at `now`: created before 00:00 Istanbul of today minus its own day count
 * (the per-row form of bankTransferOverdueCutoff: created_at < cutoff ⇔ now > bankTransferDeadline(created_at, days)).
 * Hours, not days, so a session time zone with daylight saving cannot shift it.
 */
function pastDeadline(input: OverdueInput): SQL<boolean> {
  return sql<boolean>`${o.createdAt} < ${istanbulDayStart(input.now).toISOString()}::timestamptz - ${rowPaymentDays(input.paymentDays)} * interval '24 hours'`;
}

/** Havale orders still waiting for their money whose own deadline has passed at `now`. */
export function overdueBankTransferWhere(input: OverdueInput): SQL {
  return and(eq(o.paymentMethod, "bank_transfer"), eq(o.status, "awaiting_transfer"), isNull(o.paidAt), pastDeadline(input)) as SQL;
}

/** The same condition as a boolean column (the list's "Ödeme süresi doldu" badge). */
export function overdueBankTransferFlag(input: OverdueInput): SQL<boolean> {
  return sql<boolean>`(${o.paymentMethod} = 'bank_transfer' and ${o.status} = 'awaiting_transfer' and ${o.paidAt} is null and ${pastDeadline(input)})`;
}

/** How many havale orders are past their deadline at `now`. */
export async function countOverdueBankTransfers(executor: Tx, input: OverdueInput): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(o)
    .where(overdueBankTransferWhere(input));
  return row?.n ?? 0;
}

export type OverdueBankTransfer = { id: number; orderNumber: string; createdAt: Date; deadline: Date; grandTotal: number };

/** The overdue havale orders, oldest first, each with its own deadline (at most `limit`). */
export async function listOverdueBankTransfers(executor: Tx, input: OverdueInput & { limit?: number }): Promise<OverdueBankTransfer[]> {
  const rows = await executor
    .select({ id: o.id, orderNumber: o.orderNumber, createdAt: o.createdAt, grandTotal: o.grandTotal, breakdown: o.breakdown })
    .from(o)
    .where(overdueBankTransferWhere(input))
    .orderBy(asc(o.createdAt), asc(o.id))
    .limit(Math.min(500, Math.max(1, input.limit ?? 100)));
  return rows.map(({ breakdown, ...r }) => ({ ...r, deadline: bankTransferDeadline(r.createdAt, orderPaymentDays(breakdown, input.paymentDays)) }));
}
