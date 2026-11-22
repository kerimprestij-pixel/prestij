// The Better Auth admin plugin, behind the small interface the team service needs. Every call carries
// the acting admin's request headers, so Better Auth checks the session and its own admin permission
// again (defence in depth on top of panelAction's role check). No Next imports: the action passes
// `await headers()`, DB tests pass the cookie of a throwaway admin.
import "server-only";
import { auth } from "@/lib/auth";
import { PanelError, fieldError, isPanelError } from "@/lib/panel/errors";
import type { StaffRole } from "@/lib/panel/roles";
import { TEAM_MESSAGES } from "./rules";

export type TeamGateway = {
  /** Creates the user with an e-mail/password account (e-mail marked verified) and the given role. */
  createUser(input: { email: string; name: string; role: StaffRole; password: string }): Promise<{ id: string }>;
  setRole(userId: string, role: StaffRole): Promise<void>;
  /** Bans the user and deletes all of their sessions (Better Auth does both). */
  banUser(userId: string, reason: string): Promise<void>;
  unbanUser(userId: string): Promise<void>;
  setUserPassword(userId: string, password: string): Promise<void>;
  /** Signs the user out everywhere. */
  revokeUserSessions(userId: string): Promise<void>;
  /** Signs the acting user out everywhere except the current session. */
  revokeOtherSessionsOfActor(): Promise<void>;
};

type BetterAuthErrorLike = { status?: unknown; statusCode?: unknown; body?: { code?: unknown } };

/** Better Auth APIError → PanelError with Turkish text; anything unexpected is rethrown (generic message). */
export function toTeamPanelError(error: unknown): unknown {
  if (isPanelError(error) || !error || typeof error !== "object") return error;
  const e = error as BetterAuthErrorLike;
  const code = typeof e.body?.code === "string" ? e.body.code : "";
  const status = typeof e.statusCode === "number" ? e.statusCode : 0;
  if (code.startsWith("USER_ALREADY_EXISTS")) return fieldError("email", TEAM_MESSAGES.emailTaken);
  if (code === "YOU_CANNOT_BAN_YOURSELF") return new PanelError("forbidden", TEAM_MESSAGES.selfBan);
  if (code === "USER_NOT_FOUND" || status === 404) return new PanelError("not_found", TEAM_MESSAGES.notFound);
  if (status === 401 || status === 403) return new PanelError("forbidden");
  return error;
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toTeamPanelError(error);
  }
}

/** Gateway that acts as the admin whose request `requestHeaders` came from. */
export function betterAuthTeamGateway(requestHeaders: Headers): TeamGateway {
  const headers = new Headers(requestHeaders);
  return {
    createUser: ({ email, name, role, password }) =>
      call(async () => {
        const result = await auth.api.createUser({
          body: { email, name, password, role, data: { emailVerified: true } },
          headers,
        });
        return { id: result.user.id };
      }),
    setRole: (userId, role) =>
      call(async () => {
        await auth.api.setRole({ body: { userId, role }, headers });
      }),
    banUser: (userId, reason) =>
      call(async () => {
        await auth.api.banUser({ body: { userId, banReason: reason }, headers });
      }),
    unbanUser: (userId) =>
      call(async () => {
        await auth.api.unbanUser({ body: { userId }, headers });
      }),
    setUserPassword: (userId, password) =>
      call(async () => {
        await auth.api.setUserPassword({ body: { userId, newPassword: password }, headers });
      }),
    revokeUserSessions: (userId) =>
      call(async () => {
        await auth.api.revokeUserSessions({ body: { userId }, headers });
      }),
    revokeOtherSessionsOfActor: () =>
      call(async () => {
        await auth.api.revokeOtherSessions({ headers });
      }),
  };
}
