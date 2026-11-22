// Quote, sample and contact e-mails (REQUESTS). Queued by src/lib/requests/** (quote and sample
// requests and their panel workflows) and src/lib/contact/service.ts (contact form) in the same
// transaction as the business change. Texts: messages `email.requests.*` (Arayüz Metinleri), subject and
// intro overrides in settings.emails.templates. Admin mails are Turkish and go to adminRecipients().
import type { BusinessSector } from "@/db/schema/commerce";
import { localeNames, isLocale } from "@/i18n/config";
import { href } from "@/i18n/paths";
import { formatInternationalPhone } from "@/lib/contact/links";
import { isContactSubject, type ContactSubject } from "@/lib/contact/subjects";
import { isBusinessSector } from "@/lib/requests/types";
import { defineEmailTemplate } from "../registry";
import type { EmailBlock, EmailBuildContext, EmailOrderLine } from "../types";

/** A product (or free-text) line as the mails show it: names already in the mail's language. */
export type RequestEmailLine = {
  name: string;
  /** Variant / size, e.g. "5 L Bidon". */
  detail: string | null;
  quantity: number;
  /** Site path or absolute URL of a WebP/PNG/JPEG image (64×64). */
  imageUrl: string | null;
  accent: string | null;
};

export type RequestEmailProduct = { name: string; detail: string | null; imageUrl: string | null; accent: string | null };

export type QuoteReceivedEmailData = {
  /** Contact person's first name. */
  name: string;
  companyName: string;
  reference: string;
  lines: RequestEmailLine[];
  message: string | null;
};

export type QuoteAdminEmailData = QuoteReceivedEmailData & {
  quoteId: number;
  contactName: string;
  email: string;
  phone: string | null;
  sector: BusinessSector | null;
  locale: string;
};

export type QuoteOfferEmailData = {
  name: string;
  companyName: string;
  reference: string;
  lines: (RequestEmailLine & { unitPrice: number; lineTotal: number })[];
  /** Kuruş, VAT included. */
  total: number;
  /** YYYY-MM-DD or null. */
  validUntil: string | null;
  note: string | null;
};

export type SampleReceivedEmailData = {
  name: string;
  companyName: string;
  reference: string;
  products: RequestEmailProduct[];
  address: { city: string; district: string; line1: string };
  liters: number | null;
  message: string | null;
};

export type SampleAdminEmailData = SampleReceivedEmailData & {
  sampleId: number;
  contactName: string;
  email: string;
  phone: string;
  sector: BusinessSector;
  locale: string;
};

export type SampleApprovedEmailData = { name: string; companyName: string; reference: string; products: RequestEmailProduct[] };

export type SampleShippedEmailData = {
  name: string;
  companyName: string;
  reference: string;
  carrierName: string;
  trackingNumber: string;
  /** The carrier's tracking page with the code filled in, or null. */
  trackingUrl: string | null;
  products: RequestEmailProduct[];
};

export type SampleRejectedEmailData = { name: string; companyName: string; reference: string; note: string | null };

export type ContactMessageEmailData = {
  messageId: number;
  name: string;
  email: string;
  phone: string | null;
  subject: ContactSubject | null;
  message: string;
  locale: string;
};

declare module "../types" {
  interface EmailTemplateRegistry {
    quote_received: QuoteReceivedEmailData;
    quote_received_admin: QuoteAdminEmailData;
    quote_offer: QuoteOfferEmailData;
    sample_received: SampleReceivedEmailData;
    sample_received_admin: SampleAdminEmailData;
    sample_approved: SampleApprovedEmailData;
    sample_shipped: SampleShippedEmailData;
    sample_rejected: SampleRejectedEmailData;
    contact_message: ContactMessageEmailData;
  }
}

// ---------------------------------------------------------------------------------------------
// Sample data (panel preview and test sends)

const SAMPLE_LINES: RequestEmailLine[] = [
  { name: "Lavanta Latte", detail: "5 L Bidon", quantity: 12, imageUrl: null, accent: "#C2ADD1" },
  { name: "Okyanus", detail: "Pompalı Şişe 500 ml", quantity: 60, imageUrl: null, accent: "#329BC0" },
  { name: "Dispenser için dolum hortumu", detail: null, quantity: 4, imageUrl: null, accent: null },
];
const SAMPLE_PRODUCTS: RequestEmailProduct[] = [
  { name: "Lavanta Latte", detail: null, imageUrl: null, accent: "#C2ADD1" },
  { name: "Portakal", detail: null, imageUrl: null, accent: "#E9952E" },
];
const SAMPLE_QUOTE: QuoteReceivedEmailData = {
  name: "Ayşe",
  companyName: "Erciyes Otelcilik",
  reference: "TKL-00012",
  lines: SAMPLE_LINES,
  message: "Üç otelimizin oda banyoları ve lobi lavaboları için düzenli tedarik düşünüyoruz.",
};
const SAMPLE_SAMPLE: SampleReceivedEmailData = {
  name: "Ayşe",
  companyName: "Erciyes Otelcilik",
  reference: "NMN-00007",
  products: SAMPLE_PRODUCTS,
  address: { city: "Kayseri", district: "Melikgazi", line1: "Alpaslan Mah. Sivas Cad. No:12" },
  liters: 120,
  message: null,
};

// ---------------------------------------------------------------------------------------------
// Shared pieces

function sectorLabel(ctx: EmailBuildContext, sector: string | null): string | null {
  if (!sector) return null;
  const labels = ctx.messages.requests.sectors;
  return isBusinessSector(sector) ? labels[sector] : labels.other;
}

function languageLabel(locale: string): string {
  return isLocale(locale) ? localeNames[locale] : locale;
}

function lineBlocks(lines: RequestEmailLine[], ctx: EmailBuildContext): EmailOrderLine[] {
  return lines.map((l) => ({
    name: l.name,
    detail: l.detail,
    quantity: l.quantity,
    total: "",
    imageUrl: l.imageUrl ? ctx.url(l.imageUrl) : null,
    accent: l.accent,
  }));
}

function productBlocks(products: RequestEmailProduct[], ctx: EmailBuildContext): EmailOrderLine[] {
  return products.map((p) => ({ name: p.name, detail: p.detail, quantity: 1, total: "", imageUrl: p.imageUrl ? ctx.url(p.imageUrl) : null, accent: p.accent }));
}

function addressText(a: SampleReceivedEmailData["address"]): string {
  return `${a.line1}\n${a.district} / ${a.city}`;
}

function sampleSummaryRows(data: SampleReceivedEmailData, ctx: EmailBuildContext) {
  const m = ctx.messages.email.requests;
  return [
    { label: m.reference, value: data.reference },
    { label: m.company, value: data.companyName },
    { label: m.address, value: addressText(data.address) },
    ...(data.liters ? [{ label: m.liters, value: ctx.format(m.litersValue, { liters: data.liters }) }] : []),
  ];
}

const panelButton = (label: string, path: string): EmailBlock => ({ type: "button", label, url: path });

// ---------------------------------------------------------------------------------------------
// Quote

export const quoteReceivedEmail = defineEmailTemplate({
  key: "quote_received",
  audience: "customer",
  label: "Teklif talebi alındı",
  description: "İşletme Kurumsal sayfasındaki formdan teklif istediğinde talep sahibine gönderilir.",
  placeholders: ["name", "companyName", "reference"],
  sample: () => ({ ...SAMPLE_QUOTE }),
  build: (data, ctx) => {
    const m = ctx.messages.email.requests;
    const t = m.quoteReceived;
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: t.eyebrow, text: t.heading },
      { type: "paragraph", text: t.intro },
      { type: "keyValue", rows: [{ label: m.reference, value: data.reference }, { label: m.company, value: data.companyName }] },
      { type: "orderLines", title: m.linesTitle, lines: lineBlocks(data.lines, ctx) },
    ];
    if (data.message) blocks.push({ type: "notice", title: m.message, text: data.message });
    blocks.push({ type: "paragraph", text: t.footer, tone: "muted", size: "sm" });
    return { subject: t.subject, preheader: t.preheader, blocks };
  },
});

export const quoteReceivedAdminEmail = defineEmailTemplate({
  key: "quote_received_admin",
  audience: "admin",
  label: "Teklif talebi (yönetici bildirimi)",
  description: "Yeni bir teklif talebi geldiğinde yönetici alıcılarına gönderilir.",
  placeholders: ["companyName", "reference"],
  sample: () => ({
    ...SAMPLE_QUOTE,
    quoteId: 12,
    contactName: "Ayşe Yılmaz",
    email: "ayse@erciyesotel.com.tr",
    phone: "+905321234567",
    sector: "hotel",
    locale: "tr",
  }),
  build: (data, ctx) => {
    const m = ctx.messages.email.requests;
    const a = m.admin;
    const sector = sectorLabel(ctx, data.sector);
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: a.eyebrow, text: a.quoteHeading },
      { type: "paragraph", text: a.quoteIntro },
      {
        type: "keyValue",
        rows: [
          { label: m.reference, value: data.reference },
          { label: m.company, value: data.companyName },
          ...(sector ? [{ label: m.sector, value: sector }] : []),
          { label: m.contact, value: data.contactName },
          { label: m.email, value: data.email },
          ...(data.phone ? [{ label: m.phone, value: formatInternationalPhone(data.phone) }] : []),
          { label: m.language, value: languageLabel(data.locale) },
        ],
      },
      { type: "orderLines", title: m.linesTitle, lines: lineBlocks(data.lines, ctx) },
    ];
    if (data.message) blocks.push({ type: "notice", title: m.message, text: data.message });
    blocks.push(panelButton(a.openInPanel, `/panel/teklifler/${data.quoteId}`));
    return { subject: a.quoteSubject, blocks };
  },
});

export const quoteOfferEmail = defineEmailTemplate({
  key: "quote_offer",
  audience: "customer",
  label: "Teklif",
  description: "Panelde “Teklifi gönder” ile hazırlanan teklif; kalemler, birim fiyatlar, toplam ve geçerlilik tarihiyle gönderilir.",
  placeholders: ["name", "companyName", "reference"],
  sample: () => ({
    name: "Ayşe",
    companyName: "Erciyes Otelcilik",
    reference: "TKL-00012",
    lines: [
      { ...SAMPLE_LINES[0], unitPrice: 38990, lineTotal: 467880 },
      { ...SAMPLE_LINES[1], unitPrice: 12490, lineTotal: 749400 },
      { ...SAMPLE_LINES[2], unitPrice: 15000, lineTotal: 60000 },
    ],
    total: 1277280,
    validUntil: "2026-12-15",
    note: "Fiyatlarımız aylık düzenli teslimat için geçerlidir; Kayseri içi teslimat ücretsizdir.",
  }),
  build: (data, ctx) => {
    const m = ctx.messages.email.requests;
    const t = m.quoteOffer;
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: t.eyebrow, text: t.heading },
      { type: "paragraph", text: t.intro },
      {
        type: "orderLines",
        title: t.linesTitle,
        lines: data.lines.map((l) => ({
          name: l.name,
          detail: l.detail,
          quantity: l.quantity,
          unitPrice: ctx.format(t.unitPrice, { price: ctx.formatPrice(l.unitPrice) }),
          total: ctx.formatPrice(l.lineTotal),
          imageUrl: l.imageUrl ? ctx.url(l.imageUrl) : null,
          accent: l.accent,
        })),
      },
      {
        type: "totals",
        rows: [
          { label: t.total, value: ctx.formatPrice(data.total), kind: "total" },
          { label: t.vatNote, value: "", kind: "note" },
        ],
      },
      {
        type: "keyValue",
        rows: [
          { label: m.reference, value: data.reference },
          ...(data.validUntil ? [{ label: t.validUntil, value: ctx.formatDate(`${data.validUntil}T12:00:00+03:00`, { time: false }) }] : []),
        ],
      },
    ];
    if (data.note) blocks.push({ type: "notice", title: t.noteTitle, text: data.note, tone: "info" });
    blocks.push({ type: "paragraph", text: t.accept });
    blocks.push({ type: "button", label: t.button, url: href(ctx.locale, "contact") });
    return { subject: t.subject, preheader: t.preheader, blocks };
  },
});

// ---------------------------------------------------------------------------------------------
// Samples

export const sampleReceivedEmail = defineEmailTemplate({
  key: "sample_received",
  audience: "customer",
  label: "Numune talebi alındı",
  description: "İşletme Numune sayfasındaki formdan ücretsiz numune istediğinde talep sahibine gönderilir.",
  placeholders: ["name", "companyName", "reference"],
  sample: () => ({ ...SAMPLE_SAMPLE }),
  build: (data, ctx) => {
    const m = ctx.messages.email.requests;
    const t = m.sampleReceived;
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: t.eyebrow, text: t.heading },
      { type: "paragraph", text: t.intro },
      { type: "keyValue", rows: sampleSummaryRows(data, ctx) },
      { type: "orderLines", title: m.products, lines: productBlocks(data.products, ctx) },
    ];
    if (data.message) blocks.push({ type: "notice", title: m.message, text: data.message });
    blocks.push({ type: "paragraph", text: t.footer, tone: "muted", size: "sm" });
    return { subject: t.subject, preheader: t.preheader, blocks };
  },
});

export const sampleReceivedAdminEmail = defineEmailTemplate({
  key: "sample_received_admin",
  audience: "admin",
  label: "Numune talebi (yönetici bildirimi)",
  description: "Yeni bir numune talebi geldiğinde yönetici alıcılarına gönderilir.",
  placeholders: ["companyName", "reference"],
  sample: () => ({
    ...SAMPLE_SAMPLE,
    sampleId: 7,
    contactName: "Ayşe Yılmaz",
    email: "ayse@erciyesotel.com.tr",
    phone: "+905321234567",
    sector: "hotel",
    locale: "tr",
  }),
  build: (data, ctx) => {
    const m = ctx.messages.email.requests;
    const a = m.admin;
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: a.eyebrow, text: a.sampleHeading },
      { type: "paragraph", text: a.sampleIntro },
      {
        type: "keyValue",
        rows: [
          ...sampleSummaryRows(data, ctx),
          { label: m.sector, value: sectorLabel(ctx, data.sector) ?? "" },
          { label: m.contact, value: data.contactName },
          { label: m.email, value: data.email },
          { label: m.phone, value: formatInternationalPhone(data.phone) },
          { label: m.language, value: languageLabel(data.locale) },
        ],
      },
      { type: "orderLines", title: m.products, lines: productBlocks(data.products, ctx) },
    ];
    if (data.message) blocks.push({ type: "notice", title: m.message, text: data.message });
    blocks.push(panelButton(a.openInPanel, `/panel/numune-talepleri/${data.sampleId}`));
    return { subject: a.sampleSubject, blocks };
  },
});

export const sampleApprovedEmail = defineEmailTemplate({
  key: "sample_approved",
  audience: "customer",
  label: "Numune talebi onaylandı",
  description: "Numune talebi panelde onaylandığında talep sahibine gönderilir.",
  placeholders: ["name", "companyName", "reference"],
  sample: () => ({ name: "Ayşe", companyName: "Erciyes Otelcilik", reference: "NMN-00007", products: SAMPLE_PRODUCTS }),
  build: (data, ctx) => {
    const m = ctx.messages.email.requests;
    const t = m.sampleApproved;
    return {
      subject: t.subject,
      preheader: t.preheader,
      blocks: [
        { type: "heading", eyebrow: t.eyebrow, text: t.heading },
        { type: "paragraph", text: t.intro },
        { type: "keyValue", rows: [{ label: m.reference, value: data.reference }] },
        { type: "orderLines", title: m.products, lines: productBlocks(data.products, ctx) },
      ],
    };
  },
});

export const sampleShippedEmail = defineEmailTemplate({
  key: "sample_shipped",
  audience: "customer",
  label: "Numune kargoya verildi",
  description: "Numuneler panelde kargo firması ve takip numarasıyla kargoya verildi olarak işaretlendiğinde gönderilir.",
  placeholders: ["name", "companyName", "reference"],
  sample: () => ({
    name: "Ayşe",
    companyName: "Erciyes Otelcilik",
    reference: "NMN-00007",
    carrierName: "Yurtiçi Kargo",
    trackingNumber: "YK123456789",
    trackingUrl: "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=YK123456789",
    products: SAMPLE_PRODUCTS,
  }),
  build: (data, ctx) => {
    const m = ctx.messages.email.requests;
    const t = m.sampleShipped;
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: t.eyebrow, text: t.heading },
      { type: "paragraph", text: t.intro },
      {
        type: "keyValue",
        rows: [
          { label: m.reference, value: data.reference },
          { label: t.carrier, value: data.carrierName },
          { label: t.tracking, value: data.trackingNumber },
        ],
      },
    ];
    if (data.trackingUrl) blocks.push({ type: "button", label: t.button, url: data.trackingUrl });
    blocks.push({ type: "orderLines", title: m.products, lines: productBlocks(data.products, ctx) });
    blocks.push({ type: "paragraph", text: t.footer, tone: "muted", size: "sm" });
    return { subject: t.subject, preheader: t.preheader, blocks };
  },
});

export const sampleRejectedEmail = defineEmailTemplate({
  key: "sample_rejected",
  audience: "customer",
  label: "Numune talebi reddedildi",
  description: "Numune talebi kargoya verilmeden önce panelde reddedildiğinde talep sahibine gönderilir (isteğe bağlı bir notla).",
  placeholders: ["name", "companyName", "reference"],
  sample: () => ({ name: "Ayşe", companyName: "Erciyes Otelcilik", reference: "NMN-00007", note: "Bu ay numune stoğumuz tükendi; önümüzdeki ay yeniden yazmanızdan memnuniyet duyarız." }),
  build: (data, ctx) => {
    const m = ctx.messages.email.requests;
    const t = m.sampleRejected;
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: t.eyebrow, text: t.heading },
      { type: "paragraph", text: t.intro },
    ];
    if (data.note) blocks.push({ type: "notice", title: t.noteTitle, text: data.note, tone: "info" });
    blocks.push({ type: "keyValue", rows: [{ label: m.reference, value: data.reference }] });
    blocks.push({ type: "paragraph", text: t.footer });
    blocks.push({ type: "button", label: t.button, url: href(ctx.locale, "products"), variant: "secondary" });
    return { subject: t.subject, preheader: t.preheader, blocks };
  },
});

// ---------------------------------------------------------------------------------------------
// Contact form

export const contactMessageEmail = defineEmailTemplate({
  key: "contact_message",
  audience: "admin",
  label: "İletişim mesajı (yönetici bildirimi)",
  description: "İletişim formundan yeni bir mesaj geldiğinde yönetici alıcılarına gönderilir.",
  placeholders: ["name", "subjectLabel"],
  sample: () => ({
    messageId: 42,
    name: "Mehmet Kaya",
    email: "mehmet@ornek.com",
    phone: "+905321234567",
    subject: "general",
    message: "Merhaba, 20 L bidonları Ankara'ya gönderiyor musunuz? Teslimat süresini öğrenmek isterim.",
    locale: "tr",
  }),
  variables: (data, ctx) => ({ name: data.name, subjectLabel: contactSubjectLabel(ctx, data.subject) }),
  build: (data, ctx) => {
    const m = ctx.messages.email.requests;
    const a = m.admin;
    return {
      subject: a.contactSubject,
      blocks: [
        { type: "heading", eyebrow: a.eyebrow, text: a.contactHeading },
        { type: "paragraph", text: a.contactIntro },
        {
          type: "keyValue",
          rows: [
            { label: a.contactSubjectLabel, value: contactSubjectLabel(ctx, data.subject) },
            { label: m.contact, value: data.name },
            { label: m.email, value: data.email },
            ...(data.phone ? [{ label: m.phone, value: formatInternationalPhone(data.phone) }] : []),
            { label: m.language, value: languageLabel(data.locale) },
          ],
        },
        { type: "notice", title: m.message, text: data.message },
        { type: "paragraph", text: a.replyHint, tone: "muted", size: "sm" },
        panelButton(a.openInPanel, `/panel/mesajlar/${data.messageId}`),
      ],
    };
  },
});

function contactSubjectLabel(ctx: EmailBuildContext, subject: string | null): string {
  const c = ctx.messages.contact;
  if (!isContactSubject(subject)) return c.subjectGeneral;
  return { general: c.subjectGeneral, quote: c.subjectQuote, sample: c.subjectSample, other: c.subjectOther }[subject];
}
