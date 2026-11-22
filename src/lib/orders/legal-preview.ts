import "server-only";
import { connection } from "next/server";
import type { Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { defaultMessages, type Messages } from "@/i18n/messages";
import { loadCart } from "@/lib/cart/load";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { totalsForLoadedCart } from "@/lib/cart/totals";
import type { CustomerContext, PaymentMethod } from "@/lib/cart/types";
import { isCardPaymentReadyFor } from "@/lib/payments/gateway";
import { loadCheckoutLegalDocs } from "./legal-docs";
import { legalBuyerFromUnknown, legalOrderData, renderDistanceSales, renderPreInformation } from "./legal-render";

export type LegalText = { key: string; title: string; version: string; html: string };
export type LegalPreview = { preInformation: LegalText; distanceSales: LegalText };

/**
 * The two legal texts for the checkout preview modal, rendered with the current cart, the chosen
 * payment method and whatever the buyer has typed so far (missing fields show "—"). placeOrder renders
 * the stored snapshot with the same functions and data.
 */
export async function renderCheckoutLegalPreview(
  input: { locale: Locale; form?: unknown; paymentMethod?: PaymentMethod | null },
  ctx: { cartId: string | null; customer: CustomerContext; messages?: Messages; now?: Date },
): Promise<LegalPreview> {
  await connection(); // uses the clock: request time only (resolves immediately in Server Actions)
  const now = ctx.now ?? new Date();
  const messages = ctx.messages ?? defaultMessages[input.locale];
  const [settings, docs, loaded] = await Promise.all([loadCommerceSettings(), loadCheckoutLegalDocs(), loadCart(ctx.cartId, ctx.customer, { now })]);
  const method = input.paymentMethod ?? null;
  const totals = totalsForLoadedCart(loaded, settings, { paymentMethod: method, cardGatewayReady: await isCardPaymentReadyFor(settings.payments, ctx.customer), now });
  const legal = legalOrderData(totals, loaded, input.locale, method);
  const base = {
    locale: input.locale,
    messages,
    seller: settings.general,
    estimatedDays: settings.shipping.estimatedDays,
    buyer: legalBuyerFromUnknown(input.form),
    items: legal.items,
    totals: legal.totals,
    paymentMethod: method,
    orderNumber: null,
    date: now,
    bankTransferDays: settings.payments.bankTransfer.paymentDays,
  };
  const text = (key: string, doc: typeof docs.preInformation, html: string, fallback: string): LegalText => ({
    key,
    title: localize(doc?.title, input.locale) || fallback,
    version: doc?.version ?? "missing",
    html,
  });
  return {
    preInformation: text("pre_information", docs.preInformation, renderPreInformation({ ...base, document: docs.preInformation }), messages.checkout.preInformation),
    distanceSales: text("distance_sales", docs.distanceSales, renderDistanceSales({ ...base, document: docs.distanceSales }), messages.checkout.distanceSales),
  };
}
