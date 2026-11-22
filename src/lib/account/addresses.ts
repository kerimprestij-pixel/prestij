// The customer's address book (/hesap/adresler, checkout prefill and "Bu adresi kaydet"). Every
// function takes the user id from the session (never from the client) and only ever touches that
// user's rows: another user's address id behaves exactly like a missing one (AccountError
// "not_found"). No Next APIs, so DB tests call these directly.
import "server-only";
import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import { schema } from "@/db";
import type { AddressData, InvoiceData } from "@/db/schema/commerce";
import type { Tx } from "@/lib/panel/tx";
import { AccountError } from "./errors";
import type { AddressInput } from "./schemas";

/** Addresses one customer may keep. */
export const MAX_ADDRESSES = 20;

const a = schema.addresses;

export type SavedAddress = {
  id: number;
  title: string;
  data: AddressData;
  invoice: InvoiceData | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  updatedAt: string;
};

const columns = {
  id: a.id,
  title: a.title,
  data: a.data,
  invoice: a.invoice,
  isDefaultShipping: a.isDefaultShipping,
  isDefaultBilling: a.isDefaultBilling,
  updatedAt: a.updatedAt,
};

type Row = { id: number; title: string; data: AddressData; invoice: InvoiceData | null; isDefaultShipping: boolean; isDefaultBilling: boolean; updatedAt: Date };

const toSaved = (r: Row): SavedAddress => ({ ...r, updatedAt: r.updatedAt.toISOString() });

/** The user's addresses: default delivery address first, then the most recently changed. */
export async function listAddresses(executor: Tx, userId: string): Promise<SavedAddress[]> {
  const rows = await executor
    .select(columns)
    .from(a)
    .where(eq(a.userId, userId))
    .orderBy(desc(a.isDefaultShipping), desc(a.isDefaultBilling), desc(a.updatedAt), desc(a.id));
  return rows.map(toSaved);
}

/** One address of the user, or null (missing or someone else's). */
export async function getAddress(executor: Tx, userId: string, id: number): Promise<SavedAddress | null> {
  const [row] = await executor.select(columns).from(a).where(and(eq(a.id, id), eq(a.userId, userId))).limit(1);
  return row ? toSaved(row) : null;
}

/** The stored shape of a validated form (invoice address = the address itself). */
export function addressRecord(input: Pick<AddressInput, "address" | "invoice">): { data: AddressData; invoice: InvoiceData } {
  const { address } = input;
  const data: AddressData = {
    fullName: address.fullName,
    phone: address.phone,
    city: address.city,
    district: address.district,
    ...(address.neighbourhood ? { neighbourhood: address.neighbourhood } : {}),
    line1: address.line1,
    ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    country: "TR",
  };
  const invoice: InvoiceData =
    input.invoice.type === "corporate"
      ? {
          type: "corporate",
          companyName: input.invoice.companyName,
          taxOffice: input.invoice.taxOffice,
          taxNumber: input.invoice.taxNumber,
          eInvoice: input.invoice.eInvoice,
        }
      : { type: "individual", ...(input.invoice.nationalId ? { nationalId: input.invoice.nationalId } : {}) };
  return { data, invoice };
}

/** A short label when the customer left the title empty: the district and province. */
export function defaultAddressTitle(data: AddressData): string {
  return `${data.district} / ${data.city}`.slice(0, 40);
}

async function clearDefault(tx: Tx, userId: string, kind: "shipping" | "billing", exceptId: number) {
  const column = kind === "shipping" ? a.isDefaultShipping : a.isDefaultBilling;
  await tx
    .update(a)
    .set(kind === "shipping" ? { isDefaultShipping: false } : { isDefaultBilling: false })
    .where(and(eq(a.userId, userId), eq(column, true), ne(a.id, exceptId)));
}

/** Locks the user's address rows (serializes concurrent saves of one customer). */
async function lockAddresses(tx: Tx, userId: string) {
  return tx.select({ id: a.id, isDefaultShipping: a.isDefaultShipping, isDefaultBilling: a.isDefaultBilling }).from(a).where(eq(a.userId, userId)).orderBy(asc(a.id)).for("update");
}

/**
 * Creates (no `id`) or updates one of the user's addresses. The first address becomes the default for
 * delivery and invoices; a new default clears the previous one. Throws AccountError "not_found" for
 * an id that is not the user's, "limit" beyond MAX_ADDRESSES.
 */
export async function saveAddress(tx: Tx, userId: string, input: AddressInput, now = new Date()): Promise<SavedAddress> {
  const rows = await lockAddresses(tx, userId);
  const { data, invoice } = addressRecord(input);
  const title = input.title?.trim() || defaultAddressTitle(data);
  let id: number;
  if (input.id != null) {
    const current = rows.find((r) => r.id === input.id);
    if (!current) throw new AccountError("not_found");
    const onlyOne = rows.length === 1;
    // The only address stays the default; a default is never "unset" by itself (pick another instead).
    const isDefaultShipping = onlyOne || input.isDefaultShipping || current.isDefaultShipping;
    const isDefaultBilling = onlyOne || input.isDefaultBilling || current.isDefaultBilling;
    await tx.update(a).set({ title, data, invoice, isDefaultShipping, isDefaultBilling, updatedAt: now }).where(and(eq(a.id, input.id), eq(a.userId, userId)));
    id = input.id;
    if (isDefaultShipping && !current.isDefaultShipping) await clearDefault(tx, userId, "shipping", id);
    if (isDefaultBilling && !current.isDefaultBilling) await clearDefault(tx, userId, "billing", id);
  } else {
    if (rows.length >= MAX_ADDRESSES) throw new AccountError("limit");
    const first = rows.length === 0;
    const isDefaultShipping = first || input.isDefaultShipping;
    const isDefaultBilling = first || input.isDefaultBilling;
    const [created] = await tx
      .insert(a)
      .values({ userId, title, data, invoice, isDefaultShipping, isDefaultBilling, createdAt: now, updatedAt: now })
      .returning({ id: a.id });
    id = created.id;
    if (isDefaultShipping) await clearDefault(tx, userId, "shipping", id);
    if (isDefaultBilling) await clearDefault(tx, userId, "billing", id);
  }
  const saved = await getAddress(tx, userId, id);
  if (!saved) throw new AccountError("not_found");
  return saved;
}

/** Deletes one of the user's addresses; a removed default passes to the most recently changed one. */
export async function deleteAddress(tx: Tx, userId: string, id: number): Promise<void> {
  await lockAddresses(tx, userId);
  const [removed] = await tx
    .delete(a)
    .where(and(eq(a.id, id), eq(a.userId, userId)))
    .returning({ isDefaultShipping: a.isDefaultShipping, isDefaultBilling: a.isDefaultBilling });
  if (!removed) throw new AccountError("not_found");
  if (!removed.isDefaultShipping && !removed.isDefaultBilling) return;
  const [next] = await tx.select({ id: a.id }).from(a).where(eq(a.userId, userId)).orderBy(desc(a.updatedAt), desc(a.id)).limit(1);
  if (!next) return;
  await tx
    .update(a)
    .set({ ...(removed.isDefaultShipping ? { isDefaultShipping: true } : {}), ...(removed.isDefaultBilling ? { isDefaultBilling: true } : {}) })
    .where(eq(a.id, next.id));
}

/** Makes one of the user's addresses the default for delivery or invoices. */
export async function setDefaultAddress(tx: Tx, userId: string, id: number, kind: "shipping" | "billing", now = new Date()): Promise<void> {
  await lockAddresses(tx, userId);
  const [row] = await tx
    .update(a)
    .set(kind === "shipping" ? { isDefaultShipping: true, updatedAt: now } : { isDefaultBilling: true, updatedAt: now })
    .where(and(eq(a.id, id), eq(a.userId, userId)))
    .returning({ id: a.id });
  if (!row) throw new AccountError("not_found");
  await clearDefault(tx, userId, kind, id);
}

const norm = (v: string | undefined | null) => (v ?? "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");

/** Same delivery address (name, phone, province, district, neighbourhood, line, postal code). */
export function sameAddress(x: AddressData, y: AddressData): boolean {
  return (
    norm(x.fullName) === norm(y.fullName) &&
    norm(x.phone) === norm(y.phone) &&
    norm(x.city) === norm(y.city) &&
    norm(x.district) === norm(y.district) &&
    norm(x.neighbourhood) === norm(y.neighbourhood) &&
    norm(x.line1) === norm(y.line1) &&
    norm(x.postalCode) === norm(y.postalCode)
  );
}

/**
 * "Bu adresi kaydet" at checkout: stores the order's delivery address (with its invoice data) unless
 * the user already has the same address or is at MAX_ADDRESSES. Returns the new id, or null.
 */
export async function saveAddressFromOrder(
  tx: Tx,
  userId: string,
  order: { shippingAddress: AddressData; invoice: InvoiceData },
  now = new Date(),
): Promise<number | null> {
  const rows = await lockAddresses(tx, userId);
  if (rows.length >= MAX_ADDRESSES) return null;
  const existing = await tx.select({ data: a.data }).from(a).where(eq(a.userId, userId));
  if (existing.some((r) => sameAddress(r.data, order.shippingAddress))) return null;
  const inv = order.invoice;
  // The invoice data belongs to this address only when the invoice went to the same address.
  const sameBilling = !inv.address || sameAddress(inv.address, order.shippingAddress);
  const invoice: InvoiceData | null = !sameBilling
    ? null
    : inv.type === "corporate"
      ? { type: "corporate", companyName: inv.companyName, taxOffice: inv.taxOffice, taxNumber: inv.taxNumber, eInvoice: inv.eInvoice ?? false }
      : { type: "individual", ...(inv.nationalId ? { nationalId: inv.nationalId } : {}) };
  const data: AddressData = { ...order.shippingAddress, country: order.shippingAddress.country ?? "TR" };
  const first = rows.length === 0;
  const [created] = await tx
    .insert(a)
    .values({ userId, title: defaultAddressTitle(data), data, invoice, isDefaultShipping: first, isDefaultBilling: first && invoice !== null, createdAt: now, updatedAt: now })
    .returning({ id: a.id });
  return created.id;
}

/** How many addresses the user has. */
export async function countAddresses(executor: Tx, userId: string): Promise<number> {
  const [row] = await executor.select({ n: count() }).from(a).where(eq(a.userId, userId));
  return row?.n ?? 0;
}
