// Better Auth → e-mail outbox. Builds our own localized links (the storefront pages, not Better Auth's
// /api/auth/... redirects) and queues the core templates account_verify / password_reset.
//
// Links:
//   verification → /<locale>/hesap/dogrula?token=<jwt>[&sonra=<local path>]   (24 h)
//   reset        → /<locale>/hesap/sifre-sifirla?token=<token>                  (1 h, single use)
// The locale (and `sonra`) come from the callbackURL / redirectTo the auth page passed to Better Auth
// (e.g. callbackURL: "/en/account/verify?sonra=/en/checkout"), else the user's saved locale, else tr.
import "server-only";
import { db } from "@/db";
import type { Locale } from "@/i18n/locales";
import { absoluteUrl, folderPath, href, isLocaleCode, safeReturnPath, siteOrigin } from "@/i18n/paths";
import { safeErrorInfo } from "@/lib/db-errors";
import { enqueueEmail } from "@/lib/email";

/** One verification / reset mail per user per this many seconds; later requests are silent no-ops. */
export const AUTH_EMAIL_THROTTLE_SECONDS = 120;

type AuthUser = { id: string; email: string; name?: string | null; locale?: unknown };

/** The callbackURL (verification) or redirectTo (reset) Better Auth put into its own link. */
function callbackFrom(betterAuthUrl: string): URL | null {
  try {
    const raw = new URL(betterAuthUrl).searchParams.get("callbackURL");
    if (!raw) return null;
    const origin = siteOrigin();
    const parsed = new URL(raw, `${origin}/`);
    // Only our own pages count (Better Auth's origin check already refuses untrusted callbacks).
    return parsed.origin === new URL(origin).origin ? parsed : null;
  } catch {
    return null;
  }
}

/** Locale and return path for the mail: callback first, then the user's saved locale, then Turkish. */
export function linkContext(betterAuthUrl: string, user: AuthUser): { locale: Locale; sonra: string | null } {
  const callback = callbackFrom(betterAuthUrl);
  const fromCallback = callback ? folderPath(callback.pathname)?.locale : undefined;
  const saved = typeof user.locale === "string" && isLocaleCode(user.locale) ? user.locale : undefined;
  const locale: Locale = fromCallback ?? saved ?? "tr";
  const sonra = callback ? safeReturnPath(callback.searchParams.get("sonra")) : null;
  return { locale, sonra };
}

/** First name for the greeting ("Ayşe Yılmaz" → "Ayşe"); the e-mail's local part when the name is empty. */
export function greetingName(user: AuthUser): string {
  const first = (user.name ?? "").trim().split(/\s+/)[0];
  return first || user.email.split("@")[0] || "";
}

export function verificationLink(token: string, locale: Locale, sonra: string | null): string {
  const query = new URLSearchParams({ token });
  if (sonra) query.set("sonra", sonra);
  return absoluteUrl(`${href(locale, "verifyEmail")}?${query.toString()}`);
}

export function resetPasswordLink(token: string, locale: Locale): string {
  return absoluteUrl(`${href(locale, "resetPassword")}?${new URLSearchParams({ token }).toString()}`);
}

function throttleBucket(now = Date.now()): number {
  return Math.floor(now / (AUTH_EMAIL_THROTTLE_SECONDS * 1000));
}

/** emailVerification.sendVerificationEmail */
export async function sendVerificationMail(user: AuthUser, betterAuthUrl: string, token: string): Promise<void> {
  const { locale, sonra } = linkContext(betterAuthUrl, user);
  try {
    await db.transaction((tx) =>
      enqueueEmail(tx, {
        template: "account_verify",
        to: user.email,
        locale,
        data: { name: greetingName(user), url: verificationLink(token, locale, sonra) },
        related: { type: "user", id: user.id },
        dedupeKey: `user:${user.id}:verify:${throttleBucket()}`,
      }),
    );
  } catch (error) {
    // Never surface a mail problem as an auth error (it would also tell an attacker the address exists).
    console.error("[auth] verification mail not queued", safeErrorInfo(error));
  }
}

/** emailAndPassword.sendResetPassword */
export async function sendPasswordResetMail(user: AuthUser, betterAuthUrl: string, token: string): Promise<void> {
  const { locale } = linkContext(betterAuthUrl, user);
  try {
    await db.transaction((tx) =>
      enqueueEmail(tx, {
        template: "password_reset",
        to: user.email,
        locale,
        data: { name: greetingName(user), url: resetPasswordLink(token, locale) },
        related: { type: "user", id: user.id },
        dedupeKey: `user:${user.id}:reset:${throttleBucket()}`,
      }),
    );
  } catch (error) {
    console.error("[auth] reset mail not queued", safeErrorInfo(error));
  }
}
