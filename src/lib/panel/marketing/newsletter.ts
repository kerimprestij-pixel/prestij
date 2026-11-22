// Newsletter subscribers for the panel: list/filter, unsubscribe, KVKK erasure, CSV export rows.
// Personal data (e-mail addresses) never goes into the audit log or server logs.
import "server-only";
import { and, count, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";
import type { Locale } from "@/db/schema/common";
import type { NewsletterStatus } from "@/db/schema/marketing";
import type { AuditEntry } from "@/lib/panel/audit";
import { PanelError } from "@/lib/panel/errors";
import { escapeLike } from "@/lib/panel/format";
import type { Tx } from "@/lib/panel/tx";
import type { SubscriberFilter } from "./newsletter-filter";
import { toCsv } from "./csv";

const s = schema.newsletterSubscribers;

export const SUBSCRIBER_PAGE_SIZE = 50;
/** Upper bound of one CSV export. */
export const EXPORT_LIMIT = 100_000;

export type SubscriberRow = {
  id: number;
  email: string;
  locale: string;
  status: NewsletterStatus;
  source: string | null;
  consentAt: string;
  iysSynced: boolean;
  createdAt: string;
  updatedAt: string;
};

function whereFor(filter: SubscriberFilter): SQL | undefined {
  const conds: SQL[] = [];
  if (filter.status) conds.push(eq(s.status, filter.status));
  if (filter.source) conds.push(eq(s.source, filter.source));
  if (filter.locale) conds.push(eq(s.locale, filter.locale));
  if (filter.q) conds.push(sql`lower(${s.email}) like ${`%${escapeLike(filter.q.toLowerCase())}%`}`);
  return conds.length ? and(...conds) : undefined;
}

const columns = {
  id: s.id,
  email: s.email,
  locale: s.locale,
  status: s.status,
  source: s.source,
  consentAt: s.consentAt,
  iysSynced: s.iysSynced,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
} as const;

type Raw = { id: number; email: string; locale: string; status: NewsletterStatus; source: string | null; consentAt: Date; iysSynced: boolean; createdAt: Date; updatedAt: Date };

const toRow = (r: Raw): SubscriberRow => ({
  ...r,
  consentAt: r.consentAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export type SubscriberList = {
  rows: SubscriberRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  stats: { all: number; pending: number; active: number; unsubscribed: number; last30Days: number };
};

export async function listSubscribers(executor: Tx, filter: SubscriberFilter, page = 1): Promise<SubscriberList> {
  const where = whereFor(filter);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [[{ total }], stats, [{ last30 }]] = await Promise.all([
    executor.select({ total: count() }).from(s).where(where),
    executor.select({ status: s.status, n: count() }).from(s).groupBy(s.status),
    executor.select({ last30: count() }).from(s).where(and(eq(s.status, "active"), gte(s.consentAt, since))),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / SUBSCRIBER_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const rows = await executor
    .select(columns)
    .from(s)
    .where(where)
    .orderBy(desc(s.createdAt), desc(s.id))
    .limit(SUBSCRIBER_PAGE_SIZE)
    .offset((current - 1) * SUBSCRIBER_PAGE_SIZE);
  const by = new Map(stats.map((r) => [r.status, r.n]));
  const active = by.get("active") ?? 0;
  const unsubscribed = by.get("unsubscribed") ?? 0;
  const pending = by.get("pending") ?? 0;
  return {
    rows: rows.map(toRow),
    total,
    page: current,
    pageCount,
    pageSize: SUBSCRIBER_PAGE_SIZE,
    stats: { all: active + unsubscribed + pending, pending, active, unsubscribed, last30Days: last30 },
  };
}

async function lockSubscriber(tx: Tx, id: number) {
  const [row] = await tx
    .select({ id: s.id, status: s.status, locale: s.locale, source: s.source, iysSynced: s.iysSynced })
    .from(s)
    .where(eq(s.id, id))
    .for("update");
  if (!row) throw new PanelError("not_found", "Abone bulunamadı; silinmiş olabilir.");
  return row;
}

/** Stops sending to the address (it stays listed as "Ayrıldı"). Re-subscribing needs the visitor's own opt-in. */
export async function unsubscribeSubscriber(tx: Tx, id: number): Promise<{ changed: boolean; audit?: AuditEntry }> {
  const row = await lockSubscriber(tx, id);
  if (row.status === "unsubscribed") return { changed: false };
  const now = new Date();
  await tx.update(s).set({ status: "unsubscribed", unsubscribedAt: now, confirmTokenHash: null, updatedAt: now }).where(eq(s.id, id));
  return {
    changed: true,
    audit: { action: "status", entity: "newsletter_subscriber", entityId: id, before: { status: row.status }, after: { status: "unsubscribed" } },
  };
}

/** KVKK erasure: the row is deleted for good. The audit entry keeps no e-mail address. */
export async function deleteSubscriber(tx: Tx, id: number): Promise<{ audit: AuditEntry }> {
  const row = await lockSubscriber(tx, id);
  await tx.delete(s).where(eq(s.id, id));
  return {
    audit: {
      action: "delete",
      entity: "newsletter_subscriber",
      entityId: id,
      before: { status: row.status, locale: row.locale, source: row.source, erasure: "kvkk" },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// CSV export

const STATUS_TEXT: Record<SubscriberRow["status"], string> = { pending: "Onay bekliyor", active: "Aktif", unsubscribed: "Ayrıldı" };
const SOURCE_TEXT: Record<string, string> = { footer: "Alt bilgi", section: "Sayfa bölümü", popup: "Açılır pencere", checkout: "Ödeme", register: "Üyelik", profile: "Hesap profili" };
const LOCALE_TEXT: Record<Locale, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" };

const exportDate = new Intl.DateTimeFormat("tr-TR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});

/** "09.11.2026 14:30" (Istanbul time): Excel recognises it as a date in Turkish settings. */
const cellDate = (d: Date) => exportDate.format(d).replace(",", "");

export const EXPORT_HEADER = ["E-posta", "Durum", "Dil", "Kaynak", "İzin tarihi", "İYS'ye aktarıldı", "Kayıt tarihi", "Son değişiklik"] as const;

/** Every subscriber matching the filter as one CSV file (newest first) and the row count. */
export async function exportSubscribersCsv(executor: Tx, filter: SubscriberFilter): Promise<{ csv: string; rows: number }> {
  const rows = await executor
    .select(columns)
    .from(s)
    .where(whereFor(filter))
    .orderBy(desc(s.createdAt), desc(s.id))
    .limit(EXPORT_LIMIT);
  const body = rows.map((r) => [
    r.email,
    STATUS_TEXT[r.status] ?? r.status,
    LOCALE_TEXT[r.locale as Locale] ?? r.locale,
    r.source ? (SOURCE_TEXT[r.source] ?? r.source) : "",
    cellDate(r.consentAt),
    r.iysSynced ? "Evet" : "Hayır",
    cellDate(r.createdAt),
    cellDate(r.updatedAt),
  ]);
  return { csv: toCsv(EXPORT_HEADER, body), rows: rows.length };
}
