"use server";
// Storefront auth Server Actions (/hesap/giris, /kayit, /sifremi-unuttum, /sifre-sifirla, sign-out).
// Each validates with zod, applies durable limits (Better Auth's own IP limits only cover its HTTP
// routes, not these in-process auth.api calls), calls Better Auth in-process (the nextCookies plugin
// sets the session cookie on this response) and answers with localized texts. Responses never reveal
// whether an e-mail address has an account. After a successful sign-in the browser cart is attached
// to the account (merged with an older account cart) and verified guest orders are linked.
// Gift wheel (day 6): a new account takes over the visitor's held spin (prize at e-mail verification); a
// sign-in claims it (afterSignIn); an unverified sign-in only binds it. See src/lib/wheel/hooks.ts.

import { isAPIError } from "better-auth/api";
import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { href, safeReturnPath } from "@/i18n/paths";
import { auth } from "@/lib/auth";
import { SIGN_IN_LOCKED_CODE } from "@/lib/auth-limits";
import { clearCartId, readCartId } from "@/lib/cart/cookie";
import { safeErrorInfo } from "@/lib/db-errors";
import { isNewsletterEnabled } from "@/lib/newsletter/service";
import type { RateRule } from "@/lib/rate-limit";
import { checkLimits, consumeLimits } from "@/lib/rate-limit-store";
import { clientIp } from "@/lib/request-ip";
import { getSession } from "@/lib/session";
import { clearWheelSpinCookie, readWheelSpinId } from "@/lib/wheel/cookie";
import { bindWheelSpinForUnverifiedSignIn, wheelClaimLimiter } from "@/lib/wheel/hooks";
import { findSpin } from "@/lib/wheel/service";
import { localizeFieldCodes } from "./messages";
import { registerSuccessMarketing, type RegisterNewsletterOutcome } from "./register-newsletter";
import { recordNewAccount } from "./registration";
import { afterSignIn } from "./sign-in-effects";
import { echoValues, fieldCodes, forgotPasswordSchema, registerSchema, resetPasswordSchema, signInSchema } from "./schemas";

export type AuthFormState = {
  status: "idle" | "error" | "success";
  /** Increments on every answer, so the form can move focus each time. */
  attempt: number;
  formError?: string;
  /** "emailNotVerified": a fresh verification mail was sent; "invalidToken": the reset link is spent. */
  errorCode?: "emailNotVerified" | "invalidToken" | "rateLimited" | "invalidCredentials" | "generic";
  fieldErrors?: Record<string, string>;
  /** Submitted text fields (never passwords), to refill the form. */
  values?: Record<string, string>;
  /** Sign-in / reset: where to go next (full page load, so the header and viewer start fresh). */
  redirectTo?: string;
  /** Sign-in: items in the (merged) cart for the header badge. */
  cartCount?: number;
  /** Register: the address the mail went to; whether the success screen mentions the newsletter confirmation mail (registerMarketingNotice). */
  email?: string;
  marketing?: boolean;
};

const MINUTE = 60_000;
const RULES = {
  /** Failed sign-ins per client IP (the per-e-mail lock lives in auth.ts hooks). */
  signInIp: { limit: 30, windowMs: 15 * MINUTE },
  registerIp: { limit: 10, windowMs: 60 * MINUTE },
  registerEmail: { limit: 3, windowMs: 60 * MINUTE },
  forgotIp: { limit: 10, windowMs: 60 * MINUTE },
  forgotEmail: { limit: 5, windowMs: 60 * MINUTE },
  resetIp: { limit: 20, windowMs: 60 * MINUTE },
} as const satisfies Record<string, RateRule>;

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const localeOf = (formData: FormData): Locale => {
  const raw = field(formData, "locale");
  return isLocale(raw) ? raw : "tr";
};
const errorCodeOf = (error: unknown): string | undefined =>
  isAPIError(error) ? ((error.body as { code?: unknown } | undefined)?.code as string | undefined) : undefined;

export async function signInAction(prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const locale = localeOf(formData);
  const messages = await getMessages(locale);
  const e = messages.auth.errors;
  const values = echoValues(formData);
  const parsed = signInSchema.safeParse({ locale, email: field(formData, "email"), password: field(formData, "password") });
  if (!parsed.success) {
    return { status: "error", attempt, fieldErrors: localizeFieldCodes(fieldCodes(parsed.error.issues), messages, locale), values };
  }
  const { email, password } = parsed.data;
  const sonra = safeReturnPath(field(formData, "sonra"));
  const ip = await clientIp();
  const ipKey: [string, RateRule] = [`signin:ip:${ip}`, RULES.signInIp];
  const wait = (await checkLimits([ipKey])).retryAfterMinutes;
  if (wait > 0) return { status: "error", attempt, errorCode: "rateLimited", formError: format(e.rateLimited, { minutes: wait }, locale), values };

  let userId: string;
  try {
    // callbackURL: the verification link Better Auth re-sends to an unverified account keeps the return path.
    const callbackURL = href(locale, "verifyEmail") + (sonra ? `?sonra=${encodeURIComponent(sonra)}` : "");
    const result = await auth.api.signInEmail({ body: { email, password, rememberMe: true, callbackURL }, headers: await headers() });
    userId = result.user.id;
  } catch (error) {
    const code = errorCodeOf(error);
    const status = isAPIError(error) ? error.statusCode : 0;
    if (status === 401 || code === "INVALID_EMAIL_OR_PASSWORD") {
      await consumeLimits([ipKey]);
      return { status: "error", attempt, errorCode: "invalidCredentials", formError: e.invalidCredentials, values };
    }
    if (code === "EMAIL_NOT_VERIFIED") {
      // The password was right (Better Auth checks it first): the held wheel spin waits for the verification.
      await bindWheelSpinForUnverifiedSignIn(email);
      return { status: "error", attempt, errorCode: "emailNotVerified", formError: e.emailNotVerified, values };
    }
    if (code === SIGN_IN_LOCKED_CODE || status === 429) return { status: "error", attempt, errorCode: "rateLimited", formError: e.tooManyRequests, values };
    if (code === "BANNED_USER") return { status: "error", attempt, formError: e.accountBanned, values };
    console.error("[account] sign-in failed", safeErrorInfo(error));
    return { status: "error", attempt, errorCode: "generic", formError: e.generic, values };
  }

  const { cartCount } = await afterSignIn({ id: userId, email });
  return { status: "success", attempt, redirectTo: sonra ?? href(locale, "account"), cartCount };
}

/** Current versions of the texts the register form shows (stored with the consent record). */
async function consentVersions(): Promise<{ membership: string | null; kvkk: string | null }> {
  const t = schema.legalDocuments;
  const rows = await db
    .select({ key: t.key, version: t.version })
    .from(t)
    .where(and(inArray(t.key, ["membership", "kvkk"]), eq(t.isCurrent, true)));
  return { membership: rows.find((r) => r.key === "membership")?.version ?? null, kvkk: rows.find((r) => r.key === "kvkk")?.version ?? null };
}

export async function registerAction(prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const locale = localeOf(formData);
  const messages = await getMessages(locale);
  const e = messages.auth.errors;
  const values = echoValues(formData);
  const parsed = registerSchema.safeParse({
    locale,
    name: field(formData, "name"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    password: field(formData, "password"),
    terms: field(formData, "terms"),
    marketing: field(formData, "marketing"),
  });
  // Bots fill every field; people never see this one. Same answer as a real sign-up.
  if (field(formData, "website").trim() !== "") {
    return parsed.success ? { status: "success", attempt, email: parsed.data.email, marketing: false } : { status: "success", attempt, marketing: false };
  }
  if (!parsed.success) {
    return { status: "error", attempt, fieldErrors: localizeFieldCodes(fieldCodes(parsed.error.issues), messages, locale), values };
  }
  const data = parsed.data;
  const ip = await clientIp();
  const decision = await consumeLimits([
    [`register:ip:${ip}`, RULES.registerIp],
    [`register:email:${data.email}`, RULES.registerEmail],
  ]);
  if (!decision.allowed) return { status: "error", attempt, errorCode: "rateLimited", formError: format(e.rateLimited, { minutes: decision.retryAfterMinutes }, locale), values };

  const u = schema.user;
  const existedBefore = (await db.select({ id: u.id }).from(u).where(eq(u.email, data.email)).limit(1)).length > 0;
  const sonra = safeReturnPath(field(formData, "sonra"));
  const callbackURL = href(locale, "verifyEmail") + (sonra ? `?sonra=${encodeURIComponent(sonra)}` : "");
  try {
    await auth.api.signUpEmail({
      body: { name: data.name, email: data.email, password: data.password, locale, callbackURL, ...(data.phone ? { phone: data.phone } : {}) },
      headers: await headers(),
    });
  } catch (error) {
    const code = errorCodeOf(error);
    if (code === "EMAIL_PASSWORD_SIGN_UP_DISABLED") return { status: "error", attempt, formError: e.signUpClosed, values };
    if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
      return { status: "error", attempt, fieldErrors: localizeFieldCodes({ password: code === "PASSWORD_TOO_SHORT" ? "password_too_short" : "password_too_long" }, messages, locale), values };
    }
    // An existing address answers like a new one (requireEmailVerification), so any other error is ours.
    if (code !== "USER_ALREADY_EXISTS" && code !== "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      console.error("[account] sign-up failed", safeErrorInfo(error));
      return { status: "error", attempt, formError: e.generic, values };
    }
  }

  // Go-live SR-1: the newsletter box exists only while the newsletter is on (the form hides it otherwise);
  // a ticked value with the newsletter off (stale page, forged request) is ignored. Fresh read, the same
  // switch subscribeNewsletter obeys.
  const newsletterEnabled = await isNewsletterEnabled(db);
  // Only a brand-new account gets the consent record, the newsletter request and the visitor's held
  // wheel spin (never reveal or change anything for an address that already had an account).
  let newAccountOutcome: RegisterNewsletterOutcome | null = null;
  if (!existedBefore) {
    try {
      const [created] = await db.select({ id: u.id }).from(u).where(eq(u.email, data.email)).limit(1);
      if (created) {
        const versions = await consentVersions();
        const wheelSpinId = await readWheelSpinId();
        const records = await db.transaction((tx) =>
          recordNewAccount(tx, {
            userId: created.id,
            email: data.email,
            locale,
            ip,
            versions,
            wheelSpinId,
            consumeClaimLimit: wheelClaimLimiter(ip),
            newsletterEnabled,
            marketingTicked: data.marketing,
          }),
        );
        newAccountOutcome = records.newsletter;
      }
    } catch (error) {
      console.error("[account] post sign-up records failed", safeErrorInfo(error));
    }
  }
  // "We also sent a confirmation e-mail": a brand-new account only for a request the newsletter service accepted;
  // an address that already had an account gets the answer a new account normally gets (no enumeration).
  const marketing = registerSuccessMarketing({ existedBefore, newsletterEnabled, ticked: data.marketing, newAccountOutcome });
  return { status: "success", attempt, email: data.email, marketing };
}

export async function forgotPasswordAction(prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const locale = localeOf(formData);
  const messages = await getMessages(locale);
  const values = echoValues(formData);
  const parsed = forgotPasswordSchema.safeParse({ locale, email: field(formData, "email") });
  if (!parsed.success) return { status: "error", attempt, fieldErrors: localizeFieldCodes(fieldCodes(parsed.error.issues), messages, locale), values };
  const { email } = parsed.data;
  const ip = await clientIp();
  const decision = await consumeLimits([
    [`forgot:ip:${ip}`, RULES.forgotIp],
    [`forgot:email:${email}`, RULES.forgotEmail],
  ]);
  if (!decision.allowed) {
    return { status: "error", attempt, errorCode: "rateLimited", formError: format(messages.auth.errors.rateLimited, { minutes: decision.retryAfterMinutes }, locale), values };
  }
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: href(locale, "resetPassword") }, headers: await headers() });
  } catch (error) {
    // Same answer either way (no enumeration); log the class only.
    console.error("[account] password reset request failed", safeErrorInfo(error));
  }
  return { status: "success", attempt, email };
}

export async function resetPasswordAction(prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const locale = localeOf(formData);
  const messages = await getMessages(locale);
  const e = messages.auth.errors;
  const parsed = resetPasswordSchema.safeParse({ locale, token: field(formData, "token"), password: field(formData, "password"), confirm: field(formData, "confirm") });
  if (!parsed.success) {
    const codes = fieldCodes(parsed.error.issues);
    if (codes.token) return { status: "error", attempt, errorCode: "invalidToken", formError: e.invalidToken };
    return { status: "error", attempt, fieldErrors: localizeFieldCodes(codes, messages, locale) };
  }
  const ip = await clientIp();
  const decision = await consumeLimits([[`reset:ip:${ip}`, RULES.resetIp]]);
  if (!decision.allowed) return { status: "error", attempt, errorCode: "rateLimited", formError: format(e.rateLimited, { minutes: decision.retryAfterMinutes }, locale) };
  try {
    await auth.api.resetPassword({ body: { newPassword: parsed.data.password, token: parsed.data.token }, headers: await headers() });
  } catch (error) {
    const code = errorCodeOf(error);
    if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED") return { status: "error", attempt, errorCode: "invalidToken", formError: e.invalidToken };
    if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
      return { status: "error", attempt, fieldErrors: localizeFieldCodes({ password: code === "PASSWORD_TOO_SHORT" ? "password_too_short" : "password_too_long" }, messages, locale) };
    }
    console.error("[account] password reset failed", safeErrorInfo(error));
    return { status: "error", attempt, errorCode: "generic", formError: e.generic };
  }
  // A reset finished on a device where an account is signed in (a shared or family computer): end that
  // session, so the sign-in page shows the form with "password renewed" instead of forwarding to the
  // other account. (Better Auth already revoked every session of the account that was reset.)
  try {
    const current = await getSession();
    if (current?.session) {
      await prepareSignOutAction(locale);
      await auth.api.signOut({ headers: await headers() });
    }
  } catch (error) {
    console.error("[account] sign-out after reset failed", safeErrorInfo(error));
  }
  return { status: "success", attempt, redirectTo: `${href(locale, "signIn")}?sifre=yenilendi` };
}

/**
 * First half of signing out (the button then calls Better Auth's /api/auth/sign-out over HTTP and
 * does a full page load). Clears the cart cookie when its cart belongs to the account, so the next
 * person on this browser starts with an empty cart; the cart comes back at the next sign-in. The gift
 * wheel cookie goes too when its spin belongs to the account (bound or claimed), so the next person on a
 * shared browser is not told "already claimed" or shown that prize. The
 * session itself is NOT ended here: a cookie change re-renders the current page, which must still
 * see the session (account pages would redirect to the sign-in form otherwise).
 */
export async function prepareSignOutAction(locale: string): Promise<{ redirectTo: string }> {
  const lang: Locale = isLocale(locale) ? locale : "tr";
  try {
    const session = await getSession();
    const cartId = await readCartId();
    if (session?.user?.id && cartId) {
      const [cart] = await db.select({ userId: schema.carts.userId }).from(schema.carts).where(eq(schema.carts.id, cartId)).limit(1);
      if (cart?.userId === session.user.id) await clearCartId();
    }
    const spinId = session?.user?.id ? await readWheelSpinId() : null;
    if (spinId) {
      const spin = await findSpin(db, spinId);
      if (spin?.userId === session?.user?.id) await clearWheelSpinCookie();
    }
  } catch (error) {
    console.error("[account] sign-out preparation failed", safeErrorInfo(error));
  }
  return { redirectTo: href(lang, "home") };
}
