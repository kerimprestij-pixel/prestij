"use server";
// Storefront account Server Actions (/hesap/adresler, /hesap/profil, favorites). Every action reads
// the session itself (never a user id from the client), validates with zod and re-checks ownership in
// the service: another customer's id is "not found". Texts come back localized.

import { isAPIError } from "better-auth/api";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { auth } from "@/lib/auth";
import { safeErrorInfo } from "@/lib/db-errors";
import { isNewsletterEnabled } from "@/lib/newsletter/service";
import { writeAudit } from "@/lib/panel/audit";
import type { RateRule } from "@/lib/rate-limit";
import { checkLimits, consumeLimits } from "@/lib/rate-limit-store";
import { clientIp } from "@/lib/request-ip";
import { getSession } from "@/lib/session";
import { MAX_ADDRESSES, deleteAddress, saveAddress, setDefaultAddress, type SavedAddress } from "./addresses";
import { isAccountError } from "./errors";
import { queuePasswordChanged } from "./events";
import { setFavorite } from "./favorites";
import { localizeFieldCodes } from "./messages";
import {
  addressIdSchema,
  addressInputSchema,
  changePasswordSchema,
  defaultAddressSchema,
  deleteAccountSchema,
  echoValues,
  favoriteSchema,
  fieldCodes,
  formDataToObject,
  profileSchema,
} from "./schemas";
import { profileMarketingSubscribe } from "./marketing";
import { anonymizeAccount, isAnonymizedEmail, loadAccountUser, updateProfile, withdrawMarketingConsent, type MarketingState } from "./service";

export type AccountFormState = {
  status: "idle" | "error" | "success";
  attempt: number;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  /** The session is gone: the form shows formError with a sign-in link. */
  sessionExpired?: boolean;
  /** saveAddressAction: the saved row (the list updates without a reload). */
  address?: SavedAddress;
  /** setMarketingAction: the new state. */
  marketing?: MarketingState;
};

export type AccountActionResult = { ok: true; message?: string } | { ok: false; error: string; sessionExpired?: boolean };

const MINUTE = 60_000;
const RULES = {
  /** Wrong current passwords (change password / delete account) per user. */
  passwordUser: { limit: 5, windowMs: 15 * MINUTE },
  /** Newsletter requests from the profile per user. */
  marketingUser: { limit: 5, windowMs: 60 * MINUTE },
  /** Favorite toggles per user (a script must not hammer the table). */
  favoritesUser: { limit: 120, windowMs: 10 * MINUTE },
} as const satisfies Record<string, RateRule>;

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const localeOf = (value: unknown): Locale => (isLocale(value) ? value : "tr");

type Viewer = { id: string; email: string; sessionId: string };

/** The signed-in, not banned, not anonymized customer of this request, or null. */
async function currentUser(): Promise<Viewer | null> {
  const session = await getSession();
  if (!session) return null;
  const { user } = session;
  if (!user?.id || user.banned || isAnonymizedEmail(user.email)) return null;
  return { id: user.id, email: user.email, sessionId: session.session.id };
}

const errorCodeOf = (error: unknown): string | undefined =>
  isAPIError(error) ? ((error.body as { code?: unknown } | undefined)?.code as string | undefined) : undefined;

// -------------------------------------------------------------------------------------------------
// Addresses

const ADDRESS_CHECKBOXES = ["isDefaultShipping", "isDefaultBilling", "invoice.eInvoice"] as const;

export async function saveAddressAction(prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const locale = localeOf(field(formData, "locale"));
  const messages = await getMessages(locale);
  const m = messages.account;
  const values = echoValues(formData);
  const user = await currentUser();
  if (!user) return { status: "error", attempt, formError: m.errors.sessionExpired, sessionExpired: true, values };
  const parsed = addressInputSchema.safeParse(formDataToObject(formData, ADDRESS_CHECKBOXES));
  if (!parsed.success) {
    return { status: "error", attempt, formError: m.errors.invalid, fieldErrors: localizeFieldCodes(fieldCodes(parsed.error.issues), messages, locale), values };
  }
  try {
    const address = await db.transaction((tx) => saveAddress(tx, user.id, parsed.data));
    refresh();
    return { status: "success", attempt, message: m.addressBook.saved, address };
  } catch (error) {
    if (isAccountError(error)) {
      const text = error.code === "limit" ? format(m.addressBook.limit, { max: MAX_ADDRESSES }, locale) : m.errors[error.code];
      return { status: "error", attempt, formError: text, values };
    }
    console.error("[account] address save failed", safeErrorInfo(error));
    return { status: "error", attempt, formError: m.errors.generic, values };
  }
}

export async function deleteAddressAction(input: { id: number; locale: string }): Promise<AccountActionResult> {
  const locale = localeOf(input?.locale);
  const m = (await getMessages(locale)).account;
  const user = await currentUser();
  if (!user) return { ok: false, error: m.errors.sessionExpired, sessionExpired: true };
  const parsed = addressIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.not_found };
  try {
    await db.transaction((tx) => deleteAddress(tx, user.id, parsed.data.id));
    refresh();
    return { ok: true, message: m.addressBook.deleted };
  } catch (error) {
    if (isAccountError(error)) return { ok: false, error: m.errors[error.code] };
    console.error("[account] address delete failed", safeErrorInfo(error));
    return { ok: false, error: m.errors.generic };
  }
}

export async function setDefaultAddressAction(input: { id: number; kind: "shipping" | "billing"; locale: string }): Promise<AccountActionResult> {
  const locale = localeOf(input?.locale);
  const m = (await getMessages(locale)).account;
  const user = await currentUser();
  if (!user) return { ok: false, error: m.errors.sessionExpired, sessionExpired: true };
  const parsed = defaultAddressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.not_found };
  try {
    await db.transaction((tx) => setDefaultAddress(tx, user.id, parsed.data.id, parsed.data.kind));
    refresh();
    return { ok: true, message: m.addressBook.defaultSet };
  } catch (error) {
    if (isAccountError(error)) return { ok: false, error: m.errors[error.code] };
    console.error("[account] default address failed", safeErrorInfo(error));
    return { ok: false, error: m.errors.generic };
  }
}

// -------------------------------------------------------------------------------------------------
// Profile

export async function updateProfileAction(prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const locale = localeOf(field(formData, "locale"));
  const messages = await getMessages(locale);
  const m = messages.account;
  const values = echoValues(formData);
  const user = await currentUser();
  if (!user) return { status: "error", attempt, formError: m.errors.sessionExpired, sessionExpired: true, values };
  const parsed = profileSchema.safeParse({ locale, name: field(formData, "name"), phone: field(formData, "phone"), preferredLocale: field(formData, "preferredLocale") });
  if (!parsed.success) return { status: "error", attempt, fieldErrors: localizeFieldCodes(fieldCodes(parsed.error.issues), messages, locale), values };
  try {
    await db.transaction((tx) => updateProfile(tx, user.id, parsed.data));
    refresh();
    return { status: "success", attempt, message: m.profilePage.saved };
  } catch (error) {
    console.error("[account] profile save failed", safeErrorInfo(error));
    return { status: "error", attempt, formError: m.errors.generic, values };
  }
}

export async function changePasswordAction(prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const locale = localeOf(field(formData, "locale"));
  const messages = await getMessages(locale);
  const m = messages.account;
  const user = await currentUser();
  if (!user) return { status: "error", attempt, formError: m.errors.sessionExpired, sessionExpired: true };
  const parsed = changePasswordSchema.safeParse({
    locale,
    currentPassword: field(formData, "currentPassword"),
    newPassword: field(formData, "newPassword"),
    confirm: field(formData, "confirm"),
  });
  if (!parsed.success) return { status: "error", attempt, fieldErrors: localizeFieldCodes(fieldCodes(parsed.error.issues), messages, locale) };
  const key: [string, RateRule] = [`password:user:${user.id}`, RULES.passwordUser];
  const wait = (await checkLimits([key])).retryAfterMinutes;
  if (wait > 0) return { status: "error", attempt, formError: format(m.errors.rateLimited, { minutes: wait }, locale) };
  try {
    // revokeOtherSessions: false keeps THIS session (and its cookie) as it is: Better Auth's own
    // revoke deletes every session and sets a new cookie, and a cookie change re-renders this page
    // with the old (deleted) session in the request, which would bounce to the sign-in form. The
    // other sessions are deleted right below instead.
    await auth.api.changePassword({
      body: { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword, revokeOtherSessions: false },
      headers: await headers(),
    });
  } catch (error) {
    const code = errorCodeOf(error);
    if (code === "INVALID_PASSWORD") {
      await consumeLimits([key]);
      return { status: "error", attempt, fieldErrors: { currentPassword: messages.auth.errors.currentPasswordWrong } };
    }
    if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
      return { status: "error", attempt, fieldErrors: localizeFieldCodes({ newPassword: code === "PASSWORD_TOO_SHORT" ? "password_too_short" : "password_too_long" }, messages, locale) };
    }
    console.error("[account] password change failed", safeErrorInfo(error));
    return { status: "error", attempt, formError: m.errors.generic };
  }
  try {
    await db.transaction(async (tx) => {
      await tx.delete(schema.session).where(and(eq(schema.session.userId, user.id), ne(schema.session.id, user.sessionId)));
      await queuePasswordChanged(tx, user.id, "change");
    });
  } catch (error) {
    console.error("[account] password-changed mail failed", { userId: user.id, ...safeErrorInfo(error) });
  }
  return { status: "success", attempt, message: m.profilePage.passwordChanged };
}

/** "subscribe": starts the newsletter double opt-in (pending + confirmation mail). "unsubscribe": withdraws consent. */
export async function setMarketingAction(input: { locale: string; action: "subscribe" | "unsubscribe" }): Promise<AccountFormState> {
  const locale = localeOf(input?.locale);
  const m = (await getMessages(locale)).account;
  const user = await currentUser();
  if (!user) return { status: "error", attempt: 0, formError: m.errors.sessionExpired, sessionExpired: true };
  try {
    if (input?.action === "unsubscribe") {
      await db.transaction((tx) => withdrawMarketingConsent(tx, user));
      refresh();
      return { status: "success", attempt: 0, message: m.profilePage.marketingStopped, marketing: "off" };
    }
    // Go-live SR-1: newsletter switched off (the profile hides the button; a stale page still says why). Checked
    // before the rate limit so a closed newsletter uses no attempt; profileMarketingSubscribe checks again in its
    // transaction (a switch-off in between still answers marketingClosed).
    if (!(await isNewsletterEnabled(db))) return { status: "error", attempt: 0, formError: m.profilePage.marketingClosed };
    const decision = await consumeLimits([[`marketing:user:${user.id}`, RULES.marketingUser]]);
    if (!decision.allowed) return { status: "error", attempt: 0, formError: format(m.errors.rateLimited, { minutes: decision.retryAfterMinutes }, locale) };
    const account = await loadAccountUser(db, user.id);
    const ip = await clientIp();
    const outcome = await db.transaction((tx) =>
      profileMarketingSubscribe(tx, { email: user.email, locale: account?.locale ?? locale, ip, marketingConsent: account?.marketingConsent ?? false }),
    );
    if (!outcome.ok) return { status: "error", attempt: 0, formError: outcome.reason === "closed" ? m.profilePage.marketingClosed : m.errors.forbidden };
    refresh();
    return { status: "success", attempt: 0, message: outcome.state === "subscribed" ? m.profilePage.marketingOn : m.profilePage.marketingStarted, marketing: outcome.state };
  } catch (error) {
    console.error("[account] marketing preference failed", safeErrorInfo(error));
    return { status: "error", attempt: 0, formError: m.errors.generic };
  }
}

/**
 * "Hesabımı sil": checks the password, then anonymizes the account (anonymizeAccount: personal data,
 * addresses, favorites, carts, sessions and the password go; orders stay) and clears the cookies.
 */
export async function deleteAccountAction(prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const locale = localeOf(field(formData, "locale"));
  const messages = await getMessages(locale);
  const m = messages.account;
  const user = await currentUser();
  if (!user) return { status: "error", attempt, formError: m.errors.sessionExpired, sessionExpired: true };
  const parsed = deleteAccountSchema.safeParse({ locale, password: field(formData, "password"), confirmDeletion: field(formData, "confirmDeletion") });
  if (!parsed.success) return { status: "error", attempt, fieldErrors: localizeFieldCodes(fieldCodes(parsed.error.issues), messages, locale) };
  const key: [string, RateRule] = [`password:user:${user.id}`, RULES.passwordUser];
  const wait = (await checkLimits([key])).retryAfterMinutes;
  if (wait > 0) return { status: "error", attempt, formError: format(m.errors.rateLimited, { minutes: wait }, locale) };
  try {
    await auth.api.verifyPassword({ body: { password: parsed.data.password }, headers: await headers() });
  } catch (error) {
    if (errorCodeOf(error) === "INVALID_PASSWORD") {
      await consumeLimits([key]);
      return { status: "error", attempt, fieldErrors: { password: m.errors.wrongPassword } };
    }
    console.error("[account] password check failed", safeErrorInfo(error));
    return { status: "error", attempt, formError: m.errors.generic };
  }
  try {
    await db.transaction(async (tx) => {
      const result = await anonymizeAccount(tx, user.id, { actorId: user.id, reason: "self" });
      await writeAudit(tx, { ...result.audit, actorId: user.id });
    });
  } catch (error) {
    if (isAccountError(error)) return { status: "error", attempt, formError: m.errors[error.code] };
    console.error("[account] account deletion failed", safeErrorInfo(error));
    return { status: "error", attempt, formError: m.errors.generic };
  }
  // The sessions and carts are gone in the DB, so this browser's cookies are dead. They are not
  // touched here: changing a cookie in a Server Action re-renders the page, and this page would then
  // redirect to the sign-in form before the customer sees the confirmation.
  return { status: "success", attempt, message: m.profilePage.deletedTitle };
}

// -------------------------------------------------------------------------------------------------
// Favorites

/** The heart: adds or removes a favorite for the signed-in customer. */
export async function toggleFavoriteAction(input: { productId: number; favorite: boolean; locale: string }): Promise<AccountActionResult & { favorite?: boolean }> {
  const locale = localeOf(input?.locale);
  const m = (await getMessages(locale)).account;
  const user = await currentUser();
  if (!user) return { ok: false, error: m.favorite.signIn, sessionExpired: true };
  const parsed = favoriteSchema.safeParse({ productId: input?.productId, favorite: input?.favorite });
  if (!parsed.success) return { ok: false, error: m.favorite.error };
  const decision = await consumeLimits([[`favorites:user:${user.id}`, RULES.favoritesUser]]);
  if (!decision.allowed) return { ok: false, error: format(m.errors.rateLimited, { minutes: decision.retryAfterMinutes }, locale) };
  try {
    const result = await db.transaction((tx) => setFavorite(tx, user.id, parsed.data.productId, parsed.data.favorite));
    return { ok: true, favorite: result.favorite, message: result.favorite ? m.favorite.added : m.favorite.removed };
  } catch (error) {
    if (isAccountError(error)) return { ok: false, error: error.code === "limit" ? m.favorite.limit : m.favorite.error };
    console.error("[account] favorite failed", safeErrorInfo(error));
    return { ok: false, error: m.favorite.error };
  }
}
