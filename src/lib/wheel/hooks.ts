// Gift wheel hooks for the account flows (contract §1.1 "Claim paths"), the request-aware half: they
// read the spin cookie and the client IP, then call the DB services of ./service with plain values.
//   registerAction (new account only)     → bindSpinToAccount(tx, { via: "register", consumeClaimLimit })
//   signInAction EMAIL_NOT_VERIFIED        → bindWheelSpinForUnverifiedSignIn(email)   (bind only)
//   afterSignIn (sign-in, verify page)     → wheelSignInEffects(tx, …)                  (claim + auto-apply)
//   completeEmailVerification              → wheelVerificationEffects(tx, userId)       (no cookie, no IP)
// Server-only, NOT a Server Action file: nothing here may be callable from the browser with an id.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { safeErrorInfo } from "@/lib/db-errors";
import { clientIp } from "@/lib/request-ip";
import { readWheelSpinId } from "./cookie";
import { wheelClaimLimiter } from "./limits";
import { bindSpinToAccount } from "./service";

// The limit keys and the limiter live in ./limits (counted on the caller's transaction); re-exported here
// for the existing importers.
export { wheelClaimLimiter, wheelClaimLimitKey, wheelSpinLimitKey } from "./limits";

/** The client IP of the current request, or "" outside a request. */
export async function requestIp(): Promise<string> {
  try {
    return await clientIp();
  } catch {
    return "";
  }
}

/**
 * signInAction's EMAIL_NOT_VERIFIED branch (Better Auth checked the password before refusing): binds the
 * visitor's held spin to that existing, unverified account, so the prize is issued when the address is
 * verified (the fresh link Better Auth just sent may open on another device). Never throws; the answer
 * to the visitor stays the same.
 */
export async function bindWheelSpinForUnverifiedSignIn(email: string): Promise<void> {
  try {
    const spinId = await readWheelSpinId();
    if (!spinId) return;
    const [user] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email.trim().toLowerCase())).limit(1);
    if (!user) return;
    const limiter = wheelClaimLimiter(await requestIp());
    await db.transaction((tx) => bindSpinToAccount(tx, { spinId, userId: user.id, via: "sign_in", consumeClaimLimit: limiter }));
  } catch (error) {
    console.error("[wheel] unverified sign-in bind failed", safeErrorInfo(error));
  }
}
