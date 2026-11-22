// The transactional outbox. enqueueEmail renders the mail and inserts it in the CALLER's transaction
// (so it exists exactly when the business change commits); flushEmailQueue sends due rows; after()
// triggers a flush right after the response. No Next request APIs apart from after(), which is
// optional (outside a request it is skipped and the emails.flush job sends later).
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { db, schema } from "@/db";
import { safeErrorInfo } from "@/lib/db-errors";
import type { Tx } from "@/lib/panel/tx";
import { fromHeader, getEmailDriver, isEmailAddress, type EmailDriver } from "./drivers";
import { loadEmailEnvironment, loadEmailSettings } from "./environment";
import { AUTH_LINK_TEMPLATES, redactEmailSecrets } from "./redact";
import { getEmailTemplate } from "./registry";
import { renderTemplate } from "./render";
import "./templates";
import type { EmailDataFor, EmailRelatedType, EmailStatus, EmailTextOverrides, TemplateKey } from "./types";
import { listUnsubscribeHeaders, type UnsubscribeLinks } from "./unsubscribe";

const t = schema.emailMessages;

/** Attempts before a row is marked failed. */
export const EMAIL_MAX_ATTEMPTS = 5;
/** Wait after the 1st, 2nd, 3rd and 4th failed attempt (minutes). */
export const EMAIL_BACKOFF_MINUTES = [1, 5, 15, 60] as const;
/** A row left in "sending" this long (a crashed sender) is claimed again. */
export const EMAIL_STALE_SENDING_MINUTES = 10;
/** Default rows per flush (SMTP sends one by one). */
export const EMAIL_FLUSH_LIMIT = 25;
/**
 * Campaign templates (the marketing ones: `marketing: true` in their definition). A flush claims every due
 * transactional row (verification, password reset, order mails…) before any of these, so a large campaign can
 * never delay an account or order mail (go-live CF-14).
 */
export const CAMPAIGN_EMAIL_TEMPLATES = ["newsletter_campaign", "wheel_prize_reminder"] as const;

export type EnqueueEmailInput<K extends TemplateKey = TemplateKey> = {
  template: K;
  to: string;
  /** "tr" | "en" | "ar"; anything else renders in Turkish. Admin mails: "tr". */
  locale: string;
  data: EmailDataFor<K>;
  related?: { type: EmailRelatedType; id: string | number } | null;
  /** e.g. "order:12:paid:customer": a second enqueue with the same key is a no-op (returns null). */
  dedupeKey?: string | null;
  /** Not sent before (scheduled campaigns, reminders). Default: now. */
  sendAfter?: Date | null;
  /** Panel user who caused the mail (resend, test send); null = the system. */
  createdBy?: string | null;
  /** Marketing templates only (required for them): the reader's unsubscribe links. */
  unsubscribe?: UnsubscribeLinks | null;
};

export type EnqueuedEmail = { id: number; status: EmailStatus };

type InternalOptions = { force?: boolean; overrides?: EmailTextOverrides; subjectPrefix?: string };

/**
 * Renders `template` for `to` in `locale` and queues it inside `tx` (render at enqueue: the log shows
 * exactly what is sent). Returns null when the template is disabled in the panel or `dedupeKey` was
 * already used. An invalid recipient or a template that fails to render is stored as `failed` (visible
 * in the e-mail log) instead of breaking the caller's business transaction. Unknown template keys and
 * marketing mails without unsubscribe links throw (programming errors).
 * After the caller's request, the queue is flushed (after()); in scripts call flushEmailQueue().
 */
export async function enqueueEmail<K extends TemplateKey>(tx: Tx, input: EnqueueEmailInput<K>): Promise<EnqueuedEmail | null> {
  return enqueue(tx, input, {});
}

async function enqueue<K extends TemplateKey>(tx: Tx, input: EnqueueEmailInput<K>, options: InternalOptions): Promise<EnqueuedEmail | null> {
  const template = getEmailTemplate(input.template);
  if (!template) throw new Error(`Unknown e-mail template "${input.template}"`);
  if (template.marketing && !input.unsubscribe) throw new Error(`E-mail template "${input.template}" is a marketing mail: pass unsubscribe links`);

  const env = await loadEmailEnvironment(tx, input.locale);
  if (!options.force && env.emails.templates?.[template.key]?.enabled === false) return null;

  const to = (input.to ?? "").trim();
  const validRecipient = isEmailAddress(to);
  let rendered: { subject: string; html: string; text: string } | null = null;
  let renderError: string | null = null;
  try {
    rendered = renderTemplate(template, input.data, env, { overrides: options.overrides, unsubscribeUrl: input.unsubscribe?.url ?? null });
  } catch (error) {
    renderError = `Şablon oluşturulamadı (${safeErrorInfo(error).name}).`;
    console.error(`[email] render failed template=${template.key}`, safeErrorInfo(error).name);
  }

  const status: EmailStatus = validRecipient && rendered ? "queued" : "failed";
  const subject = rendered ? `${options.subjectPrefix ?? ""}${rendered.subject}` : `[${template.key}]`;
  const [row] = await tx
    .insert(t)
    .values({
      template: template.key,
      toEmail: to.slice(0, 320),
      locale: env.locale,
      subject,
      html: rendered?.html ?? "",
      text: rendered?.text ?? "",
      headers: template.marketing && input.unsubscribe ? listUnsubscribeHeaders(input.unsubscribe) : null,
      status,
      lastError: renderError ?? (validRecipient ? null : "Geçersiz alıcı adresi."),
      relatedType: input.related?.type ?? null,
      relatedId: input.related ? String(input.related.id) : null,
      dedupeKey: input.dedupeKey?.trim() || null,
      createdBy: input.createdBy ?? null,
      ...(input.sendAfter ? { sendAfter: input.sendAfter } : {}),
    })
    // The only unique key besides the identity id is the partial dedupe_key index.
    .onConflictDoNothing()
    .returning({ id: t.id, status: t.status });
  if (!row) return null;
  if (row.status === "queued") scheduleEmailFlush();
  return row;
}

// ---------------------------------------------------------------------------------------------
// Flush

export type FlushEmailOptions = {
  /** Rows per call (default 25). */
  limit?: number;
  /** Only these rows (tests, "send now" of one message). */
  ids?: number[];
  /** Default: the configured driver (getEmailDriver()). */
  driver?: EmailDriver | null;
  /** Clock for the due / backoff checks (tests). Default: the database's now(). */
  now?: Date;
};

export type FlushEmailResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  /** 1 when no driver is configured (production without SMTP): nothing was claimed. */
  notConfigured: number;
};

type ClaimedRow = {
  id: number;
  template: string;
  toEmail: string;
  locale: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string> | null;
  attempts: number;
};

/** Short, secret-free reason for last_error: error code + message with URLs and addresses masked. */
export function sendErrorReason(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown; message?: unknown; name?: unknown };
  const code = typeof e.code === "string" ? e.code : null;
  const response = typeof e.responseCode === "number" ? String(e.responseCode) : null;
  const message = (typeof e.message === "string" ? e.message : "")
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/[^\s<>@"']+@[^\s<>@"']+/g, "<adres>")
    .replace(/\s+/g, " ")
    .trim();
  const reason = [code, response, message].filter(Boolean).join(" ").slice(0, 200);
  return reason || (typeof e.name === "string" ? e.name : "Gönderilemedi");
}

/**
 * Sends due rows: claims up to `limit` of them with FOR UPDATE SKIP LOCKED (concurrent flushes never
 * take the same row), transactional mails before campaign mails (CAMPAIGN_EMAIL_TEMPLATES), marks each
 * `sent`, or re-queues it with backoff (1, 5, 15, 60 min) and marks it `failed` after 5 attempts. Never
 * throws. Without a configured driver it claims nothing.
 */
export async function flushEmailQueue(options: FlushEmailOptions = {}): Promise<FlushEmailResult> {
  const result: FlushEmailResult = { claimed: 0, sent: 0, retried: 0, failed: 0, notConfigured: 0 };
  try {
    const driver = options.driver === undefined ? getEmailDriver() : options.driver;
    if (!driver) {
      result.notConfigured = 1;
      return result;
    }
    if (options.ids && options.ids.length === 0) return result;
    const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? EMAIL_FLUSH_LIMIT)));
    const now = options.now ? sql`${options.now.toISOString()}::timestamptz` : sql`now()`;
    const onlyIds = options.ids
      ? sql`and ${t.id} in (${sql.join(
          options.ids.map((id) => sql`${Math.trunc(id)}`),
          sql`, `,
        )})`
      : sql``;

    // The pick runs once in a MATERIALIZED CTE: `where id in (select … limit n for update skip locked)` lets the
    // planner re-run the subquery (semi-join), which can claim more than `limit` rows.
    const claimed = await db.execute<ClaimedRow>(sql`
      with picked as materialized (
        select ${t.id} as "pickedId" from ${t}
        where (
          (${t.status} = 'queued' and ${t.sendAfter} <= ${now})
          -- Staleness is about real time since the claim (updated_at is the claim's now()), never the test clock.
          or (${t.status} = 'sending' and ${t.updatedAt} < now() - make_interval(mins => ${EMAIL_STALE_SENDING_MINUTES}))
        ) ${onlyIds}
        -- Transactional mails first (CAMPAIGN_EMAIL_TEMPLATES last), then oldest due first.
        order by (${t.template} in (${sql.join(
          CAMPAIGN_EMAIL_TEMPLATES.map((key) => sql`${key}`),
          sql`, `,
        )})), ${t.sendAfter}, ${t.id}
        limit ${limit}
        for update skip locked
      )
      update ${t} set status = 'sending', attempts = ${t.attempts} + 1, updated_at = now()
      from picked
      where ${t.id} = picked."pickedId"
      returning ${t.id} as "id", ${t.template} as "template", ${t.toEmail} as "toEmail", ${t.locale} as "locale",
        ${t.subject} as "subject", ${t.html} as "html", ${t.text} as "text", ${t.headers} as "headers", ${t.attempts} as "attempts"`);
    const campaign = (row: ClaimedRow) => ((CAMPAIGN_EMAIL_TEMPLATES as readonly string[]).includes(row.template) ? 1 : 0);
    const rows = [...claimed].sort((a, b) => campaign(a) - campaign(b) || a.id - b.id);
    result.claimed = rows.length;
    if (rows.length === 0) return result;

    const settings = await loadEmailSettings();
    const from = fromHeader(settings.emails.fromName);
    const replyCandidate = settings.emails.replyTo.trim() || settings.general.email.trim();
    const replyTo = isEmailAddress(replyCandidate) ? replyCandidate : null;

    for (const row of rows) {
      try {
        await driver.send({
          id: row.id,
          template: row.template,
          locale: row.locale,
          to: row.toEmail,
          from,
          replyTo,
          subject: row.subject,
          html: row.html,
          text: row.text,
          headers: row.headers ?? {},
        });
        // Account links (reset / verification) are credentials: once sent, the log keeps no usable copy.
        const scrub = AUTH_LINK_TEMPLATES.has(row.template) ? { html: redactEmailSecrets(row.html), text: redactEmailSecrets(row.text) } : {};
        await db
          .update(t)
          .set({ status: "sent", sentAt: sql`now()`, lastError: null, ...scrub })
          .where(and(eq(t.id, row.id), eq(t.status, "sending")));
        result.sent++;
      } catch (error) {
        const reason = sendErrorReason(error);
        const attempts = Number(row.attempts);
        if (attempts >= EMAIL_MAX_ATTEMPTS) {
          await db
            .update(t)
            .set({ status: "failed", lastError: reason })
            .where(and(eq(t.id, row.id), eq(t.status, "sending")));
          result.failed++;
        } else {
          const wait = EMAIL_BACKOFF_MINUTES[Math.min(attempts, EMAIL_BACKOFF_MINUTES.length) - 1] ?? 60;
          await db
            .update(t)
            .set({ status: "queued", lastError: reason, sendAfter: sql`${now} + make_interval(mins => ${wait})` })
            .where(and(eq(t.id, row.id), eq(t.status, "sending")));
          result.retried++;
        }
        console.warn(`[email] send failed id=${row.id} template=${row.template} attempt=${attempts}`, (error as { code?: unknown })?.code ?? safeErrorInfo(error).name);
      }
    }
  } catch (error) {
    console.error("[email] flush failed", safeErrorInfo(error));
  }
  return result;
}

// One flush at a time per server instance; a request that queues while a flush runs makes it go again.
const flushState = globalThis as typeof globalThis & { __prestijEmailFlush?: { running: Promise<void> | null; again: boolean } };
const state = (flushState.__prestijEmailFlush ??= { running: null, again: false });

function flushSoon(): Promise<void> {
  if (state.running) {
    state.again = true;
    return state.running;
  }
  state.running = (async () => {
    try {
      let rounds = 0;
      do {
        state.again = false;
        const r = await flushEmailQueue();
        // Stop when idle, misconfigured, or after a few rounds (the job picks up the rest).
        if (r.claimed < EMAIL_FLUSH_LIMIT && !state.again) break;
      } while (++rounds < 4);
    } finally {
      state.running = null;
    }
  })();
  return state.running;
}

/**
 * Flushes the queue right after the current response (after()). Outside a request scope (scripts, DB
 * tests) it does nothing and returns false: call `await flushEmailQueue()` after your transaction, or
 * let the emails.flush job send.
 */
export function scheduleEmailFlush(): boolean {
  try {
    after(() => flushSoon());
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Panel helpers (NOTIFY's e-mail log)

/** Cancels a queued row (no-op for any other status). Returns true when cancelled. */
export async function cancelQueuedEmail(tx: Tx, id: number): Promise<boolean> {
  const rows = await tx
    .update(t)
    .set({ status: "cancelled" })
    .where(and(eq(t.id, id), eq(t.status, "queued")))
    .returning({ id: t.id });
  return rows.length > 0;
}

/**
 * "Tekrar gönder": queues a copy of a stored message (same subject, body and headers; no dedupe key)
 * so the log keeps both. Returns the new row, or null when the original does not exist or is an
 * account link mail (password reset, verification: AUTH_LINK_TEMPLATES), which is never re-sent from a
 * stored copy (the customer requests a fresh link on the site).
 */
export async function requeueEmail(tx: Tx, id: number, options: { createdBy?: string | null } = {}): Promise<EnqueuedEmail | null> {
  const [original] = await tx.select().from(t).where(eq(t.id, id)).limit(1);
  if (!original || !original.html || AUTH_LINK_TEMPLATES.has(original.template)) return null;
  const status: EmailStatus = isEmailAddress(original.toEmail) ? "queued" : "failed";
  const [row] = await tx
    .insert(t)
    .values({
      template: original.template,
      toEmail: original.toEmail,
      locale: original.locale,
      subject: original.subject,
      html: original.html,
      text: original.text,
      headers: original.headers,
      status,
      lastError: status === "failed" ? "Geçersiz alıcı adresi." : null,
      relatedType: original.relatedType,
      relatedId: original.relatedId,
      createdBy: options.createdBy ?? null,
    })
    .returning({ id: t.id, status: t.status });
  if (row?.status === "queued") scheduleEmailFlush();
  return row ?? null;
}

/** Internal: test sends ignore the "enabled" switch and mark the subject. */
export function enqueueTestEmail<K extends TemplateKey>(tx: Tx, input: EnqueueEmailInput<K>, overrides?: EmailTextOverrides): Promise<EnqueuedEmail | null> {
  return enqueue(tx, input, { force: true, overrides, subjectPrefix: "[Test] " });
}
