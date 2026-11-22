// Announcement bar entries: create/save (locked by updatedAt), reorder, delete. No Next APIs.
import "server-only";
import { asc, eq, max } from "drizzle-orm";
import { schema } from "@/db";
import type { AuditEntry } from "@/lib/panel/audit";
import { auditChanges } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import type { AnnouncementSaveInput } from "./schemas";

const a = schema.announcements;

const NOT_FOUND = "Duyuru bulunamadı. Silinmiş olabilir.";

export type SaveAnnouncementResult = { id: number; updatedAt: string; created: boolean };

export async function saveAnnouncement(tx: Tx, input: AnnouncementSaveInput): Promise<{ result: SaveAnnouncementResult; audit: AuditEntry }> {
  const values = {
    text: input.text,
    href: input.href,
    variant: input.variant,
    isActive: input.isActive,
    startsAt: input.schedule.startsAt,
    endsAt: input.schedule.endsAt,
  };

  if (input.id === null) {
    const [{ last }] = await tx.select({ last: max(a.position) }).from(a);
    const [row] = await tx
      .insert(a)
      .values({ ...values, position: (last ?? -1) + 1 })
      .returning({ id: a.id, updatedAt: a.updatedAt });
    return {
      result: { id: row.id, updatedAt: row.updatedAt.toISOString(), created: true },
      audit: { action: "create", entity: "announcement", entityId: row.id, after: values },
    };
  }

  const [row] = await tx.select().from(a).where(eq(a.id, input.id)).for("update");
  if (!row) throw new PanelError("not_found", NOT_FOUND);
  assertFresh(row.updatedAt, input.updatedAt);
  const [saved] = await tx.update(a).set({ ...values, updatedAt: new Date() }).where(eq(a.id, row.id)).returning({ updatedAt: a.updatedAt });
  const before = { text: row.text, href: row.href, variant: row.variant, isActive: row.isActive, startsAt: row.startsAt, endsAt: row.endsAt };
  return {
    result: { id: row.id, updatedAt: saved.updatedAt.toISOString(), created: false },
    audit: { action: "update", entity: "announcement", entityId: row.id, ...auditChanges(before, values) },
  };
}

/**
 * New display order. The ids must be exactly the current announcements (otherwise someone added or
 * removed one meanwhile: conflict). Positions are not content, so updatedAt is left as it was.
 */
export async function reorderAnnouncements(tx: Tx, ids: number[]): Promise<{ audit: AuditEntry | null }> {
  const rows = await tx.select({ id: a.id, position: a.position, updatedAt: a.updatedAt }).from(a).orderBy(asc(a.position), asc(a.id)).for("update");
  const current = rows.map((r) => r.id);
  const same = ids.length === current.length && new Set(ids).size === ids.length && ids.every((id) => current.includes(id));
  if (!same) throw new PanelError("conflict", "Duyuru listesi siz düzenlerken değişti. Sayfayı yenileyin.");
  if (ids.every((id, i) => current[i] === id)) return { audit: null };
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const [position, id] of ids.entries()) {
    const row = byId.get(id);
    if (row && row.position !== position) await tx.update(a).set({ position, updatedAt: row.updatedAt }).where(eq(a.id, id));
  }
  return { audit: { action: "reorder", entity: "announcement", before: { order: current }, after: { order: ids } } };
}

export async function deleteAnnouncement(tx: Tx, input: { id: number; updatedAt: Date }): Promise<{ audit: AuditEntry }> {
  const [row] = await tx.select().from(a).where(eq(a.id, input.id)).for("update");
  if (!row) throw new PanelError("not_found", NOT_FOUND);
  assertFresh(row.updatedAt, input.updatedAt);
  await tx.delete(a).where(eq(a.id, row.id));
  return {
    audit: {
      action: "delete",
      entity: "announcement",
      entityId: row.id,
      before: { text: row.text, href: row.href, variant: row.variant, isActive: row.isActive, startsAt: row.startsAt, endsAt: row.endsAt },
    },
  };
}
