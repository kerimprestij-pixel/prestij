// Standalone DB client for scripts. Same schema + casing as src/db, but without the "server-only"
// guard, so `npm run db:seed` works with or without the react-server condition.
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

/** The client or a transaction opened on it (both share PgDatabase's query API). */
export type ScriptDb = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

export function createScriptDb(): { db: ScriptDb; close: () => Promise<void> } {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Run with --env-file=.env.local");
  const client = postgres(url, { max: 4, prepare: !url.includes(":6543"), onnotice: () => {} });
  const db = drizzle({ client, schema, casing: "snake_case" });
  return { db, close: () => client.end({ timeout: 5 }) };
}
