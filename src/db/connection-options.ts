// Connection options of the app's postgres.js pool that depend on DATABASE_URL (go-live CF-15). Pure:
// unit-tested in tests/unit/golive-config.test.ts; src/db/index.ts applies it.

/** Seconds an idle pooled connection stays open (a serverless instance does not hold Supabase pooler slots). */
export const IDLE_TIMEOUT_SECONDS = 20;

/** True for Supabase hosts (*.supabase.com pooler, *.supabase.co direct). */
export function isSupabaseHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return host === "supabase.com" || host === "supabase.co" || host.endsWith(".supabase.com") || host.endsWith(".supabase.co");
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
