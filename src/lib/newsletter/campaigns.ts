// Newsletter campaigns (/panel/e-bulten/kampanyalar): compose (editor), send or schedule (admin), and
// the batched sending done by the newsletter.send job (and right after "Gönder" in the request). One
// mail per active subscriber in their own language (falls back to Turkish), with the subscriber's
// unsubscribe link and List-Unsubscribe headers. Idempotent: every mail has the dedupe key
// `campaign:<id>:subscriber:<subscriberId>`, and a batch only picks subscribers without one.
// No Next APIs (DB tests call these directly).
import "server-only";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import { isLocale, type Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { enqueueEmail, newsletterUnsubscribeLinks } from "@/lib/email";
import type { AuditEntry } from "@/lib/panel/audit";
import { auditChanges } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { PanelError } from "@/lib/panel/errors";
import { istanbulDateTimeLocal } from "@/lib/panel/format";
import type { Tx } from "@/lib/panel/tx";

const c = schema.emailCampaigns;
const s = schema.newsletterSubscribers;
const m = schema.emailMessages;

export type CampaignAudience = "all" | "retail" | "business";
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent";
export const CAMPAIGN_AUDIENCES: readonly CampaignAudience[] = ["all", "retail", "business"];

/** Mails queued per batch (the contract's 200). */
export const CAMPAIGN_BATCH_SIZE = 200;

export type CampaignFields = { subject: LocalizedText; body: LocalizedText; audience: CampaignAudience };

export type CampaignStats = { recipients: number; queued: number; sent: number; failed: number };

export type CampaignRow = {
  id: number;
  subject: LocalizedText;
  body: LocalizedText;
  audience: CampaignAudience;
  status: CampaignStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  stats: CampaignStats;
};

/** Subscribers a campaign goes to: active, and in the audience (business = an approved company account). */
export function audienceCondition(audience: CampaignAudience): SQL | undefined {
  const business = sql`exists (select 1 from ${schema.user} u join ${schema.companies} co on co.id = u.company_id where lower(u.email) = lower(${s.email}) and co.status = 'approved')`;
  if (audience === "business") return business;
  if (audience === "retail") return sql`not ${business}`;
  return undefined;
}

export async function countCampaignRecipients(executor: Tx, audience: CampaignAudience): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(s)
    .where(and(eq(s.status, "active"), audienceCondition(audience)));
  return row?.n ?? 0;
}

/** Live counts from the e-mail log (what was queued for the campaign and how it went). */
export async function campaignStats(executor: Tx, ids: number[]): Promise<Map<number, CampaignStats>> {
  const out = new Map<number, CampaignStats>();
  if (ids.length === 0) return out;
  const rows = await executor
    .select({ id: m.relatedId, status: m.status, n: sql<number>`count(*)::int` })
    .from(m)
    .where(and(eq(m.relatedType, "campaign"), inArray(m.relatedId, ids.map(String)), sql`${m.dedupeKey} is not null`))
    .groupBy(m.relatedId, m.status);
  for (const r of rows) {
    const id = Number(r.id);
    const stat = out.get(id) ?? { recipients: 0, queued: 0, sent: 0, failed: 0 };
    stat.recipients += r.n;
    if (r.status === "sent") stat.sent += r.n;
    else if (r.status === "failed") stat.failed += r.n;
    else if (r.status === "queued" || r.status === "sending") stat.queued += r.n;
    out.set(id, stat);
  }
  return out;
}

type Raw = typeof c.$inferSelect;

function toRow(r: Raw, stats: CampaignStats | undefined): CampaignRow {
  return {
    id: r.id,
    subject: r.subject,
    body: r.body,
    audience: r.audience,
    status: r.status,
    scheduledAt: r.scheduledAt ? r.scheduledAt.toISOString() : null,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    stats: stats ?? { recipients: r.stats?.recipients ?? 0, queued: 0, sent: r.stats?.sent ?? 0, failed: r.stats?.failed ?? 0 },
  };
}

export async function listCampaigns(executor: Tx, limit = 100): Promise<CampaignRow[]> {
  const rows = await executor.select().from(c).orderBy(desc(c.createdAt), desc(c.id)).limit(limit);
  const stats = await campaignStats(executor, rows.map((r) => r.id));
  return rows.map((r) => toRow(r, stats.get(r.id)));
}

export async function getCampaign(executor: Tx, id: number): Promise<CampaignRow | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await executor.select().from(c).where(eq(c.id, id)).limit(1);
  if (!row) return null;
  const stats = await campaignStats(executor, [row.id]);
  return toRow(row, stats.get(row.id));
}

async function lockCampaign(tx: Tx, id: number) {
  const [row] = await tx.select().from(c).where(eq(c.id, id)).for("update").limit(1);
  if (!row) throw new PanelError("not_found", "Kampanya bulunamadı; silinmiş olabilir.");
  return row;
}

const editable = (status: CampaignStatus) => status === "draft" || status === "scheduled";

export async function createCampaign(tx: Tx, input: CampaignFields, actorId: string | null): Promise<{ id: number; updatedAt: Date; audit: AuditEntry }> {
  const [row] = await tx
    .insert(c)
    .values({ subject: input.subject, body: input.body, audience: input.audience, status: "draft", createdBy: actorId, localeMode: "per_subscriber" })
    .returning({ id: c.id, updatedAt: c.updatedAt });
  return { id: row.id, updatedAt: row.updatedAt, audit: { action: "create", entity: "email_campaign", entityId: row.id, after: { audience: input.audience, subject: input.subject.tr } } };
}

export async function saveCampaign(tx: Tx, input: CampaignFields & { id: number; updatedAt: Date }): Promise<{ updatedAt: Date; audit: AuditEntry }> {
  const row = await lockCampaign(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  if (!editable(row.status)) throw new PanelError("conflict", "Gönderimi başlamış bir kampanya değiştirilemez.");
  const next = { subject: input.subject, body: input.body, audience: input.audience };
  const [saved] = await tx.update(c).set({ ...next, updatedAt: new Date() }).where(eq(c.id, input.id)).returning({ updatedAt: c.updatedAt });
  return {
    updatedAt: saved.updatedAt,
    audit: { action: "update", entity: "email_campaign", entityId: input.id, ...auditChanges({ subject: row.subject, audience: row.audience, body: row.body }, next) },
  };
}

export async function deleteCampaign(tx: Tx, input: { id: number; updatedAt: Date }): Promise<{ audit: AuditEntry }> {
  const row = await lockCampaign(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  if (!editable(row.status)) throw new PanelError("in_use", "Gönderilmiş ya da gönderilmekte olan bir kampanya silinemez; istatistikleri kayıtta kalır.");
  await tx.delete(c).where(eq(c.id, input.id));
  return { audit: { action: "delete", entity: "email_campaign", entityId: input.id, before: { status: row.status, subject: row.subject.tr } } };
}

/**
 * "Gönder" (at = null: now) or "Planla" (a future time). Admin only (the caller checks). Refuses a
 * campaign without recipients, or one that is sending / sent.
 */
export async function scheduleCampaign(
  tx: Tx,
  input: { id: number; updatedAt: Date; at: Date | null },
  options: { now?: Date } = {},
): Promise<{ status: CampaignStatus; recipients: number; updatedAt: Date; audit: AuditEntry }> {
  const now = options.now ?? new Date();
  const row = await lockCampaign(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  if (!editable(row.status)) throw new PanelError("conflict", "Bu kampanyanın gönderimi zaten başladı.");
  if (input.at && input.at.getTime() < now.getTime() + 60_000) throw new PanelError("invalid", "Planlanan zaman en az bir dakika sonrası olmalı.", { at: "Gelecekte bir zaman seçin." });
  const recipients = await countCampaignRecipients(tx, row.audience);
  if (recipients === 0) throw new PanelError("invalid", "Bu kitlede onaylı (aktif) abone yok; kampanya gönderilemez.");
  const status: CampaignStatus = input.at ? "scheduled" : "sending";
  const [saved] = await tx
    .update(c)
    .set({ status, scheduledAt: input.at ?? now, stats: { recipients }, updatedAt: now })
    .where(eq(c.id, input.id))
    .returning({ updatedAt: c.updatedAt });
  return {
    status,
    recipients,
    updatedAt: saved.updatedAt,
    audit: { action: "status", entity: "email_campaign", entityId: input.id, before: { status: row.status }, after: { status, scheduledAt: (input.at ?? now).toISOString(), recipients } },
  };
}

/** Takes a scheduled campaign back to draft. */
export async function unscheduleCampaign(tx: Tx, input: { id: number; updatedAt: Date }): Promise<{ updatedAt: Date; audit: AuditEntry }> {
  const row = await lockCampaign(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  if (row.status !== "scheduled") throw new PanelError("conflict", "Kampanya planlı değil; sayfayı yenileyin.");
  const [saved] = await tx.update(c).set({ status: "draft", scheduledAt: null, updatedAt: new Date() }).where(eq(c.id, input.id)).returning({ updatedAt: c.updatedAt });
  return { updatedAt: saved.updatedAt, audit: { action: "status", entity: "email_campaign", entityId: input.id, before: { status: "scheduled" }, after: { status: "draft" } } };
}

/** Suggested schedule time for the editor: tomorrow 10:00 Istanbul ("YYYY-MM-DDTHH:mm"). */
export function defaultCampaignScheduleAt(now: Date = new Date()): string {
  return `${istanbulDateTimeLocal(new Date(now.getTime() + 24 * 3600_000)).slice(0, 11)}10:00`;
}

/** Subject and body of a campaign for one reader's language (Turkish when there is no translation). */
export function campaignContentFor(campaign: { subject: LocalizedText; body: LocalizedText }, locale: Locale): { subject: string; html: string } {
  return { subject: localize(campaign.subject, locale) || campaign.subject.tr, html: localize(campaign.body, locale) || campaign.body.tr };
}

/**
 * One batch for one campaign in `tx`: locks the campaign (SKIP LOCKED: a concurrent run moves on),
 * queues up to `batchSize` mails to active audience subscribers that have none yet, and marks the
 * campaign sent when nobody is left. Returns null when the campaign is not sending or is locked.
 */
export async function sendCampaignBatch(
  tx: Tx,
  campaignId: number,
  options: { batchSize?: number; now?: Date; /** DB tests on the shared DB: only these subscriber ids. */ onlySubscribers?: number[] } = {},
): Promise<{ queued: number; done: boolean } | null> {
  const batchSize = Math.max(1, Math.min(1000, options.batchSize ?? CAMPAIGN_BATCH_SIZE));
  const [campaign] = await tx.select().from(c).where(and(eq(c.id, campaignId), eq(c.status, "sending"))).for("update", { skipLocked: true }).limit(1);
  if (!campaign) return null;
  const dedupe = sql`'campaign:' || ${campaign.id}::text || ':subscriber:' || ${s.id}::text`;
  const candidates = await tx
    .select({ id: s.id, email: s.email, locale: s.locale })
    .from(s)
    .where(
      and(
        eq(s.status, "active"),
        audienceCondition(campaign.audience),
        options.onlySubscribers ? inArray(s.id, options.onlySubscribers.length ? options.onlySubscribers : [0]) : undefined,
        sql`not exists (select 1 from ${m} where ${m.dedupeKey} = ${dedupe})`,
      ),
    )
    .orderBy(asc(s.id))
    .limit(batchSize);

  let queued = 0;
  for (const sub of candidates) {
    const locale: Locale = isLocale(sub.locale) ? sub.locale : "tr";
    const content = campaignContentFor(campaign, locale);
    const row = await enqueueEmail(tx, {
      template: "newsletter_campaign",
      to: sub.email,
      locale,
      data: { subject: content.subject, html: content.html, preheader: null },
      related: { type: "campaign", id: campaign.id },
      dedupeKey: `campaign:${campaign.id}:subscriber:${sub.id}`,
      createdBy: campaign.createdBy,
      unsubscribe: newsletterUnsubscribeLinks(sub.id, locale),
    });
    if (row) queued++;
  }

  const done = candidates.length < batchSize;
  const [{ total }] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(m)
    .where(and(eq(m.relatedType, "campaign"), eq(m.relatedId, String(campaign.id)), sql`${m.dedupeKey} is not null`));
  await tx
    .update(c)
    .set({
      stats: { ...(campaign.stats ?? {}), recipients: total },
      ...(done ? { status: "sent" as const, sentAt: options.now ?? new Date() } : {}),
      updatedAt: options.now ?? new Date(),
    })
    .where(eq(c.id, campaign.id));
  return { queued, done };
}

/**
 * The newsletter.send job: due scheduled campaigns start sending, then every sending campaign gets
 * batches until `maxBatches` are used (the next run continues). Safe to run twice at once (row locks
 * with SKIP LOCKED + dedupe keys). `only` limits the run to some campaigns (DB tests on a shared DB).
 */
export async function processCampaigns(
  options: { now?: Date; batchSize?: number; maxBatches?: number; only?: number[]; onlySubscribers?: number[] } = {},
): Promise<{ started: number; batches: number; queued: number; completed: number }> {
  const now = options.now ?? new Date();
  const only = options.only?.length ? inArray(c.id, options.only) : undefined;
  const started = await db
    .update(c)
    .set({ status: "sending", updatedAt: now })
    .where(and(eq(c.status, "scheduled"), sql`${c.scheduledAt} <= ${now.toISOString()}::timestamptz`, only))
    .returning({ id: c.id });
  const result = { started: started.length, batches: 0, queued: 0, completed: 0 };
  const maxBatches = Math.max(1, options.maxBatches ?? 10);
  const sending = await db.select({ id: c.id }).from(c).where(and(eq(c.status, "sending"), only)).orderBy(asc(c.id));
  for (const { id } of sending) {
    while (result.batches < maxBatches) {
      const batch = await db.transaction((tx) => sendCampaignBatch(tx, id, { batchSize: options.batchSize, now, onlySubscribers: options.onlySubscribers }));
      if (!batch) break;
      result.batches++;
      result.queued += batch.queued;
      if (batch.done) {
        result.completed++;
        break;
      }
    }
    if (result.batches >= maxBatches) break;
  }
  return result;
}
