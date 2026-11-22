// Order placement: server-side re-validation and recompute, then ONE transaction that locks the cart,
// decrements stock with guarded UPDATEs (variants in ascending id order), counts the coupon use under
// its maxUses guard, numbers the order from the sequence, stores order + items + events + consents +
// the legal snapshot, and deletes the cart. READ COMMITTED is enough because every check that matters
// is repeated inside an UPDATE's WHERE clause (re-evaluated on the latest row version after a wait).
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AddressData, InvoiceData, OrderBreakdown, OrderItemSnapshot, OrderStatus, PaymentMethod } from "@/db/schema/commerce";
import type { LocalizedText } from "@/db/schema/common";
import { locales, type Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { defaultMessages, type Messages } from "@/i18n/messages";
import { clearCartId } from "@/lib/cart/cookie";
import { findCart, isUuid, loadCart, type LoadedLine } from "@/lib/cart/load";
import { loadCommerceSettings, type CommerceSettings, type DbExecutor } from "@/lib/cart/settings";
import { cartRevision, totalsForLoadedCart } from "@/lib/cart/totals";
import type { CustomerContext, PaymentUnavailableReason } from "@/lib/cart/types";
import { countCouponUsesByEmail, lockCouponForEmail } from "@/lib/coupons/validate";
import { scheduleOpportunisticOrderExpiry } from "@/lib/cron/opportunistic";
import { isUniqueViolation, safeErrorInfo } from "@/lib/db-errors";
import { isVideoMedia } from "@/lib/media/types";
import { getCardGatewayFor } from "@/lib/payments/gateway";
import { initiateCardPayment, recordPaymentInitiated } from "@/lib/payments/complete";
import { recordOrderSubscriptions } from "@/lib/subscriptions/service";
import { normalizePaymentDays } from "./bank-transfer-deadline";
import { validateCheckout, type CheckoutData, type CheckoutFieldErrors } from "./checkout-schema";
import { revalidateProducts, scheduleNotification } from "./effects";
import { loadCheckoutLegalDocs } from "./legal-docs";
import { checkoutLegalReady } from "./legal-ready";
import { LEGAL_KEYS, legalOrderData, renderDistanceSales, renderPreInformation, type LegalBuyer } from "./legal-render";
import { formatOrderNumber } from "./number";
import { orderPageHref } from "./token";

export type CheckoutErrorCode =
  | "invalid_input"
  | "cart_empty"
  | "cart_has_issues"
  | "samples_only"
  | "method_unavailable"
  | "out_of_stock"
  | "coupon_unavailable"
  | "coupon_limit_reached"
  | "price_changed"
  | "cart_changed"
  | "card_not_configured"
  | "legal_unavailable"
  | "rate_limited"
  | "generic";

export type PlaceOrderSuccess = {
  ok: true;
  orderId: number;
  orderNumber: string;
  accessToken: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  /** Card: the payment page (simulator). Others: the order page with `new=1`. */
  redirectTo: string;
  /** True when this cart had already been ordered (double submit): the existing order is returned. */
  existing: boolean;
};

export type PlaceOrderFailure = {
  ok: false;
  /** General error; message key `checkout.errors.<code>`. */
  code: CheckoutErrorCode;
  /** Field path → field error code (message key `checkout.errors.<code>`). Empty unless invalid_input. */
  fieldErrors: CheckoutFieldErrors;
  /** method_unavailable: why (message key `checkout.paymentUnavailable.<reason>`). */
  reason?: PaymentUnavailableReason;
  /** method_unavailable with over_limit: the kapıda ödeme limit (kuruş) for the message. */
  limit?: number;
  /** out_of_stock: the variant that ran out. */
  variantId?: number;
  /** price_changed: the current total for the chosen method. */
  actualTotal?: number;
};

export type PlaceOrderResult = PlaceOrderSuccess | PlaceOrderFailure;

export type PlaceOrderContext = {
  /** From readCartId() (the httpOnly cookie). */
  cartId: string | null;
  /** From getCustomerContext(). */
  customer: CustomerContext;
  /** Labels for the stored legal texts; pass getMessages(locale) so preview and snapshot match. */
  messages?: Messages;
  /** Test/script override; production reads fresh settings. */
  settings?: CommerceSettings;
  now?: Date;
  /** Clear the cart cookie, revalidate product pages, schedule the notification (default true). */
  effects?: boolean;
  /** The buyer's trusted client IP (clientIp() in the action): card providers require it. */
  clientIp?: string | null;
  /**
   * Tests and scripts only (the checkout action never passes it): accept contract texts whose version is
   * still a draft ("taslak…"), so DB tests can place orders against the seeded drafts. Without it an order
   * never stores a draft contract (go-live CF-4).
   */
  allowDraftContracts?: boolean;
};

class Rollback extends Error {
  constructor(readonly result: PlaceOrderFailure) {
    super(result.code);
  }
}

const fail = (code: CheckoutErrorCode, extra: Partial<PlaceOrderFailure> = {}): PlaceOrderFailure => ({ ok: false, code, fieldErrors: {}, ...extra });

const INITIAL_STATUS: Record<PaymentMethod, OrderStatus> = {
  card: "pending_payment",
  bank_transfer: "awaiting_transfer",
  cash_on_delivery: "processing",
  deferred: "processing",
};

function joinLabels(labels: LocalizedText[]): LocalizedText {
  const out: Record<string, string> = {};
  for (const l of locales) out[l] = labels.map((x) => localize(x, l)).filter(Boolean).join(" · ");
  return out as LocalizedText;
}

function addresses(data: CheckoutData): { shipping: AddressData; invoice: InvoiceData; buyer: LegalBuyer } {
  const s = data.shippingAddress;
  const shipping: AddressData = {
    fullName: s.fullName,
    phone: data.contact.phone,
    city: s.city,
    district: s.district,
    ...(s.neighbourhood ? { neighbourhood: s.neighbourhood } : {}),
    line1: s.line1,
    ...(s.postalCode ? { postalCode: s.postalCode } : {}),
    country: "TR",
  };
  const inv = data.invoice;
  const billing: AddressData =
    inv.sameAsShipping || !inv.address
      ? shipping
      : {
          fullName: inv.address.fullName,
          phone: data.contact.phone,
          city: inv.address.city,
          district: inv.address.district,
          ...(inv.address.neighbourhood ? { neighbourhood: inv.address.neighbourhood } : {}),
          line1: inv.address.line1,
          ...(inv.address.postalCode ? { postalCode: inv.address.postalCode } : {}),
          country: "TR",
        };
  const invoice: InvoiceData =
    inv.type === "corporate"
      ? { type: "corporate", companyName: inv.companyName, taxOffice: inv.taxOffice, taxNumber: inv.taxNumber, eInvoice: inv.eInvoice, address: billing }
      : { type: "individual", fullName: inv.fullName ?? shipping.fullName, ...(inv.nationalId ? { nationalId: inv.nationalId } : {}), address: billing };
  return {
    shipping,
    invoice,
    buyer: { email: data.contact.email, phone: data.contact.phone, shippingAddress: shipping, invoice: { ...invoice, sameAsShipping: inv.sameAsShipping } },
  };
}

function snapshotOf(line: LoadedLine, priced: { compareAt: number | null; couponDiscount: number; bankTransferDiscount: number }, stockTracked: boolean): OrderItemSnapshot {
  const d = line.display;
  // Snapshots are permanent: never store a video as the line's image (day 6; loadLineImages already
  // returns images only, this is the last guard).
  const image = d.image && !isVideoMedia(d.image) ? d.image : null;
  return {
    productId: line.productId,
    productName: d.name,
    variantTitle: joinLabels(d.variantLabels),
    sku: d.sku,
    barcode: d.barcode,
    imageUrl: image?.url ?? null,
    accentColor: d.accentColor,
    productSlug: d.productSlug,
    productSubtitle: d.subtitle,
    variantLabels: d.variantLabels,
    image,
    categoryId: line.categoryId,
    compareAt: priced.compareAt,
    weightGrams: line.weightGrams,
    stockTracked,
    couponDiscount: priced.couponDiscount,
    bankTransferDiscount: priced.bankTransferDiscount,
  };
}

type ExistingOrder = { id: number; orderNumber: string; accessToken: string; status: OrderStatus; paymentMethod: PaymentMethod; grandTotal: number; locale: string; email: string };

async function findOrderByCart(cartId: string, executor: DbExecutor = db): Promise<ExistingOrder | null> {
  const o = schema.orders;
  const [row] = await executor
    .select({ id: o.id, orderNumber: o.orderNumber, accessToken: o.accessToken, status: o.status, paymentMethod: o.paymentMethod, grandTotal: o.grandTotal, locale: o.locale, email: o.email })
    .from(o)
    .where(eq(o.cartId, cartId))
    .limit(1);
  return row ?? null;
}

async function redirectFor(order: ExistingOrder, locale: Locale, card: { clientIp?: string | null; payments?: CommerceSettings["payments"] } = {}): Promise<string> {
  if (order.paymentMethod === "card" && order.status === "pending_payment") {
    try {
      // The provider's page (iyzico, simulator) or the PayTR card page; the order page when it fails.
      const started = await initiateCardPayment(order.id, { clientIp: card.clientIp ?? null, payments: card.payments, locale });
      if (started.ok) return started.redirectUrl;
    } catch (error) {
      console.error(`[orders] gateway initiate failed order=${order.id}`, safeErrorInfo(error));
    }
    return orderPageHref(locale, order.orderNumber, order.accessToken);
  }
  return orderPageHref(locale, order.orderNumber, order.accessToken, { new: true });
}

/**
 * Places the order for the cart. Never trusts the client: the input is re-validated, the cart reloaded
 * and every amount recomputed for the chosen payment method inside the transaction.
 * Returns field errors (invalid_input) or a general error code; never throws for expected failures.
 */
export async function placeOrder(input: unknown, ctx: PlaceOrderContext): Promise<PlaceOrderResult> {
  const validated = validateCheckout(input);
  if (!validated.ok) return { ok: false, code: "invalid_input", fieldErrors: validated.fieldErrors };
  const data = validated.data;
  const locale = data.locale;
  const cartId = ctx.cartId;
  if (!isUuid(cartId)) return fail("cart_empty");

  const now = ctx.now ?? new Date();
  const [settings, docs] = await Promise.all([ctx.settings ?? loadCommerceSettings(), loadCheckoutLegalDocs()]);
  // No sale without the contract texts: consent to a document that does not exist proves nothing.
  const preDoc = docs.preInformation;
  const salesDoc = docs.distanceSales;
  if (!preDoc || !salesDoc) return fail("legal_unavailable");
  // Nor with a draft ("taslak…", awaiting the lawyer): the snapshot is stored with the order for good.
  if (!ctx.allowDraftContracts && !checkoutLegalReady(docs)) return fail("legal_unavailable");
  const messages = ctx.messages ?? defaultMessages[locale];
  // Go-live CF-11: null for non-staff while the test mode is on on a live site (card is then not_configured).
  const gateway = await getCardGatewayFor(settings.payments, ctx.customer);
  const card = { clientIp: ctx.clientIp ?? null, payments: settings.payments };
  const { shipping, invoice, buyer } = addresses(data);

  type Outcome = { order: ExistingOrder; existing: boolean; slugs: string[] };
  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      // 1. Lock the cart. A second submit waits here; when the first one commits the cart is gone.
      const [cartRow] = await tx
        .select({ id: schema.carts.id })
        .from(schema.carts)
        .where(eq(schema.carts.id, cartId))
        .for("update")
        .limit(1);
      const cart = cartRow ? await findCart(cartRow.id, tx, now) : null;
      if (!cart) {
        const existing = await findOrderByCart(cartId, tx);
        if (existing) return { order: existing, existing: true, slugs: [] };
        throw new Rollback(fail("cart_empty"));
      }

      // 2. Reload and recompute under the lock.
      const loaded = await loadCart(cart.id, ctx.customer, { executor: tx, now });
      const totals = totalsForLoadedCart(loaded, settings, { paymentMethod: data.paymentMethod, cardGatewayReady: gateway !== null, now });
      const included = totals.lines.filter((l) => l.included);
      const paid = included.filter((l) => !l.isSample);
      if (totals.lines.length === 0) throw new Rollback(fail("cart_empty"));
      if (totals.issues.some((i) => i.code === "samples_only")) throw new Rollback(fail("samples_only"));
      if (paid.length === 0 || totals.issues.some((i) => i.blocking)) throw new Rollback(fail("cart_has_issues"));
      const method = totals.paymentMethods.find((m) => m.method === data.paymentMethod)!;
      if (!method.available) {
        throw new Rollback(
          data.paymentMethod === "card" && method.reason === "not_configured"
            ? fail("card_not_configured", { reason: method.reason })
            : fail("method_unavailable", { ...(method.reason ? { reason: method.reason } : {}), ...(method.limit ? { limit: method.limit } : {}) }),
        );
      }
      // What the buyer confirmed: the same lines and coupon, and the total shown for this method.
      if (data.expectedCart !== undefined && data.expectedCart !== cartRevision(totals)) throw new Rollback(fail("cart_changed"));
      const expectedTotal = data.expectedTotals?.[data.paymentMethod] ?? data.expectedTotal;
      if (expectedTotal !== undefined && expectedTotal !== totals.grandTotal) {
        throw new Rollback(fail("price_changed", { actualTotal: totals.grandTotal }));
      }

      // 3. Never drop a coupon the buyer applied: if it stopped being valid, refuse (the code is then
      //    removed from the cart so the next view shows the real totals).
      if (loaded.cart?.couponCode && totals.coupon?.status !== "applied") throw new Rollback(fail("coupon_unavailable"));
      // A code that saved nothing (e.g. free_shipping on a cart above the free-shipping threshold) is
      // not used up: no usage count, no per-customer use, not linked to the order.
      const couponSaved = totals.discounts.coupon > 0 || totals.shipping.freeReason === "coupon";
      const coupon = totals.coupon?.status === "applied" && couponSaved ? loaded.coupon : null;
      // Per-customer limit, serialized per coupon + e-mail.
      if (coupon?.perCustomerLimit != null) {
        await lockCouponForEmail(coupon.id, data.contact.email, tx);
        const used = await countCouponUsesByEmail(coupon.id, data.contact.email, tx);
        if (used >= coupon.perCustomerLimit) throw new Rollback(fail("coupon_limit_reached"));
      }

      // 4. Stock: guarded decrements in ascending variant order (stable lock order, no deadlocks).
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
        if (rows.length === 0) throw new Rollback(fail("out_of_stock", { variantId: line.variantId }));
        tracked.set(line.variantId, rows[0].trackStock);
      }

      // 5. Coupon use under the same guards as validation (maxUses, active, window).
      if (coupon) {
        const c = schema.coupons;
        const at = now.toISOString();
        const rows = await tx
          .update(c)
          .set({ usedCount: sql`${c.usedCount} + 1` })
          .where(
            and(
              eq(c.id, coupon.id),
              eq(c.isActive, true),
              sql`(${c.maxUses} is null or ${c.usedCount} < ${c.maxUses})`,
              sql`(${c.startsAt} is null or ${c.startsAt} <= ${at}::timestamptz)`,
              sql`(${c.endsAt} is null or ${c.endsAt} > ${at}::timestamptz)`,
            ),
          )
          .returning({ id: c.id });
        if (rows.length === 0) throw new Rollback(fail("coupon_unavailable"));
      }

      // 6. Number, legal snapshot, order, items, events, payment row.
      const seqRows = await tx.execute<{ n: string }>(sql`select nextval('order_number_seq')::text as n`);
      const orderNumber = formatOrderNumber(Number(seqRows[0].n), now);
      const legal = legalOrderData(totals, loaded, locale, data.paymentMethod);
      // FIX F4: the havale day count is fixed at placement (contract, e-mail, order page and panel all read it).
      const bankTransferDays = normalizePaymentDays(settings.payments.bankTransfer.paymentDays);
      const legalInput = {
        locale,
        messages,
        seller: settings.general,
        estimatedDays: settings.shipping.estimatedDays,
        buyer,
        items: legal.items,
        totals: legal.totals,
        paymentMethod: data.paymentMethod,
        orderNumber,
        date: now,
        bankTransferDays,
      };
      const preInformationHtml = renderPreInformation({ ...legalInput, document: preDoc });
      const distanceSalesHtml = renderDistanceSales({ ...legalInput, document: salesDoc });
      const acceptedAt = now.toISOString();
      const status = INITIAL_STATUS[data.paymentMethod];
      const breakdown: OrderBreakdown = {
        couponDiscount: totals.discounts.coupon,
        couponType: coupon?.type ?? null,
        bankTransferDiscount: totals.discounts.bankTransfer,
        bankTransferPercent: method.discountPercent,
        shippingFlat: totals.shipping.flat,
        shippingHeavy: totals.shipping.heavy,
        heavyKg: totals.shipping.heavyKg,
        freeShipping: totals.shipping.free,
        freeShippingReason: totals.shipping.freeReason,
        totalWeightGrams: totals.totalWeightGrams,
        itemCount: totals.itemCount,
        ...(data.paymentMethod === "bank_transfer" ? { bankTransferDays } : {}),
      };

      const o = schema.orders;
      const [order] = await tx
        .insert(o)
        .values({
          orderNumber,
          cartId: cart.id,
          userId: ctx.customer.userId,
          companyId: ctx.customer.companyId,
          customerGroupId: ctx.customer.groupId,
          email: data.contact.email,
          phone: data.contact.phone,
          locale,
          status,
          paymentMethod: data.paymentMethod,
          paymentProvider: data.paymentMethod === "card" ? (gateway?.provider ?? null) : data.paymentMethod === "bank_transfer" ? "manual" : null,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          shippingTotal: totals.shipping.total,
          paymentFee: totals.paymentFee,
          vatTotal: totals.vatTotal,
          grandTotal: totals.grandTotal,
          couponCode: coupon?.code ?? null,
          couponId: coupon?.id ?? null,
          breakdown,
          shippingAddress: shipping,
          invoice,
          customerNote: data.customerNote ?? null,
          // The same instant the contracts were dated with (their havale deadline is counted from it).
          createdAt: now,
          consents: [
            { key: LEGAL_KEYS.preInformation, version: preDoc.version, acceptedAt },
            { key: LEGAL_KEYS.distanceSales, version: salesDoc.version, acceptedAt },
          ],
        })
        .returning({
          id: o.id,
          orderNumber: o.orderNumber,
          accessToken: o.accessToken,
          status: o.status,
          paymentMethod: o.paymentMethod,
          grandTotal: o.grandTotal,
          locale: o.locale,
          email: o.email,
        });

      const byLine = new Map(loaded.lines.map((l) => [l.lineId, l]));
      await tx.insert(schema.orderItems).values(
        included.map((line) => ({
          orderId: order.id,
          variantId: line.variantId,
          snapshot: snapshotOf(byLine.get(line.lineId)!, line, tracked.get(line.variantId) ?? false),
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          discount: line.discount,
          lineTotal: line.lineTotal,
          vatRate: line.vatRate,
          isSample: line.isSample,
        })),
      );

      await tx.insert(schema.orderEvents).values([
        {
          orderId: order.id,
          type: "placed",
          data: { status, paymentMethod: data.paymentMethod, grandTotal: totals.grandTotal, itemCount: totals.itemCount, couponCode: coupon?.code ?? null },
        },
        {
          orderId: order.id,
          type: "legal_snapshot",
          data: {
            preInformation: { key: LEGAL_KEYS.preInformation, version: preDoc.version, html: preInformationHtml },
            distanceSales: { key: LEGAL_KEYS.distanceSales, version: salesDoc.version, html: distanceSalesHtml },
          },
        },
      ]);
      if (data.paymentMethod === "card" && gateway) await recordPaymentInitiated(tx, order.id, gateway.provider, totals.grandTotal);
      // Subscribe and save: one subscription per plan, started now (havale, kapıda ödeme) or when
      // the card payment succeeds (src/lib/subscriptions/service.ts).
      await recordOrderSubscriptions(tx, {
        orderId: order.id,
        userId: ctx.customer.userId,
        email: data.contact.email,
        locale,
        paymentMethod: data.paymentMethod,
        shippingAddress: shipping,
        invoice,
        lines: included,
        now,
      });

      // 7. The cart is done.
      await tx.delete(schema.cartItems).where(eq(schema.cartItems.cartId, cart.id));
      await tx.delete(schema.carts).where(eq(schema.carts.id, cart.id));

      const slugs = included.map((l) => byLine.get(l.lineId)!.display.productSlug);
      return { order, existing: false, slugs };
    });
  } catch (error) {
    if (error instanceof Rollback) {
      if (error.result.code === "coupon_unavailable") {
        await db
          .update(schema.carts)
          .set({ couponCode: null })
          .where(eq(schema.carts.id, cartId))
          .catch((e: unknown) => console.error("[orders] clearing coupon failed", safeErrorInfo(e)));
      }
      return error.result;
    }
    if (isUniqueViolation(error)) {
      const existing = await findOrderByCart(cartId);
      if (existing) return { ok: true, ...base(existing), redirectTo: await redirectFor(existing, locale, card), existing: true };
    }
    // Only the error class and SQLSTATE: the query parameters hold the buyer's personal data.
    console.error("[orders] placeOrder failed", safeErrorInfo(error));
    return fail("generic");
  }

  if (ctx.effects !== false) {
    try {
      await clearCartId();
    } catch (error) {
      console.error("[orders] clearCartId failed", safeErrorInfo(error));
    }
    if (!outcome.existing) {
      revalidateProducts(outcome.slugs);
      scheduleNotification("placed", outcome.order.id);
      // The daily cron alone would leave unpaid card orders holding stock for hours (throttled: 5 min).
      scheduleOpportunisticOrderExpiry();
    }
  }
  return { ok: true, ...base(outcome.order), redirectTo: await redirectFor(outcome.order, locale, card), existing: outcome.existing };
}

function base(order: ExistingOrder) {
  return { orderId: order.id, orderNumber: order.orderNumber, accessToken: order.accessToken, status: order.status, paymentMethod: order.paymentMethod };
}
