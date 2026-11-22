// Turkish labels and small formatters for the panel order screens. Pure (type-only imports), so
// both server pages and client components can use it.
import type { AddressData, InvoiceData, OrderStatus, PaymentMethod, PaymentProvider } from "@/db/schema/commerce";
import type { OrderAction } from "@/lib/orders/status-machine";
import type { Tone } from "@/components/panel/labels";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "Kredi / banka kartı",
  bank_transfer: "Havale / EFT",
  cash_on_delivery: "Kapıda ödeme",
  deferred: "Vadeli ödeme",
};

/** Short form for table cells and badges. */
export const PAYMENT_METHOD_SHORT: Record<PaymentMethod, string> = {
  card: "Kart",
  bank_transfer: "Havale/EFT",
  cash_on_delivery: "Kapıda ödeme",
  deferred: "Vadeli",
};

export const PAYMENT_PROVIDER_LABELS: Record<PaymentProvider, string> = {
  iyzico: "iyzico",
  paytr: "PayTR",
  manual: "Manuel onay",
  simulator: "Test simülatörü",
};

export const PAYMENT_RECORD_STATUS: Record<"initiated" | "succeeded" | "failed" | "refunded", { label: string; tone: Tone }> = {
  initiated: { label: "Başlatıldı", tone: "warning" },
  succeeded: { label: "Başarılı", tone: "success" },
  failed: { label: "Başarısız", tone: "danger" },
  refunded: { label: "İade edildi", tone: "neutral" },
};

export const ORDER_ACTION_LABELS: Record<OrderAction, string> = {
  mark_paid: "Ödeme alındı",
  start_processing: "Hazırlanıyor",
  ship: "Kargoya ver",
  deliver: "Teslim edildi",
  cancel: "İptal et",
  mark_refunded: "İade edildi",
  add_note: "Not ekle",
};

export const LEGAL_DOC_LABELS: Record<string, string> = {
  pre_information: "Ön Bilgilendirme Formu",
  distance_sales: "Mesafeli Satış Sözleşmesi",
};

export const TIMELINE_STEP_LABELS: Record<string, string> = {
  placed: "Sipariş alındı",
  paid: "Ödendi",
  processing: "Hazırlanıyor",
  shipped: "Kargoda",
  delivered: "Teslim edildi",
  cancelled: "İptal edildi",
  refunded: "İade edildi",
};

// ---------------------------------------------------------------------------------------------
// List tabs (URL values are Turkish, like the product list's `durum`)

export type OrderTabKey = "all" | "pending" | "transfer" | "prepare" | "shipped" | "delivered" | "closed";

export type OrderTab = {
  key: OrderTabKey;
  /** `?durum=` value; null for "all". */
  param: string | null;
  label: string;
  /** Statuses in the tab; null = every status. */
  statuses: readonly OrderStatus[] | null;
  /** Needs staff action: the count is highlighted. */
  attention?: boolean;
};

export const ORDER_TABS: readonly OrderTab[] = [
  { key: "all", param: null, label: "Tümü", statuses: null },
  { key: "pending", param: "odeme-bekleyen", label: "Ödeme bekleyen", statuses: ["pending_payment"] },
  { key: "transfer", param: "havale-bekleyen", label: "Havale bekleyen", statuses: ["awaiting_transfer"], attention: true },
  { key: "prepare", param: "hazirlanacak", label: "Hazırlanacak", statuses: ["paid", "processing"], attention: true },
  { key: "shipped", param: "kargoda", label: "Kargoda", statuses: ["shipped"] },
  { key: "delivered", param: "teslim-edildi", label: "Teslim edildi", statuses: ["delivered"] },
  { key: "closed", param: "iptal-iade", label: "İptal / İade", statuses: ["cancelled", "refunded"] },
];

export function orderTabFromParam(value: unknown): OrderTab {
  return ORDER_TABS.find((t) => t.param !== null && t.param === value) ?? ORDER_TABS[0];
}

/** Statuses that wait for staff: havale to confirm, orders to prepare and ship. */
export const NEEDS_ACTION_STATUSES: readonly OrderStatus[] = ["awaiting_transfer", "paid", "processing"];

/** `?sure=doldu`: only havale orders past their payment deadline (SR-2; always with the "Havale bekleyen" tab). */
export const OVERDUE_PARAM = { name: "sure", value: "doldu" } as const;

/**
 * PayTR-fix R-UX8: `?uyari=…` keeps the orders that carry one of the dashboard's payment warnings (src/lib/payments/
 * alerts.ts paymentEventAlertWhere, always with the "Tümü" tab). Values are Turkish like the other URL values.
 */
export type OrderAlertKey = "testOnLive" | "successAfterFailure";
export const ORDER_ALERT_PARAM = "uyari";
export const ORDER_ALERTS: Record<OrderAlertKey, { param: string; label: string }> = {
  testOnLive: { param: "test-odeme", label: "Canlı siparişe PayTR test ödemesi gelen siparişler" },
  successAfterFailure: { param: "basarisiz-sonra-basarili", label: "Başarısız ödemeden sonra başarılı bildirim gelen siparişler" },
};

export function orderAlertFromParam(value: unknown): OrderAlertKey | null {
  return (Object.keys(ORDER_ALERTS) as OrderAlertKey[]).find((k) => ORDER_ALERTS[k].param === value) ?? null;
}

/** List URL with the given filters (empty values dropped, page 1 omitted). */
export function ordersListHref({
  tab,
  q,
  page,
  overdue,
  alert,
}: {
  tab?: OrderTab | null;
  q?: string | null;
  page?: number | null;
  overdue?: boolean;
  alert?: OrderAlertKey | null;
}): string {
  const params = new URLSearchParams();
  if (tab?.param) params.set("durum", tab.param);
  if (overdue) params.set(OVERDUE_PARAM.name, OVERDUE_PARAM.value);
  if (alert) params.set(ORDER_ALERT_PARAM, ORDER_ALERTS[alert].param);
  if (q?.trim()) params.set("ara", q.trim());
  if (page && page > 1) params.set("sayfa", String(page));
  const query = params.toString();
  return query ? `/panel/siparisler?${query}` : "/panel/siparisler";
}

// ---------------------------------------------------------------------------------------------
// Contact and address formatting

/** "+905321234567" → "+90 532 123 45 67"; anything else is returned as stored. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const m = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone.replace(/\s+/g, ""));
  return m ? `+90 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

/** tel: target (digits and a leading +). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** wa.me link for Turkish mobile numbers (+905…), else null. */
export function whatsappHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (/^905\d{9}$/.test(digits)) return `https://wa.me/${digits}`;
  if (/^05\d{9}$/.test(digits)) return `https://wa.me/9${digits}`;
  return null;
}

/** Address as display lines: name, street, "PK İlçe / İl", country when not TR. */
export function addressLines(a: Partial<AddressData> | null | undefined): string[] {
  if (!a) return [];
  const street = [a.neighbourhood, a.line1].map((x) => x?.trim()).filter(Boolean).join(", ");
  const place = [a.postalCode?.trim(), [a.district?.trim(), a.city?.trim()].filter(Boolean).join(" / ")].filter(Boolean).join(" ");
  const country = a.country && a.country.toUpperCase() !== "TR" ? a.country : "";
  return [a.fullName?.trim() ?? "", street, place, country].filter(Boolean);
}

/** Plain-text address for the clipboard (cargo label software, e-mails). */
export function addressText(a: Partial<AddressData> | null | undefined, phone?: string | null): string {
  const lines = addressLines(a);
  const tel = formatPhone(phone ?? a?.phone);
  return [...lines, tel ? `Tel: ${tel}` : ""].filter(Boolean).join("\n");
}

const sameText = (x: string | undefined, y: string | undefined) => (x ?? "").trim().toLocaleLowerCase("tr-TR") === (y ?? "").trim().toLocaleLowerCase("tr-TR");

/** True when the billing address is the delivery address (placeOrder stores a copy when "same"). */
export function isSameAddress(a: Partial<AddressData> | null | undefined, b: Partial<AddressData> | null | undefined): boolean {
  if (!a || !b) return !a;
  return (["fullName", "city", "district", "neighbourhood", "line1", "postalCode"] as const).every((k) => sameText(a[k], b[k]));
}

/** Invoice details as plain text for the accounting / e-Arşiv software. */
export function invoiceText(invoice: InvoiceData, shipping: AddressData): string {
  const lines: string[] = [];
  if (invoice.type === "corporate") {
    lines.push(`Firma: ${invoice.companyName ?? ""}`);
    lines.push(`Vergi dairesi: ${invoice.taxOffice ?? ""}`);
    lines.push(`VKN: ${invoice.taxNumber ?? ""}`);
    lines.push(`e-Fatura mükellefi: ${invoice.eInvoice ? "Evet" : "Hayır"}`);
  } else {
    lines.push(`Ad soyad: ${invoice.fullName ?? shipping.fullName}`);
    lines.push(`T.C. kimlik no: ${invoice.nationalId || "Belirtilmedi"}`);
  }
  const address = invoice.address ?? shipping;
  const addr = addressLines(address);
  if (addr.length) lines.push(`Adres: ${addr.join(", ")}`);
  return lines.join("\n");
}
