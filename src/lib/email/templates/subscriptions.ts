// Subscription e-mails (SUBSCRIPTIONS): started, renewal reminder (skip + manage links), card renewal
// payment due, renewal failed (out of stock …) and changed (pause, resume, skip, plan, address, cancel).
// Texts live under `email.subscriptions` in the dictionaries; the panel may override subject and intro.
import type { LocalizedText } from "@/i18n/locales";
import { localize } from "@/i18n/localize";
import { defineEmailTemplate } from "../registry";
import type { EmailBlock, EmailBuildContext, EmailOrderLine } from "../types";

/** One product of the subscription as shown in a mail (names localized at render time). */
export type SubscriptionEmailItem = {
  name: LocalizedText;
  detail: LocalizedText | null;
  quantity: number;
  /** Site path or absolute URL of a WebP/PNG/JPEG image (never AVIF), or null. */
  imageUrl: string | null;
  accent: string | null;
};

type Base = {
  /** The customer's name (first name or full name). */
  name: string;
  /** The plan's name, e.g. { tr: "Her ay", en: "Monthly" }. */
  plan: LocalizedText;
  /** Absolute link to /hesap/abonelikler in the customer's language. */
  manageUrl: string;
};

export type SubscriptionStartedEmailData = Base & {
  /** First renewal (ISO). */
  date: string;
  items: SubscriptionEmailItem[];
  paymentMethod: "card" | "bank_transfer" | "cash_on_delivery" | "deferred";
};

const METHOD_LABEL_KEYS = { card: "card", bank_transfer: "bankTransfer", cash_on_delivery: "cashOnDelivery", deferred: "deferred" } as const;

export type SubscriptionReminderEmailData = Base & {
  /** The renewal date (ISO). */
  date: string;
  items: SubscriptionEmailItem[];
  /** Absolute link that skips this one renewal (signed, purpose subscription-skip). */
  skipUrl: string;
  /** Card renewals: the order waits for payment (a pay link follows). */
  card: boolean;
};

export type SubscriptionPaymentDueEmailData = Base & {
  orderNumber: string;
  /** When the unpaid renewal order expires (ISO). */
  deadline: string;
  /** Grand total in kuruş. */
  total: number;
  /** Absolute order page link (with the access token) whose button starts the card payment. */
  payUrl: string;
  items: SubscriptionEmailItem[];
};

export type SubscriptionRenewalFailedEmailData = Base & {
  reason: "out_of_stock" | "unavailable" | "method_unavailable" | "quantity_changed";
};

export type SubscriptionChangeKind = "paused" | "resumed" | "skipped" | "unskipped" | "plan" | "address" | "cancelled";

export type SubscriptionChangedEmailData = Base & {
  kind: SubscriptionChangeKind;
  /** The skipped renewal date (ISO), for "skipped". */
  date: string | null;
  /** The next renewal date (ISO), when there is one. */
  next: string | null;
};

declare module "../types" {
  interface EmailTemplateRegistry {
    subscription_started: SubscriptionStartedEmailData;
    subscription_reminder: SubscriptionReminderEmailData;
    subscription_payment_due: SubscriptionPaymentDueEmailData;
    subscription_renewal_failed: SubscriptionRenewalFailedEmailData;
    subscription_changed: SubscriptionChangedEmailData;
  }
}

const SAMPLE_ITEMS: SubscriptionEmailItem[] = [
  {
    name: { tr: "Lavanta Latte", en: "Lavender Latte", ar: "لاتيه اللافندر" },
    detail: { tr: "Sıvı El Sabunu · 500 ml", en: "Liquid Hand Soap · 500 ml", ar: "صابون سائل لليدين · 500 مل" },
    quantity: 2,
    imageUrl: null,
    accent: "#C2ADD1",
  },
];
const SAMPLE_PLAN: LocalizedText = { tr: "Her ay", en: "Monthly", ar: "شهريًا" };
const SAMPLE_MANAGE = "https://prestij.com.tr/tr/hesap/abonelikler";
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const day = (ctx: EmailBuildContext, iso: string | null) => (iso ? ctx.formatDate(iso, { time: false }) : "");

function itemLines(items: SubscriptionEmailItem[], ctx: EmailBuildContext): EmailOrderLine[] {
  return items.map((item) => ({
    name: localize(item.name, ctx.locale),
    detail: localize(item.detail, ctx.locale) || null,
    quantity: item.quantity,
    total: "",
    imageUrl: item.imageUrl ? ctx.url(item.imageUrl) : null,
    accent: item.accent ?? null,
  }));
}

export const subscriptionStartedEmail = defineEmailTemplate({
  key: "subscription_started",
  audience: "customer",
  label: "Abonelik başladı",
  description: "İlk sipariş ödendiğinde (kartta) ya da verildiğinde (havale, kapıda ödeme) aboneliğin başladığı ve sonraki sipariş tarihi bildirilir.",
  placeholders: ["name", "plan", "date"],
  sample: () => ({ name: "Ayşe", plan: SAMPLE_PLAN, manageUrl: SAMPLE_MANAGE, date: inDays(30), items: SAMPLE_ITEMS, paymentMethod: "cash_on_delivery" }),
  variables: (data, ctx) => ({ plan: localize(data.plan, ctx.locale), date: day(ctx, data.date) }),
  build: (data, ctx) => {
    const m = ctx.messages.email.subscriptions.started;
    const c = ctx.messages.email.subscriptions.common;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "orderLines", title: c.items, lines: itemLines(data.items, ctx) },
        {
          type: "keyValue",
          rows: [
            { label: c.plan, value: localize(data.plan, ctx.locale) },
            { label: c.nextOrder, value: day(ctx, data.date) },
            { label: c.paymentMethod, value: ctx.messages.checkout[METHOD_LABEL_KEYS[data.paymentMethod] ?? "card"] },
          ],
        },
        { type: "paragraph", text: m.note },
        { type: "button", label: c.manage, url: data.manageUrl },
        { type: "paragraph", text: c.priceNote, tone: "muted", size: "sm" },
      ],
    };
  },
});

export const subscriptionReminderEmail = defineEmailTemplate({
  key: "subscription_reminder",
  audience: "customer",
  label: "Abonelik hatırlatması",
  description: "Yenileme siparişinden birkaç gün önce (Ayarlar › Abonelik) teslimatı atlama ve aboneliği yönetme bağlantılarıyla gönderilir.",
  placeholders: ["name", "plan", "date"],
  sample: () => ({
    name: "Ayşe",
    plan: SAMPLE_PLAN,
    manageUrl: SAMPLE_MANAGE,
    date: inDays(3),
    items: SAMPLE_ITEMS,
    skipUrl: `${SAMPLE_MANAGE}?atla=ornek`,
    card: true,
  }),
  variables: (data, ctx) => ({ plan: localize(data.plan, ctx.locale), date: day(ctx, data.date) }),
  build: (data, ctx) => {
    const m = ctx.messages.email.subscriptions.reminder;
    const c = ctx.messages.email.subscriptions.common;
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: m.eyebrow, text: m.heading },
      { type: "paragraph", text: m.intro },
      { type: "orderLines", title: c.items, lines: itemLines(data.items, ctx) },
      { type: "paragraph", text: c.priceNote, tone: "muted", size: "sm" },
    ];
    if (data.card) blocks.push({ type: "notice", text: m.cardNote, tone: "info" });
    blocks.push(
      { type: "paragraph", text: m.skipNote },
      { type: "button", label: m.skip, url: data.skipUrl },
      { type: "button", label: c.manage, url: data.manageUrl, variant: "secondary" },
    );
    return { subject: m.subject, preheader: m.preheader, blocks };
  },
});

export const subscriptionPaymentDueEmail = defineEmailTemplate({
  key: "subscription_payment_due",
  audience: "customer",
  label: "Abonelik ödemesi bekleniyor",
  description: "Kartla ödenen aboneliklerde yenileme siparişi oluşturulunca ödeme bağlantısıyla gönderilir; süre Ayarlar › Abonelik'teki ödeme süresidir.",
  placeholders: ["name", "plan", "orderNumber", "deadline"],
  sample: () => ({
    name: "Ayşe",
    plan: SAMPLE_PLAN,
    manageUrl: SAMPLE_MANAGE,
    orderNumber: "PR-261042",
    deadline: inDays(3),
    total: 28481,
    payUrl: "https://prestij.com.tr/tr/siparis/PR-261042?t=ornek",
    items: SAMPLE_ITEMS,
  }),
  variables: (data, ctx) => ({ plan: localize(data.plan, ctx.locale), deadline: ctx.formatDate(data.deadline) }),
  build: (data, ctx) => {
    const m = ctx.messages.email.subscriptions.paymentDue;
    const c = ctx.messages.email.subscriptions.common;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "orderLines", title: c.items, lines: itemLines(data.items, ctx) },
        { type: "totals", rows: [{ label: m.total, value: ctx.formatPrice(data.total), kind: "total" }] },
        { type: "button", label: m.button, url: data.payUrl },
        { type: "paragraph", text: m.expiry, tone: "muted", size: "sm" },
        { type: "button", label: c.manage, url: data.manageUrl, variant: "secondary" },
      ],
    };
  },
});

export const subscriptionRenewalFailedEmail = defineEmailTemplate({
  key: "subscription_renewal_failed",
  audience: "customer",
  label: "Abonelik siparişi oluşturulamadı",
  description: "Yenileme günü sipariş oluşturulamazsa (stok tükendi, ürün satıştan kalktı, ödeme yöntemi kapalı) dönem başına bir kez gönderilir; ertesi gün yeniden denenir.",
  placeholders: ["name", "plan"],
  sample: () => ({ name: "Ayşe", plan: SAMPLE_PLAN, manageUrl: SAMPLE_MANAGE, reason: "out_of_stock" }),
  variables: (data, ctx) => ({ plan: localize(data.plan, ctx.locale) }),
  build: (data, ctx) => {
    const m = ctx.messages.email.subscriptions.renewalFailed;
    const c = ctx.messages.email.subscriptions.common;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "notice", text: m.reasons[data.reason] ?? m.reasons.out_of_stock, tone: "warning" },
        { type: "button", label: c.manage, url: data.manageUrl },
      ],
    };
  },
});

export const subscriptionChangedEmail = defineEmailTemplate({
  key: "subscription_changed",
  audience: "customer",
  label: "Abonelik güncellendi",
  description: "Müşteri (veya panelden ekip) aboneliği duraklattığında, devam ettirdiğinde, teslimat atladığında, planını ya da adresini değiştirdiğinde veya iptal ettiğinde gönderilir.",
  placeholders: ["name", "plan"],
  sample: () => ({ name: "Ayşe", plan: SAMPLE_PLAN, manageUrl: SAMPLE_MANAGE, kind: "skipped", date: inDays(3), next: inDays(33) }),
  variables: (data, ctx) => ({ plan: localize(data.plan, ctx.locale), date: day(ctx, data.date), next: day(ctx, data.next) }),
  build: (data, ctx) => {
    const m = ctx.messages.email.subscriptions.changed;
    const c = ctx.messages.email.subscriptions.common;
    const detail = ctx.format(m.kinds[data.kind] ?? m.kinds.address, {
      plan: localize(data.plan, ctx.locale),
      date: day(ctx, data.date),
      next: day(ctx, data.next),
    });
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "notice", text: detail, tone: data.kind === "cancelled" || data.kind === "paused" ? "info" : "success" },
        ...(data.kind === "cancelled" ? [] : [{ type: "button" as const, label: c.manage, url: data.manageUrl }]),
      ],
    };
  },
});
