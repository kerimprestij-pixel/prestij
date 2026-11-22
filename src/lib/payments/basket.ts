// Basket lines and buyer fields for the providers (pure). iyzico refuses a basket whose item prices do
// not add up exactly to `price`, and both providers refuse zero-priced items, so the lines are built
// from the stored order (line totals after discounts + shipping + the payment fee) and checked here.
import type { AddressData, InvoiceData } from "@/db/schema/commerce";
import { findProvince, normalizeTrPhone } from "@/lib/validation/tr";
import type { GatewayAddress, GatewayLine } from "./types";

export type OrderLineSource = { id: number; name: string; quantity: number; lineTotal: number; isSample: boolean };

/**
 * Order items (samples and fully discounted lines left out) + shipping + payment fee. When the stored
 * totals do not add up to `amount` (should never happen: grandTotal = Σ lineTotal + shipping + fee),
 * a single line for the whole order is used so the provider still sees the exact amount.
 */
export function buildBasketLines(input: {
  orderNumber: string;
  amount: number;
  items: OrderLineSource[];
  shippingTotal: number;
  paymentFee: number;
}): GatewayLine[] {
  const lines: GatewayLine[] = input.items
    .filter((i) => !i.isSample && i.lineTotal > 0 && i.quantity > 0)
    .map((i) => ({ id: `item-${i.id}`, name: clip(i.name, 100) || `Ürün ${i.id}`, quantity: i.quantity, total: i.lineTotal, kind: "item" as const }));
  if (input.shippingTotal > 0) lines.push({ id: "shipping", name: "Kargo", quantity: 1, total: input.shippingTotal, kind: "shipping" });
  if (input.paymentFee > 0) lines.push({ id: "fee", name: "Ödeme hizmet bedeli", quantity: 1, total: input.paymentFee, kind: "fee" });
  const sum = lines.reduce((s, l) => s + l.total, 0);
  if (lines.length === 0 || sum !== input.amount) {
    return [{ id: "order", name: `Sipariş ${input.orderNumber}`, quantity: 1, total: input.amount, kind: "item" }];
  }
  return lines;
}

/** Trims, collapses whitespace, drops control characters and cuts to `max` characters. */
export function clip(value: string | null | undefined, max: number): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** "Ayşe Nur Yılmaz" → { name: "Ayşe Nur", surname: "Yılmaz" }; one word → both the same. */
export function splitName(fullName: string): { name: string; surname: string } {
  const parts = clip(fullName, 120).split(" ").filter(Boolean);
  if (parts.length === 0) return { name: "Müşteri", surname: "Müşteri" };
  if (parts.length === 1) return { name: parts[0], surname: parts[0] };
  return { name: parts.slice(0, -1).join(" "), surname: parts[parts.length - 1] };
}

/** A stored order address → the provider shape (province name for a plate code, one address line). */
export function gatewayAddress(address: AddressData, fallbackName: string): GatewayAddress {
  const city = findProvince(address.city)?.name ?? clip(address.city, 60);
  const line = [address.neighbourhood, address.line1, `${clip(address.district, 60)}/${city}`].map((p) => clip(p, 200)).filter(Boolean).join(", ");
  return {
    contactName: clip(address.fullName, 100) || fallbackName,
    city,
    district: clip(address.district, 60),
    line: clip(line, 380),
    zipCode: address.postalCode && /^\d{5}$/.test(address.postalCode) ? address.postalCode : null,
    country: (address.country || "TR").toUpperCase(),
  };
}

/** The TCKN of an individual invoice when it has the right shape, else null. */
export function identityNumberOf(invoice: InvoiceData | null | undefined): string | null {
  const id = invoice?.type === "individual" ? invoice.nationalId?.trim() : undefined;
  return id && /^[1-9]\d{10}$/.test(id) ? id : null;
}

/** "+905321234567" for a Turkish mobile number, else the trimmed input (max 20 characters). */
export function gatewayPhone(phone: string | null | undefined): string {
  return normalizeTrPhone(phone ?? "") ?? clip(phone, 20);
}
