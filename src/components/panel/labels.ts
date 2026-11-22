// Turkish labels and formatters for the panel (Turkish-only UI).
import type { ProductStatus, ProductType } from "@/db/schema/catalog";
import type { CompanyStatus, OrderStatus, RequestStatus } from "@/db/schema/commerce";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "gold";

export const ROLE_LABELS: Record<string, string> = {
  admin: "Yönetici",
  editor: "Editör",
  staff: "Personel",
  customer: "Müşteri",
};

export const PRODUCT_STATUS: Record<ProductStatus, { label: string; tone: Tone }> = {
  active: { label: "Yayında", tone: "success" },
  draft: { label: "Taslak", tone: "warning" },
  archived: { label: "Arşivde", tone: "neutral" },
};

export const PRODUCT_TYPE: Record<ProductType, string> = {
  standard: "Ürün",
  bundle: "Set",
  sample: "Numune",
};

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  pending_payment: { label: "Ödeme bekleniyor", tone: "warning" },
  awaiting_transfer: { label: "Havale bekleniyor", tone: "warning" },
  paid: { label: "Ödendi", tone: "info" },
  processing: { label: "Hazırlanıyor", tone: "info" },
  shipped: { label: "Kargoda", tone: "gold" },
  delivered: { label: "Teslim edildi", tone: "success" },
  cancelled: { label: "İptal", tone: "danger" },
  refunded: { label: "İade edildi", tone: "neutral" },
};

export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: Tone }> = {
  new: { label: "Yeni", tone: "gold" },
  in_review: { label: "İnceleniyor", tone: "info" },
  approved: { label: "Onaylandı", tone: "success" },
  quoted: { label: "Teklif verildi", tone: "info" },
  shipped: { label: "Gönderildi", tone: "success" },
  won: { label: "Kazanıldı", tone: "success" },
  rejected: { label: "Reddedildi", tone: "danger" },
};

export const COMPANY_STATUS: Record<CompanyStatus, { label: string; tone: Tone }> = {
  pending: { label: "Onay bekliyor", tone: "warning" },
  approved: { label: "Onaylı", tone: "success" },
  rejected: { label: "Reddedildi", tone: "danger" },
};

const numberFormat = new Intl.NumberFormat("tr-TR");
const dateTimeFormat = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});
const dateFormat = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Istanbul",
});

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatDateTime(value: Date | string): string {
  return dateTimeFormat.format(typeof value === "string" ? new Date(value) : value);
}

export function formatDate(value: Date | string): string {
  return dateFormat.format(typeof value === "string" ? new Date(value) : value);
}

/** Volume in ml shown the way the catalog writes it: 500 ml, 5 L, 20 L. */
export function formatVolume(ml: number | null): string {
  if (ml == null) return "—";
  return ml >= 1000 ? `${formatNumber(ml / 1000)} L` : `${formatNumber(ml)} ml`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "");
  return letters.toLocaleUpperCase("tr-TR") || "?";
}
