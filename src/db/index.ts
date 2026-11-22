import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { IDLE_TIMEOUT_SECONDS, sslOptionFor } from "./connection-options";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.local)");

// Reuse one connection pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

const client =
  globalForDb.pgClient ??
  postgres(url, {
    max: process.env.NODE_ENV === "production" ? 5 : 10,
    // A query or transaction waiting this long for a free connection fails instead of waiting forever
    // (defence in depth, day 6 FIX SEC-1: a pool use nested inside an open transaction can never hang
    // the whole process again; the request errors and its transaction releases its connection).
    queue_timeout: 15,
    // Close idle connections after 20 s: a serverless instance that sleeps does not keep pooler slots.
    idle_timeout: IDLE_TIMEOUT_SECONDS,
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: !url.includes(":6543"),
    // TLS for Supabase hosts when the URL does not say sslmode itself (src/db/connection-options.ts).
    ...sslOptionFor(url, process.env),
    onnotice: () => {},
  });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle({ client, schema, casing: "snake_case" });
export type DB = typeof db;
export { schema };
