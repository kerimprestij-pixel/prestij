// Panel helpers: live preview, test send, built-in texts, admin recipients. Callers check the role
// (templates and sender settings: admin; campaign test send: editor).
import "server-only";
import { db } from "@/db";
import type { Locale } from "@/i18n/locales";
import type { Tx } from "@/lib/panel/tx";
import { isEmailAddress } from "./drivers";
import { loadEmailEnvironment, loadEmailSettings } from "./environment";
import { enqueueTestEmail } from "./queue";
import { getEmailTemplate } from "./registry";
import { renderTemplate, templateDefaults } from "./render";
import "./templates";
import type { EmailTextOverrides, RenderedEmail, TemplateKey } from "./types";
import { newsletterUnsubscribeLinks } from "./unsubscribe";

export type EmailPreview = RenderedEmail & { template: string; locale: Locale };

/** Sample links for marketing previews and test sends (subscriber id 0 never matches a row). */
function sampleUnsubscribe(locale: Locale) {
  return newsletterUnsubscribeLinks(0, locale);
}

/**
 * The template rendered with its sample data and the saved settings, or with unsaved panel edits
 * (`overrides`, for the current locale). Null for an unknown template.
 */
export async function renderEmailPreview(template: string, locale: string, overrides?: EmailTextOverrides): Promise<EmailPreview | null> {
  const tpl = getEmailTemplate(template);
  if (!tpl) return null;
  const env = await loadEmailEnvironment(db, locale);
  const rendered = renderTemplate(tpl, tpl.sample(), env, {
    overrides,
    unsubscribeUrl: tpl.marketing ? sampleUnsubscribe(env.locale).url : null,
  });
  return { ...rendered, template: tpl.key, locale: env.locale };
}

export type TestEmailResult = { ok: true; id: number } | { ok: false; error: string };

/**
 * Queues the template with its sample data to `to` (subject prefixed "[Test] ", sent even when the
 * template is switched off) and flushes after the response. Logged with related type "test".
 */
export async function sendTestEmail(
  template: string,
  to: string,
  locale: string,
  options: { createdBy?: string | null; overrides?: EmailTextOverrides } = {},
): Promise<TestEmailResult> {
  const tpl = getEmailTemplate(template);
  if (!tpl) return { ok: false, error: "Bilinmeyen e-posta şablonu." };
  const recipient = to.trim();
  if (!isEmailAddress(recipient)) return { ok: false, error: "Geçerli bir e-posta adresi girin." };
  const env = await loadEmailEnvironment(db, locale);
  const row = await db.transaction((tx) =>
    enqueueTestEmail(
      tx,
      {
        template: tpl.key as TemplateKey,
        to: recipient,
        locale: env.locale,
        data: tpl.sample() as never,
        related: { type: "test", id: tpl.key },
        createdBy: options.createdBy ?? null,
        unsubscribe: tpl.marketing ? sampleUnsubscribe(env.locale) : null,
      },
      options.overrides,
    ),
  );
  if (!row) return { ok: false, error: "Test e-postası kuyruğa alınamadı." };
  if (row.status !== "queued") return { ok: false, error: "Test e-postası oluşturulamadı. Şablonu kontrol edin." };
  return { ok: true, id: row.id };
}

/**
 * The template's built-in subject and intro for `locale` (with UI text overrides, before the panel's
 * template overrides; placeholders unfilled), for the editor's placeholders and "reset" button.
 */
export async function emailTemplateDefaults(template: string, locale: string): Promise<{ subject: string; intro: string } | null> {
  const tpl = getEmailTemplate(template);
  if (!tpl) return null;
  return templateDefaults(tpl, await loadEmailEnvironment(db, locale));
}

/**
 * Who gets admin notifications: settings.emails.adminRecipients (valid, de-duplicated), else
 * settings.general.email, else nobody ([]).
 */
export async function adminRecipients(executor: Tx = db): Promise<string[]> {
  const { general, emails } = await loadEmailSettings(executor);
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of emails.adminRecipients) {
    const address = raw.trim();
    const key = address.toLowerCase();
    if (isEmailAddress(address) && !seen.has(key)) {
      seen.add(key);
      list.push(address);
    }
  }
  if (list.length > 0) return list;
  const fallback = general.email.trim();
  return isEmailAddress(fallback) ? [fallback] : [];
}
