// Order e-mails: which mails an order event sends (the contract's rules, a pure function) and the
// queueing itself (reads the stored order, builds the template data, enqueues deduped rows). No Next
// request APIs: notifyOrderEvent (./index.ts) runs it right after the status change commits, DB tests
// and scripts call it directly. Never logs personal data.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { schema } from "@/db";
import type { OrderItemSnapshot, OrderStatus, PaymentMethod } from "@/db/schema/commerce";
import { isLocale, type Locale } from "@/i18n/config";
import { absoluteUrl } from "@/i18n/paths";
import { maskId, sameAddress } from "@/components/order/format";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { firstNameOf } from "@/lib/customer/viewer";
import { adminRecipients, enqueueEmail } from "@/lib/email";
import type { OrderEmailData, OrderEmailLine } from "@/lib/email/templates/orders";
import type { MediaLike } from "@/lib/media/types";
import { BANK_TRANSFER_PAYMENT_DAYS, bankTransferDeadline, orderPaymentDays } from "@/lib/orders/bank-transfer-deadline";
import { hasTestPayment } from "@/lib/payments/attempts";
import { variantUrl } from "@/lib/media/types";
import { orderPageHref } from "@/lib/orders/token";
import type { Tx } from "@/lib/panel/tx";

/** Events the order code reports (src/lib/orders/effects.ts → notifyOrderEvent). */
export type OrderEmailEvent = "placed" | "paid" | "payment_failed" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded";

export type CustomerOrderTemplate =
  | "order_received"
  | "order_awaiting_transfer"
  | "order_paid"
  | "order_payment_failed"
  | "order_shipped"
  | "order_delivered"
  | "order_cancelled"
  | "order_refunded";

export type OrderEmailPlan = {
  /** The customer mail, or null. `event` is the dedupe-key part (`order:<id>:<event>:customer`). */
  customer: { template: CustomerOrderTemplate; event: string } | null;
  /** True: admin_new_order to every admin recipient (deduped per recipient, so once per order). */
  admin: boolean;
};

/**
 * The DEFAULT number of days a havale order is asked to be paid in. The mail uses the day count stored with the
 * order at placement (breakdown.bankTransferDays, FIX F4; the shop's current settings.payments.bankTransfer.paymentDays
 * for older orders), through bankTransferDeadline(); nothing enforces it automatically (the panel marks overdue
 * orders, the owner cancels them).
 */
export const BANK_TRANSFER_DEADLINE_DAYS = BANK_TRANSFER_PAYMENT_DAYS.default;

/**
 * The contract's rules (pure). `order` is the order as it is when the mail is queued (right after the
 * change): a mail whose moment has passed (the havale instructions of an order paid meanwhile, the
 * "complete your payment" mail of an order that is no longer waiting) is skipped.
 *
 * - card: nothing on `placed` (never "order received" for an unpaid card attempt); the customer and
 *   admin mails on `paid`; `payment_failed` once per order while still pending.
 * - havale: instructions on `placed` (+ admin), `order_paid` when the transfer is confirmed.
 * - kapıda ödeme / vadeli: `order_received` on `placed` (+ admin).
 * - shipped, delivered, refunded: always. cancelled: unless an unpaid card attempt (the customer never
 *   got an order confirmation for it).
 * - processing: no mail.
 * - admin_new_order only while the order still waits for the shop (havale: awaiting_transfer, kapıda
 *   ödeme / vadeli: processing, card: paid), so a late replay never alerts newly added recipients.
 */
export function planOrderEmails(event: OrderEmailEvent, order: { paymentMethod: PaymentMethod; status: OrderStatus; paid: boolean }): OrderEmailPlan {
  const none: OrderEmailPlan = { customer: null, admin: false };
  switch (event) {
    case "placed":
      if (order.paymentMethod === "card") return none;
      if (order.paymentMethod === "bank_transfer") {
        const waiting = order.status === "awaiting_transfer";
        return { customer: waiting ? { template: "order_awaiting_transfer", event: "placed" } : null, admin: waiting };
      }
      return { customer: { template: "order_received", event: "placed" }, admin: order.status === "processing" };
    case "paid":
      return { customer: { template: "order_paid", event: "paid" }, admin: order.paymentMethod === "card" && order.status === "paid" };
    case "payment_failed":
      return order.paymentMethod === "card" && order.status === "pending_payment"
        ? { customer: { template: "order_payment_failed", event: "payment_failed" }, admin: false }
        : none;
    case "shipped":
      return { customer: { template: "order_shipped", event: "shipped" }, admin: false };
    case "delivered":
      return { customer: { template: "order_delivered", event: "delivered" }, admin: false };
    case "cancelled":
      if (order.paymentMethod === "card" && !order.paid) return none;
      return { customer: { template: "order_cancelled", event: "cancelled" }, admin: false };
    case "refunded":
      return { customer: { template: "order_refunded", event: "refunded" }, admin: false };
    default:
      return none;
  }
}

/** A small JPEG/PNG/WebP variant (≥ 128 px for the 64 px box on retina), never AVIF; null when none. */
export function emailImageUrl(media: MediaLike | null | undefined): string | null {
  if (!media) return null;
  const variants = (media.variants ?? []).filter((v) => v.format === "webp" || v.format === "jpeg" || v.format === "png");
  if (variants.length > 0) {
    const sorted = [...variants].sort((a, b) => a.width - b.width);
    const pick = sorted.find((v) => v.width >= 128) ?? sorted[sorted.length - 1];
    const url = variantUrl(media, pick.key);
    return /^https?:\/\//i.test(url) ? url : absoluteUrl(url);
  }
  if (/\.(webp|jpe?g|png)(\?|$)/i.test(media.url)) return /^https?:\/\//i.test(media.url) ? media.url : absoluteUrl(media.url);
  return null;
}

type OrderRow = typeof schema.orders.$inferSelect;

export type LoadedOrderEmail = {
  order: OrderRow;
  locale: Locale;
  data: OrderEmailData;
};

/**
 * The template data for an order, read through `tx`. Totals, lines and addresses come from the stored
 * order (exactly what the order page shows); bank accounts, carriers and the delivery estimate from
 * the current settings.
 */
export async function loadOrderEmailData(tx: Tx, orderId: number): Promise<LoadedOrderEmail | null> {
  const o = schema.orders;
  const [order] = await tx.select().from(o).where(eq(o.id, orderId)).limit(1);
  if (!order) return null;
  const [items, settings] = await Promise.all([
    tx
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId))
      .orderBy(asc(schema.orderItems.isSample), asc(schema.orderItems.id)),
    loadCommerceSettings(tx),
  ]);
  const locale: Locale = isLocale(order.locale) ? order.locale : "tr";

  let deferredDays: number | null = null;
  let companyName: string | null = null;
  if (order.companyId != null) {
    const [company] = await tx
      .select({ name: schema.companies.name, terms: schema.companies.paymentTerms })
      .from(schema.companies)
      .where(eq(schema.companies.id, order.companyId))
      .limit(1);
    companyName = company?.name ?? null;
    const days = company?.terms?.days;
    if (order.paymentMethod === "deferred" && typeof days === "number" && days > 0) deferredDays = days;
  }

  const lines: OrderEmailLine[] = items.map((row) => {
    const s = row.snapshot as OrderItemSnapshot;
    const variant = s.variantTitle ?? null;
    const detail = {
      tr: [s.productSubtitle?.tr, variant?.tr].filter(Boolean).join(" · "),
      ...(s.productSubtitle?.en || variant?.en ? { en: [s.productSubtitle?.en ?? s.productSubtitle?.tr, variant?.en ?? variant?.tr].filter(Boolean).join(" · ") } : {}),
      ...(s.productSubtitle?.ar || variant?.ar ? { ar: [s.productSubtitle?.ar ?? s.productSubtitle?.tr, variant?.ar ?? variant?.tr].filter(Boolean).join(" · ") } : {}),
    };
    return {
      name: s.productName,
      detail: detail.tr || detail.en || detail.ar ? detail : null,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      lineSubtotal: row.unitPrice * row.quantity,
      isSample: row.isSample,
      imageUrl: emailImageUrl(s.image ?? null),
      accent: s.accentColor ?? null,
    };
  });

  // Go-live CF-11: a card order paid in test mode (or by the simulator) is flagged in the admin mail.
  const testPayment =
    order.paymentMethod === "card" &&
    hasTestPayment(
      await tx
        .select({ provider: schema.payments.provider, status: schema.payments.status, raw: schema.payments.raw })
        .from(schema.payments)
        .where(eq(schema.payments.orderId, orderId)),
    );

  const b = order.breakdown ?? null;
  const carrierCfg = order.carrier ? settings.shipping.carriers.find((c) => c.key === order.carrier) : undefined;
  // End of the last payment day in Türkiye time, from the order's own day count (the same date the order page, the
  // contract and the panel use).
  const deadline = bankTransferDeadline(order.createdAt, orderPaymentDays(order.breakdown, settings.payments.bankTransfer.paymentDays));
  const inv = order.invoice;
  const corporate = inv.type === "corporate";
  const fullName = order.shippingAddress?.fullName?.trim() || order.email;

  const data: OrderEmailData = {
    name: firstNameOf(order.shippingAddress?.fullName) ?? "",
    fullName,
    orderNumber: order.orderNumber,
    orderUrl: absoluteUrl(orderPageHref(locale, order.orderNumber, order.accessToken)),
    placedAt: order.createdAt.toISOString(),
    paymentMethod: order.paymentMethod,
    email: order.email,
    phone: order.phone,
    lines,
    totals: {
      subtotal: order.subtotal,
      couponCode: order.couponCode,
      couponDiscount: b?.couponDiscount ?? (order.couponCode ? order.discountTotal : 0),
      bankTransferDiscount: b?.bankTransferDiscount ?? 0,
      bankTransferPercent: b?.bankTransferPercent ?? 0,
      shippingFlat: b?.shippingFlat ?? order.shippingTotal,
      shippingHeavy: b?.shippingHeavy ?? 0,
      heavyKg: b?.heavyKg ?? 0,
      freeShipping: b?.freeShipping ?? order.shippingTotal === 0,
      freeShippingReason: b?.freeShippingReason ?? null,
      paymentFee: order.paymentFee,
      vatTotal: order.vatTotal,
      grandTotal: order.grandTotal,
    },
    shippingAddress: order.shippingAddress,
    invoice: {
      type: corporate ? "corporate" : "individual",
      name: (corporate ? inv.companyName : inv.fullName)?.trim() || fullName,
      taxOffice: corporate ? (inv.taxOffice?.trim() || null) : null,
      maskedId: maskId(corporate ? inv.taxNumber : inv.nationalId),
      eInvoice: corporate && Boolean(inv.eInvoice),
      address: inv.address && !sameAddress(inv.address, order.shippingAddress) ? inv.address : null,
    },
    deferredDays,
    bankTransfer:
      order.paymentMethod === "bank_transfer"
        ? {
            accounts: settings.payments.bankTransfer.accounts,
            instructions: settings.payments.bankTransfer.instructions?.tr?.trim() ? settings.payments.bankTransfer.instructions : null,
            deadline: deadline.toISOString(),
          }
        : null,
    carrier:
      order.carrier && order.trackingNumber
        ? {
            name: carrierCfg?.name ?? order.carrier,
            trackingNumber: order.trackingNumber,
            trackingUrl: carrierCfg?.trackingUrl ? carrierCfg.trackingUrl.replace("{code}", encodeURIComponent(order.trackingNumber)) : null,
          }
        : null,
    estimatedDays: settings.shipping.estimatedDays ?? null,
    paid: order.paidAt != null,
    admin: {
      panelUrl: absoluteUrl(`/panel/siparisler/${order.id}`),
      companyName,
      isMember: order.userId != null,
      customerNote: order.customerNote,
      taxId: (corporate ? inv.taxNumber : inv.nationalId)?.trim() || null,
      ...(testPayment ? { testPayment: true } : {}),
    },
  };
  return { order, locale, data };
}

export type EnqueueOrderEmailsResult = {
  /** Rows inserted (queued, or failed for an invalid address). */
  queued: number;
  /** Mails the plan asked for that were not inserted (template off, or already sent: dedupe). */
  skipped: number;
};

/**
 * Queues the mails `event` calls for (see planOrderEmails) inside `tx`, deduped per order and event
 * (`order:<id>:<event>:customer`, `order:<id>:new:admin:<recipient>`): replays and repeated actions
 * never send twice. Customer mails go out in the order's language, admin mails in Turkish.
 */
export async function enqueueOrderEmails(tx: Tx, event: OrderEmailEvent, orderId: number): Promise<EnqueueOrderEmailsResult> {
  const result: EnqueueOrderEmailsResult = { queued: 0, skipped: 0 };
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return result;
  const loaded = await loadOrderEmailData(tx, orderId);
  if (!loaded) return result;
  const { order, locale, data } = loaded;
  const plan = planOrderEmails(event, { paymentMethod: order.paymentMethod, status: order.status, paid: order.paidAt != null });
  const related = { type: "order" as const, id: order.id };

  if (plan.customer) {
    const { admin: _admin, ...customerData } = data;
    void _admin;
    const row = await enqueueEmail(tx, {
      template: plan.customer.template,
      to: order.email,
      locale,
      data: customerData,
      related,
      dedupeKey: `order:${order.id}:${plan.customer.event}:customer`,
    });
    if (row) result.queued++;
    else result.skipped++;
  }

  if (plan.admin) {
    for (const to of await adminRecipients(tx)) {
      const row = await enqueueEmail(tx, {
        template: "admin_new_order",
        to,
        locale: "tr",
        data,
        related,
        dedupeKey: `order:${order.id}:new:admin:${to.toLowerCase()}`,
      });
      if (row) result.queued++;
      else result.skipped++;
    }
  }
  return result;
}
