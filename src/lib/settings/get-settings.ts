import "server-only";
import { eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import { TAGS } from "@/lib/cache-tags";
import { parseSettings, type Settings, type SettingsKey } from "./types";

/**
 * One settings document, parsed and merged over its defaults (a missing or invalid row yields the
 * defaults). Cached until the panel invalidates TAGS.settings.
 */
export async function getSettings<K extends SettingsKey>(key: K): Promise<Settings<K>> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.settings);

  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1);
  return parseSettings(key, row?.value);
}
