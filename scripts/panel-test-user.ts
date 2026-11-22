/**
 * Throwaway users for local testing (never for real accounts): panel staff and storefront customers.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/panel-test-user.ts create <email> <staff|editor|admin|customer>
 *     → creates the user (e-mail must end with @test.local) with a verified e-mail address and prints
 *       its generated password
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/panel-test-user.ts cookie <email> <password> <origin>
 *     → signs in in-process and prints only the session cookie as name=value, for
 *       document.cookie = "<name=value>; path=/" on <origin> (e.g. http://core.localhost:3300)
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/panel-test-user.ts delete <email>
 *     → removes the user with its sessions, accounts and favorites (cascade), its saved addresses and its
 *       audit_log rows (addresses.user_id has no foreign key, so it is deleted explicitly)
 *
 * Refuses NODE_ENV=production, a DATABASE_URL that is not on this machine, and any e-mail outside
 * @test.local (so it can never print a real user's cookie or touch the real admin).
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { addresses, auditLog, user as userTable } from "@/db/schema";
import { forgetLimits } from "@/lib/rate-limit-store";
import { signInFailureKey } from "@/lib/auth-limits";
import { auth } from "@/lib/auth";

const ROLES = ["staff", "editor", "admin", "customer"] as const;
type Role = (typeof ROLES)[number];
const TEST_DOMAIN = "@test.local";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function fail(message: string): never {
  console.error(`panel-test-user: ${message}`);
  process.exit(1);
}

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") fail("refusing to run with NODE_ENV=production.");
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set (run with --env-file=.env.local).");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    fail("DATABASE_URL is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(host)) fail(`refusing to run against a non-local database (${host}).`);
}

function testEmail(raw: string | undefined): string {
  const email = (raw ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._+-]+@test\.local$/.test(email)) fail(`the e-mail must look like <name>${TEST_DOMAIN}.`);
  return email;
}

async function findUser(email: string) {
  const [row] = await db.select({ id: userTable.id, role: userTable.role }).from(userTable).where(eq(userTable.email, email)).limit(1);
  return row ?? null;
}

async function create(email: string, role: Role) {
  if (await findUser(email)) fail(`${email} already exists; delete it first.`);
  const password = randomBytes(18).toString("base64url");
  await auth.api.createUser({
    body: { email, password, name: `Test ${role} (${email.split("@")[0]})`, role, data: { emailVerified: true } },
  });
  // Customer sign-in requires a verified e-mail (day 4); staff always count as verified. Set it directly
  // as well, so the account can sign in whatever the admin plugin does with `data`.
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
  console.log(`created ${email} (${role}, e-mail verified)`);
  console.log(`password: ${password}`);
}

async function cookie(email: string, password: string, origin: string) {
  if (!(await findUser(email))) fail(`${email} does not exist.`);
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    fail("origin must be a URL such as http://core.localhost:3300.");
  }
  const response = await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({ origin: originUrl.origin }),
    asResponse: true,
  });
  if (!response.ok) fail(`sign-in failed (HTTP ${response.status}).`);
  const setCookies = response.headers.getSetCookie();
  const session = setCookies
    .map((c) => c.split(";")[0])
    .find((pair) => /^(__Secure-)?[\w.-]*session_token=/.test(pair));
  if (!session) fail("no session cookie in the sign-in response.");
  console.log(session);
}

async function remove(email: string) {
  const row = await findUser(email);
  if (!row) {
    console.log(`${email} does not exist (nothing to delete)`);
    return;
  }
  const audits = await db.delete(auditLog).where(eq(auditLog.userId, row.id)).returning({ id: auditLog.id });
  const saved = await db.delete(addresses).where(eq(addresses.userId, row.id)).returning({ id: addresses.id });
  await db.delete(userTable).where(eq(userTable.id, row.id)); // sessions, accounts and favorites cascade
  const failureKey = signInFailureKey(email);
  if (failureKey) await forgetLimits([failureKey]); // durable sign-in failure counter of this address
  console.log(`deleted ${email} (+${audits.length} audit rows, ${saved.length} addresses)`);
}

async function main() {
  assertSafeEnvironment();
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "create": {
      const role = args[1] as Role;
      if (!ROLES.includes(role)) fail(`role must be one of ${ROLES.join(", ")}.`);
      return create(testEmail(args[0]), role);
    }
    case "cookie":
      if (!args[1] || !args[2]) fail("usage: cookie <email> <password> <origin>");
      return cookie(testEmail(args[0]), args[1], args[2]);
    case "delete":
      return remove(testEmail(args[0]));
    default:
      fail("usage: create <email> <staff|editor|admin|customer> | cookie <email> <password> <origin> | delete <email>");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    // Never print the error object: Better Auth / DB errors may echo request bodies.
    console.error("panel-test-user failed:", error instanceof Error ? error.name : typeof error);
    process.exit(1);
  });
