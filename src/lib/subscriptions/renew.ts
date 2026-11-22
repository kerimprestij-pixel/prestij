// Renewals and reminders (the daily jobs subscriptions.renew and subscriptions.remind). No Next
// request APIs: DB tests and the cron route call these directly.
//
// Renewal of one subscription = ONE transaction that locks the subscription row (FOR UPDATE SKIP
// LOCKED: a concurrent run skips it), re-checks that it is active and due, prices the items with the
// money engine (current prices, the plan discount or a better campaign, no coupon), decrements stock
// with the same guarded UPDATEs as placeOrder (variants in ascending id order), numbers and stores
// the order (orders.subscription_id), and moves next_run_at one period on. Because next_run_at moves
// in the same transaction, a second run (now or later) finds nothing due: one order per period.
import "server-only";
import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OrderBreakdown, OrderItemSnapshot, OrderStatus, PaymentMethod } from "@/db/schema/commerce";
import type { LocalizedText } from "@/db/schema/common";
import { locales } from "@/i18n/config";
import { defaultMessages } from "@/i18n/messages";
import { localize } from "@/i18n/localize";
import { absoluteUrl } from "@/i18n/paths";
import { computeCart } from "@/lib/cart/compute";
import { loadCampaigns, loadVariantLines, type LoadedCart, type LoadedLine } from "@/lib/cart/load";
import { loadCommerceSettings, type CommerceSettings } from "@/lib/cart/settings";
import type { CartTotals } from "@/lib/cart/types";
import { firstNameOf } from "@/lib/customer/viewer";
import { safeErrorInfo } from "@/lib/db-errors";
import { enqueueEmail } from "@/lib/email";
import { normalizePaymentDays } from "@/lib/orders/bank-transfer-deadline";
import { loadCheckoutLegalDocs } from "@/lib/orders/legal-docs";
import { checkoutLegalReady } from "@/lib/orders/legal-ready";
import { LEGAL_KEYS, legalOrderData, renderDistanceSales, renderPreInformation } from "@/lib/orders/legal-render";
import { formatOrderNumber } from "@/lib/orders/number";
import { revalidateProducts, scheduleNotification } from "@/lib/orders/effects";
import { orderPageHref } from "@/lib/orders/token";
import { recordPaymentInitiated } from "@/lib/payments/complete";
import { cardTestModeHidden, getCardGateway, getCardGatewayFor } from "@/lib/payments/gateway";
import { customerContextForUser } from "./context";
import { anchorDayOf, nextRunAfter, istanbulDay, reminderAt } from "./schedule";
import { emailItems, localeOf, subscriptionManageUrl, subscriptionSkipToken } from "./service";
import type { SubscriptionLineSnapshot } from "./types";

const subs = schema.subscriptions;
const plans = schema.subscriptionPlans;

export type RenewFailureReason = "out_of_stock" | "unavailable" | "method_unavailable" | "quantity_changed";

/**
 * Go-live (CF-4 for renewals): the shop cannot take this renewal because the pre-information form or the
 * distance sales agreement is missing or still a "taslak…" version (checkoutLegalReady). A shop-side problem:
 * nothing is written, next_run_at does not move (the daily job retries), and the customer gets no
 * "renewal failed" mail; the job run counts it as `held` and the server log says why.
 *
 * Go-live CF-11 for renewals (SR-4), "card_test_mode": a card renewal while the panel's card test mode is on
 * on a live site (cardTestModeHidden). A test-mode payment moves no money, and only signed-in staff may use it
 * (CustomerContext.staff); a renewal has no viewer at all, so it is held the same way: nothing written,
 * next_run_at unchanged, a server log line. Only when the test mode is the SOLE blocker (FIX F7): card switched
 * on in the panel and its provider configured; otherwise the renewal fails with method_unavailable as before
 * (the customer is told, failed_count counts). Locally (localPaymentMockAllowed) nothing changes.
 */
export type RenewHoldReason = "legal_unavailable" | "card_test_mode";

export type RenewOutcome =
  | { status: "renewed"; subscriptionId: number; orderId: number; orderNumber: string; orderStatus: OrderStatus; grandTotal: number }
  | { status: "skipped"; subscriptionId: number }
  | { status: "failed"; subscriptionId: number; reason: RenewFailureReason }
  | { status: "held"; subscriptionId: number; reason: RenewHoldReason }
  | { status: "not_due" | "locked" | "not_found"; subscriptionId: number };

const INITIAL_STATUS: Record<PaymentMethod, OrderStatus> = {
  card: "pending_payment",
  bank_transfer: "awaiting_transfer",
  cash_on_delivery: "processing",
  deferred: "processing",
};

class Abort extends Error {
  constructor(readonly reason: RenewFailureReason) {
    super(reason);
  }
}

function joinLabels(labels: LocalizedText[]): LocalizedText {
  const out: Record<string, string> = {};
  for (const l of locales) out[l] = labels.map((x) => localize(x, l)).filter(Boolean).join(" · ");
  return out as LocalizedText;
}

/** Why the engine refuses to place this renewal, or null when it can be ordered as priced. */
function failureOf(totals: CartTotals, method: PaymentMethod, expectedLines: number): RenewFailureReason | null {
  const paid = totals.lines.filter((l) => l.included && !l.isSample);
  if (paid.length === 0 || totals.lines.length < expectedLines) return "unavailable";
  // Never ship less than the customer subscribed to: a stock clamp is a failure, not a smaller parcel.
  if (totals.lines.some((l) => l.issues.some((i) => i.code === "out_of_stock" || (i.code === "quantity_adjusted" && i.reason === "stock")))) return "out_of_stock";
  // Nor a different quantity (min / max / step rules changed since): never charge for units the customer did not subscribe to.
  if (totals.lines.some((l) => l.issues.some((i) => i.code === "quantity_adjusted"))) return "quantity_changed";
  if (totals.issues.some((i) => i.blocking)) return "unavailable";
  const option = totals.paymentMethods.find((m) => m.method === method);
  if (!option?.available) return "method_unavailable";
  return null;
}

export type RenewOptions = {
  now?: Date;
  /** Revalidate product pages and schedule the order notification after commit (default true). */
  effects?: boolean;
  settings?: CommerceSettings;
  /**
   * Tests and scripts only (the cron job never passes it): renew even while a contract text is a draft, as
   * placeOrder's allowDraftContracts does. Without it a draft or missing contract holds the renewal.
   */
  allowDraftContracts?: boolean;
};

/**
 * Renews one subscription if it is active and due. Safe to call twice at the same time (row lock with
 * SKIP LOCKED, re-check of next_run_at) and repeatedly (one order per period).
 */
export async function renewSubscription(subscriptionId: number, options: RenewOptions = {}): Promise<RenewOutcome> {
  const now = options.now ?? new Date();
  const [settings, docs] = await Promise.all([options.settings ?? loadCommerceSettings(), loadCheckoutLegalDocs()]);
  // Go-live CF-11: a renewal has no staff viewer (null customer). On a live site with the card test mode on,
  // card renewals are held below; getCardGatewayFor then has no gateway, and it returns the payment
  // simulator only where localPaymentMockAllowed() (CF-1).
  // Held only when the test mode alone stops the card (FIX F7): getCardGateway ignores card.enabled, so it is checked first.
  const cardTestModeHeld =
    settings.payments.card.enabled && cardTestModeHidden(settings.payments, null) && (await getCardGateway(settings.payments)) !== null;
  const gateway = await getCardGatewayFor(settings.payments, null);

  type Done = RenewOutcome & { slugs?: string[] };
  let outcome: Done;
  try {
    outcome = await db.transaction(async (tx): Promise<Done> => {
      const [sub] = await tx.select().from(subs).where(eq(subs.id, subscriptionId)).for("update", { skipLocked: true }).limit(1);
      if (!sub) {
        const [exists] = await tx.select({ id: subs.id }).from(subs).where(eq(subs.id, subscriptionId)).limit(1);
        return { status: exists ? "locked" : "not_found", subscriptionId };
      }
      if (sub.status !== "active" || sub.nextRunAt.getTime() > now.getTime()) return { status: "not_due", subscriptionId };
      const [plan] = await tx.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
      if (!plan) return { status: "not_found", subscriptionId };

      // "Skip next delivery": this period passes without an order.
      if (sub.skipNext) {
        await tx
          .update(subs)
          .set({ skipNext: false, nextRunAt: nextRunAfter(sub.nextRunAt, plan, now, anchorDayOf(sub.createdAt)), reminderSentAt: null, updatedAt: now })
          .where(eq(subs.id, sub.id));
        return { status: "skipped", subscriptionId };
      }

      const fail = async (reason: RenewFailureReason): Promise<Done> => {
        await recordFailure(tx, sub, plan.name, reason, now);
        return { status: "failed", subscriptionId, reason };
      };

      // Go-live CF-4: never store a draft contract with an order (placeOrder refuses the same way). Held, not
      // failed: nothing is written and next_run_at stays, so the next daily run retries once the texts are approved.
      if (!options.allowDraftContracts && !checkoutLegalReady(docs)) {
        console.error(`[subscriptions] renewal held subscription=${subscriptionId}: the pre-information form or distance sales agreement is missing or a draft (taslak) version`);
        return { status: "held", subscriptionId, reason: "legal_unavailable" };
      }

      // Go-live CF-11 (SR-4): never charge a renewal through the card gateway's test mode on a live site. Held,
      // not failed: a shop-side setting, so no "renewal failed" mail and next_run_at stays (the daily job
      // retries once the panel's test mode is off).
      if (sub.paymentMethod === "card" && cardTestModeHeld) {
        console.error(`[subscriptions] renewal held subscription=${subscriptionId}: card payments are in test mode on a live site (card_test_mode)`);
        return { status: "held", subscriptionId, reason: "card_test_mode" };
      }

      const owner = await customerContextForUser(tx, sub.userId, settings);
      if (!owner) return fail("unavailable");
      const customer = owner.customer;
      const method = sub.paymentMethod;
      // The plan discount applies to every renewal of the subscription (even if the plan was switched
      // off for new subscribers or the product stopped offering subscriptions).
      const enginePlan = { id: plan.id, name: plan.name, percent: plan.discountPercent, interval: plan.interval, intervalCount: plan.intervalCount };
      const loadedLines: LoadedLine[] = (
        await loadVariantLines(
          tx,
          sub.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, subscriptionPlanId: plan.id })),
          customer,
        )
      ).map((l) => ({ ...l, subscriptionPlan: enginePlan }));
      const campaigns = await loadCampaigns(tx);
      const totals = computeCart({
        lines: loadedLines,
        customer,
        coupon: null,
        campaigns,
        settings: {
          shipping: settings.shipping,
          payments: settings.payments,
          samples: settings.samples,
          subscriptions: { enabled: true, allowedMethods: method === "deferred" ? [] : [method] },
        },
        paymentMethod: method,
        cardGatewayReady: gateway !== null,
        now,
      });
      const reason = failureOf(totals, method, sub.items.length);
      if (reason) return fail(reason);

      // Stock: guarded decrements in ascending variant order (the same lock order as placeOrder).
      const included = totals.lines.filter((l) => l.included);
      const v = schema.productVariants;
      const p = schema.products;
      const tracked = new Map<number, boolean>();
      for (const line of [...included].sort((a, b) => a.variantId - b.variantId)) {
        const rows = await tx
          .update(v)
          .set({ stock: sql`case when ${v.trackStock} then ${v.stock} - ${line.quantity} else ${v.stock} end` })
          .where(
            and(
              eq(v.id, line.variantId),
              eq(v.isActive, true),
              sql`(not ${v.trackStock} or ${v.allowBackorder} or ${v.stock} >= ${line.quantity})`,
              sql`exists (select 1 from ${p} where ${p.id} = ${v.productId} and ${p.status} = 'active')`,
            ),
          )
          .returning({ id: v.id, trackStock: v.trackStock });
        if (rows.length === 0) throw new Abort("out_of_stock"); // stock taken meanwhile: roll back, record below
        tracked.set(line.variantId, rows[0].trackStock);
      }

      const option = totals.paymentMethods.find((m) => m.method === method)!;
      const t = option.totals;
      const locale = localeOf(sub.locale);
      const seq = await tx.execute<{ n: string }>(sql`select nextval('order_number_seq')::text as n`);
      const orderNumber = formatOrderNumber(Number(seq[0].n), now);
      const status = INITIAL_STATUS[method];
      // FIX F4: the havale day count is fixed with the order (its contract below is written with the same value).
      const bankTransferDays = normalizePaymentDays(settings.payments.bankTransfer.paymentDays);
      const breakdown: OrderBreakdown = {
        couponDiscount: 0,
        couponType: null,
        bankTransferDiscount: t.discounts.bankTransfer,
        bankTransferPercent: option.discountPercent,
        shippingFlat: t.shipping.flat,
        shippingHeavy: t.shipping.heavy,
        heavyKg: t.shipping.heavyKg,
        freeShipping: t.shipping.free,
        freeShippingReason: t.shipping.freeReason,
        totalWeightGrams: totals.totalWeightGrams,
        itemCount: totals.itemCount,
        ...(method === "bank_transfer" ? { bankTransferDays } : {}),
      };
      const o = schema.orders;
      const [order] = await tx
        .insert(o)
        .values({
          orderNumber,
          userId: sub.userId,
          companyId: customer.companyId,
          customerGroupId: customer.groupId,
          email: sub.email,
          phone: sub.shippingAddress.phone || null,
          locale,
          status,
          paymentMethod: method,
          paymentProvider: method === "card" ? (gateway?.provider ?? null) : method === "bank_transfer" ? "manual" : null,
          subtotal: t.subtotal,
          discountTotal: t.discountTotal,
          shippingTotal: t.shipping.total,
          paymentFee: t.paymentFee,
          vatTotal: t.vatTotal,
          grandTotal: t.grandTotal,
          breakdown,
          shippingAddress: sub.shippingAddress,
          invoice: sub.invoice,
          consents: [],
          subscriptionId: sub.id,
        })
        .returning({ id: o.id, accessToken: o.accessToken, grandTotal: o.grandTotal });

      // computeCart ran with paymentMethod = method: the lines carry this method's discounts (havale).
      const priced = new Map(totals.lines.map((l) => [l.lineId, l]));
      const byLine = new Map(loadedLines.map((l) => [l.lineId, l]));
      await tx.insert(schema.orderItems).values(
        included.map((line) => {
          const l = priced.get(line.lineId) ?? line;
          const d = byLine.get(line.lineId)!.display;
          const subscription: SubscriptionLineSnapshot = { planId: plan.id, percent: plan.discountPercent, discount: l.subscription?.discount ?? "none" };
          const snapshot: OrderItemSnapshot & { subscription: SubscriptionLineSnapshot } = {
            productId: line.productId,
            productName: d.name,
            variantTitle: joinLabels(d.variantLabels),
            sku: d.sku,
            barcode: d.barcode,
            imageUrl: d.image?.url ?? null,
            accentColor: d.accentColor,
            productSlug: d.productSlug,
            productSubtitle: d.subtitle,
            variantLabels: d.variantLabels,
            image: d.image,
            categoryId: byLine.get(line.lineId)!.categoryId,
            compareAt: l.compareAt,
            weightGrams: byLine.get(line.lineId)!.weightGrams,
            stockTracked: tracked.get(line.variantId) ?? false,
            couponDiscount: 0,
            bankTransferDiscount: l.bankTransferDiscount,
            subscription,
          };
          return {
            orderId: order.id,
            variantId: line.variantId,
            snapshot,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            discount: l.discount,
            lineTotal: l.lineTotal,
            vatRate: l.vatRate,
            isSample: false,
          };
        }),
      );

      const eventRows: (typeof schema.orderEvents.$inferInsert)[] = [
        {
          orderId: order.id,
          type: "placed",
          data: { status, paymentMethod: method, grandTotal: t.grandTotal, itemCount: totals.itemCount, couponCode: null, subscriptionId: sub.id, renewal: true },
        },
      ];
      // The contract texts of this order, rendered like placeOrder does (the buyer accepted the
      // subscription terms with the first order; renewals keep a copy of what applies to each order).
      if (docs.preInformation && docs.distanceSales) {
        const loadedCart: LoadedCart = { cart: null, customer, lines: loadedLines, coupon: null, campaigns, sampleOffers: [] };
        const legal = legalOrderData(totals, loadedCart, locale, method);
        const sameAsShipping = JSON.stringify(sub.invoice.address ?? null) === JSON.stringify(sub.shippingAddress);
        const legalInput = {
          locale,
          messages: defaultMessages[locale],
          seller: settings.general,
          estimatedDays: settings.shipping.estimatedDays,
          buyer: { email: sub.email, phone: sub.shippingAddress.phone, shippingAddress: sub.shippingAddress, invoice: { ...sub.invoice, sameAsShipping } },
          items: legal.items,
          totals: legal.totals,
          paymentMethod: method,
          orderNumber,
          date: now,
          bankTransferDays,
        };
        eventRows.push({
          orderId: order.id,
          type: "legal_snapshot",
          data: {
            preInformation: { key: LEGAL_KEYS.preInformation, version: docs.preInformation.version, html: renderPreInformation({ ...legalInput, document: docs.preInformation }) },
            distanceSales: { key: LEGAL_KEYS.distanceSales, version: docs.distanceSales.version, html: renderDistanceSales({ ...legalInput, document: docs.distanceSales }) },
          },
        });
      }
      await tx.insert(schema.orderEvents).values(eventRows);
      if (method === "card" && gateway) await recordPaymentInitiated(tx, order.id, gateway.provider, t.grandTotal);

      await tx
        .update(subs)
        .set({ lastOrderId: order.id, nextRunAt: nextRunAfter(sub.nextRunAt, plan, now, anchorDayOf(sub.createdAt)), failedCount: 0, reminderSentAt: null, updatedAt: now })
        .where(eq(subs.id, sub.id));

      if (method === "card") {
        const items = await emailItems(tx, sub.items);
        await enqueueEmail(tx, {
          template: "subscription_payment_due",
          to: sub.email,
          locale,
          data: {
            name: firstNameOf(owner.owner.name) ?? "",
            plan: plan.name,
            manageUrl: subscriptionManageUrl(locale),
            orderNumber,
            deadline: new Date(now.getTime() + settings.subscriptions.cardPaymentWindowHours * 3_600_000).toISOString(),
            total: t.grandTotal,
            payUrl: absoluteUrl(orderPageHref(locale, orderNumber, order.accessToken)),
            items,
          },
          related: { type: "order", id: order.id },
          dedupeKey: `subscription:${sub.id}:payment_due:${order.id}`,
        });
      }

      return {
        status: "renewed",
        subscriptionId,
        orderId: order.id,
        orderNumber,
        orderStatus: status,
        grandTotal: t.grandTotal,
        slugs: included.map((l) => byLine.get(l.lineId)!.display.productSlug),
      };
    });
  } catch (error) {
    if (!(error instanceof Abort)) throw error;
    // Stock went away between pricing and the guarded update: nothing was written; record the failure.
    const reason = error.reason;
    await db.transaction(async (tx) => {
      const [sub] = await tx.select().from(subs).where(eq(subs.id, subscriptionId)).for("update").limit(1);
      if (!sub || sub.status !== "active" || sub.nextRunAt.getTime() > now.getTime()) return;
      const [plan] = await tx.select({ name: plans.name }).from(plans).where(eq(plans.id, sub.planId)).limit(1);
      await recordFailure(tx, sub, plan?.name ?? { tr: "" }, reason, now);
    });
    outcome = { status: "failed", subscriptionId, reason };
  }

  if (outcome.status === "renewed" && options.effects !== false) {
    try {
      revalidateProducts(outcome.slugs ?? []);
    } catch (error) {
      console.error("[subscriptions] revalidate failed", safeErrorInfo(error));
    }
    // NOTIFY decides per method: havale instructions / kapıda ödeme "order received"; never an
    // "order received" for an unpaid card order (the payment_due mail above covers it).
    scheduleNotification("placed", outcome.orderId);
  }
  const { slugs, ...rest } = outcome as Done;
  void slugs;
  return rest as RenewOutcome;
}

async function recordFailure(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sub: typeof subs.$inferSelect,
  planName: LocalizedText,
  reason: RenewFailureReason,
  now: Date,
): Promise<void> {
  await tx
    .update(subs)
    .set({ failedCount: sql`${subs.failedCount} + 1`, updatedAt: now })
    .where(eq(subs.id, sub.id));
  const locale = localeOf(sub.locale);
  const [user] = await tx.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, sub.userId)).limit(1);
  await enqueueEmail(tx, {
    template: "subscription_renewal_failed",
    to: sub.email,
    locale,
    data: { name: firstNameOf(user?.name) ?? "", plan: planName, manageUrl: subscriptionManageUrl(locale), reason },
    related: { type: "subscription", id: sub.id },
    // One mail per period, however many daily retries fail.
    dedupeKey: `subscription:${sub.id}:renewal_failed:${istanbulDay(sub.nextRunAt)}`,
  });
}

// ---------------------------------------------------------------------------------------------
// Jobs

const BATCH = 100;

/**
 * Active subscriptions due at `now`: fresh ones first, then the ones that keep failing (fewest
 * failures first), each oldest first, so failing subscriptions can never starve the batch.
 */
export async function dueSubscriptionIds(now: Date, limit = BATCH): Promise<number[]> {
  const rows = await db
    .select({ id: subs.id })
    .from(subs)
    .where(and(eq(subs.status, "active"), lte(subs.nextRunAt, now)))
    .orderBy(asc(subs.failedCount), asc(subs.nextRunAt), asc(subs.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** subscriptions.renew: every due subscription once (bounded batch; the next run continues). */
export async function renewDueSubscriptions(options: RenewOptions & { limit?: number; only?: number[] } = {}): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const settings = options.settings ?? (await loadCommerceSettings());
  const ids = options.only ?? (await dueSubscriptionIds(now, options.limit ?? BATCH));
  const counts = { renewed: 0, skipped: 0, failed: 0, busy: 0, held: 0 };
  for (const id of ids) {
    try {
      const r = await renewSubscription(id, { ...options, now, settings });
      if (r.status === "renewed") counts.renewed++;
      else if (r.status === "skipped") counts.skipped++;
      else if (r.status === "failed") counts.failed++;
      else if (r.status === "locked") counts.busy++;
      else if (r.status === "held") counts.held++;
    } catch (error) {
      counts.failed++;
      console.error(`[subscriptions] renew failed subscription=${id}`, safeErrorInfo(error));
    }
  }
  return counts;
}

export type RemindOptions = { now?: Date; limit?: number; only?: number[] };

/**
 * subscriptions.remind: one `subscription_reminder` per renewal, `reminderDaysBefore` days ahead, with
 * a skip link for that renewal and the manage link. Idempotent: reminder_sent_at (reset when the
 * renewal moves) and the dedupe key `subscription:<id>:remind:<renewal day>`.
 */
export async function sendDueReminders(options: RemindOptions = {}): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const settings = await loadCommerceSettings();
  const horizon = new Date(now.getTime() + settings.subscriptions.reminderDaysBefore * 86_400_000);
  const where = and(eq(subs.status, "active"), eq(subs.skipNext, false), isNull(subs.reminderSentAt), gt(subs.nextRunAt, now), lte(subs.nextRunAt, horizon));
  const ids = options.only ?? (await db.select({ id: subs.id }).from(subs).where(where).orderBy(asc(subs.nextRunAt)).limit(options.limit ?? 200)).map((r) => r.id);
  let queued = 0;
  for (const id of ids) {
    try {
      const sent = await db.transaction(async (tx) => {
        const [sub] = await tx.select().from(subs).where(and(eq(subs.id, id), where)).for("update", { skipLocked: true }).limit(1);
        if (!sub || reminderAt(sub.nextRunAt, settings.subscriptions.reminderDaysBefore).getTime() > now.getTime()) return false;
        const [plan] = await tx.select({ name: plans.name }).from(plans).where(eq(plans.id, sub.planId)).limit(1);
        const [user] = await tx.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, sub.userId)).limit(1);
        const locale = localeOf(sub.locale);
        const manageUrl = subscriptionManageUrl(locale);
        await enqueueEmail(tx, {
          template: "subscription_reminder",
          to: sub.email,
          locale,
          data: {
            name: firstNameOf(user?.name) ?? "",
            plan: plan?.name ?? { tr: "" },
            manageUrl,
            date: sub.nextRunAt.toISOString(),
            items: await emailItems(tx, sub.items),
            skipUrl: `${manageUrl}?atla=${encodeURIComponent(subscriptionSkipToken(sub.id, sub.nextRunAt))}`,
            card: sub.paymentMethod === "card",
          },
          related: { type: "subscription", id: sub.id },
          dedupeKey: `subscription:${sub.id}:remind:${istanbulDay(sub.nextRunAt)}`,
        });
        await tx.update(subs).set({ reminderSentAt: now }).where(eq(subs.id, sub.id));
        return true;
      });
      if (sent) queued++;
    } catch (error) {
      console.error(`[subscriptions] reminder failed subscription=${id}`, safeErrorInfo(error));
    }
  }
  return { queued, scanned: ids.length };
}
