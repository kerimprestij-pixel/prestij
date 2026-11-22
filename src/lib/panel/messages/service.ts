// Inbox mutations (no Next APIs; DB tests call them with a transaction). Read state changes are
// idempotent ("set to read"), so they need no optimistic lock: two people opening the same message
// both end up with it read. Audit rows never contain the sender's personal data or message text.
import "server-only";
import { and, eq, lte } from "drizzle-orm";
import { schema } from "@/db";
import type { AuditEntry } from "@/lib/panel/audit";
import { PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";

const m = schema.contactMessages;
const NOT_FOUND = "Bu mesaj bulunamadı; silinmiş olabilir. Listeyi yenileyin.";

async function lockMessage(tx: Tx, id: number) {
  const [row] = await tx
    .select({ id: m.id, isRead: m.isRead, subject: m.subject, locale: m.locale, createdAt: m.createdAt })
    .from(m)
    .where(eq(m.id, id))
    .for("update");
  if (!row) throw new PanelError("not_found", NOT_FOUND);
  return row;
}

/** Marks one message read or unread. `changed` is false when it already had that state (no audit then). */
export async function setMessageRead(
  tx: Tx,
  input: { id: number; isRead: boolean },
): Promise<{ changed: boolean; audit: AuditEntry | null }> {
  const row = await lockMessage(tx, input.id);
  if (row.isRead === input.isRead) return { changed: false, audit: null };
  await tx.update(m).set({ isRead: input.isRead, updatedAt: new Date() }).where(eq(m.id, input.id));
  return {
    changed: true,
    audit: { action: "status", entity: "contact_message", entityId: input.id, before: { isRead: row.isRead }, after: { isRead: input.isRead } },
  };
}

/**
 * Marks every unread message up to `maxId` (the newest one the user saw) read, so a message that arrives
 * meanwhile stays unread. Returns how many changed.
 */
export async function markAllMessagesRead(tx: Tx, input: { maxId: number }): Promise<{ count: number; audit: AuditEntry | null }> {
  const changed = await tx
    .update(m)
    .set({ isRead: true, updatedAt: new Date() })
    .where(and(eq(m.isRead, false), lte(m.id, input.maxId)))
    .returning({ id: m.id });
  if (changed.length === 0) return { count: 0, audit: null };
  return {
    count: changed.length,
    audit: { action: "status", entity: "contact_message", entityId: null, after: { isRead: true, count: changed.length, ids: changed.map((r) => r.id) } },
  };
}

/**
 * Deletes a message for good (e.g. a KVKK erasure request). The audit row keeps only what the message
 * was about (subject, language, dates), never who sent it or what it said.
 */
export async function deleteContactMessage(tx: Tx, input: { id: number }): Promise<{ audit: AuditEntry }> {
  const row = await lockMessage(tx, input.id);
  await tx.delete(m).where(eq(m.id, input.id));
  return {
    audit: {
      action: "delete",
      entity: "contact_message",
      entityId: input.id,
      before: { subject: row.subject, locale: row.locale, isRead: row.isRead, createdAt: row.createdAt.toISOString() },
    },
  };
}
