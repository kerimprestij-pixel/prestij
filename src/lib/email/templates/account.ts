// Core account e-mails (CORE-COMMS): e-mail verification and password reset, sent by Better Auth's
// hooks in src/lib/auth.ts. Texts come from the `email` message group (overridable in the panel under
// Arayüz Metinleri) and the subject/intro overrides in settings.emails.templates.
import { defineEmailTemplate } from "../registry";

export type AccountLinkEmailData = {
  /** The customer's name (first name or full name). */
  name: string;
  /** Absolute link to /hesap/dogrula?token=… or /hesap/sifre-sifirla?token=…. */
  url: string;
};

declare module "../types" {
  interface EmailTemplateRegistry {
    account_verify: AccountLinkEmailData;
    password_reset: AccountLinkEmailData;
  }
}

export const accountVerifyEmail = defineEmailTemplate({
  key: "account_verify",
  audience: "customer",
  label: "Hesap doğrulama",
  description: "Üye olan müşteriye e-posta adresini doğrulaması için gönderilir (bağlantı 24 saat geçerlidir).",
  placeholders: ["name"],
  sample: () => ({ name: "Ayşe", url: "https://prestij.com.tr/tr/hesap/dogrula?token=ornek" }),
  build: (data, ctx) => {
    const m = ctx.messages.email.accountVerify;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "button", label: m.button, url: data.url, showUrl: true },
        { type: "paragraph", text: m.expiry, tone: "muted", size: "sm" },
        { type: "paragraph", text: m.ignore, tone: "muted", size: "sm" },
      ],
    };
  },
});

export const passwordResetEmail = defineEmailTemplate({
  key: "password_reset",
  audience: "customer",
  label: "Şifre sıfırlama",
  description: "Şifresini unutan kullanıcıya yeni şifre belirleme bağlantısı gönderilir (1 saat geçerlidir, tek kullanımlık).",
  placeholders: ["name"],
  sample: () => ({ name: "Ayşe", url: "https://prestij.com.tr/tr/hesap/sifre-sifirla?token=ornek" }),
  build: (data, ctx) => {
    const m = ctx.messages.email.passwordReset;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "button", label: m.button, url: data.url, showUrl: true },
        { type: "paragraph", text: m.expiry, tone: "muted", size: "sm" },
        { type: "paragraph", text: m.ignore, tone: "muted", size: "sm" },
      ],
    };
  },
});
