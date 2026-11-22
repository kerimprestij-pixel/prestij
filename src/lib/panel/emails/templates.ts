// Panel template editor (/panel/ayarlar/e-posta/<key>, admin): saves one template's on/off switch and
// its subject / intro per locale into settings.emails.templates (optimistic lock on the settings row,
// through the core saveSettings so the audit entry and validation match every other settings save).
// No Next APIs: DB tests call it directly.
import "server-only";
import { z } from "zod";
import { LOCALES, type LocalizedText } from "@/i18n/locales";
import { getEmailTemplate, GLOBAL_PLACEHOLDERS, unknownPlaceholders } from "@/lib/email";
import type { AuditEntry } from "@/lib/panel/audit";
import { fieldError, PanelError } from "@/lib/panel/errors";
import { readSettingsRow, saveSettings } from "@/lib/panel/settings/service";
import { emailSettingsInput, settingsVersionInput, type SettingsInput } from "@/lib/panel/settings/schemas";
import type { Tx } from "@/lib/panel/tx";
import { EMAIL_TEMPLATE_KEY, type Settings } from "@/lib/settings/types";

/** Templates the shop cannot work without (account access, double opt-in, campaigns): always on. */
export const REQUIRED_EMAIL_TEMPLATES: readonly string[] = ["account_verify", "password_reset", "newsletter_confirm", "newsletter_campaign"];

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

const localeText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" ? v.trim() : ""))
    .pipe(z.string().max(max, `En fazla ${max} karakter girebilirsiniz.`).refine((v) => !CONTROL_CHARS.test(v), "Metin geçersiz karakterler içeriyor."));

/**
 * Per-locale override text: every language is optional on its own (an English subject may be changed
 * while Turkish keeps the built-in text; the renderer never falls back across languages). Stored as
 * { tr: "" | text, en?, ar? }; all empty → null.
 */
export function perLocaleTextOf(max: number) {
  return z
    .union([z.object({ tr: localeText(max), en: localeText(max), ar: localeText(max) }), z.null()])
    .optional()
    .transform((v): LocalizedText | null => {
      if (!v || (!v.tr && !v.en && !v.ar)) return null;
      const out: LocalizedText = { tr: v.tr };
      if (v.en) out.en = v.en;
      if (v.ar) out.ar = v.ar;
      return out;
    });
}

export const emailTemplateSaveSchema = z.object({
  key: z.string().regex(EMAIL_TEMPLATE_KEY, "Geçersiz şablon."),
  enabled: z.boolean(),
  subject: perLocaleTextOf(200),
  intro: perLocaleTextOf(2000),
  updatedAt: settingsVersionInput,
});

/** Sender settings (Ayarlar → E-posta): everything but the templates, which the template editor owns. */
export const emailSenderSaveSchema = emailSettingsInput.omit({ templates: true }).extend({ updatedAt: settingsVersionInput });
export type EmailSenderSaveInput = z.output<typeof emailSenderSaveSchema>;

/** Saves the sender settings; the stored templates are kept as they are. */
export async function saveEmailSenderSettings(tx: Tx, input: EmailSenderSaveInput): Promise<{ updatedAt: Date; audit: AuditEntry }> {
  const { updatedAt, ...fields } = input;
  const row = await readSettingsRow("emails", tx);
  const saved = await saveSettings(tx, "emails", { value: { ...row.value, ...fields, templates: row.value.templates } as SettingsInput<"emails">, updatedAt });
  return { updatedAt: saved.updatedAt, audit: saved.audit };
}

export type EmailTemplateSaveInput = z.output<typeof emailTemplateSaveSchema>;

function placeholderList(names: readonly string[]): string {
  return names.map((n) => `{${n}}`).join(", ");
}

/** Validates the placeholders of a draft (unknown names → field error on `<field>.<locale>`). */
export function checkTemplatePlaceholders(key: string, draft: { subject: LocalizedText | null; intro: LocalizedText | null }): void {
  const template = getEmailTemplate(key);
  if (!template) throw new PanelError("not_found", "Şablon bulunamadı.");
  const allowed = [...template.placeholders, ...GLOBAL_PLACEHOLDERS];
  const errors: Record<string, string> = {};
  for (const field of ["subject", "intro"] as const) {
    const text = draft[field];
    if (!text) continue;
    for (const locale of LOCALES) {
      const bad = unknownPlaceholders(text[locale], allowed);
      if (bad.length > 0) {
        errors[`${field}.${locale}`] = `Bu şablonda ${placeholderList(bad)} kullanılamaz. Kullanılabilenler: ${placeholderList(allowed)}.`;
      }
      if (field === "subject" && /[\r\n]/.test(text[locale] ?? "")) errors[`${field}.${locale}`] = "Konu tek satır olmalı.";
    }
  }
  if (Object.keys(errors).length > 0) throw new PanelError("invalid", "Bazı alanlar düzeltilmeli.", errors);
}

/**
 * Saves one template's settings. A template that is on and has no own texts is removed from the map
 * (built-in texts, nothing stored). Admin audience templates keep Turkish texts only.
 */
export async function saveEmailTemplateSettings(tx: Tx, input: EmailTemplateSaveInput): Promise<{ updatedAt: Date; audit: AuditEntry }> {
  const template = getEmailTemplate(input.key);
  if (!template) throw new PanelError("not_found", "Şablon bulunamadı.");
  if (!input.enabled && REQUIRED_EMAIL_TEMPLATES.includes(template.key)) {
    throw fieldError("enabled", "Bu e-posta kapatılamaz: müşterilerin hesabına erişmesi veya bülten onayı için gereklidir.");
  }
  const onlyTr = (text: LocalizedText | null): LocalizedText | null => (text && template.audience === "admin" ? { tr: text.tr } : text);
  const subject = template.marketing ? null : onlyTr(input.subject);
  const intro = template.marketing ? null : onlyTr(input.intro);
  checkTemplatePlaceholders(template.key, { subject, intro });

  const row = await readSettingsRow("emails", tx);
  const templates: Settings<"emails">["templates"] = { ...row.value.templates };
  if (input.enabled && !subject && !intro) delete templates[template.key];
  else templates[template.key] = { enabled: input.enabled, ...(subject ? { subject } : {}), ...(intro ? { intro } : {}) };

  const saved = await saveSettings(tx, "emails", { value: { ...row.value, templates } as SettingsInput<"emails">, updatedAt: input.updatedAt });
  return { updatedAt: saved.updatedAt, audit: saved.audit };
}
