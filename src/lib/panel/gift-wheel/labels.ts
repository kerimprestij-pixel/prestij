// Turkish labels, tones and small formatters of the Hediye Çarkı panel pages (contract §1.1 "Panel").
// Pure (no DB, no React, no Next): shared by the server pages, the client editor, the CSV export and the
// unit tests. The panel is Turkish-only; storefront texts live in messages (`wheel.*`) and the settings.
import type { Tone } from "@/components/panel/labels";
import type { WheelBoundVia } from "@/db/schema/wheel";
import { formatPrice } from "@/lib/pricing/money";
import { WHEEL_PRIZE_TYPES, WHEEL_TONES, type WheelAudience, type WheelPrizeType, type WheelTone } from "@/lib/settings/types";
import { suggestSliceLabel } from "./slices";

// ---------------------------------------------------------------------------------------------------
// Settings vocabulary

export const PRIZE_TYPE_LABELS: Record<WheelPrizeType, string> = {
  percent: "Yüzde indirim",
  fixed: "Tutar indirimi (TL)",
  free_shipping: "Ücretsiz kargo",
};

export const PRIZE_TYPE_OPTIONS = WHEEL_PRIZE_TYPES.map((value) => ({ value, label: PRIZE_TYPE_LABELS[value] }));

/** Slice colours as the owner sees them (the swatches use the same theme tokens as the wheel). */
export const TONE_LABELS: Record<WheelTone, string> = {
  brand: "Lacivert",
  gold: "Altın",
  cream: "Krem",
  ink: "Gece mavisi",
};

export const TONE_OPTIONS = WHEEL_TONES.map((value) => ({ value, label: TONE_LABELS[value] }));

export const AUDIENCE_LABELS: Record<WheelAudience, { label: string; description: string }> = {
  new_customers: {
    label: "Yeni müşteriler (önerilen)",
    description:
      "Misafir ziyaretçiler ve henüz sipariş vermemiş üyeler. Çark üyeliği ve ilk siparişi teşvik eder; daha önce sipariş vermiş bir hesap hediye alamaz.",
  },
  everyone: {
    label: "Tüm müşteriler",
    description: "Daha önce sipariş vermiş üyeler de çarkı çevirebilir. Her hesap her turda yine yalnızca bir hediye alır.",
  },
};

/** How a spin got its account (wheel_spins.bound_via). */
export const BOUND_VIA_LABELS: Record<WheelBoundVia, string> = {
  register: "Çarktan sonra üye oldu",
  sign_in: "Çarktan sonra giriş yaptı",
  signed_in: "Üyeyken çevirdi",
};

// ---------------------------------------------------------------------------------------------------
// Live state of the wheel (status line of the overview and the settings page)

export type WheelScheduleStatus = "off" | "scheduled" | "live" | "ended";

export const WHEEL_SCHEDULE_STATUS: Record<WheelScheduleStatus, { label: string; tone: Tone; description: string }> = {
  off: { label: "Kapalı", tone: "neutral", description: "Çark sitede görünmüyor." },
  scheduled: { label: "Planlandı", tone: "info", description: "Çark başlangıç zamanında kendiliğinden açılacak." },
  live: { label: "Yayında", tone: "success", description: "Çark sitede, uygun ziyaretçilere gösteriliyor." },
  ended: { label: "Bitti", tone: "warning", description: "Bitiş zamanı geçti; çark artık gösterilmiyor." },
};

/** Off → ended → scheduled → live, like the storefront's check (live while startsAt ≤ now < endsAt). */
export function wheelScheduleStatus(
  config: { enabled: boolean; startsAt: string | null; endsAt: string | null },
  now: number,
): WheelScheduleStatus {
  if (!config.enabled) return "off";
  const end = config.endsAt ? Date.parse(config.endsAt) : Number.NaN;
  if (Number.isFinite(end) && now >= end) return "ended";
  const start = config.startsAt ? Date.parse(config.startsAt) : Number.NaN;
  if (Number.isFinite(start) && now < start) return "scheduled";
  return "live";
}

// ---------------------------------------------------------------------------------------------------
// Winners (Kazananlar): one derived status per spin with an account or a prize coupon

export const WINNER_STATUSES = ["active", "used", "expired", "pending", "inactive"] as const;
export type WinnerStatus = (typeof WINNER_STATUSES)[number];

export const WINNER_STATUS: Record<WinnerStatus, { label: string; tone: Tone; param: string; description: string }> = {
  active: { label: "Aktif", tone: "success", param: "aktif", description: "Kod hesaba tanımlı, henüz kullanılmadı ve süresi dolmadı." },
  used: { label: "Kullanıldı", tone: "info", param: "kullanildi", description: "Kod bir siparişte kullanıldı." },
  expired: { label: "Süresi doldu", tone: "neutral", param: "suresi-doldu", description: "Kod kullanılmadan süresi doldu (ya da hediye zamanında alınmadı)." },
  pending: {
    label: "Bekliyor",
    tone: "warning",
    param: "bekliyor",
    description: "Ziyaretçi üye oldu ya da giriş yaptı; hediye e-posta onayından sonra hesaba tanımlanacak.",
  },
  inactive: { label: "İptal edildi", tone: "danger", param: "iptal", description: "Kod pasifleştirildi ya da silindi (ör. hesap silme talebi)." },
};

export function winnerStatusFromParam(param: string | null | undefined): WinnerStatus | null {
  return WINNER_STATUSES.find((s) => WINNER_STATUS[s].param === param) ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Formatting

const shareFormat = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 1 });
const decimalFormat = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/** 25 → "%25", 2.5 → "%2,5" (Turkish percent sign before the number). */
export function formatShare(percent: number): string {
  return shareFormat.format((Number.isFinite(percent) ? percent : 0) / 100);
}

/** Part of a whole as a share: 3 of 12 → "%25"; 0 of 0 → "–". */
export function formatRatio(part: number, whole: number): string {
  return whole > 0 ? formatShare((part / whole) * 100) : "–";
}

/** Chart scale for counts: the smallest of 2, 4, 6, 8, 10 × 10^k at or above `value` (an even maximum keeps the midpoint whole). */
export function niceCountMax(value: number): number {
  if (!(value > 0)) return 2;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 4, 6, 8, 10].find((m) => m * magnitude >= value) ?? 10;
  const max = Math.round(step * magnitude);
  return max < 2 ? 2 : max;
}

/** 72 → "72 saat (3 gün)", 36 → "36 saat (1,5 gün)", 12 → "12 saat". */
export function formatHours(hours: number): string {
  if (hours < 24) return `${hours} saat`;
  return `${hours} saat (${decimalFormat.format(hours / 24)} gün)`;
}

/** The prize value alone: "%10", "50,00 ₺", "Ücretsiz kargo". */
export function prizeValueLabel(type: WheelPrizeType | string, value: number): string {
  if (type === "percent") return `%${value}`;
  if (type === "fixed") return formatPrice(value, "tr");
  return "Ücretsiz kargo";
}

/** One line for lists: "%10 indirim · 300,00 ₺ ve üzeri sepette". */
export function prizeConditions(prize: { type: WheelPrizeType | string; value: number; minOrderTotal: number }): string {
  const value = prize.type === "free_shipping" ? "Ücretsiz kargo" : `${prizeValueLabel(prize.type, prize.value)} indirim`;
  return prize.minOrderTotal > 0 ? `${value} · ${formatPrice(prize.minOrderTotal, "tr")} ve üzeri sepette` : value;
}

/**
 * What a list row adds under the prize label: the value when the label does not already say it (a label
 * the owner wrote himself) and the minimum basket. "" when the label says everything.
 */
export function prizeDetail(prize: { type: WheelPrizeType; value: number; minOrderTotal: number; label?: { tr?: string } | null }): string {
  const value = prize.type === "free_shipping" ? "Ücretsiz kargo" : `${prizeValueLabel(prize.type, prize.value)} indirim`;
  const label = (prize.label?.tr ?? "").trim().toLocaleLowerCase("tr");
  const said = label === value.toLocaleLowerCase("tr") || label === suggestSliceLabel(prize.type, prize.value).tr.toLocaleLowerCase("tr");
  return [said ? null : value, prize.minOrderTotal > 0 ? `${formatPrice(prize.minOrderTotal, "tr")} ve üzeri sepette` : null].filter(Boolean).join(" · ");
}

/**
 * E-mail for editors (personal data: only admins see the full address): "ayse.yilmaz@gmail.com" →
 * "ay•••@g•••.com". Keeps the first one or two characters of the name, the first letter of the domain
 * and the top-level domain, so staff can tell two winners apart without reading the address.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = local.length <= 3 ? 1 : 2;
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, keep)}•••@${host.slice(0, 1)}•••${tld}`;
}
