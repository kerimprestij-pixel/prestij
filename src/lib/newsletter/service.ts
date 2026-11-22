// Newsletter double opt-in (NOTIFY): subscribe → `pending` + confirmation mail → /bulten/onay → `active`;
// unsubscribe by the signed link of every campaign (page or RFC 8058 one-click POST). Services take a
// transaction and no Next APIs (DB tests and ACCOUNTS' register / profile hooks call them directly).
//
//   await db.transaction((tx) => subscribeNewsletter(tx, { email, locale, source: "register", ip }));
//
// Every entry point answers the same whether or not the address is known (no enumeration). Personal
// data (e-mail, IP) never reaches logs; the IP is kept only as a keyed hash (proof of consent).
import "server-only";
import { createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { NewsletterStatus } from "@/db/schema/marketing";
import { isLocale, type Locale } from "@/i18n/config";
import { absoluteUrl, href } from "@/i18n/paths";
import { safeErrorInfo } from "@/lib/db-errors";
import { enqueueEmail, isEmailAddress, readNewsletterUnsubscribeToken } from "@/lib/email";
import type { Tx } from "@/lib/panel/tx";
import { parseSettings } from "@/lib/settings/types";

const s = schema.newsletterSubscribers;

/** Where a subscription started (stored as `source` and `consent_source`). "wheel": the sign-up form, reached through the gift wheel (day 6). */
export const NEWSLETTER_SOURCES = ["footer", "section", "popup", "checkout", "register", "profile", "wheel"] as const;
export type NewsletterSource = (typeof NEWSLETTER_SOURCES)[number];

/** Confirmation links are valid this long after the (latest) request. */
export const CONFIRM_TTL_DAYS = 7;
/** A second request for a pending address within this window sends no new mail (same answer). */
export const CONFIRM_RESEND_SECONDS = 60;

export type SubscribeInput = {
  email: string;
  /** The reader's language: the confirmation mail and later campaigns use it. */
  locale: string;
  source: NewsletterSource;
  /** Trusted client IP (stored only as a keyed hash); null when unknown. */
  ip?: string | null;
};

export type SubscribeResult =
  | { ok: true; outcome: "pending" | "already_active" | "throttled"; subscriberId: number; emailId: number | null }
  | { ok: false; reason: "invalid_email" | "disabled" };

export type ConfirmResult = { ok: true; subscriberId: number; locale: Locale; alreadyActive: boolean } | { ok: false; reason: "invalid" | "expired" };
export type UnsubscribeResult = { ok: true; subscriberId: number | null; changed: boolean } | { ok: false; reason: "invalid" };

export function normalizeNewsletterEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const value = email.trim().toLowerCase();
  return value.length <= 254 && isEmailAddress(value) ? value : null;
}

/** sha256 hex of a confirmation token (the token itself is only in the e-mail). */
export function hashConfirmToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

let ipKey: Buffer | null = null;
/** Keyed hash of the consent IP (HKDF from BETTER_AUTH_SECRET), so the table never holds the IP. */
export function hashConsentIp(ip: string | null | undefined): string | null {
  const value = (ip ?? "").trim();
  if (!value) return null;
  if (!ipKey) {
    const secret = process.env.BETTER_AUTH_SECRET ?? "";
    ipKey = secret.length >= 16 ? Buffer.from(hkdfSync("sha256", secret, "prestij/newsletter/v1", "consent-ip", 32)) : Buffer.from("prestij-newsletter-consent-ip");
  }
  return createHmac("sha256", ipKey).update(value).digest("hex").slice(0, 40);
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{40,64}$/;

/** The confirm page link for a token, absolute, in the reader's language. */
export function newsletterConfirmUrl(locale: Locale, token: string): string {
  return absoluteUrl(`${href(locale, "newsletterConfirm")}?t=${encodeURIComponent(token)}`);
}

/**
 * Fresh (uncached) read of settings.newsletter.enabled, the switch subscribeNewsletter obeys. Server
 * Actions that decide what to tell the visitor use it too (registerAction), so both agree.
 */
export async function isNewsletterEnabled(tx: Tx): Promise<boolean> {
  const [row] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "newsletter")).limit(1);
  return parseSettings("newsletter", row?.value).enabled;
}

/**
 * Creates or refreshes a `pending` subscription and queues the confirmation mail (in `tx`).
 * - unknown address → new pending row + mail;
 * - pending → new token + mail (no second mail within CONFIRM_RESEND_SECONDS: "throttled");
 * - unsubscribed → pending again (re-subscribing always needs a new confirmation) + mail;
 * - active → unchanged, no mail ("already_active").
 * Callers answer the visitor the same way for every ok outcome. Rate limits are the caller's job
 * (public forms: consumeLimits). Newsletter switched off in the panel → { ok: false, "disabled" }.
 */
export async function subscribeNewsletter(tx: Tx, input: SubscribeInput, options: { now?: Date } = {}): Promise<SubscribeResult> {
  const email = normalizeNewsletterEmail(input.email);
  if (!email) return { ok: false, reason: "invalid_email" };
  if (!(await isNewsletterEnabled(tx))) return { ok: false, reason: "disabled" };
  const locale: Locale = isLocale(input.locale) ? input.locale : "tr";
  const source: NewsletterSource = (NEWSLETTER_SOURCES as readonly string[]).includes(input.source) ? input.source : "footer";
  const now = options.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashConfirmToken(token);
  const ipHash = hashConsentIp(input.ip);

  const [existing] = await tx
    .select({ id: s.id, status: s.status, consentAt: s.consentAt, confirmTokenHash: s.confirmTokenHash })
    .from(s)
    .where(eq(s.email, email))
    .for("update")
    .limit(1);

  let subscriberId: number;
  if (!existing) {
    const [row] = await tx
      .insert(s)
      .values({
        email,
        locale,
        status: "pending",
        source,
        consentSource: source,
        consentAt: now,
        consentIpHash: ipHash,
        confirmTokenHash: tokenHash,
        unsubscribeToken: randomBytes(24).toString("base64url"),
      })
      // A concurrent request inserted the same address: answer like a known pending address.
      .onConflictDoNothing({ target: s.email })
      .returning({ id: s.id });
    if (!row) {
      const [other] = await tx.select({ id: s.id }).from(s).where(eq(s.email, email)).limit(1);
      return { ok: true, outcome: "throttled", subscriberId: other?.id ?? 0, emailId: null };
    }
    subscriberId = row.id;
  } else if (existing.status === "active") {
    return { ok: true, outcome: "already_active", subscriberId: existing.id, emailId: null };
  } else {
    if (existing.status === "pending" && existing.confirmTokenHash && now.getTime() - existing.consentAt.getTime() < CONFIRM_RESEND_SECONDS * 1000) {
      return { ok: true, outcome: "throttled", subscriberId: existing.id, emailId: null };
    }
    await tx
      .update(s)
      .set({
        status: "pending",
        locale,
        source,
        consentSource: source,
        consentAt: now,
        consentIpHash: ipHash,
        confirmTokenHash: tokenHash,
        iysSynced: false,
        updatedAt: now,
      })
      .where(eq(s.id, existing.id));
    subscriberId = existing.id;
  }

  const row = await enqueueEmail(tx, {
    template: "newsletter_confirm",
    to: email,
    locale,
    data: { url: newsletterConfirmUrl(locale, token) },
    related: { type: "newsletter", id: subscriberId },
    dedupeKey: `newsletter:${subscriberId}:confirm:${tokenHash.slice(0, 16)}`,
  });
  return { ok: true, outcome: "pending", subscriberId, emailId: row?.id ?? null };
}

/**
 * Activates the pending subscription of a confirmation token (single use: the hash is cleared).
 * Expired (older than CONFIRM_TTL_DAYS since the request) or unknown tokens → not ok.
 */
export async function confirmNewsletter(tx: Tx, token: unknown, options: { now?: Date } = {}): Promise<ConfirmResult> {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) return { ok: false, reason: "invalid" };
  const now = options.now ?? new Date();
  const [row] = await tx
    .select({ id: s.id, status: s.status, locale: s.locale, consentAt: s.consentAt })
    .from(s)
    .where(eq(s.confirmTokenHash, hashConfirmToken(token)))
    .for("update")
    .limit(1);
  if (!row) return { ok: false, reason: "invalid" };
  const locale: Locale = isLocale(row.locale) ? row.locale : "tr";
  if (row.status === "active") {
    await tx.update(s).set({ confirmTokenHash: null, updatedAt: now }).where(eq(s.id, row.id));
    return { ok: true, subscriberId: row.id, locale, alreadyActive: true };
  }
  if (row.status !== "pending") return { ok: false, reason: "invalid" };
  if (now.getTime() - row.consentAt.getTime() > CONFIRM_TTL_DAYS * 86_400_000) return { ok: false, reason: "expired" };
  await tx
    .update(s)
    .set({ status: "active" satisfies NewsletterStatus, confirmedAt: now, confirmTokenHash: null, unsubscribedAt: null, iysSynced: false, updatedAt: now })
    .where(eq(s.id, row.id));
  return { ok: true, subscriberId: row.id, locale, alreadyActive: false };
}

/**
 * Unsubscribes the subscriber of a signed unsubscribe token (campaign footer link or one-click POST).
 * A valid token whose row no longer exists answers ok as well (nothing to send to).
 */
export async function unsubscribeNewsletter(tx: Tx, token: unknown, options: { now?: Date } = {}): Promise<UnsubscribeResult> {
  const id = readNewsletterUnsubscribeToken(token);
  if (id == null) return { ok: false, reason: "invalid" };
  return unsubscribeSubscriberById(tx, id, options);
}

/** Stops sending to one subscriber (idempotent). Pending rows lose their confirmation link too. */
export async function unsubscribeSubscriberById(tx: Tx, id: number, options: { now?: Date } = {}): Promise<UnsubscribeResult> {
  const now = options.now ?? new Date();
  const [row] = await tx.select({ id: s.id, status: s.status }).from(s).where(eq(s.id, id)).for("update").limit(1);
  if (!row) return { ok: true, subscriberId: null, changed: false };
  if (row.status === "unsubscribed") return { ok: true, subscriberId: row.id, changed: false };
  await tx
    .update(s)
    .set({ status: "unsubscribed", unsubscribedAt: now, confirmTokenHash: null, updatedAt: now })
    .where(eq(s.id, row.id));
  return { ok: true, subscriberId: row.id, changed: true };
}

/**
 * For flows where the subscription is a side effect of something else (the checkout's opt-in box):
 * its own transaction, never throws (logged without personal data).
 */
export async function subscribeNewsletterSafely(input: SubscribeInput): Promise<SubscribeResult | null> {
  try {
    return await db.transaction((tx) => subscribeNewsletter(tx, input));
  } catch (error) {
    console.error(`[newsletter] subscribe (source=${input.source}) failed`, safeErrorInfo(error));
    return null;
  }
}

/** Pending sign-ups created in the last 10 minutes (site-wide flood guard of the public form). */
export async function recentPendingSignups(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(s)
    .where(sql`${s.status} = 'pending' and ${s.consentAt} > now() - interval '10 minutes'`);
  return row?.n ?? 0;
}
