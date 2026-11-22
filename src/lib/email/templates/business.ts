// Business account e-mails (B2B): the application receipt (customer) and its admin notification, the
// approval with the group and payment terms, and the rejection with its reason. Queued by
// src/lib/b2b/service.ts in the same transaction as the company change. Texts: messages
// `email.business.*` (Arayüz Metinleri), subject/intro overrides in settings.emails.templates.
import type { BusinessSector } from "@/db/schema/commerce";
import { localize } from "@/i18n/localize";
import type { LocalizedText } from "@/i18n/locales";
import { href } from "@/i18n/paths";
import { formatBusinessPhone, isBusinessSector, isMonthlyVolume, type MonthlyVolume } from "@/lib/b2b/application";
import { defineEmailTemplate } from "../registry";
import type { EmailBlock, EmailBuildContext } from "../types";

export type BusinessApplicationEmailData = {
  /** Applicant's first name. */
  name: string;
  company: string;
  sector: BusinessSector;
  taxOffice: string | null;
  taxNumber: string | null;
  city: string | null;
  district: string | null;
};

export type BusinessApplicationAdminEmailData = BusinessApplicationEmailData & {
  companyId: number;
  contactName: string;
  accountEmail: string;
  companyEmail: string | null;
  phone: string | null;
  website: string | null;
  monthlyVolume: MonthlyVolume | null;
  note: string | null;
};

export type BusinessApprovedEmailData = {
  name: string;
  company: string;
  /** The approved group's name (all locales; the mail picks its own). */
  groupName: LocalizedText | null;
  /** Deferred payment days, null without deferred terms. */
  deferredDays: number | null;
  pricesExVat: boolean;
};

export type BusinessRejectedEmailData = {
  name: string;
  company: string;
  reason: string | null;
  /** An approved account lost its business status ("Onayı kaldır"), rather than an application declined. */
  revoked?: boolean;
};

declare module "../types" {
  interface EmailTemplateRegistry {
    business_application_received: BusinessApplicationEmailData;
    business_application_admin: BusinessApplicationAdminEmailData;
    business_approved: BusinessApprovedEmailData;
    business_rejected: BusinessRejectedEmailData;
  }
}

const SAMPLE_APPLICATION: BusinessApplicationEmailData = {
  name: "Ayşe",
  company: "Erciyes Otelcilik A.Ş.",
  sector: "hotel",
  taxOffice: "Kocasinan",
  taxNumber: "1234567890",
  city: "Kayseri",
  district: "Kocasinan",
};

function sectorLabel(ctx: EmailBuildContext, sector: string): string {
  const labels = ctx.messages.b2b.account.sectors;
  return isBusinessSector(sector) ? labels[sector] : labels.other;
}

function place(city: string | null, district: string | null): string {
  return [district, city].filter(Boolean).join(" / ");
}

function summaryRows(data: BusinessApplicationEmailData, ctx: EmailBuildContext) {
  const m = ctx.messages.email.business;
  const rows = [
    { label: m.company, value: data.company },
    { label: m.sector, value: sectorLabel(ctx, data.sector) },
  ];
  if (data.taxOffice) rows.push({ label: m.taxOffice, value: data.taxOffice });
  if (data.taxNumber) rows.push({ label: m.taxNumber, value: data.taxNumber });
  const where = place(data.city, data.district);
  if (where) rows.push({ label: m.city, value: where });
  return rows;
}

export const businessApplicationReceivedEmail = defineEmailTemplate({
  key: "business_application_received",
  audience: "customer",
  label: "Kurumsal başvuru alındı",
  description: "Müşteri /hesap/kurumsal sayfasından kurumsal hesap başvurusu yaptığında gönderilir.",
  placeholders: ["name", "company"],
  sample: () => ({ ...SAMPLE_APPLICATION }),
  build: (data, ctx) => {
    const m = ctx.messages.email.business.received;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "keyValue", title: m.summaryTitle, rows: summaryRows(data, ctx) },
        { type: "notice", tone: "info", text: m.next },
        { type: "button", label: m.button, url: href(ctx.locale, "accountBusiness") },
      ],
    };
  },
});

export const businessApplicationAdminEmail = defineEmailTemplate({
  key: "business_application_admin",
  audience: "admin",
  label: "Kurumsal başvuru (yönetici bildirimi)",
  description: "Yeni bir kurumsal hesap başvurusu geldiğinde yönetici alıcılarına gönderilir.",
  placeholders: ["company"],
  sample: () => ({
    ...SAMPLE_APPLICATION,
    companyId: 12,
    contactName: "Ayşe Yılmaz",
    accountEmail: "ayse@erciyesotel.com.tr",
    companyEmail: "muhasebe@erciyesotel.com.tr",
    phone: "+903521234567",
    website: "https://erciyesotel.com.tr",
    monthlyVolume: "l200_1000",
    note: "Üç otelimiz için oda banyoları ve lobi lavaboları.",
  }),
  build: (data, ctx) => {
    const m = ctx.messages.email.business.admin;
    const volumes = ctx.messages.b2b.account.volumes;
    const rows = [
      { label: m.contact, value: data.contactName },
      { label: m.accountEmail, value: data.accountEmail },
      ...(data.companyEmail && data.companyEmail !== data.accountEmail ? [{ label: m.companyEmail, value: data.companyEmail }] : []),
      ...(data.phone ? [{ label: m.phone, value: formatBusinessPhone(data.phone) }] : []),
      ...(data.website ? [{ label: m.website, value: data.website }] : []),
      ...(isMonthlyVolume(data.monthlyVolume) ? [{ label: m.volume, value: volumes[data.monthlyVolume] }] : []),
    ];
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: m.eyebrow, text: m.heading },
      { type: "paragraph", text: m.intro },
      { type: "keyValue", rows: summaryRows(data, ctx) },
      { type: "keyValue", rows },
    ];
    if (data.note) blocks.push({ type: "notice", title: m.note, text: data.note });
    blocks.push({ type: "button", label: m.button, url: `/panel/kurumsal-hesaplar/${data.companyId}` });
    return { subject: m.subject, preheader: m.preheader, blocks };
  },
});

export const businessApprovedEmail = defineEmailTemplate({
  key: "business_approved",
  audience: "customer",
  label: "Kurumsal hesap onaylandı",
  description: "Kurumsal başvuru panelden onaylandığında müşteri grubu ve ödeme koşullarıyla birlikte gönderilir.",
  placeholders: ["name", "company"],
  sample: () => ({
    name: "Ayşe",
    company: "Erciyes Otelcilik A.Ş.",
    groupName: { tr: "Kurumsal", en: "Business", ar: "الشركات" },
    deferredDays: 30,
    pricesExVat: true,
  }),
  build: (data, ctx) => {
    const m = ctx.messages.email.business.approved;
    const rows: { label: string; value: string }[] = [];
    const group = data.groupName ? localize(data.groupName, ctx.locale) : "";
    if (group) rows.push({ label: m.group, value: group });
    rows.push({ label: m.terms, value: data.deferredDays ? ctx.format(m.termsDeferred, { days: data.deferredDays }) : m.termsStandard });
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: m.eyebrow, text: m.heading },
      { type: "paragraph", text: m.intro },
      { type: "keyValue", title: m.termsTitle, rows },
    ];
    if (data.pricesExVat) blocks.push({ type: "notice", tone: "info", text: m.exVatNote });
    blocks.push(
      { type: "button", label: m.button, url: href(ctx.locale, "products") },
      { type: "paragraph", text: m.help, tone: "muted", size: "sm" },
    );
    return { subject: m.subject, preheader: m.preheader, blocks };
  },
});

export const businessRejectedEmail = defineEmailTemplate({
  key: "business_rejected",
  audience: "customer",
  label: "Kurumsal başvuru reddedildi",
  description: "Kurumsal başvuru panelden reddedildiğinde ya da onaylı bir firmanın onayı kaldırıldığında, yazılan gerekçeyle birlikte gönderilir.",
  placeholders: ["name", "company"],
  sample: () => ({ name: "Ayşe", company: "Erciyes Otelcilik A.Ş.", reason: "Vergi levhanızdaki unvan ile başvurudaki firma adı eşleşmiyor." }),
  build: (data, ctx) => {
    const m = ctx.messages.email.business.rejected;
    const r = data.revoked ? m.revoked : null;
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: m.eyebrow, text: r?.heading ?? m.heading },
      { type: "paragraph", text: r?.intro ?? m.intro },
    ];
    if (data.reason) blocks.push({ type: "notice", tone: "warning", title: m.reasonTitle, text: data.reason });
    blocks.push(
      { type: "paragraph", text: r?.next ?? m.reapply },
      { type: "button", label: r?.button ?? m.button, url: href(ctx.locale, "accountBusiness"), variant: "secondary" },
    );
    return { subject: r?.subject ?? m.subject, preheader: r?.preheader ?? m.preheader, blocks };
  },
});
