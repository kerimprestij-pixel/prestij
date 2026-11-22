// Team service against the local PostgreSQL and the real Better Auth admin plugin: a throwaway admin
// signs in, and its session cookie drives betterAuthTeamGateway exactly like the /panel/ekip actions do.
// Covers create (one-time password, duplicate e-mail), role changes, deactivate/reactivate (sessions
// revoked, banned sign-in refused), password reset (old password dead, sessions revoked, own session
// kept), the self/last-admin rules, non-staff targets, Better Auth's own admin check, and audit rows
// without secrets. Every user, session, account and audit row it creates is removed again.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/team.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { auth } from "@/lib/auth";
import { executePanelAction } from "@/lib/panel/action-core";
import { PanelError } from "@/lib/panel/errors";
import { betterAuthTeamGateway, type TeamGateway } from "@/lib/panel/team/gateway";
import { assertTeamChangeAllowed, generateStaffPassword, parseStaffRole, STAFF_PASSWORD_PATTERN, TEAM_MESSAGES } from "@/lib/panel/team/rules";
import {
  changeStaffRole,
  countOtherActiveAdmins,
  createStaffMember,
  getStaffMember,
  listStaffMembers,
  resetStaffPassword,
  setStaffActive,
} from "@/lib/panel/team/service";
import type { StaffSession } from "@/lib/session";

const PREFIX = "team-test-";
const EMAIL = (key: string) => `${PREFIX}${key}@test.local`;
const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const { user: userTable, session: sessionTable, auditLog } = schema;

type SignedIn = { userId: string; cookie: string; sessionToken: string };

let admin: SignedIn;
let adminActor: StaffSession;
let adminGateway: TeamGateway;
let auditSeq: { name: string; lastValue: string; isCalled: boolean } | null = null;

function randomPassword() {
  return generateStaffPassword();
}

async function signIn(email: string, password: string): Promise<SignedIn> {
  const response = await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({ origin: ORIGIN }),
    asResponse: true,
  });
  if (!response.ok) throw Object.assign(new Error(`sign-in failed (${response.status})`), { status: response.status, body: await response.text() });
  const pair = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => /session_token=/.test(c));
  assert.ok(pair, "session cookie set");
  const signed = decodeURIComponent(pair.slice(pair.indexOf("=") + 1));
  const sessionToken = signed.split(".")[0];
  const [row] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email));
  return { userId: row.id, cookie: pair, sessionToken };
}

async function signInStatus(email: string, password: string): Promise<number> {
  const response = await auth.api.signInEmail({ body: { email, password }, headers: new Headers({ origin: ORIGIN }), asResponse: true });
  return response.status;
}

async function createRawUser(email: string, role: string): Promise<{ id: string; password: string }> {
  const password = randomPassword();
  const result = await auth.api.createUser({ body: { email, password, name: `Team Test ${role}`, role: role as "admin", data: { emailVerified: true } } });
  return { id: result.user.id, password };
}

function actorFor(userId: string, email: string, sessionId: string): StaffSession {
  return {
    user: { id: userId, name: "Team Test Admin", email, role: "admin", banned: false },
    session: { id: sessionId },
    staffRole: "admin",
  } as unknown as StaffSession;
}

async function sessionCount(userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(sessionTable).where(eq(sessionTable.userId, userId));
  return row.n;
}

async function testUserIds(): Promise<string[]> {
  const rows = await db.select({ id: userTable.id }).from(userTable).where(like(userTable.email, `${PREFIX}%@test.local`));
  return rows.map((r) => r.id);
}

async function cleanup() {
  const ids = await testUserIds();
  if (ids.length === 0) return;
  await db.delete(auditLog).where(or(inArray(auditLog.userId, ids), sql`${auditLog.entity} = 'user' and ${auditLog.entityId} in ${ids}`));
  await db.delete(userTable).where(inArray(userTable.id, ids)); // sessions + accounts cascade
}

/** Runs a team service in one transaction, like panelAction does (without writing audit rows). */
function inTx<T>(run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(run);
}

async function rejectsWith(promise: Promise<unknown>, code: PanelError["code"], message?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PanelError, `expected PanelError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (message) assert.equal(error.message, message);
    return true;
  });
}

before(async () => {
  await cleanup();
  const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence('audit_log', 'id') as seq`);
  const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
  auditSeq = { name: seq, lastValue: row.last_value, isCalled: row.is_called };

  const created = await createRawUser(EMAIL("admin"), "admin");
  admin = await signIn(EMAIL("admin"), created.password);
  const [s] = await db.select({ id: sessionTable.id }).from(sessionTable).where(eq(sessionTable.token, admin.sessionToken));
  adminActor = actorFor(admin.userId, EMAIL("admin"), s.id);
  adminGateway = betterAuthTeamGateway(new Headers({ cookie: admin.cookie, origin: ORIGIN }));
});

after(async () => {
  try {
    await cleanup();
    assert.deepEqual(await testUserIds(), [], "no test users left");
    if (auditSeq) {
      const [{ max }] = await db.execute<{ max: string | null }>(sql`select max(id)::text as max from audit_log`);
      if (max === null || Number(max) <= Number(auditSeq.lastValue)) {
        await db.execute(sql`select setval(${auditSeq.name}::regclass, ${auditSeq.lastValue}::bigint, ${auditSeq.isCalled})`);
      }
    }
  } finally {
    await db.$client.end();
  }
});

describe("rules (pure)", () => {
  test("parseStaffRole picks the highest staff role", () => {
    assert.equal(parseStaffRole("editor"), "editor");
    assert.equal(parseStaffRole("customer, staff"), "staff");
    assert.equal(parseStaffRole("staff,admin"), "admin");
    assert.equal(parseStaffRole("customer"), null);
    assert.equal(parseStaffRole(null), null);
  });

  test("generated passwords: four groups of five, unambiguous symbols, unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateStaffPassword();
      assert.match(p, STAFF_PASSWORD_PATTERN);
      assert.doesNotMatch(p, /[0O1lI]/);
      seen.add(p);
    }
    assert.equal(seen.size, 200);
  });

  test("the last active admin can be neither demoted nor deactivated", () => {
    const target = { id: "a2", role: "admin" as const, banned: false };
    const lastAdmin = new PanelError("invalid", TEAM_MESSAGES.lastAdmin);
    assert.throws(() => assertTeamChangeAllowed({ actorId: "a1", target, change: { kind: "role", role: "editor" }, otherActiveAdmins: 0 }), lastAdmin);
    assert.throws(() => assertTeamChangeAllowed({ actorId: "a1", target, change: { kind: "active", active: false }, otherActiveAdmins: 0 }), lastAdmin);
    // With another active admin both are fine; a banned admin is not "active", so demoting it is fine too.
    assertTeamChangeAllowed({ actorId: "a1", target, change: { kind: "role", role: "editor" }, otherActiveAdmins: 1 });
    assertTeamChangeAllowed({ actorId: "a1", target: { ...target, banned: true }, change: { kind: "role", role: "staff" }, otherActiveAdmins: 0 });
  });

  test("self demotion and self deactivation are refused; customers are not team members", () => {
    const self = { id: "a1", role: "admin" as const, banned: false };
    assert.throws(() => assertTeamChangeAllowed({ actorId: "a1", target: self, change: { kind: "role", role: "staff" }, otherActiveAdmins: 5 }), new PanelError("forbidden", TEAM_MESSAGES.selfRole));
    assert.throws(() => assertTeamChangeAllowed({ actorId: "a1", target: self, change: { kind: "active", active: false }, otherActiveAdmins: 5 }), new PanelError("forbidden", TEAM_MESSAGES.selfBan));
    assertTeamChangeAllowed({ actorId: "a1", target: self, change: { kind: "password" }, otherActiveAdmins: 0 });
    assert.throws(() => assertTeamChangeAllowed({ actorId: "a1", target: { id: "c", role: null, banned: false }, change: { kind: "password" }, otherActiveAdmins: 1 }), new PanelError("not_found", TEAM_MESSAGES.notStaff));
  });
});

describe("team service (Better Auth admin plugin)", () => {
  let editor: { id: string; password: string; updatedAt: string };
  let staff: { id: string; password: string; updatedAt: string };

  test("create: staff accounts with a one-time password; duplicate e-mail → field error", async () => {
    const e = await inTx((tx) => createStaffMember(tx, { name: "Team Test Editör", email: ` ${EMAIL("editor").toUpperCase()} `, role: "editor" }, adminActor, adminGateway));
    assert.match(e.password, STAFF_PASSWORD_PATTERN);
    assert.equal(e.member.email, EMAIL("editor"));
    assert.equal(e.member.role, "editor");
    assert.equal(e.member.active, true);
    assert.deepEqual(e.audit.after, { name: "Team Test Editör", email: EMAIL("editor"), role: "editor", active: true });
    assert.ok(!JSON.stringify(e.audit).includes(e.password), "audit never holds the password");
    editor = { id: e.member.id, password: e.password, updatedAt: e.member.updatedAt };

    const s = await inTx((tx) => createStaffMember(tx, { name: "Team Test Personel", email: EMAIL("staff"), role: "staff" }, adminActor, adminGateway));
    staff = { id: s.member.id, password: s.password, updatedAt: s.member.updatedAt };
    assert.notEqual(s.password, e.password);

    // The generated password signs in; the e-mail is verified and the role is stored as given.
    assert.equal(await signInStatus(EMAIL("staff"), s.password), 200);
    const [row] = await db.select().from(userTable).where(eq(userTable.id, staff.id));
    assert.equal(row.role, "staff");
    assert.equal(row.emailVerified, true);
    const signedInMember = await getStaffMember(db, staff.id);
    assert.ok(signedInMember?.lastSignInAt, "last sign-in comes from the user's own session rows");
    assert.equal(signedInMember?.sessions, 1);
    assert.equal(s.member.lastSignInAt, null, "a fresh account has not signed in yet");

    await rejectsWith(
      inTx((tx) => createStaffMember(tx, { name: "Dup", email: EMAIL("editor"), role: "staff" }, adminActor, adminGateway)),
      "invalid",
      TEAM_MESSAGES.emailTaken,
    );

    const list = await listStaffMembers(db);
    const mine = list.filter((m) => m.email.startsWith(PREFIX));
    assert.deepEqual(mine.map((m) => m.role), ["admin", "editor", "staff"], "admins first, then editors, then staff");
  });

  test("role change: guarded by updatedAt; own role refused; promotion and demotion work", async () => {
    await rejectsWith(
      inTx((tx) => changeStaffRole(tx, { userId: admin.userId, role: "editor", updatedAt: new Date() }, adminActor, adminGateway)),
      "forbidden",
      TEAM_MESSAGES.selfRole,
    );
    await rejectsWith(
      inTx((tx) => changeStaffRole(tx, { userId: editor.id, role: "admin", updatedAt: new Date(Date.parse(editor.updatedAt) - 60_000) }, adminActor, adminGateway)),
      "conflict",
    );
    await rejectsWith(
      inTx((tx) => changeStaffRole(tx, { userId: editor.id, role: "editor", updatedAt: new Date(editor.updatedAt) }, adminActor, adminGateway)),
      "invalid",
      TEAM_MESSAGES.sameRole,
    );

    const before = await inTx((tx) => countOtherActiveAdmins(tx, admin.userId));
    const promoted = await inTx((tx) => changeStaffRole(tx, { userId: editor.id, role: "admin", updatedAt: new Date(editor.updatedAt) }, adminActor, adminGateway));
    assert.equal(promoted.member.role, "admin");
    assert.deepEqual(promoted.audit, { action: "update", entity: "user", entityId: editor.id, before: { role: "editor" }, after: { role: "admin" } });
    assert.equal(await inTx((tx) => countOtherActiveAdmins(tx, admin.userId)), before + 1);

    // Another admin exists (us), so demoting the new admin is allowed.
    const demoted = await inTx((tx) => changeStaffRole(tx, { userId: editor.id, role: "editor", updatedAt: new Date(promoted.member.updatedAt) }, adminActor, adminGateway));
    assert.equal(demoted.member.role, "editor");
    editor.updatedAt = demoted.member.updatedAt;
  });

  test("deactivate bans and signs out everywhere; banned sign-in is refused; reactivate restores access", async () => {
    await signIn(EMAIL("staff"), staff.password);
    assert.ok((await sessionCount(staff.id)) >= 1);

    await rejectsWith(
      inTx((tx) => setStaffActive(tx, { userId: admin.userId, active: false, updatedAt: new Date() }, adminActor, adminGateway)),
      "forbidden",
      TEAM_MESSAGES.selfBan,
    );

    const off = await inTx((tx) => setStaffActive(tx, { userId: staff.id, active: false, updatedAt: new Date(staff.updatedAt) }, adminActor, adminGateway));
    assert.equal(off.member.active, false);
    assert.deepEqual(off.audit.after, { active: false });
    assert.equal(await sessionCount(staff.id), 0, "all sessions revoked");
    assert.equal(await signInStatus(EMAIL("staff"), staff.password), 403, "banned user cannot sign in");

    await rejectsWith(
      inTx((tx) => setStaffActive(tx, { userId: staff.id, active: false, updatedAt: new Date(off.member.updatedAt) }, adminActor, adminGateway)),
      "invalid",
      TEAM_MESSAGES.alreadyInactive,
    );
    // The stale token from before the ban is a conflict.
    await rejectsWith(
      inTx((tx) => setStaffActive(tx, { userId: staff.id, active: true, updatedAt: new Date(staff.updatedAt) }, adminActor, adminGateway)),
      "conflict",
    );

    const on = await inTx((tx) => setStaffActive(tx, { userId: staff.id, active: true, updatedAt: new Date(off.member.updatedAt) }, adminActor, adminGateway));
    assert.equal(on.member.active, true);
    assert.equal(await signInStatus(EMAIL("staff"), staff.password), 200, "old password works again");
    staff.updatedAt = on.member.updatedAt;
  });

  test("password reset: new password once, old one dead, sessions revoked; own reset keeps this session", async () => {
    await signIn(EMAIL("editor"), editor.password);
    assert.ok((await sessionCount(editor.id)) >= 1);
    const reset = await inTx((tx) => resetStaffPassword(tx, { userId: editor.id }, adminActor, adminGateway));
    assert.match(reset.password, STAFF_PASSWORD_PATTERN);
    assert.equal(await sessionCount(editor.id), 0);
    assert.equal(await signInStatus(EMAIL("editor"), editor.password), 401, "old password refused");
    assert.equal(await signInStatus(EMAIL("editor"), reset.password), 200, "new password works");
    assert.ok(!JSON.stringify(reset.audit).includes(reset.password));
    assert.deepEqual(reset.audit, { action: "reset_password", entity: "user", entityId: editor.id, after: { signedOutEverywhere: true } });
    editor.password = reset.password;

    // Own account: a second session ends, the current one stays.
    const adminPassword = await inTx(async (tx) => {
      const own = await resetStaffPassword(tx, { userId: admin.userId }, adminActor, adminGateway);
      return own.password;
    });
    const sessions = await db.select({ token: sessionTable.token }).from(sessionTable).where(eq(sessionTable.userId, admin.userId));
    assert.deepEqual(sessions.map((s) => s.token), [admin.sessionToken], "only the current session is left");
    const second = await signIn(EMAIL("admin"), adminPassword);
    assert.ok(second.sessionToken);
  });

  test("customers are not managed here; unknown users are not found", async () => {
    const customer = await createRawUser(EMAIL("customer"), "customer");
    await rejectsWith(inTx((tx) => resetStaffPassword(tx, { userId: customer.id }, adminActor, adminGateway)), "not_found", TEAM_MESSAGES.notStaff);
    await rejectsWith(
      inTx((tx) => changeStaffRole(tx, { userId: customer.id, role: "admin", updatedAt: new Date() }, adminActor, adminGateway)),
      "not_found",
      TEAM_MESSAGES.notStaff,
    );
    await rejectsWith(inTx((tx) => resetStaffPassword(tx, { userId: "does-not-exist" }, adminActor, adminGateway)), "not_found");
    assert.equal(await getStaffMember(db, customer.id), null);
  });

  test("Better Auth re-checks the session: an editor's cookie cannot use the admin endpoints", async () => {
    const signedEditor = await signIn(EMAIL("editor"), editor.password);
    const editorGateway = betterAuthTeamGateway(new Headers({ cookie: signedEditor.cookie, origin: ORIGIN }));
    const editorActor = actorFor(signedEditor.userId, EMAIL("editor"), "x");
    await rejectsWith(
      inTx((tx) => changeStaffRole(tx, { userId: staff.id, role: "admin", updatedAt: new Date(staff.updatedAt) }, editorActor, editorGateway)),
      "forbidden",
    );
    await rejectsWith(inTx((tx) => resetStaffPassword(tx, { userId: staff.id }, editorActor, editorGateway)), "forbidden");
    const [row] = await db.select({ role: userTable.role }).from(userTable).where(eq(userTable.id, staff.id));
    assert.equal(row.role, "staff", "nothing changed");
  });

  test("through executePanelAction: one audit row per change, actor recorded, no password anywhere", async () => {
    const { result } = await executePanelAction(
      {
        schema: z.object({ userId: z.string() }),
        run: async (input, { actor, tx }) => {
          const { member, password, audit } = await resetStaffPassword(tx, input, actor, adminGateway);
          return { data: { member, password }, audit };
        },
      },
      adminActor,
      { userId: staff.id },
    );
    assert.equal(result.ok, true);
    const password = result.ok ? (result.data as { password: string }).password : "";
    const rows = await db.select().from(auditLog).where(eq(auditLog.userId, admin.userId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, "reset_password");
    assert.equal(rows[0].entity, "user");
    assert.equal(rows[0].entityId, staff.id);
    assert.ok(!JSON.stringify(rows[0]).includes(password));
  });
});
