// Everything a render needs from the DB, read fresh (uncached) through the caller's executor, so a mail
// queued inside a transaction sees the same settings the business change saw. No Next APIs: safe in
// Server Actions, route handlers, jobs, scripts and DB tests.
import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { isLocale } from "@/i18n/config";
import { mergeUiStringOverrides } from "@/i18n/get-messages";
import type { Locale } from "@/i18n/locales";
import { siteOrigin } from "@/i18n/paths";
import type { Tx } from "@/lib/panel/tx";
import { parseSettings, type Settings } from "@/lib/settings/types";
import type { EmailRenderEnvironment } from "./render";
import type { EmailSettings } from "./types";

export type EmailSettingsBundle = { general: Settings<"general">; emails: EmailSettings };

/** settings.general + settings.emails, fresh. */
export async function loadEmailSettings(executor: Tx = db): Promise<EmailSettingsBundle> {
  const rows = await executor
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, ["general", "emails"]));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return { general: parseSettings("general", byKey.get("general")), emails: parseSettings("emails", byKey.get("emails")) };
}

// Per-transaction memo: a job that queues 200 campaign mails in one transaction reads settings, theme
// and texts once per locale. Never used for the shared `db` client (settings may change between calls).
const memo = new WeakMap<object, Map<Locale, Promise<EmailRenderEnvironment>>>();

/** The render environment for `locale` (unknown locales fall back to Turkish). */
export function loadEmailEnvironment(executor: Tx, locale: string): Promise<EmailRenderEnvironment> {
  const lang: Locale = isLocale(locale) ? locale : "tr";
  if (executor === (db as unknown as Tx)) return readEnvironment(executor, lang);
  let byLocale = memo.get(executor);
  if (!byLocale) {
    byLocale = new Map();
    memo.set(executor, byLocale);
  }
  let pending = byLocale.get(lang);
  if (!pending) {
    pending = readEnvironment(executor, lang);
    byLocale.set(lang, pending);
    pending.catch(() => byLocale?.delete(lang));
  }
  return pending;
}

async function readEnvironment(executor: Tx, locale: Locale): Promise<EmailRenderEnvironment> {
  const [settings, theme, uiRows] = await Promise.all([
    loadEmailSettings(executor),
    executor.select({ tokens: schema.themes.tokens }).from(schema.themes).where(eq(schema.themes.isDefault, true)).limit(1),
    executor.select({ key: schema.uiStrings.key, value: schema.uiStrings.value }).from(schema.uiStrings),
  ]);
  return {
    locale,
    messages: mergeUiStringOverrides(locale, uiRows),
    general: settings.general,
    emails: settings.emails,
    themeTokens: theme[0]?.tokens,
    siteUrl: siteOrigin(),
  };
}
