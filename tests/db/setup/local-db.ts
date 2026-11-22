// The DB tests write to and delete from the database they are given (users, carts, media, variants…), so they
// run only against a database on this machine: the same rule as scripts/seed.ts. Pure (unit-tested in
// tests/unit/golive-config.test.ts); tests/db/setup/local-only.ts applies it before any test file loads.

/** Hosts that count as this machine. */
export const LOCAL_DB_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1", "[::1]"];

/**
 * Why the DB tests must not run against `url`, or null when it is a local database. The message names the
 * host only (never the user, password or query string of the URL).
 */
export function localDatabaseProblem(url: string | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return "DATABASE_URL is not set (npm run test:db reads .env.local).";
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return "DATABASE_URL is not a valid connection URL.";
  }
  if (LOCAL_DB_HOSTS.includes(host)) return null;
  return `DATABASE_URL points at "${host}", not a local database. The DB tests insert and delete rows; they run only against localhost / 127.0.0.1.`;
}
