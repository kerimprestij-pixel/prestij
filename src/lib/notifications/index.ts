// Notifications. Order events become e-mails (NOTIFY, day 4: ./order-emails.ts holds the rules and
// the queueing); the contact form's admin notification belongs to REQUESTS (notifyContactMessage).
// Never log PII here (no e-mail, name, phone or address): ids and event types only.
import "server-only";
import { db } from "@/db";
import { safeErrorInfo } from "@/lib/db-errors";
import { scheduleEmailFlush } from "@/lib/email";
import type { Tx } from "@/lib/panel/tx";
import { enqueueContactMessage } from "@/lib/requests/emails";
import { enqueueOrderEmails } from "./order-emails";

export { BANK_TRANSFER_DEADLINE_DAYS, emailImageUrl, enqueueOrderEmails, loadOrderEmailData, planOrderEmails } from "./order-emails";
export type { EnqueueOrderEmailsResult, OrderEmailEvent, OrderEmailPlan } from "./order-emails";

export type OrderNotificationType =
  | "placed"
  | "paid"
  | "payment_failed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

/**
 * Queues the e-mails of an order event (see planOrderEmails for the rules), deduped per order and
 * event, in its own transaction. Called right after the status change committed (after() in a
 * request; inline from scripts). Never throws: a failure is logged (ids only) and the order change
 * stands. In a request the mails go out after the response; elsewhere the emails.flush job sends them.
 */
export async function notifyOrderEvent(type: OrderNotificationType, orderId: number): Promise<void> {
  try {
    const result = await db.transaction((tx) => enqueueOrderEmails(tx, type, orderId));
    if (result.queued > 0) {
      console.info(`[notify] order=${orderId} event=${type} queued=${result.queued}`);
      // This usually runs inside an after() callback (scheduleNotification). A nested after() starts at
      // once, so the flush enqueueEmail scheduled could run before the transaction above committed and
      // find nothing; schedule another one now that the rows are visible (no-op outside a request).
      scheduleEmailFlush();
    }
  } catch (error) {
    console.error(`[notify] order=${orderId} event=${type} failed`, safeErrorInfo(error));
  }
}

/** Every notification event type (each one queues e-mails: order events via order-emails.ts, contact_message via REQUESTS). */
export type NotificationEventType = `order_${OrderNotificationType}` | "contact_message";

/**
 * Event `contact_message` (REQUESTS, day 4): a visitor sent the contact form. Queues the admin
 * notification (template contact_message, one row per admin recipient, deduped per message and
 * recipient) inside the caller's transaction, the one that stores the message
 * (src/lib/contact/service.ts). Logs the message id and the count only; never the sender's data.
 */
export async function notifyContactMessage(tx: Tx, message: ContactMessageNotice): Promise<number> {
  const event: NotificationEventType = "contact_message";
  const queued = await enqueueContactMessage(tx, message);
  console.info(`[notify] event=${event} message=${message.id} queued=${queued}`);
  return queued;
}

export type ContactMessageNotice = Parameters<typeof enqueueContactMessage>[1];
