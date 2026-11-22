// Turkish labels for campaigns, coupons and the newsletter (panel). Pure.
import type { CouponType } from "@/db/schema/commerce";
import type { WheelBoundVia } from "@/db/schema/wheel";
import { formatDateTime } from "@/components/panel/labels";
import type { Tone } from "@/components/panel/labels";
import type { ScheduleStatus, WheelCouponStatus } from "@/lib/panel/marketing/status";
import { formatPrice } from "@/lib/pricing/money";

export const CAMPAIGN_STATUS: Record<Exclude<ScheduleStatus, "exhausted">, { label: string; tone: Tone }> = {
  live: { label: "Yayında", tone: "success" },
  scheduled: { label: "Planlandı", tone: "info" },
  ended: { label: "Bitti", tone: "neutral" },
  inactive: { label: "Durduruldu", tone: "warning" },
};

export const COUPON_STATUS: Record<ScheduleStatus, { label: string; tone: Tone }> = {
  live: { label: "Geçerli", tone: "success" },
  scheduled: { label: "Planlandı", tone: "info" },
  ended: { label: "Süresi doldu", tone: "neutral" },
  exhausted: { label: "Limit doldu", tone: "gold" },
  inactive: { label: "Pasif", tone: "warning" },
};

export const COUPON_TYPE: Record<CouponType, string> = {
  percent: "Yüzde indirim",
  fixed: "Tutar indirimi",
  free_shipping: "Ücretsiz kargo",
};

/** "%15", "50,00 ₺" or "Ücretsiz kargo". */
export function couponValueLabel(type: CouponType, value: number): string {
  if (type === "percent") return `%${value}`;
  if (type === "fixed") return formatPrice(value, "tr");
  return "Ücretsiz kargo";
}

/** "Hemen – süresiz", "9 Kas 2026 10:00 – 16 Kas 2026 23:59" (Istanbul time). */
export function windowLabel(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return "Süresiz";
  const start = startsAt ? formatDateTime(startsAt) : "Hemen";
  const end = endsAt ? formatDateTime(endsAt) : "süresiz";
  return `${start} – ${end}`;
}

/** Day 6: a gift wheel prize coupon (read-only page /panel/kuponlar/<id>). */
export const WHEEL_COUPON_STATUS: Record<WheelCouponStatus, { label: string; tone: Tone }> = {
  active: { label: "Aktif", tone: "success" },
  used: { label: "Kullanıldı", tone: "gold" },
  expired: { label: "Süresi doldu", tone: "neutral" },
  inactive: { label: "Pasif", tone: "warning" },
};

export const WHEEL_BOUND_VIA: Record<WheelBoundVia, string> = {
  register: "Üye olarak",
  sign_in: "Giriş yaparak",
  signed_in: "Hesabı açıkken",
};

/**
 * "a•••@example.com": the first character of the local part, the domain in full. Editors see winners
 * masked, admins in full (contract §1.1 Kazananlar).
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

export const SUBSCRIBER_STATUS: Record<"pending" | "active" | "unsubscribed", { label: string; tone: Tone }> = {
  pending: { label: "Onay bekliyor", tone: "warning" },
  active: { label: "Aktif", tone: "success" },
  unsubscribed: { label: "Ayrıldı", tone: "neutral" },
};

export const SUBSCRIBER_SOURCE: Record<string, string> = {
  footer: "Alt bilgi",
  section: "Sayfa bölümü",
  popup: "Açılır pencere",
  checkout: "Ödeme",
  register: "Üyelik",
  profile: "Hesap profili",
  wheel: "Hediye çarkı",
};

export const SUBSCRIBER_LOCALE: Record<string, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" };
