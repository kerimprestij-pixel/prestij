// Customer account services: profile, marketing preference state and account deletion
// (anonymization). Each takes the user id from the session (or, for the panel, from staff who
// checked their own role) and never touches another user's rows. No Next APIs: DB tests call these
// directly; the storefront actions live in src/lib/account/actions.ts.
import "server-only";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { Locale } from "@/i18n/locales";
import type { AuditEntry } from "@/lib/panel/audit";
import type { Tx } from "@/lib/panel/tx";
import { anonymizeWheelData } from "@/lib/wheel/anonymize";
import { AccountError } from "./errors";

const u = schema.user;

/** Name an anonymized account keeps (shown in the panel next to its kept orders). */
export const ANONYMIZED_NAME = "Silinmiş üye";
/** Anonymized accounts get an address in this reserved, undeliverable domain (RFC 2606 `.invalid`). */
export const ANONYMIZED_EMAIL_DOMAIN = "silinmis.invalid";

export function anonymizedEmail(userId: string): string {
  const id = userId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 64) || "kullanici";
  return `uye-${id}@${ANONYMIZED_EMAIL_DOMAIN}`;
}

/** True for an account that was deleted (anonymized) through anonymizeAccount. */
export function isAnonymizedEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`);
}

const STAFF = new Set(["staff", "editor", "admin"]);
const isStaff = (role: string | null | undefined) => (role ?? "").split(",").some((r) => STAFF.has(r.trim()));

export type AccountUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  locale: Locale;
  role: string | null;
  banned: boolean;
  emailVerified: boolean;
  marketingConsent: boolean;
  companyId: number | null;
  createdAt: string;
};

/** The user's own account row (fresh), or null. */
export async function loadAccountUser(executor: Tx, userId: string): Promise<AccountUser | null> {
  const [row] = await executor
    .select({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      locale: u.locale,
      role: u.role,
      banned: u.banned,
      emailVerified: u.emailVerified,
      marketingConsent: u.marketingConsent,
      companyId: u.companyId,
      createdAt: u.createdAt,
    })
    .from(u)
    .where(eq(u.id, userId))
    .limit(1);
  if (!row) return null;
  const locale = row.locale === "en" || row.locale === "ar" ? row.locale : "tr";
  return { ...row, locale, banned: row.banned ?? false, createdAt: row.createdAt.toISOString() };
}

/** Name, phone and preferred language (the language of e-mails and of the account pages' links). */
export async function updateProfile(tx: Tx, userId: string, input: { name: string; phone: string | null; preferredLocale: Locale }, now = new Date()): Promise<void> {
  const [row] = await tx
    .update(u)
    .set({ name: input.name, phone: input.phone, locale: input.preferredLocale, updatedAt: now })
    .where(eq(u.id, userId))
    .returning({ id: u.id });
  if (!row) throw new AccountError("not_found");
}

export type MarketingState = "subscribed" | "pending" | "off";

/**
 * Commercial e-mail preference as the profile shows it: an active newsletter subscription (or a
 * consent recorded on the account), a confirmation that is still pending, or nothing.
 */
export async function marketingState(executor: Tx, user: { email: string; marketingConsent: boolean }): Promise<MarketingState> {
  const n = schema.newsletterSubscribers;
  const [row] = await executor
    .select({ status: n.status })
    .from(n)
    .where(sql`lower(${n.email}) = ${user.email.toLowerCase()}`)
    .limit(1);
  if (row?.status === "active") return "subscribed";
  if (row?.status === "pending") return "pending";
  if (!row && user.marketingConsent) return "subscribed";
  return "off";
}

/**
 * Withdraws commercial e-mail consent: the account flag and consent time are cleared and an active
 * or pending newsletter subscription for the address is unsubscribed (it stays as the record of the
 * withdrawal). Turning consent ON is the newsletter double opt-in (NOTIFY), never a direct write.
 */
export async function withdrawMarketingConsent(tx: Tx, user: { id: string; email: string }, now = new Date()): Promise<{ unsubscribed: number }> {
  await tx.update(u).set({ marketingConsent: false, marketingConsentAt: null, updatedAt: now }).where(eq(u.id, user.id));
  const n = schema.newsletterSubscribers;
  const rows = await tx
    .update(n)
    .set({ status: "unsubscribed", unsubscribedAt: now, confirmTokenHash: null, updatedAt: now })
    .where(and(sql`lower(${n.email}) = ${user.email.toLowerCase()}`, ne(n.status, "unsubscribed")))
    .returning({ id: n.id });
  return { unsubscribed: rows.length };
}

export type AnonymizeResult = {
  userId: string;
  /** Orders stay (legal retention: Turkish commercial and tax law), still linked to the user id. */
  keptOrders: number;
  deletedAddresses: number;
  deletedFavorites: number;
  cancelledSubscriptions: number;
  revokedSessions: number;
  deletedCarts: number;
  unsubscribedNewsletter: number;
  cancelledEmails: number;
  /** Gift wheel spins unlinked from the account (kept for statistics, without user or IP hash). */
  unlinkedWheelSpins: number;
  /** Unused gift wheel prize coupons switched off. */
  deactivatedWheelPrizes: number;
  /** Write it with the change (panelAction `audit`, or writeAudit for the self-service action). */
  audit: AuditEntry;
};

/**
 * Deletes a customer account the KVKK way while keeping the orders (legal retention):
 * - the user row is anonymized: name "Silinmiş üye", a reserved undeliverable e-mail, no phone, no
 *   marketing consent, no company or customer group, e-mail unverified;
 * - the password (credential account), every session and pending reset tokens are deleted, so nobody
 *   can sign in to it again; the old e-mail address is free for a new registration;
 * - addresses, favorites and carts are deleted; subscriptions are cancelled;
 * - a newsletter subscription for the address is unsubscribed and mails still queued to it cancelled;
 * - gift wheel spins lose the user link and IP hash, unused wheel prize coupons are switched off;
 * - orders, their addresses and invoices stay untouched (and linked to the anonymized user id).
 * Staff accounts are refused (AccountError "forbidden"); they are managed in the panel's team page.
 * Shared by the self-service deletion (/hesap/profil) and the panel's "anonymize" (B2B, admin).
 */
export async function anonymizeAccount(tx: Tx, userId: string, opts: { actorId: string | null; now?: Date; reason?: "self" | "admin" }): Promise<AnonymizeResult> {
  const now = opts.now ?? new Date();
  const [row] = await tx.select({ id: u.id, email: u.email, role: u.role }).from(u).where(eq(u.id, userId)).for("update");
  if (!row) throw new AccountError("not_found");
  if (isStaff(row.role)) throw new AccountError("forbidden");
  if (isAnonymizedEmail(row.email)) throw new AccountError("not_found");
  const email = row.email.trim().toLowerCase();

  const addresses = await tx.delete(schema.addresses).where(eq(schema.addresses.userId, userId)).returning({ id: schema.addresses.id });
  const favorites = await tx.delete(schema.favorites).where(eq(schema.favorites.userId, userId)).returning({ id: schema.favorites.productId });
  const subscriptions = await tx
    .update(schema.subscriptions)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(and(eq(schema.subscriptions.userId, userId), ne(schema.subscriptions.status, "cancelled")))
    .returning({ id: schema.subscriptions.id });
  const sessions = await tx.delete(schema.session).where(eq(schema.session.userId, userId)).returning({ id: schema.session.id });
  await tx.delete(schema.account).where(eq(schema.account.userId, userId));
  // Reset-password tokens store the user id as their value (Better Auth); verification links are JWTs.
  await tx.delete(schema.verification).where(eq(schema.verification.value, userId));
  const carts = await tx.delete(schema.carts).where(eq(schema.carts.userId, userId)).returning({ id: schema.carts.id });

  const n = schema.newsletterSubscribers;
  const newsletter = await tx
    .update(n)
    .set({ status: "unsubscribed", unsubscribedAt: now, confirmTokenHash: null, updatedAt: now })
    .where(and(sql`lower(${n.email}) = ${email}`, ne(n.status, "unsubscribed")))
    .returning({ id: n.id });
  const m = schema.emailMessages;
  const mails = await tx
    .update(m)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(sql`lower(${m.toEmail}) = ${email}`, eq(m.status, "queued")))
    .returning({ id: m.id });
  const wheel = await anonymizeWheelData(tx, userId, now);

  await tx
    .update(u)
    .set({
      name: ANONYMIZED_NAME,
      email: anonymizedEmail(userId),
      emailVerified: false,
      image: null,
      phone: null,
      marketingConsent: false,
      marketingConsentAt: null,
      companyId: null,
      customerGroupId: null,
      updatedAt: now,
    })
    .where(eq(u.id, userId));

  const [{ orders }] = await tx.select({ orders: count() }).from(schema.orders).where(eq(schema.orders.userId, userId));

  const result = {
    userId,
    keptOrders: orders,
    deletedAddresses: addresses.length,
    deletedFavorites: favorites.length,
    cancelledSubscriptions: subscriptions.length,
    revokedSessions: sessions.length,
    deletedCarts: carts.length,
    unsubscribedNewsletter: newsletter.length,
    cancelledEmails: mails.length,
    unlinkedWheelSpins: wheel.unlinkedSpins,
    deactivatedWheelPrizes: wheel.deactivatedPrizes,
  };
  return {
    ...result,
    audit: {
      action: "delete",
      entity: "user",
      entityId: userId,
      actorId: opts.actorId,
      // Counts only: no personal data in the audit log.
      after: { anonymized: true, reason: opts.reason ?? (opts.actorId === userId ? "self" : "admin"), ...result, userId: undefined },
    },
  };
}
