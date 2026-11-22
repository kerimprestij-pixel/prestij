// Connection options of the app's postgres.js pool that depend on DATABASE_URL (go-live CF-15). Pure:
// unit-tested in tests/unit/golive-config.test.ts; src/db/index.ts applies it.

/** Seconds an idle pooled connection stays open (a serverless instance does not hold Supabase pooler slots). */
export const IDLE_TIMEOUT_SECONDS = 20;

/** True for Supabase hosts (*.supabase.com pooler, *.supabase.co direct). */
export function isSupabaseHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return host === "supabase.com" || host === "supabase.co" || host.endsWith(".supabase.com") || host.endsWith(".supabase.co");
}

/** True for Supabase's connection pooler (Supavisor): `*.pooler.supabase.com`. */
export function isSupabasePoolerHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return isSupabaseHost(host) && host.endsWith(".pooler.supabase.com");
}

/** Supabase pooler ports on the same host and credentials: 6543 transaction mode, 5432 session mode. */
export const SUPABASE_TRANSACTION_POOLER_PORT = "6543";
export const SUPABASE_SESSION_POOLER_PORT = "5432";
/** Seconds a query may wait and run through the transaction pooler before it fails instead of hanging. */
export const POOLER_QUERY_TIMEOUT_SECONDS = 30;
/** The same during `next build`; below Next's 54 s "use cache" fill limit, so a stall names itself. */
export const BUILD_QUERY_TIMEOUT_SECONDS = 45;
/**
 * Connections per pool during `next build`. Session mode gives every client its own server connection, up
 * to the Supavisor pool size (15 on Supabase Free). Each build worker holds two pools (Turbopack compiles
 * src/db for pages and for route handlers separately), and next.config.ts pins Vercel builds to one worker.
 */
export const BUILD_POOL_MAX = 3;

export interface PoolerOptions {
  /** The URL to connect to: DATABASE_URL itself, or its session-mode twin while `next build` prerenders. */
  url: string;
  prepare: boolean;
  max?: number;
  max_pipeline?: number;
  query_timeout?: number;
}

/**
 * postgres.js options that depend on the pooler behind DATABASE_URL (deploy fix, first Vercel build).
 *
 * - Supabase transaction pooler (port 6543) at run time: no prepared statements (unsupported there) and
 *   `max_pipeline: 1`, because Supavisor before 2.10 never answers queries pipelined in transaction mode
 *   (node_modules/postgres/README.md, "Connection poolers"). `query_timeout` turns any other silent stall
 *   into an error instead of a request that hangs until the function times out.
 * - `next build` (NEXT_PHASE=phase-production-build) with a Supabase transaction-pooler URL: the same host
 *   and credentials in session mode (port 5432), where pipelining works, so prerendering every page from
 *   Vercel's build region (far from the database) stays fast with a small pool (BUILD_POOL_MAX). The first
 *   production build hung on port 6543 ("use cache" fill took too long, src/lib/settings/get-settings.ts).
 *   `prepare: true` only restores the postgres.js default; drizzle sends its queries unprepared anyway.
 * - Anything else (local Postgres, a direct connection, another pooler): the URL as given, and the earlier
 *   rule that any port-6543 URL skips prepared statements.
 */
export function poolerOptionsFor(url: string, env: Record<string, string | undefined> = {}): PoolerOptions {
  let parsed: URL | null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  const supabaseTransactionPooler =
    parsed !== null && parsed.port === SUPABASE_TRANSACTION_POOLER_PORT && isSupabasePoolerHost(parsed.hostname);
  if (!parsed || !supabaseTransactionPooler) return { url, prepare: !url.includes(`:${SUPABASE_TRANSACTION_POOLER_PORT}`) };
  if (env.NEXT_PHASE === "phase-production-build") {
    parsed.port = SUPABASE_SESSION_POOLER_PORT;
    return { url: parsed.toString(), prepare: true, max: BUILD_POOL_MAX, query_timeout: BUILD_QUERY_TIMEOUT_SECONDS };
  }
  return { url, prepare: false, max_pipeline: 1, query_timeout: POOLER_QUERY_TIMEOUT_SECONDS };
}

/**
 * `{ ssl: "require" }` when the URL points at Supabase and sets no TLS option of its own (sslmode, ssl,
 * sslrootcert): Supabase accepts encrypted connections, and with "Enforce SSL" on it refuses the rest. A URL
 * that says what it wants (e.g. `?sslmode=verify-full&sslrootcert=…`) is left alone, and so is PGSSLMODE.
 * Anything that is not a parseable URL also gets nothing (postgres.js then reads it as before).
 */
export function sslOptionFor(url: string, env: Record<string, string | undefined> = {}): { ssl?: "require" } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {};
  }
  if (!isSupabaseHost(parsed.hostname)) return {};
  const params = parsed.searchParams;
  if (params.has("sslmode") || params.has("ssl") || params.has("sslrootcert")) return {};
  if ((env.PGSSLMODE ?? "").trim()) return {};
  return { ssl: "require" };
}
