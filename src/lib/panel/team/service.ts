// Team (staff accounts) service: list, create, change role, deactivate/reactivate, reset password.
// Takes (tx, input, actor, gateway) and never touches Next APIs, so DB tests call it directly.
//
// Writes go through the Better Auth admin plugin (TeamGateway), which runs on its own connections. To
// keep the safety rules race-free without holding row locks that those connections would wait on, every
// mutation first takes a transaction-scoped advisory lock: team changes run one at a time, and each one
// reads the committed state of the previous one. The audit row is written in the same transaction by
// panelAction (never with the password).
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { user } from "@/db/schema";
import type { AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import type { StaffSession } from "@/lib/session";
import type { TeamGateway } from "./gateway";
import { assertTeamChangeAllowed, generateStaffPassword, parseStaffRole, TEAM_MESSAGES, TEAM_ROLES, type StaffRole } from "./rules";

/** One row of the staff list (client-safe: ISO strings, no secrets). */
export type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  active: boolean;
  createdAt: string;
  /** Optimistic-lock token for role and status changes. */
  updatedAt: string;
  /** Start of the newest session (sign-in time), if any session row is left. */
  lastSignInAt: string | null;
  /** Sessions that have not expired yet. */
  sessions: number;
};

type Actor = Pick<StaffSession, "user">;

/** The role string holds a staff role (also inside a comma-separated list). */
const isStaffRow = sql`exists (select 1 from unnest(string_to_array(coalesce(${user.role}, ''), ',')) as r(v) where btrim(r.v) in ('admin', 'editor', 'staff'))`;
const isAdminRow = sql`exists (select 1 from unnest(string_to_array(coalesce(${user.role}, ''), ',')) as r(v) where btrim(r.v) = 'admin')`;
const isActive = sql`coalesce(${user.banned}, false) = false`;

// The subqueries name "user"."id" explicitly: inside a select, drizzle may print the outer column unqualified,
// which would then resolve to the session alias.
const memberColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  banned: user.banned,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastSignInAt: sql<Date | string | null>`(select max(s.created_at) from "session" s where s.user_id = "user"."id")`,
  sessions: sql<number>`(select count(*) from "session" s where s.user_id = "user"."id" and s.expires_at > now())`.mapWith(Number),
};

type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  lastSignInAt: Date | string | null;
  sessions: number;
};

function toMember(row: MemberRow): StaffMember | null {
  const role = parseStaffRole(row.role);
  if (!role) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    active: !row.banned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastSignInAt: row.lastSignInAt ? new Date(row.lastSignInAt).toISOString() : null,
    sessions: row.sessions,
  };
}

const roleRank = (role: StaffRole) => TEAM_ROLES.indexOf(role);

/** Every staff account: active first, then admins → editors → staff, then by name (Turkish order). */
export async function listStaffMembers(executor: Tx): Promise<StaffMember[]> {
  const rows = await executor.select(memberColumns).from(user).where(isStaffRow);
  return rows
    .map(toMember)
    .filter((m): m is StaffMember => m !== null)
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) || roleRank(b.role) - roleRank(a.role) || a.name.localeCompare(b.name, "tr"),
    );
}

export async function getStaffMember(executor: Tx, userId: string): Promise<StaffMember | null> {
  const [row] = await executor.select(memberColumns).from(user).where(eq(user.id, userId)).limit(1);
  return row ? toMember(row) : null;
}

/** Serializes team mutations (see the file comment). Released at commit/rollback. */
export async function lockTeam(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('prestij:panel-team'))`);
}

async function loadTarget(tx: Tx, userId: string) {
  const [row] = await tx
    .select({ id: user.id, name: user.name, email: user.email, role: user.role, banned: user.banned, updatedAt: user.updatedAt })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) throw new PanelError("not_found", TEAM_MESSAGES.notFound);
  return { ...row, staffRole: parseStaffRole(row.role), banned: Boolean(row.banned) };
}

/** Active (not banned) admins other than `excludeId`. */
export async function countOtherActiveAdmins(tx: Tx, excludeId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(user)
    .where(and(isAdminRow, isActive, sql`${user.id} <> ${excludeId}`));
  return row?.n ?? 0;
}

async function freshMember(tx: Tx, userId: string): Promise<StaffMember> {
  const member = await getStaffMember(tx, userId);
  if (!member) throw new PanelError("not_found", TEAM_MESSAGES.notFound);
  return member;
}

// ---------------------------------------------------------------------------------------------------
// Mutations

export type CreateStaffInput = { name: string; email: string; role: StaffRole };

/** Creates a staff account with a generated password, returned once (never stored or audited). */
export async function createStaffMember(
  tx: Tx,
  input: CreateStaffInput,
  _actor: Actor,
  gateway: TeamGateway,
): Promise<{ member: StaffMember; password: string; audit: AuditEntry }> {
  await lockTeam(tx);
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const [existing] = await tx.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`).limit(1);
  if (existing) throw fieldError("email", TEAM_MESSAGES.emailTaken);

  const password = generateStaffPassword();
  const { id } = await gateway.createUser({ email, name, role: input.role, password });
  const member = await freshMember(tx, id);
  return {
    member,
    password,
    audit: { action: "create", entity: "user", entityId: id, after: { name, email, role: input.role, active: true } },
  };
}

export type ChangeRoleInput = { userId: string; role: StaffRole; updatedAt: Date };

export async function changeStaffRole(
  tx: Tx,
  input: ChangeRoleInput,
  actor: Actor,
  gateway: TeamGateway,
): Promise<{ member: StaffMember; audit: AuditEntry }> {
  await lockTeam(tx);
  const row = await loadTarget(tx, input.userId);
  if (!row.staffRole) throw new PanelError("not_found", TEAM_MESSAGES.notStaff);
  assertTeamChangeAllowed({
    actorId: actor.user.id,
    target: { id: row.id, role: row.staffRole, banned: row.banned },
    change: { kind: "role", role: input.role },
    otherActiveAdmins: await countOtherActiveAdmins(tx, row.id),
  });
  assertFresh(row.updatedAt, input.updatedAt);
  await gateway.setRole(row.id, input.role);
  return {
    member: await freshMember(tx, row.id),
    audit: { action: "update", entity: "user", entityId: row.id, before: { role: row.staffRole }, after: { role: input.role } },
  };
}

export type SetActiveInput = { userId: string; active: boolean; updatedAt: Date };

/** Deactivate = ban + sign out everywhere; reactivate = unban (the old password works again). */
export async function setStaffActive(
  tx: Tx,
  input: SetActiveInput,
  actor: Actor,
  gateway: TeamGateway,
): Promise<{ member: StaffMember; audit: AuditEntry }> {
  await lockTeam(tx);
  const row = await loadTarget(tx, input.userId);
  if (!row.staffRole) throw new PanelError("not_found", TEAM_MESSAGES.notStaff);
  assertTeamChangeAllowed({
    actorId: actor.user.id,
    target: { id: row.id, role: row.staffRole, banned: row.banned },
    change: { kind: "active", active: input.active },
    otherActiveAdmins: await countOtherActiveAdmins(tx, row.id),
  });
  assertFresh(row.updatedAt, input.updatedAt);
  if (input.active) await gateway.unbanUser(row.id);
  else await gateway.banUser(row.id, TEAM_MESSAGES.banReason);
  return {
    member: await freshMember(tx, row.id),
    audit: { action: "status", entity: "user", entityId: row.id, before: { active: !input.active }, after: { active: input.active } },
  };
}

/**
 * Sets a new generated password, returned once. Signs the user out everywhere; for the acting admin's
 * own account only the other sessions end (the current one stays, so the password can be copied).
 */
export async function resetStaffPassword(
  tx: Tx,
  input: { userId: string },
  actor: Actor,
  gateway: TeamGateway,
): Promise<{ member: StaffMember; password: string; audit: AuditEntry }> {
  await lockTeam(tx);
  const row = await loadTarget(tx, input.userId);
  if (!row.staffRole) throw new PanelError("not_found", TEAM_MESSAGES.notStaff);
  assertTeamChangeAllowed({
    actorId: actor.user.id,
    target: { id: row.id, role: row.staffRole, banned: row.banned },
    change: { kind: "password" },
    otherActiveAdmins: 0,
  });
  const self = row.id === actor.user.id;
  const password = generateStaffPassword();
  await gateway.setUserPassword(row.id, password);
  if (self) await gateway.revokeOtherSessionsOfActor();
  else await gateway.revokeUserSessions(row.id);
  return {
    member: await freshMember(tx, row.id),
    password,
    audit: { action: "reset_password", entity: "user", entityId: row.id, after: { signedOutEverywhere: !self } },
  };
}
