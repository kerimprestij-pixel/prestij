// Announcement bar labels and status rules for the panel. Pure and client-safe.
import type { Tone } from "@/components/panel/labels";

export const ANNOUNCEMENT_VARIANTS = ["brand", "accent", "neutral"] as const;
export type AnnouncementVariantKey = (typeof ANNOUNCEMENT_VARIANTS)[number];

export const ANNOUNCEMENT_VARIANT_OPTIONS: { value: AnnouncementVariantKey; label: string; description: string }[] = [
  { value: "brand", label: "Lacivert", description: "Marka rengi; varsayılan duyuru şeridi." },
  { value: "accent", label: "Altın", description: "Kampanya ve fırsatları öne çıkarmak için." },
  { value: "neutral", label: "Sade", description: "Açık zemin, ince çizgi; bilgilendirme için." },
];

/** Same classes as the storefront's AnnouncementRotator (the panel uses the default PRESTİJ tokens). */
export const ANNOUNCEMENT_VARIANT_CLASS: Record<AnnouncementVariantKey, string> = {
  brand: "surface-inverse bg-brand text-brand-contrast",
  accent: "bg-gold text-gold-contrast",
  neutral: "border-b border-border bg-surface-2 text-text",
};

export const ANNOUNCEMENT_TEXT_MAX = 160;

export type AnnouncementStatus = "live" | "scheduled" | "ended" | "off";

export const ANNOUNCEMENT_STATUS: Record<AnnouncementStatus, { label: string; tone: Tone }> = {
  live: { label: "Yayında", tone: "success" },
  scheduled: { label: "Planlandı", tone: "info" },
  ended: { label: "Süresi doldu", tone: "neutral" },
  off: { label: "Kapalı", tone: "warning" },
};

type Stamp = string | Date | null | undefined;

const time = (value: Stamp) => (value ? new Date(value).getTime() : null);

/** Same window rule as the storefront (getActiveAnnouncements): start ≤ now < end. */
export function announcementStatus(a: { isActive: boolean; startsAt: Stamp; endsAt: Stamp }, now = Date.now()): AnnouncementStatus {
  if (!a.isActive) return "off";
  const start = time(a.startsAt);
  const end = time(a.endsAt);
  if (end !== null && end <= now) return "ended";
  if (start !== null && start > now) return "scheduled";
  return "live";
}
