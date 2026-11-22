// ACCOUNTS e-mails: `welcome` (after the e-mail address is verified) and `password_changed` (after a
// password reset or a change on /hesap/profil). Texts: messages.email.accounts (tr/en/ar, overridable
// under Arayüz Metinleri) plus the subject/intro overrides in settings.emails.templates.
import { defineEmailTemplate } from "../registry";

export type WelcomeEmailData = {
  /** First name (or the e-mail's local part). */
  name: string;
  /** Absolute links to the account overview and the products list. */
  accountUrl: string;
  shopUrl: string;
  /** Guest orders with this e-mail that were linked to the new account. */
  linkedOrders: number;
};

export type PasswordChangedEmailData = {
  name: string;
  /** When the password changed (ISO). */
  changedAt: string;
  /** Absolute link to the forgot-password page. */
  resetUrl: string;
  /** "reset" (forgot-password link) or "change" (profile page). */
  via: "reset" | "change";
};

declare module "../types" {
  interface EmailTemplateRegistry {
    welcome: WelcomeEmailData;
    password_changed: PasswordChangedEmailData;
  }
}

export const welcomeEmail = defineEmailTemplate({
  key: "welcome",
  audience: "customer",
  label: "Hoş geldiniz",
  description: "Müşteri e-posta adresini doğruladığında gönderilir; üye olmadan verdiği siparişler hesaba eklendiyse bunu da bildirir.",
  placeholders: ["name"],
  sample: () => ({ name: "Ayşe", accountUrl: "https://prestij.com.tr/tr/hesap", shopUrl: "https://prestij.com.tr/tr/urunler", linkedOrders: 1 }),
  build: (data, ctx) => {
    const m = ctx.messages.email.accounts.welcome;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        ...(data.linkedOrders > 0
          ? [{ type: "notice" as const, tone: "success" as const, text: ctx.format(m.linkedOrders, { count: data.linkedOrders }) }]
          : []),
        { type: "button", label: m.button, url: data.accountUrl },
        { type: "divider" },
        { type: "heading", level: 2, text: m.benefitsTitle },
        { type: "paragraph", text: [m.benefitOrders, m.benefitAddresses, m.benefitFavorites].map((line) => `• ${line}`).join("\n") },
        { type: "button", label: m.shop, url: data.shopUrl, variant: "secondary" },
        { type: "paragraph", text: m.footer, tone: "muted", size: "sm" },
      ],
    };
  },
});

export const passwordChangedEmail = defineEmailTemplate({
  key: "password_changed",
  audience: "customer",
  label: "Şifre değişti",
  description: "Müşterinin şifresi sıfırlandığında veya profil sayfasından değiştirildiğinde güvenlik bildirimi olarak gönderilir.",
  placeholders: ["name", "date"],
  sample: () => ({ name: "Ayşe", changedAt: "2026-11-10T09:30:00.000Z", resetUrl: "https://prestij.com.tr/tr/hesap/sifremi-unuttum", via: "change" }),
  variables: (data, ctx) => ({ name: data.name, date: ctx.formatDate(data.changedAt) }),
  build: (data, ctx) => {
    const m = ctx.messages.email.accounts.passwordChanged;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "keyValue", rows: [{ label: m.whenLabel, value: ctx.formatDate(data.changedAt) }, { label: m.howLabel, value: data.via === "reset" ? m.viaReset : m.viaChange }] },
        { type: "notice", tone: "warning", title: m.notSelfTitle, text: m.notSelf },
        { type: "button", label: m.button, url: data.resetUrl },
        { type: "paragraph", text: m.footer, tone: "muted", size: "sm" },
      ],
    };
  },
});
