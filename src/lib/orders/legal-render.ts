// Order-specific pre-information form and distance sales agreement (Mesafeli Sözleşmeler
// Yönetmeliği). Pure: the checkout preview modal and placeOrder (stored snapshot) call the same
// functions, so what the buyer reads is exactly what gets stored. Output is sanitized HTML.
import type { AddressData, InvoiceData } from "@/db/schema/commerce";
import type { LocalizedText } from "@/db/schema/common";
import { intlLocale, localeDir, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { localize } from "@/i18n/localize";
import { defaultMessages, type Messages } from "@/i18n/messages";
import { formatPrice } from "@/lib/pricing/money";
import type { Settings } from "@/lib/settings/types";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import { maskId } from "@/components/order/format";
import type { LoadedCart } from "@/lib/cart/load";
import type { CartTotals, PaymentMethod } from "@/lib/cart/types";
import { paymentMethodLabel, summaryRows, type SummaryInput } from "@/lib/cart/view";
import { bankTransferDeadline, normalizePaymentDays } from "./bank-transfer-deadline";

export const LEGAL_KEYS = { preInformation: "pre_information", distanceSales: "distance_sales" } as const;

export type LegalDocumentInput = { key: string; version: string; title: LocalizedText; body: LocalizedText } | null;

/** Buyer data; every field may be missing (live preview while the form is being filled). */
export type LegalBuyer = {
  email?: string | null;
  phone?: string | null;
  shippingAddress?: Partial<AddressData> | null;
  invoice?: (Partial<Omit<InvoiceData, "address">> & { address?: Partial<AddressData> | null; sameAsShipping?: boolean }) | null;
};

export type LegalItem = {
  /** Product name with its type, e.g. "Okyanus — Duş Jeli" (the goods' essential features, MSY m.5(1)(a)). */
  name: string;
  variant: string;
  quantity: number;
  /** VAT-included unit price and unit × quantity (before order-level discounts, which the totals show). */
  unitPrice: number;
  lineSubtotal: number;
  vatRate: number;
  isSample: boolean;
};

export type LegalRenderInput = {
  locale: Locale;
  messages?: Messages;
  seller: Pick<Settings<"general">, "legalName" | "siteName" | "phone" | "email" | "address"> &
    Partial<Pick<Settings<"general">, "mersisNo" | "taxOffice" | "taxNumber" | "kep">>;
  estimatedDays: { min: number; max: number };
  buyer: LegalBuyer;
  items: LegalItem[];
  totals: SummaryInput;
  paymentMethod: PaymentMethod | null;
  /** null before the order exists (preview). */
  orderNumber: string | null;
  date: Date;
  /** The current legal document from the DB; its body follows the order block. */
  document: LegalDocumentInput;
  /**
   * SR-2: settings.payments.bankTransfer.paymentDays. With a havale order the block states the payment deadline
   * (end of the last day in Türkiye time, counted from `date`). Omitted = no deadline line. FIX F9: the line states
   * only the date and the day count (checkout.legal.bankTransferTerm); what happens after it (e.g. cancellation) is
   * left to the lawyer-approved body, so the order block adds no contractual term of its own. The exact line is
   * listed for the lawyer in docs/YAYINA-ALMA-REHBERI.md.
   */
  bankTransferDays?: number | null;
};

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const clean = (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, 300) : "");

export function formatAddressLine(address: Partial<AddressData> | null | undefined): string {
  if (!address) return "";
  const area = [clean(address.district), clean(address.city)].filter(Boolean).join(" / ");
  return [clean(address.line1), clean(address.neighbourhood), area, clean(address.postalCode)].filter(Boolean).join(", ");
}

function dateLabel(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(date);
}

function dayLabel(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(date);
}

function orderBlock(input: LegalRenderInput, heading: string): string {
  const { locale } = input;
  const m = input.messages ?? defaultMessages[locale];
  const L = m.checkout.legal;
  const dash = L.missing;
  // In RTL text, Latin values (phone numbers, addresses, company names) are wrapped in Unicode
  // first-strong isolates (FSI…PDI) so their own direction is kept: otherwise "0352 353 30 70" reads
  // "70 30 353 0352" in Arabic. Text characters, so they survive the sanitizer and the stored snapshot.
  const isolate = localeDir(locale) === "rtl" ? (s: string) => `⁨${s}⁩` : (s: string) => s;
  const v = (value: unknown) => isolate(escapeHtml(clean(value) || dash));
  const li = (label: string, value: unknown) => `<li><strong>${escapeHtml(label)}:</strong> ${v(value)}</li>`;
  const seller = input.seller;
  const sellerAddress = [seller.address.line, `${seller.address.district} / ${seller.address.city}`, seller.address.country].filter(Boolean).join(", ");
  const ship = input.buyer.shippingAddress ?? null;
  const inv = input.buyer.invoice ?? null;
  const invoiceAddress = inv?.sameAsShipping === false ? inv.address : ship;

  // ID numbers are masked to the last two digits (like the order page's details card): the texts are
  // shown on the bearer-link order page; the full value stays in orders.invoice for the invoice.
  const invoiceLines =
    inv?.type === "corporate"
      ? [li(L.invoice, L.invoiceCorporate), li(L.companyName, inv.companyName), li(L.taxOffice, inv.taxOffice), li(L.taxNumber, maskId(clean(inv.taxNumber)))]
      : [
          li(L.invoice, L.invoiceIndividual),
          li(L.fullName, inv?.fullName || ship?.fullName),
          ...(inv?.nationalId ? [li(L.nationalId, maskId(clean(inv.nationalId)))] : []),
        ];

  const items = input.items.map((item) =>
    item.isSample
      ? `<li>${escapeHtml(format(L.sampleLine, { name: item.name, quantity: item.quantity }, locale))}</li>`
      : `<li>${escapeHtml(
          format(
            L.productLine,
            {
              name: item.name,
              variant: item.variant || dash,
              quantity: item.quantity,
              total: formatPrice(item.lineSubtotal, locale),
              unit: formatPrice(item.unitPrice, locale),
              vat: item.vatRate,
            },
            locale,
          ),
        )}</li>`,
  );

  const rows = summaryRows(input.totals, locale, m).map((row) =>
    row.kind === "total"
      ? `<li><strong>${escapeHtml(row.label)}: ${escapeHtml(row.amountLabel)}</strong></li>`
      : `<li>${escapeHtml(row.label)}: ${escapeHtml(row.amountLabel)}</li>`,
  );

  return [
    `<h2>${escapeHtml(heading)}</h2>`,
    `<h3>${escapeHtml(L.orderBlockTitle)}</h3>`,
    "<ul>",
    li(L.orderNumber, input.orderNumber ?? L.orderNumberPending),
    li(L.orderDate, dateLabel(input.date, locale)),
    "</ul>",
    `<h3>${escapeHtml(L.seller)}</h3>`,
    "<ul>",
    li(L.sellerName, seller.legalName),
    li(L.address, sellerAddress),
    li(L.phone, seller.phone),
    ...(seller.email ? [li(L.email, seller.email)] : []),
    ...(seller.kep ? [li(L.kep, seller.kep)] : []),
    ...(seller.mersisNo ? [li(L.mersisNo, seller.mersisNo)] : []),
    ...(seller.taxOffice ? [li(L.taxOffice, seller.taxOffice)] : []),
    ...(seller.taxNumber ? [li(L.sellerTaxNumber, seller.taxNumber)] : []),
    "</ul>",
    `<h3>${escapeHtml(L.buyer)}</h3>`,
    "<ul>",
    li(L.fullName, ship?.fullName),
    li(L.email, input.buyer.email),
    li(L.phone, input.buyer.phone ?? ship?.phone),
    li(L.delivery, formatAddressLine(ship)),
    "</ul>",
    `<h3>${escapeHtml(L.invoice)}</h3>`,
    "<ul>",
    ...invoiceLines,
    li(L.invoiceAddress, formatAddressLine(invoiceAddress)),
    "</ul>",
    `<h3>${escapeHtml(L.products)}</h3>`,
    `<ul>${items.join("")}</ul>`,
    `<h3>${escapeHtml(L.totals)}</h3>`,
    `<ul>${rows.join("")}</ul>`,
    `<p>${escapeHtml(L.vatIncluded)}</p>`,
    `<p><strong>${escapeHtml(L.paymentMethod)}:</strong> ${escapeHtml(input.paymentMethod ? paymentMethodLabel(input.paymentMethod, m) : L.notSelected)}</p>`,
    ...(input.paymentMethod === "bank_transfer" && input.bankTransferDays
      ? [
          `<p>${escapeHtml(
            format(
              L.bankTransferTerm,
              { date: isolate(dayLabel(bankTransferDeadline(input.date, input.bankTransferDays), locale)), days: normalizePaymentDays(input.bankTransferDays) },
              locale,
            ),
          )}</p>`,
        ]
      : []),
    `<h3>${escapeHtml(L.deliveryTime)}</h3>`,
    `<p>${escapeHtml(format(L.deliveryTimeText, { min: input.estimatedDays.min, max: input.estimatedDays.max }, locale))}</p>`,
    `<h3>${escapeHtml(L.withdrawal)}</h3>`,
    `<p>${escapeHtml(L.withdrawalText)}</p>`,
  ].join("\n");
}

function render(input: LegalRenderInput, fallbackTitle: string): string {
  const title = localize(input.document?.title, input.locale) || fallbackTitle;
  const body = input.document ? localize(input.document.body, input.locale) : "";
  // A translated body is a courtesy; the Turkish text is the binding one. It is shown (and stored)
  // after the translation, so an English or Arabic buyer accepts the full contract, not a summary.
  const own = input.locale !== "tr" ? input.document?.body[input.locale]?.trim() : "";
  const turkish = own ? input.document?.body.tr?.trim() : "";
  const L = (input.messages ?? defaultMessages[input.locale]).checkout.legal;
  const binding = turkish ? `\n<hr>\n<h2>${escapeHtml(L.bindingTurkishTitle)}</h2>\n<p>${escapeHtml(L.bindingTurkishNote)}</p>\n${turkish}` : "";
  return sanitizeHtml(`${orderBlock(input, title)}\n<hr>\n${body}${binding}`);
}

/** Ön Bilgilendirme Formu: order block + the current pre_information document body. */
export function renderPreInformation(input: LegalRenderInput): string {
  const m = input.messages ?? defaultMessages[input.locale];
  return render(input, m.checkout.preInformation);
}

/** Mesafeli Satış Sözleşmesi: order block + the current distance_sales document body. */
export function renderDistanceSales(input: LegalRenderInput): string {
  const m = input.messages ?? defaultMessages[input.locale];
  return render(input, m.checkout.distanceSales);
}

/** Legal items + totals from engine output (preview and placeOrder use this same mapping). */
export function legalOrderData(totals: CartTotals, loaded: LoadedCart, locale: Locale, paymentMethod: PaymentMethod | null) {
  const byLine = new Map(loaded.lines.map((l) => [l.lineId, l]));
  const method = paymentMethod ? totals.paymentMethods.find((m) => m.method === paymentMethod) : undefined;
  const t = method?.totals ?? totals;
  const items: LegalItem[] = totals.lines
    .filter((l) => l.included)
    .map((l) => {
      const d = byLine.get(l.lineId)?.display;
      const name = localize(d?.name, locale);
      const type = localize(d?.subtitle, locale);
      return {
        name: type ? `${name} — ${type}` : name,
        variant: (d?.variantLabels ?? []).map((x) => localize(x, locale)).join(" · "),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineSubtotal: l.lineSubtotal,
        vatRate: l.vatRate,
        isSample: l.isSample,
      };
    });
  const summary: SummaryInput = {
    subtotal: t.subtotal,
    couponDiscount: t.discounts.coupon,
    couponCode: totals.coupon?.status === "applied" ? totals.coupon.code : null,
    bankTransferDiscount: t.discounts.bankTransfer,
    bankTransferPercent: method?.discountPercent ?? 0,
    shippingFlat: t.shipping.flat,
    shippingHeavy: t.shipping.heavy,
    heavyKg: t.shipping.heavyKg,
    freeShipping: t.shipping.free,
    hasShipment: items.length > 0,
    paymentFee: t.paymentFee,
    vatTotal: t.vatTotal,
    grandTotal: t.grandTotal,
  };
  return { items, totals: summary };
}

/** Defensive reader for half-filled preview input (never throws, never validates). */
export function legalBuyerFromUnknown(value: unknown): LegalBuyer {
  const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
  const s = (x: unknown) => (typeof x === "string" ? x.slice(0, 300) : undefined);
  const root = obj(value);
  const contact = obj(root.contact);
  const addr = (x: unknown): Partial<AddressData> => {
    const a = obj(x);
    return { fullName: s(a.fullName), city: s(a.city), district: s(a.district), neighbourhood: s(a.neighbourhood), line1: s(a.line1), postalCode: s(a.postalCode) };
  };
  const inv = obj(root.invoice);
  const same = inv.sameAsShipping === undefined ? true : inv.sameAsShipping === true || inv.sameAsShipping === "on" || inv.sameAsShipping === "true";
  return {
    email: s(contact.email),
    phone: s(contact.phone),
    shippingAddress: addr(root.shippingAddress),
    invoice: {
      type: inv.type === "corporate" ? "corporate" : "individual",
      fullName: s(inv.fullName),
      nationalId: s(inv.nationalId),
      companyName: s(inv.companyName),
      taxOffice: s(inv.taxOffice),
      taxNumber: s(inv.taxNumber),
      sameAsShipping: same,
      address: same ? null : addr(inv.address),
    },
  };
}
