// UI text overrides (ui_strings). One row per dotted key with the overridden locales only; a key with
// no overridden locale has no row. Services take a transaction and never touch Next APIs.
import "server-only";
import { eq, inArray } from "drizzle-orm";
import { schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import type { AuditEntry } from "@/lib/panel/audit";
import { assertFresh, CONFLICT_MESSAGE } from "@/lib/panel/concurrency";
import { PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import { compactOverride, uiStringValueErrors, type UiStringOverride, type UiStringSaveItem } from "./schemas";

const sameOverride = (a: UiStringOverride, b: UiStringOverride) => JSON.stringify(compactOverride(a)) === JSON.stringify(compactOverride(b));

export type UiStringsSaveResult = {
  /** New updatedAt per saved key (ISO), null when the override was removed. */
  versions: Record<string, string | null>;
  changed: number;
  audit: AuditEntry[];
};

/**
 * Saves several overrides at once. Each item is guarded by the updatedAt the editor loaded (null = it
 * saw no override). Empty values remove the override. Field errors use the item index:
 * "items.3.en", "items.3.key".
 */
export async function saveUiStrings(tx: Tx, items: UiStringSaveItem[]): Promise<UiStringsSaveResult> {
  const fieldErrors: Record<string, string> = {};
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.key)) fieldErrors[`items.${index}.key`] = "Bu metin listede iki kez var.";
    seen.add(item.key);
    for (const [path, message] of Object.entries(uiStringValueErrors(item.key, item.value))) {
      fieldErrors[`items.${index}.${path}`] = message;
    }
  });
  if (Object.keys(fieldErrors).length > 0) throw new PanelError("invalid", "Lütfen işaretli metinleri düzeltin.", fieldErrors);

  const t = schema.uiStrings;
  const rows = await tx
    .select()
    .from(t)
    .where(inArray(t.key, [...seen]))
    .for("update");
  const existing = new Map(rows.map((row) => [row.key, row]));

  const versions: Record<string, string | null> = {};
  const audit: AuditEntry[] = [];
  const now = new Date();

  for (const item of items) {
    const row = existing.get(item.key);
    if (row) assertFresh(row.updatedAt, item.updatedAt);
    else if (item.updatedAt) throw new PanelError("conflict", CONFLICT_MESSAGE);

    const next = compactOverride(item.value);
    const before = row ? compactOverride(row.value as UiStringOverride) : null;
    const empty = Object.keys(next).length === 0;

    if (empty) {
      if (!row) continue;
      await tx.delete(t).where(eq(t.key, item.key));
      versions[item.key] = null;
      audit.push({ action: "delete", entity: "ui_string", entityId: item.key, before });
      continue;
    }
    if (row && before && sameOverride(before, next)) continue;

    // Stored with the overridden locales only (tr may be missing): getMessages reads value[locale].
    const value = next as LocalizedText;
    if (row) {
      const [saved] = await tx.update(t).set({ value, updatedAt: now }).where(eq(t.key, item.key)).returning({ updatedAt: t.updatedAt });
      versions[item.key] = saved.updatedAt.toISOString();
      audit.push({ action: "update", entity: "ui_string", entityId: item.key, before, after: next });
    } else {
      const [saved] = await tx
        .insert(t)
        .values({ key: item.key, value, updatedAt: now })
        .onConflictDoNothing({ target: t.key })
        .returning({ updatedAt: t.updatedAt });
      // Someone else created the override a moment ago.
      if (!saved) throw new PanelError("conflict", CONFLICT_MESSAGE);
      versions[item.key] = saved.updatedAt.toISOString();
      audit.push({ action: "create", entity: "ui_string", entityId: item.key, after: next });
    }
  }
  return { versions, changed: audit.length, audit };
}
