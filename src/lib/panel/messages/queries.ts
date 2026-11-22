// Panel reads of the contact form inbox (contact_messages). Uncached on purpose: new messages and read
// states must show at once. Callers check the session first (requireStaff / requirePanelActor).
import "server-only";
import { and, count, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { CONTACT_SUBJECTS, isContactSubject, type ContactSubject } from "@/lib/contact/subjects";
import { escapeLike, FOLD_FROM, FOLD_TO, foldText } from "@/lib/panel/format";
import type { Tx } from "@/lib/panel/tx";

export const MESSAGES_PAGE_SIZE = 20;

const m = schema.contactMessages;

export type MessageStatusFilter = "all" | "unread";

export type MessageListInput = {
  status?: MessageStatusFilter;
  subject?: ContactSubject | null;
  q?: string | null;
  page?: number | null;
};

export type PanelMessageRow = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  /** null for rows without a (known) subject key. */
  subject: ContactSubject | null;
  /** First characters of the message, on one line. */
  excerpt: string;
  locale: string;
  isRead: boolean;
  createdAt: string;
};

export type PanelMessage = Omit<PanelMessageRow, "excerpt"> & { message: string; updatedAt: string };

export type PanelMessageList = {
  rows: PanelMessageRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Honour the search, not the status/subject filters (for the tab and chip counters). */
  counts: { all: number; unread: number; bySubject: Record<ContactSubject, number> };
  /** Unread messages overall and the newest message id ("mark all read" stops there). */
  inbox: { unread: number; newestId: number | null };
};

const fold = (expr: SQL) => sql`lower(translate(coalesce(${expr}, ''), ${FOLD_FROM}, ${FOLD_TO}))`;

/** Name, e-mail, message text (Turkish-insensitive) and phone digits. */
function searchWhere(q: string | null | undefined): SQL | undefined {
  const term = (q ?? "").trim().slice(0, 100);
  if (!term) return undefined;
  const like = `%${escapeLike(foldText(term))}%`;
  const parts: SQL[] = [sql`${fold(sql`${m.name}`)} like ${like}`, sql`${fold(sql`${m.email}`)} like ${like}`, sql`${fold(sql`${m.message}`)} like ${like}`];
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 4) parts.push(sql`regexp_replace(coalesce(${m.phone}, ''), '\\D', '', 'g') like ${`%${digits.slice(-10)}%`}`);
  return or(...parts);
}

const subjectOf = (value: string | null): ContactSubject | null => (isContactSubject(value) ? value : null);

const rowColumns = {
  id: m.id,
  name: m.name,
  email: m.email,
  phone: m.phone,
  subject: m.subject,
  excerpt: sql<string>`left(regexp_replace(${m.message}, '\\s+', ' ', 'g'), 180)`,
  locale: m.locale,
  isRead: m.isRead,
  createdAt: m.createdAt,
};

type RawRow = { id: number; name: string; email: string; phone: string | null; subject: string | null; excerpt: string; locale: string; isRead: boolean; createdAt: Date };
const toRow = (r: RawRow): PanelMessageRow => ({ ...r, subject: subjectOf(r.subject), createdAt: r.createdAt.toISOString() });

export async function listContactMessages(input: MessageListInput = {}, executor: Tx = db): Promise<PanelMessageList> {
  const search = searchWhere(input.q);
  const where = and(
    search,
    input.status === "unread" ? eq(m.isRead, false) : undefined,
    input.subject ? eq(m.subject, input.subject) : undefined,
  );

  const [groups, [{ total }], [inbox]] = await Promise.all([
    executor.select({ subject: m.subject, isRead: m.isRead, n: count() }).from(m).where(search).groupBy(m.subject, m.isRead),
    executor.select({ total: count() }).from(m).where(where),
    executor
      .select({
        unread: sql<number>`count(*) filter (where not ${m.isRead})`.mapWith(Number),
        newestId: sql<number | null>`max(${m.id})`.mapWith((v) => (v === null ? null : Number(v))),
      })
      .from(m),
  ]);

  const pageSize = MESSAGES_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isSafeInteger(input.page) && (input.page ?? 0) > 0 ? (input.page as number) : 1;
  const page = Math.min(pageCount, requested);

  const rows = await executor
    .select(rowColumns)
    .from(m)
    .where(where)
    .orderBy(desc(m.createdAt), desc(m.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const bySubject = Object.fromEntries(CONTACT_SUBJECTS.map((s) => [s, 0])) as Record<ContactSubject, number>;
  let all = 0;
  let unread = 0;
  for (const g of groups) {
    all += g.n;
    if (!g.isRead) unread += g.n;
    const key = subjectOf(g.subject);
    if (key) bySubject[key] += g.n;
  }

  return {
    rows: rows.map(toRow),
    total,
    page,
    pageSize,
    pageCount,
    counts: { all, unread, bySubject },
    inbox: { unread: inbox?.unread ?? 0, newestId: inbox?.newestId ?? null },
  };
}

export async function getContactMessage(id: number, executor: Tx = db): Promise<PanelMessage | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await executor.select().from(m).where(eq(m.id, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    subject: subjectOf(row.subject),
    message: row.message,
    locale: row.locale,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Unread messages (sidebar badge, dashboard). */
export async function countUnreadMessages(executor: Tx = db): Promise<number> {
  const [row] = await executor.select({ n: count() }).from(m).where(eq(m.isRead, false));
  return row?.n ?? 0;
}

/** The newest messages, unread first (dashboard card). */
export async function listRecentMessages(limit = 5, executor: Tx = db): Promise<PanelMessageRow[]> {
  const rows = await executor
    .select(rowColumns)
    .from(m)
    .orderBy(m.isRead, desc(m.createdAt), desc(m.id))
    .limit(Math.min(Math.max(1, limit), 50));
  return rows.map(toRow);
}
