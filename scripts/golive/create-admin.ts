/**
 * Go-live: creates the production panel admin on the target database (docs/GO-LIVE.md B5).
 *
 *   npx.cmd tsx --conditions=react-server scripts/golive/create-admin.ts [--reset-password]   (cwd = project root;
 *   npx.cmd in Windows PowerShell, plain npx elsewhere)
 *
 * Why not `npm run admin:create` (scripts/create-admin.ts): it runs with --env-file=.env.local, so an
 * unset or empty ADMIN_EMAIL / ADMIN_PASSWORD silently falls back to the LOCAL admin's values from
 * .env.local (PowerShell removes a variable set to ''), it accepts any DATABASE_URL, and it allows
 * Better Auth's 10-character minimum. This script reads nothing from disk:
 *   TARGET_DATABASE_URL  same rules as copy-content.ts (session pooler + ?sslmode=require, or a local
 *                        prestij_golive_* rehearsal database); never printed
 *   ADMIN_EMAIL          a real mailbox the owner reads (rehearsal: an @test.local address)
 *   ADMIN_PASSWORD       environment only, never an argument; 14-128 characters; never printed
 * The admin is created through the app's own Better Auth instance (src/lib/auth.ts: same password
 * hashing and user fields as the panel), with role "admin" and a verified e-mail address. An existing
 * admin with that e-mail is refused unless --reset-password is passed (new password, every session
 * revoked); an existing non-admin account is never promoted here.
 */
import { randomBytes } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { session as sessionTable, user as userTable } from "@/db/schema";
import { errorText, fail, targetFromEnv } from "./pg";
import { adminEmailProblem, adminPasswordProblem, describeTarget } from "./rules";

const SCRIPT = "golive/create-admin";
const ADMIN_NAME = "PRESTİJ Yönetici";
const RESET_FLAG = "--reset-password";

async function loadApp() {
  try {
    const { auth } = await import("@/lib/auth");
    const { db } = await import("@/db");
    return { auth, db };
  } catch (error) {
    if (/server-only|client component/i.test(errorText(error))) {
      fail(SCRIPT, "start it with: npx.cmd tsx --conditions=react-server scripts/golive/create-admin.ts");
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  argv.forEach((a, i) => {
    if (a === RESET_FLAG) return;
    // Never echo other arguments: one could be the password.
    fail(SCRIPT, /^--[a-z-]+$/.test(a) ? `unknown option ${a} (only ${RESET_FLAG}).` : `argument ${i + 1} was ignored unread: the password comes only from ADMIN_PASSWORD.`);
  });
  const reset = argv.includes(RESET_FLAG);

  const target = targetFromEnv(SCRIPT);
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const emailProblem = adminEmailProblem(email, target.check.kind);
  if (emailProblem) fail(SCRIPT, emailProblem);
  if (!password) fail(SCRIPT, "ADMIN_PASSWORD is not set (enter it in a hidden prompt, docs/GO-LIVE.md B5).");
  const passwordProblem = adminPasswordProblem(password, email);
  if (passwordProblem) fail(SCRIPT, passwordProblem);

  // src/db reads DATABASE_URL when it is first imported; only this process sees the value.
  process.env.DATABASE_URL = target.url;
  // Better Auth wants a secret at start-up. Creating a user signs nothing (no session, cookie or token),
  // so a throwaway value is enough; production's BETTER_AUTH_SECRET is never needed on this PC.
  process.env.BETTER_AUTH_SECRET ||= randomBytes(32).toString("base64url");
  const { auth, db } = await loadApp();
  // Belt and braces for the URL guard: write only into the database the guard checked.
  const [where] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (where?.name !== target.check.database) {
    fail(SCRIPT, `connected to database "${where?.name}", but the checked URL names "${target.check.database}". Nothing was written.`);
  }

  const ctx = await auth.$context;
  const { minPasswordLength, maxPasswordLength } = ctx.password.config;
  if (password.length < minPasswordLength || password.length > maxPasswordLength) {
    fail(SCRIPT, `Better Auth accepts ${minPasswordLength}-${maxPasswordLength} characters.`);
  }

  let outcome: string;
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (!existing) {
    await auth.api.createUser({ body: { email, password, name: ADMIN_NAME, role: "admin", data: { emailVerified: true } } });
    outcome = "created";
  } else {
    const [row] = await db.select({ role: userTable.role }).from(userTable).where(eq(userTable.id, existing.user.id)).limit(1);
    const role = row?.role ?? "customer";
    if (role !== "admin") {
      fail(SCRIPT, `${email} already exists as a "${role}" account and is not promoted here. Use another ADMIN_EMAIL.`);
    }
    if (!reset) fail(SCRIPT, `${email} is already an admin. Pass ${RESET_FLAG} to set a new password (every session of it is revoked).`);
    const hash = await ctx.password.hash(password);
    const credential = await ctx.internalAdapter.findCredentialAccount(existing.user.id);
    if (credential) await ctx.internalAdapter.updatePassword(existing.user.id, hash);
    else await ctx.internalAdapter.linkAccount({ providerId: "credential", accountId: existing.user.id, userId: existing.user.id, password: hash });
    if (!existing.user.emailVerified) {
      await db.update(userTable).set({ emailVerified: true, updatedAt: new Date() }).where(eq(userTable.id, existing.user.id));
    }
    await ctx.internalAdapter.deleteUserSessions(existing.user.id);
    outcome = "password reset, all its sessions revoked";
  }

  const [created] = await db
    .select({ role: userTable.role, emailVerified: userTable.emailVerified })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);
  if (created?.role !== "admin" || !created.emailVerified) throw new Error(`${email} is not a verified admin after the update.`);
  const roles = await db.select({ role: userTable.role, n: count() }).from(userTable).groupBy(userTable.role);
  const [sessions] = await db.select({ n: count() }).from(sessionTable);

  console.log(`Admin ${outcome}: ${email} (role admin, e-mail verified) on ${describeTarget(target.check)}`);
  console.log(`Accounts on the target: ${roles.map((r) => `${r.n} ${r.role}`).join(", ")}; sessions: ${sessions?.n ?? 0}`);
  console.log("OK");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`${SCRIPT}: FAILED: ${errorText(error)}`);
    process.exit(1);
  });
