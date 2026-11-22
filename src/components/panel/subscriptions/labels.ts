// Turkish panel wording for subscriptions (pure).
import type { Tone } from "@/components/panel/labels";
import type { SubscriptionStatus } from "@/lib/subscriptions/types";

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  active: { label: "Aktif", tone: "success" },
  paused: { label: "Duraklatıldı", tone: "warning" },
  past_due: { label: "Ödeme bekleniyor", tone: "danger" },
  cancelled: { label: "İptal edildi", tone: "neutral" },
};

/** "Her hafta", "2 haftada bir", "Her ay", "3 ayda bir". */
export function rhythmLabel(interval: "week" | "month", count: number): string {
  const unit = interval === "week" ? "hafta" : "ay";
  return count <= 1 ? `Her ${unit}` : `${count} ${unit}da bir`;
}

export const SUBSCRIPTIONS_BASE = "/panel/abonelikler";
