// Audit log reads for /panel/islem-kaydi (admin only; the page checks the role before calling these).
// Uncached on purpose: the log must be live. Dates in filters are Istanbul calendar days.
import "server-only";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { auditLog, user } from "@/db/schema";
import type { Tx } from "@/lib/panel/tx";

export const AUDIT_PAGE_SIZE = 25;

export type AuditLogFilters = {
  entity?: string | null;
  userId?: string | null;
  /** YYYY-MM-DD, inclusive, Istanbul days. */
  from?: string | null;
  to?: string | null;
  page?: number;
};

export type AuditLogRow = {
  id: number;
  createdAt: string;
  action: string;
  entity: string;
  entityId: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  /** For entity "user": the subject's current name (the account may be gone). */
  subjectUserName: string | null;
  before: unknown;
  after: unknown;
};

export type AuditLogPage = { rows: AuditLogRow[]; total: number; page: number; pageSize: number; pageCount: number };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-09" when it is a real calendar date, else null. */
export function parseDay(value: string | null | undefined): string | null {
  if (!value || !DAY.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

function whereFor(filters: AuditLogFilters): SQL | undefined {
  const parts: SQL[] = [];
  if (filters.entity) parts.push(eq(auditLog.entity, filters.entity));
  if (filters.userId === "system") parts.push(sql`${auditLog.userId} is null`);
  else if (filters.userId) parts.push(eq(auditLog.userId, filters.userId));
  const from = parseDay(filters.from);
  const to = parseDay(filters.to);
  if (from) parts.push(sql`${auditLog.createdAt} >= (${from}::date::timestamp at time zone 'Europe/Istanbul')`);
  if (to) parts.push(sql`${auditLog.createdAt} < ((${to}::date + 1)::timestamp at time zone 'Europe/Istanbul')`);
  return parts.length ? and(...parts) : undefined;
}

export async function listAuditLog(executor: Tx, filters: AuditLogFilters): Promise<AuditLogPage> {
  const where = whereFor(filters);
  const [{ total }] = await executor.select({ total: count() }).from(auditLog).where(where);
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(filters.page ?? 1) || 1), pageCount);

  const actor = alias(user, "actor");
  const subject = alias(user, "subject");
  const rows = await executor
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      userId: auditLog.userId,
      userName: actor.name,
      userEmail: actor.email,
      subjectUserName: subject.name,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .leftJoin(actor, eq(actor.id, auditLog.userId))
    .leftJoin(subject, and(eq(auditLog.entity, "user"), eq(subject.id, auditLog.entityId)))
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(AUDIT_PAGE_SIZE)
    .offset((page - 1) * AUDIT_PAGE_SIZE);

  return {
    rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    total,
    page,
    pageSize: AUDIT_PAGE_SIZE,
    pageCount,
  };
}

export type AuditFilterOptions = {
  entities: string[];
  users: { id: string; name: string | null; email: string | null }[];
  /** Some rows have no user (system or seed jobs). */
  hasSystemRows: boolean;
};

/** Values that actually occur in the log, for the filter selects. */
export async function auditFilterOptions(executor: Tx): Promise<AuditFilterOptions> {
  const [entities, users] = await Promise.all([
    executor.selectDistinct({ entity: auditLog.entity }).from(auditLog).orderBy(auditLog.entity),
    executor
      .selectDistinct({ id: auditLog.userId, name: user.name, email: user.email })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.userId)),
  ]);
  return {
    entities: entities.map((e) => e.entity),
    users: users
      .filter((u): u is { id: string; name: string | null; email: string | null } => u.id !== null)
      .sort((a, b) => (a.name ?? a.email ?? a.id).localeCompare(b.name ?? b.email ?? b.id, "tr")),
    hasSystemRows: users.some((u) => u.id === null),
  };
}
