// WHEEL-SERVER e-mails (day 6, gift wheel):
//   wheel_prize           sent when a prize is issued (claim): prize, code, expiry, conditions, links.
//                         Transactional: the customer asked for the prize.
//   wheel_prize_reminder  job wheel.remind, about a day before an unused prize expires, ONLY to accounts
//                         with a confirmed (active) newsletter subscription; sent as a marketing mail
//                         (unsubscribe link + List-Unsubscribe headers). Lawyer to confirm (contract §1.1).
// Both can be switched off and their subject/intro edited in the panel (E-postalar) like every template.
// Texts: messages.email.wheel (src/i18n/messages/{tr,en,ar}.ts), every line editable under Arayüz Metinleri.
// Voice "siz", like the rest of the site and the wheel's storefront texts (lead decision D1).
import type { CouponType } from "@/db/schema/commerce";
import type { Locale, LocalizedText } from "@/i18n/locales";
import { defaultMessages } from "@/i18n/messages";
import type { Messages } from "@/i18n/messages/tr";
import { prizeLabel } from "@/lib/wheel/prize";
import { defineEmailTemplate } from "../registry";
import type { EmailBlock, EmailBuildContext } from "../types";

export type WheelPrizeEmailData = {
  /** First name (or the e-mail's local part). */
  name: string;
  /** The won slice's label (snapshot); the mail picks its own language. */
  prize: LocalizedText;
  type: CouponType;
  /** Percent, kuruş or 0 (free shipping), as on the coupon. */
  value: number;
  /** Minimum basket in kuruş (0 = none). */
  minOrderTotal: number;
  code: string;
  /** Coupon ends_at (ISO): the real expiry. */
  endsAt: string;
  /** Absolute links in the mail's language. */
  cartUrl: string;
  shopUrl: string;
  /** Free shipping only: the heavy-parcel surcharge is on in the shipping settings. */
  heavySurcharge?: boolean;
};

export type WheelPrizeReminderEmailData = WheelPrizeEmailData;

declare module "../types" {
  interface EmailTemplateRegistry {
    wheel_prize: WheelPrizeEmailData;
    wheel_prize_reminder: WheelPrizeReminderEmailData;
  }
}

export type WheelEmailTexts = Messages["email"]["wheel"];

/** The texts per language: the dictionary's `email.wheel` group (built-in defaults, no panel overrides). */
export const WHEEL_EMAIL_TEXTS: Record<Locale, WheelEmailTexts> = {
  tr: defaultMessages.tr.email.wheel,
  en: defaultMessages.en.email.wheel,
  ar: defaultMessages.ar.email.wheel,
};

/** The mail's texts: the dictionary's `email.wheel` group, with the panel's Arayüz Metinleri overrides. */
export function wheelEmailTexts(ctx: Pick<EmailBuildContext, "locale" | "messages">): WheelEmailTexts {
  return ctx.messages.email.wheel;
}

const label = (data: WheelPrizeEmailData, ctx: EmailBuildContext) =>
  prizeLabel({ type: data.type, value: data.value, label: data.prize }, ctx.locale, ctx.messages.wheel);

const variables = (data: WheelPrizeEmailData, ctx: EmailBuildContext) => ({
  name: data.name,
  prize: label(data, ctx),
  code: data.code,
  date: ctx.formatDate(data.endsAt),
});

/** Prize, code, expiry and (when set) the minimum basket as a key/value table. */
function detailRows(data: WheelPrizeEmailData, ctx: EmailBuildContext, t: WheelEmailTexts): EmailBlock {
  const rows = [
    { label: t.common.prizeLabel, value: label(data, ctx) },
    { label: t.common.codeLabel, value: data.code },
    { label: t.common.expiresLabel, value: ctx.formatDate(data.endsAt) },
  ];
  if (data.minOrderTotal > 0) rows.push({ label: t.common.minOrderLabel, value: ctx.format(t.common.minOrderValue, { amount: ctx.formatPrice(data.minOrderTotal) }) });
  return { type: "keyValue", rows };
}

const heavyNote = (data: WheelPrizeEmailData, ctx: EmailBuildContext): EmailBlock[] =>
  data.type === "free_shipping" && data.heavySurcharge ? [{ type: "paragraph", text: ctx.messages.wheel.result.freeShippingHeavy, tone: "muted", size: "sm" }] : [];

const SAMPLE: WheelPrizeEmailData = {
  name: "Ayşe",
  prize: { tr: "%10 indirim", en: "10% off", ar: "خصم 10%" },
  type: "percent",
  value: 10,
  minOrderTotal: 30000,
  code: "CARK-7KQ2MX",
  endsAt: "2026-11-15T09:30:00.000Z",
  cartUrl: "https://prestij.com.tr/tr/sepet",
  shopUrl: "https://prestij.com.tr/tr/urunler",
};

export const wheelPrizeEmail = defineEmailTemplate({
  key: "wheel_prize",
  audience: "customer",
  label: "Çark hediyesi tanımlandı",
  description: "Hediye çarkında kazanılan indirim müşterinin hesabına tanımlandığında gönderilir: hediye, kod, son kullanım tarihi ve koşullar.",
  placeholders: ["name", "prize", "code", "date"],
  sample: () => ({ ...SAMPLE, prize: { ...SAMPLE.prize } }),
  variables,
  build: (data, ctx) => {
    const t = wheelEmailTexts(ctx);
    return {
      subject: t.prize.subject,
      preheader: t.prize.preheader,
      blocks: [
        { type: "heading", eyebrow: t.prize.eyebrow, text: t.prize.heading },
        { type: "paragraph", text: t.prize.intro },
        detailRows(data, ctx, t),
        { type: "paragraph", text: t.prize.autoApply },
        ...heavyNote(data, ctx),
        { type: "button", label: t.prize.button, url: data.cartUrl },
        { type: "button", label: t.prize.shop, url: data.shopUrl, variant: "secondary" },
        { type: "paragraph", text: t.prize.terms, tone: "muted", size: "sm" },
        { type: "paragraph", text: t.prize.footer, tone: "muted", size: "sm" },
      ],
    };
  },
});

export const wheelPrizeReminderEmail = defineEmailTemplate({
  key: "wheel_prize_reminder",
  audience: "customer",
  marketing: true,
  label: "Çark hediyesi hatırlatma",
  description:
    "Kullanılmamış çark hediyesinin süresi dolmadan yaklaşık bir gün önce, yalnızca e-bülten aboneliğini onaylamış müşterilere bir kez gönderilir (Hediye Çarkı ayarlarındaki hatırlatma anahtarıyla da kapatılabilir).",
  placeholders: ["name", "prize", "code", "date"],
  sample: () => ({ ...SAMPLE, prize: { ...SAMPLE.prize } }),
  variables,
  build: (data, ctx) => {
    const t = wheelEmailTexts(ctx);
    return {
      subject: t.reminder.subject,
      preheader: t.reminder.preheader,
      blocks: [
        { type: "heading", eyebrow: t.reminder.eyebrow, text: t.reminder.heading },
        { type: "paragraph", text: t.reminder.intro },
        detailRows(data, ctx, t),
        ...heavyNote(data, ctx),
        { type: "button", label: t.reminder.button, url: data.cartUrl },
        { type: "button", label: t.reminder.shop, url: data.shopUrl, variant: "secondary" },
        { type: "paragraph", text: t.prize.terms, tone: "muted", size: "sm" },
      ],
    };
  },
});
