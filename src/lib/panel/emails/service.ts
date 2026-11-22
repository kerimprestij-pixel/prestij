// The panel's e-mail log (/panel/e-postalar, staff): list with filters, one message, the mails of an
// order, resend and cancel. No Next APIs (DB tests call these directly). Recipients are personal data:
// they are shown to staff but never written to the audit log. Secret link values (password reset,
// verification, order / newsletter / review / skip links) are never returned (src/lib/email/redact.ts).
import "server-only";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";
import { cancelQueuedEmail, getEmailTemplate, requeueEmail, type EmailStatus } from "@/lib/email";
import { AUTH_LINK_TEMPLATES, REDACTED_VALUE, redactEmailSecrets } from "@/lib/email/redact";
import type { AuditEntry } from "@/lib/panel/audit";
import { PanelError } from "@/lib/panel/errors";
import { escapeLike } from "@/lib/panel/format";
import type { Tx } from "@/lib/panel/tx";
import type { EmailLogFilter } from "./filter";

const t = schema.emailMessages;

export const EMAIL_LOG_PAGE_SIZE = 50;

export type EmailLogRow = {
  id: number;
  template: string;
  toEmail: string;
  locale: string;
  subject: string;
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  relatedType: string | null;
  relatedId: string | null;
  createdBy: string | null;
  sendAfter: string;
  sentAt: string | null;
  createdAt: string;
};

export type EmailLogList = {
  rows: EmailLogRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  /** Per status for the tabs (they honour the other filters, not the status). */
  counts: Record<EmailStatus | "all", number>;
  /** Templates that appear in the log (for the template select). */
  templates: string[];
};

const columns = {
  id: t.id,
  template: t.template,
  toEmail: t.toEmail,
  locale: t.locale,
  subject: t.subject,
  status: t.status,
  attempts: t.attempts,
  lastError: t.lastError,
  relatedType: t.relatedType,
  relatedId: t.relatedId,
  createdBy: t.createdBy,
  sendAfter: t.sendAfter,
  sentAt: t.sentAt,
  createdAt: t.createdAt,
} as const;

type Raw = Omit<EmailLogRow, "sendAfter" | "sentAt" | "createdAt"> & { sendAfter: Date; sentAt: Date | null; createdAt: Date };

const toRow = (r: Raw): EmailLogRow => ({
  ...r,
  sendAfter: r.sendAfter.toISOString(),
  sentAt: r.sentAt ? r.sentAt.toISOString() : null,
  createdAt: r.createdAt.toISOString(),
});

function baseWhere(filter: EmailLogFilter): SQL | undefined {
  const conds: SQL[] = [];
  if (filter.template) conds.push(eq(t.template, filter.template));
  if (filter.related) {
    conds.push(eq(t.relatedType, filter.related.type));
    if (filter.related.id) conds.push(eq(t.relatedId, filter.related.id));
  }
  if (filter.q) {
    const like = `%${escapeLike(filter.q.toLowerCase())}%`;
    conds.push(sql`(lower(${t.toEmail}) like ${like} or lower(${t.subject}) like ${like})`);
  }
  return conds.length ? and(...conds) : undefined;
}

export async function listEmailLog(executor: Tx, filter: EmailLogFilter, page = 1): Promise<EmailLogList> {
  const base = baseWhere(filter);
  const where = and(base, filter.status ? eq(t.status, filter.status) : undefined);
  const [[{ total }], byStatus, templates] = await Promise.all([
    executor.select({ total: count() }).from(t).where(where),
    executor.select({ status: t.status, n: count() }).from(t).where(base).groupBy(t.status),
    executor.selectDistinct({ template: t.template }).from(t).orderBy(t.template),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / EMAIL_LOG_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const rows = await executor
    .select(columns)
    .from(t)
    .where(where)
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(EMAIL_LOG_PAGE_SIZE)
    .offset((current - 1) * EMAIL_LOG_PAGE_SIZE);
  const counts = { all: 0, queued: 0, sending: 0, sent: 0, failed: 0, cancelled: 0 } as Record<EmailStatus | "all", number>;
  for (const r of byStatus) {
    counts[r.status] = r.n;
    counts.all += r.n;
  }
  return { rows: rows.map(toRow), total, page: current, pageCount, pageSize: EMAIL_LOG_PAGE_SIZE, counts, templates: templates.map((r) => r.template) };
}

export type EmailMessageDetail = EmailLogRow & {
  /** The stored body with every secret link value replaced (redactEmailSecrets). */
  html: string;
  text: string;
  headers: Record<string, string> | null;
  dedupeKey: string | null;
  createdByName: string | null;
  /** True when secret link values are hidden in html/text (here, or scrubbed after sending). */
  redacted: boolean;
  /** Password reset / verification: never re-sent from the log. */
  authLink: boolean;
};

export async function getEmailMessage(executor: Tx, id: number): Promise<EmailMessageDetail | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await executor
    .select({ ...columns, html: t.html, text: t.text, headers: t.headers, dedupeKey: t.dedupeKey })
    .from(t)
    .where(eq(t.id, id))
    .limit(1);
  if (!row) return null;
  let createdByName: string | null = null;
  if (row.createdBy && row.createdBy !== "system") {
    const [u] = await executor.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, row.createdBy)).limit(1);
    createdByName = u?.name ?? null;
  }
  const { html, text, headers, dedupeKey, ...rest } = row;
  const safeHtml = redactEmailSecrets(html);
  const safeText = redactEmailSecrets(text);
  const safeHeaders = headers ? Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, redactEmailSecrets(String(v))])) : null;
  return {
    ...toRow(rest),
    html: safeHtml,
    text: safeText,
    headers: safeHeaders,
    dedupeKey,
    createdByName,
    // Changed now, or scrubbed already when it was sent (account link mails).
    redacted: safeHtml !== html || safeText !== text || safeHtml.includes(`=${REDACTED_VALUE}`),
    authLink: AUTH_LINK_TEMPLATES.has(row.template),
  };
}

/** The mails of one order, newest first (order detail page). */
export async function listOrderEmails(executor: Tx, orderId: number): Promise<EmailLogRow[]> {
  const rows = await executor
    .select(columns)
    .from(t)
    .where(and(eq(t.relatedType, "order"), eq(t.relatedId, String(orderId))))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(100);
  return rows.map(toRow);
}

/** "Tekrar gönder": a copy of the stored mail goes into the queue (marketing mails are refused: consent may be gone). */
export async function resendEmailMessage(tx: Tx, id: number, actorId: string): Promise<{ id: number; audit: AuditEntry }> {
  const [original] = await tx.select({ id: t.id, template: t.template, status: t.status, html: t.html }).from(t).where(eq(t.id, id)).limit(1);
  if (!original) throw new PanelError("not_found", "E-posta bulunamadı.");
  if (AUTH_LINK_TEMPLATES.has(original.template)) {
    throw new PanelError("invalid", "Şifre sıfırlama ve hesap doğrulama e-postaları güvenlik nedeniyle panelden yeniden gönderilemez. Müşteri yeni bağlantıyı sitedeki formdan isteyebilir.");
  }
  if (getEmailTemplate(original.template)?.marketing) {
    throw new PanelError("invalid", "Kampanya e-postaları tek tek yeniden gönderilemez; alıcı abonelikten çıkmış olabilir.");
  }
  if (!original.html) throw new PanelError("invalid", "Bu e-postanın içeriği oluşturulamamıştı; yeniden gönderilemez.");
  const copy = await requeueEmail(tx, id, { createdBy: actorId });
  if (!copy) throw new PanelError("not_found", "E-posta bulunamadı.");
  if (copy.status !== "queued") throw new PanelError("invalid", "Alıcı adresi geçersiz olduğu için e-posta yeniden gönderilemez.");
  return { id: copy.id, audit: { action: "create", entity: "email_message", entityId: copy.id, after: { copyOf: id, template: original.template } } };
}

/** "İptal": a queued mail is not sent. */
export async function cancelEmailMessage(tx: Tx, id: number): Promise<{ audit: AuditEntry }> {
  const [row] = await tx.select({ id: t.id, status: t.status, template: t.template }).from(t).where(eq(t.id, id)).for("update").limit(1);
  if (!row) throw new PanelError("not_found", "E-posta bulunamadı.");
  if (!(await cancelQueuedEmail(tx, id))) {
    throw new PanelError("conflict", "Bu e-posta artık kuyrukta değil; gönderilmiş ya da iptal edilmiş olabilir. Sayfayı yenileyin.");
  }
  return { audit: { action: "status", entity: "email_message", entityId: id, before: { status: row.status }, after: { status: "cancelled" } } };
}
