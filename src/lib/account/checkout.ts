// Checkout for a signed-in customer: the prefill (account e-mail, saved addresses with their invoice
// data, the default address) and "Bu adresi kaydet" after the order is placed. Server only.
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AddressData, InvoiceData } from "@/db/schema/commerce";
import type { Messages } from "@/i18n/messages";
import { formatPhone } from "@/components/order/format";
import { listAddresses, saveAddressFromOrder, type SavedAddress } from "./addresses";
import type { CheckoutAccount } from "./checkout-types";
import { format } from "@/i18n/format";
import { loadAccountUser } from "./service";

function addressValues(prefix: "shippingAddress" | "invoice.address", data: AddressData): Record<string, string> {
  return {
    [`${prefix}.fullName`]: data.fullName,
    [`${prefix}.city`]: data.city,
    [`${prefix}.district`]: data.district,
    [`${prefix}.neighbourhood`]: data.neighbourhood ?? "",
    [`${prefix}.line1`]: data.line1,
    [`${prefix}.postalCode`]: data.postalCode ?? "",
  };
}

function invoiceValues(invoice: InvoiceData | null): Record<string, string> {
  if (invoice?.type === "corporate") {
    return {
      "invoice.type": "corporate",
      "invoice.companyName": invoice.companyName ?? "",
      "invoice.taxOffice": invoice.taxOffice ?? "",
      "invoice.taxNumber": invoice.taxNumber ?? "",
      "invoice.eInvoice": invoice.eInvoice ? "on" : "",
    };
  }
  return { "invoice.type": "individual", "invoice.nationalId": invoice?.nationalId ?? "" };
}

/**
 * Checkout field values for delivering to `address`: its delivery data and phone, and the invoice
 * data of the default billing address (sent to that address when it is a different one).
 */
export function checkoutValuesFor(address: SavedAddress, billing: SavedAddress | null, email: string): Record<string, string> {
  const bill = billing ?? address;
  const separate = billing !== null && billing.id !== address.id;
  return {
    "contact.email": email,
    "contact.phone": formatPhone(address.data.phone),
    ...addressValues("shippingAddress", address.data),
    ...invoiceValues(bill.invoice),
    "invoice.sameAsShipping": separate ? "" : "on",
    ...(separate ? addressValues("invoice.address", bill.data) : {}),
  };
}

/** The signed-in customer's checkout prefill, or null (no such user / banned). */
export async function loadCheckoutAccount(userId: string, messages: Messages): Promise<CheckoutAccount | null> {
  const user = await loadAccountUser(db, userId);
  if (!user || user.banned) return null;
  const addresses = await listAddresses(db, userId);
  const billing = addresses.find((a) => a.isDefaultBilling) ?? null;
  const shipping = addresses.find((a) => a.isDefaultShipping) ?? addresses[0] ?? null;
  const m = messages.account.checkout;
  return {
    email: user.email,
    addresses: addresses.map((a) => ({
      id: a.id,
      title: a.title,
      summary: `${a.data.fullName} · ${a.data.district} / ${a.data.city}`,
      values: checkoutValuesFor(a, billing, user.email),
    })),
    defaultAddressId: shipping?.id ?? null,
    blankValues: { "contact.email": user.email, "contact.phone": user.phone ? formatPhone(user.phone) : "" },
    saveByDefault: addresses.length === 0,
    labels: {
      signedInAs: format(m.signedInAs, { email: user.email }),
      emailLocked: m.emailLocked,
      savedAddresses: m.savedAddresses,
      newAddress: m.newAddress,
      saveAddress: m.saveAddress,
      saveAddressHint: m.saveAddressHint,
    },
  };
}

/**
 * "Bu adresi kaydet": stores the delivery address (and its invoice data) of an order the user just
 * placed, unless it is already in the address book. Never throws (the order is already placed).
 */
export async function saveAddressFromPlacedOrder(orderId: number, userId: string): Promise<number | null> {
  try {
    const o = schema.orders;
    const [order] = await db
      .select({ shippingAddress: o.shippingAddress, invoice: o.invoice })
      .from(o)
      .where(and(eq(o.id, orderId), eq(o.userId, userId)))
      .limit(1);
    if (!order) return null;
    return await db.transaction((tx) => saveAddressFromOrder(tx, userId, order));
  } catch (error) {
    console.error("[account] save address from order failed", { orderId, name: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}
