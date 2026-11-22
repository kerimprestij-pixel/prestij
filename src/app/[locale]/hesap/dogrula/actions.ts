"use server";
// /hesap/dogrula: confirms the e-mail address with the token from the verification mail. Better Auth
// marks the user verified and (autoSignInAfterVerification) sets the session cookie on this response
// (nextCookies plugin). The form then does a full page load to the return path or the account
// overview, so the root layout's viewer state (header, favorites) starts fresh as the signed-in user.

import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href, safeReturnPath } from "@/i18n/paths";
import { afterSignIn } from "@/lib/account/sign-in-effects";
import { auth } from "@/lib/auth";
import { safeErrorInfo } from "@/lib/db-errors";

export type VerifyEmailState = {
  status: "idle" | "error" | "verified";
  code?: "invalid" | "expired" | "failed";
  message?: string;
  /** Where to continue after "verified" (a safe local path). */
  redirectTo?: string;
};

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** Longest token accepted (Better Auth's JWTs are ~300 characters). */
const MAX_TOKEN_LENGTH = 4096;

/** Better Auth error code → our state. */
function verifyErrorCode(code: unknown): "invalid" | "expired" | "failed" {
  if (code === "TOKEN_EXPIRED") return "expired";
  if (code === "INVALID_TOKEN" || code === "USER_NOT_FOUND" || code === "INVALID_USER") return "invalid";
  return "failed";
}

export async function verifyEmailAction(_prev: VerifyEmailState, formData: FormData): Promise<VerifyEmailState> {
  const raw = field(formData, "locale");
  const locale: Locale = isLocale(raw) ? raw : "tr";
  const token = field(formData, "token").trim();
  const sonra = safeReturnPath(field(formData, "sonra"));
  const m = (await getMessages(locale)).auth.verify;

  if (!token || token.length > MAX_TOKEN_LENGTH) return { status: "error", code: "invalid", message: m.invalid };

  // ACCOUNTS: who this link is for, read before the call. Better Auth signs the user in only when the
  // link actually verifies an unverified address (an already verified one just answers "ok").
  const email = tokenEmail(token);
  const [before] = email
    ? await db.select({ id: schema.user.id, email: schema.user.email, emailVerified: schema.user.emailVerified }).from(schema.user).where(eq(schema.user.email, email)).limit(1)
    : [];

  try {
    await auth.api.verifyEmail({ query: { token }, headers: await headers() });
  } catch (error) {
    const code = verifyErrorCode(isAPIError(error) ? (error.body as { code?: unknown } | undefined)?.code : undefined);
    if (code === "failed") console.error("[auth] e-mail verification failed", safeErrorInfo(error));
    return { status: "error", code, message: code === "expired" ? m.expired : code === "invalid" ? m.invalid : m.failed };
  }

  // The link was valid (Better Auth checked its signature just above) and signed the user in: attach
  // this browser's cart to the new account (guest orders were linked by onEmailVerified).
  if (before && !before.emailVerified) await afterSignIn(before);

  return { status: "verified", message: m.success, redirectTo: sonra ?? `${href(locale, "account")}?dogrulandi=1` };
}

/**
 * The e-mail address in a verification JWT's payload (NOT verified here: only trusted after
 * auth.api.verifyEmail accepted the same token).
 */
function tokenEmail(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.length <= 254 ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}
