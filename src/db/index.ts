import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { IDLE_TIMEOUT_SECONDS, poolerOptionsFor, sslOptionFor } from "./connection-options";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set (see .env.local)");
// Pooler-dependent options (src/db/connection-options.ts): Supabase's transaction pooler (port 6543) gets no
// prepared statements and no pipelining; `next build` connects through its session-mode port instead.
const { url, ...poolerOptions } = poolerOptionsFor(databaseUrl, process.env);
// One line per build process, so the Vercel build log shows which pooler port the prerender used.
if (url !== databaseUrl) console.log(`db: next build connects through the Supabase session pooler (:${new URL(url).port}, max ${poolerOptions.max})`);

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
    ...poolerOptions,
    // TLS for Supabase hosts when the URL does not say sslmode itself (src/db/connection-options.ts).
    ...sslOptionFor(url, process.env),
    onnotice: () => {},
  });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle({ client, schema, casing: "snake_case" });
export type DB = typeof db;
export { schema };
