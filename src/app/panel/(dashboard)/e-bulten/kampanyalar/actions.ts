"use server";
// Newsletter campaign actions. Compose, preview and test send: editor. Send and schedule: admin.
// Campaigns are never cached (no tags; panelAction refreshes the page). Recipients never reach the
// audit log.
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { isLocale } from "@/i18n/config";
import { enqueueEmail, getEmailTemplate, loadEmailEnvironment, newsletterUnsubscribeLinks, scheduleEmailFlush } from "@/lib/email";
import { renderTemplate } from "@/lib/email/render";
import { safeErrorInfo } from "@/lib/db-errors";
import {
  CAMPAIGN_AUDIENCES,
  campaignContentFor,
  countCampaignRecipients,
  createCampaign,
  deleteCampaign,
  processCampaigns,
  saveCampaign,
  scheduleCampaign,
  unscheduleCampaign,
  type CampaignAudience,
} from "@/lib/newsletter/campaigns";
import { panelAction, requirePanelActor } from "@/lib/panel/action";
import { guardTestSend } from "@/lib/panel/emails/test-send";
import { localizedRichInput } from "@/lib/panel/blog/schema";
import { PanelError } from "@/lib/panel/errors";
import { dateTimeInput, idInput, localizedTextOf, updatedAtInput } from "@/lib/panel/schemas";

const audienceInput = z.enum(CAMPAIGN_AUDIENCES as [CampaignAudience, ...CampaignAudience[]], { error: "Bir kitle seçin." });
const bodyInput = localizedRichInput.refine((v) => v !== null, { message: "Kampanya metnini yazın.", path: ["tr"] }).transform((v) => v!);

const fields = {
  subject: localizedTextOf({ max: 150, requiredMessage: "Türkçe konuyu yazın." }),
  body: bodyInput,
  audience: audienceInput,
};

export const createCampaignAction = panelAction({
  minRole: "editor",
  schema: z.object(fields),
  run: async (input, { tx, actor }) => {
    const { id, updatedAt, audit } = await createCampaign(tx, input, actor.user.id);
    return { data: { id, updatedAt: updatedAt.toISOString() }, message: "Kampanya taslağı oluşturuldu.", audit };
  },
});

export const saveCampaignAction = panelAction({
  minRole: "editor",
  schema: z.object({ ...fields, id: idInput, updatedAt: updatedAtInput }),
  run: async (input, { tx }) => {
    const { updatedAt, audit } = await saveCampaign(tx, input);
    return { data: { updatedAt: updatedAt.toISOString() }, message: "Kampanya kaydedildi.", audit };
  },
});

export const deleteCampaignAction = panelAction({
  minRole: "editor",
  schema: z.object({ id: idInput, updatedAt: updatedAtInput }),
  run: async (input, { tx }) => {
    const { audit } = await deleteCampaign(tx, input);
    return { message: "Kampanya silindi.", audit };
  },
});

/** "Gönder" (at empty) or "Planla" (at = a future Istanbul time). Admin only. */
export const sendCampaignAction = panelAction({
  minRole: "admin",
  schema: z.object({ id: idInput, updatedAt: updatedAtInput, at: dateTimeInput }),
  run: async (input, { tx }) => {
    const result = await scheduleCampaign(tx, { id: input.id, updatedAt: input.updatedAt, at: input.at });
    return {
      data: { updatedAt: result.updatedAt.toISOString(), status: result.status, recipients: result.recipients },
      message:
        result.status === "sending"
          ? `Gönderim başladı: ${result.recipients.toLocaleString("tr-TR")} aboneye 200'lük gruplar halinde gönderiliyor.`
          : `Kampanya planlandı (${result.recipients.toLocaleString("tr-TR")} abone).`,
      audit: result.audit,
      afterCommit:
        result.status === "sending"
          ? () => {
              // The first batches right after the response; the newsletter.send job continues.
              // The flushes enqueueEmail schedules from inside this after() start at once (before each
              // batch commits), so flush once more when the batches are stored.
              after(() =>
                processCampaigns({ only: [input.id], maxBatches: 5 })
                  .then(() => void scheduleEmailFlush())
                  .catch((error: unknown) =>
                    console.error(`[newsletter] campaign=${input.id} first batches failed`, safeErrorInfo(error)),
                  ),
              );
            }
          : undefined,
    };
  },
});

export const unscheduleCampaignAction = panelAction({
  minRole: "admin",
  schema: z.object({ id: idInput, updatedAt: updatedAtInput }),
  run: async (input, { tx }) => {
    const { updatedAt, audit } = await unscheduleCampaign(tx, input);
    return { data: { updatedAt: updatedAt.toISOString() }, message: "Planlama kaldırıldı; kampanya taslağa döndü.", audit };
  },
});

const draftSchema = z.object({
  subject: z.object({ tr: z.string().max(300), en: z.string().max(300).optional(), ar: z.string().max(300).optional() }),
  body: z.object({ tr: z.string().max(200_000), en: z.string().max(200_000).optional(), ar: z.string().max(200_000).optional() }),
  locale: z.string(),
});

export type CampaignPreview = { ok: true; subject: string; html: string; text: string } | { ok: false; error: string };

/** The campaign rendered for one language with the unsaved texts (sample unsubscribe link). Editor+. */
export async function previewCampaignAction(input: z.input<typeof draftSchema>): Promise<CampaignPreview> {
  await requirePanelActor("editor");
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success || !isLocale(parsed.data.locale)) return { ok: false, error: "Önizleme isteği geçersiz." };
  const template = getEmailTemplate("newsletter_campaign");
  if (!template) return { ok: false, error: "Kampanya şablonu bulunamadı." };
  const locale = parsed.data.locale;
  const content = campaignContentFor({ subject: parsed.data.subject, body: parsed.data.body }, locale);
  const env = await loadEmailEnvironment(db, locale);
  const rendered = renderTemplate(template, { subject: content.subject || "—", html: content.html, preheader: null }, env, {
    unsubscribeUrl: newsletterUnsubscribeLinks(0, locale).url,
  });
  return { ok: true, subject: rendered.subject, html: rendered.html, text: rendered.text };
}

/** Active subscribers of an audience (shown next to the select and in the send confirmation). Editor+. */
export async function campaignRecipientCountAction(audience: string): Promise<number> {
  await requirePanelActor("editor");
  const parsed = audienceInput.safeParse(audience);
  return parsed.success ? countCampaignRecipients(db, parsed.data) : 0;
}

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:.]{2,}$/;

/** Test send of the unsaved campaign to one address ("[Test] " subject, sample unsubscribe link). Editor+. */
export const testCampaignAction = panelAction({
  minRole: "editor",
  schema: draftSchema.extend({
    to: z
      .string({ error: "Bir e-posta adresi girin." })
      .trim()
      .max(200)
      .refine((v) => EMAIL.test(v), "Geçerli bir e-posta adresi girin."),
  }),
  run: async (input, { tx, actor }) => {
    if (!isLocale(input.locale)) throw new PanelError("invalid", "Geçersiz dil.");
    const content = campaignContentFor({ subject: input.subject, body: input.body }, input.locale);
    if (!content.subject.trim() || !content.html.trim()) throw new PanelError("invalid", "Test için önce konu ve metni yazın.");
    await guardTestSend(tx, { userId: actor.user.id, email: actor.user.email, role: actor.staffRole }, input.to);
    const row = await enqueueEmail(tx, {
      template: "newsletter_campaign",
      to: input.to,
      locale: input.locale,
      data: { subject: `[Test] ${content.subject}`, html: content.html, preheader: null },
      related: { type: "test", id: "newsletter_campaign" },
      createdBy: actor.user.id,
      unsubscribe: newsletterUnsubscribeLinks(0, input.locale),
    });
    if (!row || row.status !== "queued") throw new PanelError("invalid", "Test e-postası oluşturulamadı.");
    return {
      data: { id: row.id },
      message: "Test e-postası kuyruğa alındı; birkaç saniye içinde gönderilir.",
      audit: { action: "create", entity: "email_message", entityId: row.id, after: { template: "newsletter_campaign", test: true, locale: input.locale } },
    };
  },
});
