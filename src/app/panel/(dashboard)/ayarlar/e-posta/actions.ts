"use server";
// E-mail template editor actions (admin): save one template, live preview, test send.
import { z } from "zod";
import { isLocale } from "@/i18n/config";
import { TAGS } from "@/lib/cache-tags";
import { getEmailTemplate, renderEmailPreview, sendTestEmail } from "@/lib/email";
import { panelAction, requirePanelActor } from "@/lib/panel/action";
import { guardTestSend } from "@/lib/panel/emails/test-send";
import { PanelError } from "@/lib/panel/errors";
import {
  checkTemplatePlaceholders,
  emailSenderSaveSchema,
  emailTemplateSaveSchema,
  saveEmailSenderSettings,
  saveEmailTemplateSettings,
} from "@/lib/panel/emails/templates";
import { EMAIL_TEMPLATE_KEY } from "@/lib/settings/types";

/** Sender name, reply-to, admin recipients, footer note (the templates map is kept as stored). */
export const saveEmailSettingsAction = panelAction({
  minRole: "admin",
  schema: emailSenderSaveSchema,
  run: async (input, { tx }) => {
    const { updatedAt, audit } = await saveEmailSenderSettings(tx, input);
    return { data: { updatedAt: updatedAt.toISOString() }, message: "E-posta ayarları kaydedildi.", tags: [TAGS.settings], audit };
  },
});

export const saveEmailTemplateAction = panelAction({
  minRole: "admin",
  schema: emailTemplateSaveSchema,
  run: async (input, { tx }) => {
    const { updatedAt, audit } = await saveEmailTemplateSettings(tx, input);
    return { data: { updatedAt: updatedAt.toISOString() }, message: "Şablon kaydedildi; yeni e-postalar bu metinlerle gönderilir.", tags: [TAGS.settings], audit };
  },
});

const draftSchema = z.object({
  key: z.string().regex(EMAIL_TEMPLATE_KEY),
  locale: z.string(),
  subject: z.string().max(400).optional().nullable(),
  intro: z.string().max(4000).optional().nullable(),
});

export type EmailPreviewResult = { ok: true; subject: string; preheader: string; html: string; text: string } | { ok: false; error: string };

/** Live preview with the unsaved texts of one locale (sample data). Read only, admin. */
export async function previewEmailTemplateAction(input: z.input<typeof draftSchema>): Promise<EmailPreviewResult> {
  await requirePanelActor("admin");
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success || !isLocale(parsed.data.locale)) return { ok: false, error: "Önizleme isteği geçersiz." };
  const { key, locale, subject, intro } = parsed.data;
  const preview = await renderEmailPreview(key, locale, { subject: subject ?? null, intro: intro ?? null });
  if (!preview) return { ok: false, error: "Şablon bulunamadı." };
  return { ok: true, subject: preview.subject, preheader: preview.preheader, html: preview.html, text: preview.text };
}

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:.]{2,}$/;

export const sendTestEmailAction = panelAction({
  minRole: "admin",
  schema: draftSchema.extend({
    to: z
      .string({ error: "Bir e-posta adresi girin." })
      .trim()
      .max(200)
      .refine((v) => EMAIL.test(v), "Geçerli bir e-posta adresi girin."),
  }),
  run: async (input, { tx, actor }) => {
    if (!isLocale(input.locale)) throw new PanelError("invalid", "Geçersiz dil.");
    const template = getEmailTemplate(input.key);
    if (!template) throw new PanelError("not_found", "Şablon bulunamadı.");
    await guardTestSend(tx, { userId: actor.user.id, email: actor.user.email, role: actor.staffRole }, input.to);
    const subject = input.subject?.trim() || null;
    const intro = input.intro?.trim() || null;
    checkTemplatePlaceholders(template.key, {
      subject: subject ? { tr: subject } : null,
      intro: intro ? { tr: intro } : null,
    });
    const result = await sendTestEmail(template.key, input.to, input.locale, { createdBy: actor.user.id, overrides: { subject, intro } });
    if (!result.ok) throw new PanelError("invalid", result.error, { to: result.error });
    return {
      data: { id: result.id },
      message: "Test e-postası kuyruğa alındı; birkaç saniye içinde gönderilir.",
      audit: { action: "create", entity: "email_message", entityId: result.id, after: { template: template.key, test: true, locale: input.locale } },
    };
  },
});
