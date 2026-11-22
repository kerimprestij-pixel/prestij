// Turkish labels for newsletter campaigns (panel). Pure.
import type { Tone } from "@/components/panel/labels";
import type { CampaignAudience, CampaignStatus } from "@/lib/newsletter/campaigns";

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: "Taslak", tone: "neutral" },
  scheduled: { label: "Planlandı", tone: "info" },
  sending: { label: "Gönderiliyor", tone: "warning" },
  sent: { label: "Gönderildi", tone: "success" },
};

export const CAMPAIGN_AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  all: "Tüm aboneler",
  retail: "Bireysel aboneler",
  business: "Kurumsal müşteriler",
};

export const CAMPAIGN_AUDIENCE_HELP: Record<CampaignAudience, string> = {
  all: "Aboneliğini onaylamış herkes.",
  retail: "Onaylı kurumsal hesabı olmayan aboneler.",
  business: "Onaylı kurumsal hesabı olan müşteriler (abone oldukları adresle).",
};
