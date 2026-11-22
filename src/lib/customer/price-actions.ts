"use server";
// Business / group prices for the client islands on static product pages and cards (B2B). Returns
// formatted prices only for a signed-in customer whose pricing group gives a different price, and {}
// for everyone else (signed out, retail, banned, any error). Only the caller's own prices: the
// customer context is read from the session on the server, never taken from the client. The texts
// come pre-formatted (messages.b2b.price, panel overrides included), so the static page ships none.

import { isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { computePersonalCardPrices, computePersonalPrices, MAX_PERSONAL_PRICE_IDS, withoutVat } from "@/lib/b2b/personal-prices";
import { getCustomerContext } from "@/lib/customer/context";
import { safeErrorInfo } from "@/lib/db-errors";
import { formatPrice } from "@/lib/pricing/money";

export type PersonalPriceView = {
  /** "business" (approved company / business group) or "personal" (another pricing group). */
  kind: "business" | "personal";
  /** "Kurumsal fiyatınız" / "Size özel fiyat". */
  label: string;
  /** The price to show: net for groups that see prices without VAT, else VAT included (as charged). */
  price: string;
  /** "KDV hariç" when `price` is net, else null. */
  vatNote: string | null;
  /** "KDV dahil 127,49 ₺" when `price` is net (the amount the cart charges), else null. */
  grossNote: string | null;
  /** The retail price of the same line on the same basis as `price` (net or gross), shown struck through. */
  retailPrice: string;
  /** What the cart charges per unit (kuruş, VAT included): the subscription choice's one-time price. */
  unitPrice: number;
  /** Subscribe and save: the cart's unit price per active plan id (kuruş, VAT included), when it applies. */
  subscriptionUnitPrices?: Record<number, number>;
};

export type PersonalCardPriceView = {
  kind: "business" | "personal";
  /** "Kurumsal: 106,24 ₺" (net for groups without VAT, else VAT included). */
  text: string;
  /** "KDV hariç" when the amount in `text` is net, else null. */
  vatNote: string | null;
  /** The variants have different personal prices: the card prefixes its "from" label. */
  hasRange: boolean;
};

function readIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<number>();
  for (const raw of value) {
    if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) ids.add(raw);
    if (ids.size >= MAX_PERSONAL_PRICE_IDS) break;
  }
  return [...ids];
}

const readLocale = (value: unknown): Locale => (typeof value === "string" && isLocale(value) ? value : "tr");

/** Personal unit price per variant id (only where it differs from retail). */
export async function loadPersonalPrices(variantIds: unknown, locale: unknown): Promise<Record<number, PersonalPriceView>> {
  const ids = readIds(variantIds);
  if (ids.length === 0) return {};
  try {
    const customer = await getCustomerContext();
    if (!customer.userId || customer.groupId == null) return {};
    const l = readLocale(locale);
    const prices = await computePersonalPrices(customer, ids);
    if (prices.size === 0) return {};
    const m = (await getMessages(l)).b2b.price;
    const kind = customer.isBusiness ? "business" : "personal";
    const out: Record<number, PersonalPriceView> = {};
    for (const [variantId, x] of prices) {
      const gross = formatPrice(x.unitPrice, l);
      const net = customer.showPricesExVat ? formatPrice(withoutVat(x.unitPrice, x.vatRate), l) : null;
      out[variantId] = {
        kind,
        label: kind === "business" ? m.business : m.personal,
        price: net ?? gross,
        vatNote: net ? m.exVat : null,
        grossNote: net ? format(m.incVat, { amount: gross }, l) : null,
        retailPrice: formatPrice(net ? withoutVat(x.retailUnitPrice, x.vatRate) : x.retailUnitPrice, l),
        unitPrice: x.unitPrice,
        ...(x.subscriptionUnitPrices ? { subscriptionUnitPrices: x.subscriptionUnitPrices } : {}),
      };
    }
    return out;
  } catch (error) {
    console.error("[b2b] personal prices failed", safeErrorInfo(error));
    return {};
  }
}

/** Personal (lowest) price per product id for product cards (only where it differs from retail). */
export async function loadPersonalCardPrices(productIds: unknown, locale: unknown): Promise<Record<number, PersonalCardPriceView>> {
  const ids = readIds(productIds);
  if (ids.length === 0) return {};
  try {
    const customer = await getCustomerContext();
    if (!customer.userId || customer.groupId == null) return {};
    const l = readLocale(locale);
    const prices = await computePersonalCardPrices(customer, ids);
    if (prices.size === 0) return {};
    const m = (await getMessages(l)).b2b.price;
    const kind = customer.isBusiness ? "business" : "personal";
    const out: Record<number, PersonalCardPriceView> = {};
    for (const [productId, x] of prices) {
      const amount = customer.showPricesExVat ? withoutVat(x.minPrice, x.vatRate) : x.minPrice;
      out[productId] = {
        kind,
        text: format(kind === "business" ? m.card : m.cardPersonal, { price: formatPrice(amount, l) }, l),
        vatNote: customer.showPricesExVat ? m.exVat : null,
        hasRange: x.hasRange,
      };
    }
    return out;
  } catch (error) {
    console.error("[b2b] personal card prices failed", safeErrorInfo(error));
    return {};
  }
}
