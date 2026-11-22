// Turkish labels of the e-mail log (panel). Pure.
import type { Tone } from "@/components/panel/labels";
import type { EmailRelatedType, EmailStatus } from "@/lib/email/types";
import { quoteRef, sampleRef } from "@/lib/requests/types";

export const EMAIL_STATUS_LABELS: Record<EmailStatus, { label: string; tone: Tone }> = {
  queued: { label: "Kuyrukta", tone: "info" },
  sending: { label: "Gönderiliyor", tone: "info" },
  sent: { label: "Gönderildi", tone: "success" },
  failed: { label: "Gönderilemedi", tone: "danger" },
  cancelled: { label: "İptal edildi", tone: "neutral" },
};

export const EMAIL_RELATED_LABELS: Record<EmailRelatedType, string> = {
  order: "Sipariş",
  quote: "Teklif talebi",
  sample: "Numune talebi",
  company: "Kurumsal hesap",
  review: "Yorum",
  subscription: "Abonelik",
  newsletter: "E-bülten abonesi",
  campaign: "E-bülten kampanyası",
  contact: "İletişim mesajı",
  user: "Hesap",
  test: "Test gönderimi",
};

export const EMAIL_LOCALE_LABELS: Record<string, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" };

const NUMERIC_PAGES: Partial<Record<EmailRelatedType, (id: string) => string>> = {
  order: (id) => `/panel/siparisler/${id}`,
  campaign: (id) => `/panel/e-bulten/kampanyalar/${id}`,
  quote: (id) => `/panel/teklifler/${id}`,
  sample: (id) => `/panel/numune-talepleri/${id}`,
  company: (id) => `/panel/kurumsal-hesaplar/${id}`,
  subscription: (id) => `/panel/abonelikler/${id}`,
  contact: (id) => `/panel/mesajlar/${id}`,
  review: () => "/panel/yorumlar",
};

/**
 * Panel page of the record a mail belongs to. User mails link to the customer page only when the
 * caller knows the account is a customer (`options.customer`); team members have no such page.
 */
export function relatedHref(type: string | null, id: string | null, options: { customer?: boolean } = {}): string | null {
  if (!type || !id) return null;
  if (type === "user") return options.customer && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? `/panel/musteriler/${id}` : null;
  if (!/^\d{1,10}$/.test(id)) return null;
  return NUMERIC_PAGES[type as EmailRelatedType]?.(id) ?? null;
}

/** How the panel names the record elsewhere: TKL-00001, NMN-00001, else "#12" ("" for tests and user ids). */
export function relatedRef(type: string | null, id: string | null): string {
  if (!type || !id || type === "test" || !/^\d{1,10}$/.test(id)) return "";
  if (type === "quote") return quoteRef(Number(id));
  if (type === "sample") return sampleRef(Number(id));
  return `#${id}`;
}
