// Turkish labels and link helpers for Teklif Talepleri and Numune Talepleri (pure; server and client).
import type { BusinessSector } from "@/db/schema/commerce";
import { REQUEST_STATUS, type Tone } from "@/components/panel/labels";
import { SECTOR_LABELS_TR } from "@/lib/b2b/application";
import { isBusinessSector, QUOTE_STATUSES, SAMPLE_STATUSES, type QuoteStatus, type SampleStatus } from "@/lib/requests/types";

/** The same sector names as Kurumsal Hesaplar (one map for the whole panel). */
export const SECTOR_LABEL: Record<BusinessSector, string> = SECTOR_LABELS_TR;

export const sectorLabel = (sector: string | null | undefined): string => (sector && isBusinessSector(sector) ? SECTOR_LABEL[sector] : "Belirtilmemiş");

export const LANGUAGE_LABEL: Record<string, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" };

export function statusBadge(status: string): { label: string; tone: Tone } {
  return REQUEST_STATUS[status as keyof typeof REQUEST_STATUS] ?? { label: status, tone: "neutral" };
}

/** Turkish query values for the status tabs (?durum=…). */
export const STATUS_PARAM: Record<QuoteStatus | SampleStatus, string> = {
  new: "yeni",
  in_review: "inceleniyor",
  approved: "onaylandi",
  quoted: "teklif-verildi",
  shipped: "gonderildi",
  won: "kazanildi",
  rejected: "reddedildi",
};

export function quoteStatusFromParam(value: string | undefined): QuoteStatus | null {
  return QUOTE_STATUSES.find((s) => STATUS_PARAM[s] === value) ?? null;
}
export function sampleStatusFromParam(value: string | undefined): SampleStatus | null {
  return SAMPLE_STATUSES.find((s) => STATUS_PARAM[s] === value) ?? null;
}

export type RequestListFilter = { status: string | null; q: string; page?: number };

/** /panel/<base> with the filters (?durum=, ?ara=, ?sayfa=). */
export function requestListHref(base: "/panel/teklifler" | "/panel/numune-talepleri", filter: Partial<RequestListFilter>): string {
  const params = new URLSearchParams();
  if (filter.status) params.set("durum", STATUS_PARAM[filter.status as QuoteStatus] ?? filter.status);
  if (filter.q) params.set("ara", filter.q);
  if (filter.page && filter.page > 1) params.set("sayfa", String(filter.page));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

const REPLY: Record<string, { greeting: (name: string) => string; quote: string; sample: string; quoted: string }> = {
  tr: { greeting: (n) => `Merhaba ${n},`, quote: "PRESTİJ | Teklif talebiniz", sample: "PRESTİJ | Numune talebiniz", quoted: "Talebiniz:" },
  en: { greeting: (n) => `Hello ${n},`, quote: "PRESTİJ | Your quote request", sample: "PRESTİJ | Your sample request", quoted: "Your request:" },
  ar: { greeting: (n) => `مرحبًا ${n}،`, quote: "PRESTİJ | طلب عرض السعر", sample: "PRESTİJ | طلب العيّنات", quoted: "طلبك:" },
};

/** mailto: reply in the requester's language, with the reference in the subject. */
export function requestReplyMailto(input: { kind: "quote" | "sample"; email: string; contactName: string; reference: string; locale: string; quoted?: string | null }): string {
  const t = REPLY[input.locale] ?? REPLY.tr;
  const first = input.contactName.split(" ")[0] || input.contactName;
  const quoted = input.quoted ? (input.quoted.length > 600 ? `${input.quoted.slice(0, 600)}…` : input.quoted) : "";
  const body = `${t.greeting(first)}\n\n\n\n${quoted ? `---\n${t.quoted}\n${quoted}` : ""}`;
  const subject = `${input.kind === "quote" ? t.quote : t.sample} · ${input.reference}`;
  return `mailto:${encodeURIComponent(input.email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Turkish names of the request e-mail templates for the e-mail list on the detail pages. */
export const EMAIL_TEMPLATE_LABEL: Record<string, string> = {
  quote_received: "Talep alındı (müşteri)",
  quote_received_admin: "Yeni talep bildirimi (yönetici)",
  quote_offer: "Teklif",
  sample_received: "Talep alındı (müşteri)",
  sample_received_admin: "Yeni talep bildirimi (yönetici)",
  sample_approved: "Onaylandı",
  sample_shipped: "Kargoya verildi",
  sample_rejected: "Reddedildi",
};

export const EMAIL_STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Sırada", tone: "warning" },
  sending: { label: "Gönderiliyor", tone: "info" },
  sent: { label: "Gönderildi", tone: "success" },
  failed: { label: "Başarısız", tone: "danger" },
  cancelled: { label: "İptal", tone: "neutral" },
};
