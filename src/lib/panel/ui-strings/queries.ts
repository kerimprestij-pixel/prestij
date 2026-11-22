// Read side of the UI texts screen (uncached; the page calls requireStaff("editor") first).
import "server-only";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { findUiString } from "./catalog";
import { compactOverride, type UiStringOverride } from "./schemas";

export type UiStringOverrides = {
  /** Saved overrides per key (only non-empty locales). */
  values: Record<string, UiStringOverride>;
  /** updatedAt per overridden key (ISO), for optimistic locking. */
  versions: Record<string, string>;
};

/** Current overrides of keys that still exist in the built-in dictionaries. */
export async function listUiStringOverrides(): Promise<UiStringOverrides> {
  const rows = await db.select().from(schema.uiStrings).orderBy(asc(schema.uiStrings.key));
  const values: Record<string, UiStringOverride> = {};
  const versions: Record<string, string> = {};
  for (const row of rows) {
    if (!findUiString(row.key)) continue;
    values[row.key] = compactOverride(row.value as UiStringOverride);
    versions[row.key] = row.updatedAt.toISOString();
  }
  return { values, versions };
}
