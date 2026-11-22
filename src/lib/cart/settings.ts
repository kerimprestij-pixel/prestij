import "server-only";
import { inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { db, schema } from "@/db";
import { parseSettings, type Settings } from "@/lib/settings/types";

/** `db` or a transaction: every cart/order read accepts either. */
export type DbExecutor = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

export type CommerceSettings = {
  general: Settings<"general">;
  shipping: Settings<"shipping">;
  payments: Settings<"payments">;
  samples: Settings<"samples">;
  b2b: Settings<"b2b">;
  /** Subscribe and save (allowed methods, card renewal window). */
  subscriptions: Settings<"subscriptions">;
};

const KEYS = ["general", "shipping", "payments", "samples", "b2b", "subscriptions"] as const;

/**
 * The settings that decide money, read fresh (uncached) in one query. Cart actions, the cart view and
 * placeOrder all use this, so what the customer sees and what is charged come from the same values.
 */
export async function loadCommerceSettings(executor: DbExecutor = db): Promise<CommerceSettings> {
  const rows = await executor
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, [...KEYS]));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    general: parseSettings("general", byKey.get("general")),
    shipping: parseSettings("shipping", byKey.get("shipping")),
    payments: parseSettings("payments", byKey.get("payments")),
    samples: parseSettings("samples", byKey.get("samples")),
    b2b: parseSettings("b2b", byKey.get("b2b")),
    subscriptions: parseSettings("subscriptions", byKey.get("subscriptions")),
  };
}
