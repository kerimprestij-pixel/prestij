// Havale/EFT payment deadline (sales-ready SR-2). Pure: no DB, no clock (`now` is passed in), no Next APIs.
//
// The shop asks for a havale order to be paid within settings.payments.bankTransfer.paymentDays calendar
// days (1–14, default 3). The day count is stored with each order at placement (orders.breakdown.bankTransferDays,
// FIX F4: orderPaymentDays), so changing the setting later moves no deadline of an order already placed. The deadline is the END of the last day in Türkiye time: an order placed on
// 10 November with 3 days may be paid until 13 November 23:59:59 (Istanbul). Every place that shows the
// deadline (the "Havale/EFT bilgileriniz" e-mail, the order page, the order block of the pre-information
// form and the distance sales agreement, the checkout hint, the panel) uses this file, so the date the
// customer reads is the date the panel calls "Ödeme süresi doldu".
//
// Nothing cancels an order by itself: the panel marks overdue orders and the owner cancels them manually
// (cancel restocks). Türkiye has used a fixed UTC+3 offset since 2016, so the day math shifts by three
// hours instead of loading time-zone data (same rule as src/lib/subscriptions/schedule.ts).
import type { OrderStatus, PaymentMethod } from "@/db/schema/commerce";

/** Range and default of settings.payments.bankTransfer.paymentDays (the settings schema and the panel use them). */
export const BANK_TRANSFER_PAYMENT_DAYS = { min: 1, max: 14, default: 3 } as const;

const DAY_MS = 86_400_000;
/** Europe/Istanbul is UTC+3 all year. */
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

/** A stored or typed day count as a whole number inside 1–14 (anything unusable → the default 3). */
export function normalizePaymentDays(days: unknown): number {
  const n = typeof days === "number" && Number.isFinite(days) ? Math.round(days) : Number.NaN;
  if (!Number.isFinite(n)) return BANK_TRANSFER_PAYMENT_DAYS.default;
  return Math.min(BANK_TRANSFER_PAYMENT_DAYS.max, Math.max(BANK_TRANSFER_PAYMENT_DAYS.min, n));
}

/** 00:00 Europe/Istanbul of the calendar day that contains `date`. */
function startOfIstanbulDay(date: Date): number {
  const local = date.getTime() + ISTANBUL_OFFSET_MS;
  return Math.floor(local / DAY_MS) * DAY_MS - ISTANBUL_OFFSET_MS;
}

/** 00:00 Europe/Istanbul of the calendar day that contains `date` (the per-order overdue SQL counts back from it). */
export function istanbulDayStart(date: Date): Date {
  return new Date(startOfIstanbulDay(date));
}

/**
 * The day count of one havale order: the value stored at placement (orders.breakdown.bankTransferDays), or
 * `fallback` (the current setting) for orders placed before the field existed. Always a whole number in 1–14.
 */
export function orderPaymentDays(breakdown: { bankTransferDays?: unknown } | null | undefined, fallback: number): number {
  const stored = breakdown?.bankTransferDays;
  return normalizePaymentDays(typeof stored === "number" && Number.isFinite(stored) ? stored : fallback);
}

/**
 * The last instant a havale order placed at `placedAt` may be paid: 23:59:59.999 Istanbul time of the day
 * `days` calendar days after the order's Istanbul day.
 */
export function bankTransferDeadline(placedAt: Date, days: number): Date {
  return new Date(startOfIstanbulDay(placedAt) + (normalizePaymentDays(days) + 1) * DAY_MS - 1);
}

/**
 * Orders created before this instant are past their deadline at `now` (created_at < cutoff ⇔ now >
 * bankTransferDeadline(created_at, days)). One index-friendly comparison for the panel queries.
 */
export function bankTransferOverdueCutoff(now: Date, days: number): Date {
  return new Date(startOfIstanbulDay(now) - normalizePaymentDays(days) * DAY_MS);
}

export type BankTransferOrderState = {
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  createdAt: Date | string;
  paidAt?: Date | string | null;
};

/** True for a havale order that still waits for its money and whose deadline has passed at `now`. */
export function isBankTransferOverdue(order: BankTransferOrderState, days: number, now: Date): boolean {
  if (order.paymentMethod !== "bank_transfer" || order.status !== "awaiting_transfer" || order.paidAt) return false;
  const created = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return now.getTime() > bankTransferDeadline(created, days).getTime();
}
