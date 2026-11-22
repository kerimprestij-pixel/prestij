// Account lifecycle hooks called by Better Auth (wired in src/lib/auth.ts by CORE-COMMS), filled in by
// ACCOUNTS (src/lib/account/events.ts): link guest orders with the verified e-mail and queue the
// `welcome` mail; queue `password_changed` after a reset. They run inside the auth request (after the
// user row is updated) and never throw: a failure is logged (ids only) and the user's verification or
// reset still succeeds.
import "server-only";
import { handleEmailVerified, handlePasswordReset } from "@/lib/account/events";
import { safeErrorInfo } from "@/lib/db-errors";

export type AuthEventUser = { id: string; email: string; name: string; emailVerified: boolean };

/** After the user confirmed their e-mail address (emailVerification.afterEmailVerification). */
export async function onEmailVerified(user: AuthEventUser): Promise<void> {
  try {
    await handleEmailVerified(user.id);
  } catch (error) {
    console.error("[account] after-verification effects failed", { userId: user.id, ...safeErrorInfo(error) });
  }
}

/** After a password reset through the e-mailed link (the user's other sessions are already revoked). */
export async function onPasswordReset(user: AuthEventUser): Promise<void> {
  try {
    await handlePasswordReset(user.id);
  } catch (error) {
    console.error("[account] password-changed mail failed", { userId: user.id, ...safeErrorInfo(error) });
  }
}
