// Account lifecycle effects: guest-order linking + the welcome mail after verification, and the
// password_changed security mail. Called from src/lib/customer/auth-events.ts (Better Auth hooks) and
// from the profile's password change. No Next request APIs.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { absoluteUrl, href } from "@/i18n/paths";
import { enqueueEmail } from "@/lib/email";
import type { Tx } from "@/lib/panel/tx";
import { wheelVerificationEffects } from "@/lib/wheel/service";
import { linkGuestOrders } from "./orders";
import { isAnonymizedEmail } from "./service";

const localeOf = (value: unknown): Locale => (isLocale(value) ? value : "tr");

/** First name for greetings ("Ayşe Yılmaz" → "Ayşe"); the e-mail's local part when empty. */
export function greetingFirstName(name: string | null | undefined, email: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return (first || email.split("@")[0] || "").slice(0, 60);
}

/**
 * After the e-mail address is verified: link guest orders placed with it (only now: the address is
 * proven) and queue the welcome mail once per user (`user:<id>:welcome`). One transaction, so a
 * failure leaves neither. Returns the number of linked orders.
 * Gift wheel (day 6): a spin bound to the account at sign-up becomes its prize here (coupon + the
 * wheel_prize mail). Device independent (no cookie: the link may open on another device) and inside a
 * savepoint, so a wheel error never rolls back the order linking or the welcome mail. `wheelPrizes` is
 * present only when a prize was issued.
 */
export async function completeEmailVerification(tx: Tx, userId: string): Promise<{ linkedOrders: number; welcomeQueued: boolean; wheelPrizes?: number }> {
  const u = schema.user;
  const [row] = await tx
    .select({ id: u.id, email: u.email, name: u.name, locale: u.locale, emailVerified: u.emailVerified })
    .from(u)
    .where(eq(u.id, userId))
    .limit(1);
  if (!row || !row.emailVerified || isAnonymizedEmail(row.email)) return { linkedOrders: 0, welcomeQueued: false };
  const linkedOrders = await linkGuestOrders(tx, row);
  // After the linking: the "new customers only" rule sees the orders placed as a guest.
  const wheelPrizes = await wheelVerificationEffects(tx, row.id);
  const locale = localeOf(row.locale);
  const queued = await enqueueEmail(tx, {
    template: "welcome",
    to: row.email,
    locale,
    data: {
      name: greetingFirstName(row.name, row.email),
      accountUrl: absoluteUrl(href(locale, "account")),
      shopUrl: absoluteUrl(href(locale, "products")),
      linkedOrders,
    },
    related: { type: "user", id: row.id },
    dedupeKey: `user:${row.id}:welcome`,
  });
  return { linkedOrders, welcomeQueued: queued !== null, ...(wheelPrizes > 0 ? { wheelPrizes } : {}) };
}

/** Better Auth's afterEmailVerification → completeEmailVerification in its own transaction. */
export async function handleEmailVerified(userId: string): Promise<void> {
  await db.transaction((tx) => completeEmailVerification(tx, userId));
}

/**
 * Queues the password_changed security mail for the user (deduped per minute, so a double submit
 * sends one). `via`: "reset" (forgot-password link) or "change" (profile).
 */
export async function queuePasswordChanged(tx: Tx, userId: string, via: "reset" | "change", now = new Date()): Promise<boolean> {
  const u = schema.user;
  const [row] = await tx.select({ id: u.id, email: u.email, name: u.name, locale: u.locale }).from(u).where(eq(u.id, userId)).limit(1);
  if (!row || isAnonymizedEmail(row.email)) return false;
  const locale = localeOf(row.locale);
  const queued = await enqueueEmail(tx, {
    template: "password_changed",
    to: row.email,
    locale,
    data: {
      name: greetingFirstName(row.name, row.email),
      changedAt: now.toISOString(),
      resetUrl: absoluteUrl(href(locale, "forgotPassword")),
      via,
    },
    related: { type: "user", id: row.id },
    dedupeKey: `user:${row.id}:password_changed:${Math.floor(now.getTime() / 60_000)}`,
  });
  return queued !== null;
}

/** Better Auth's onPasswordReset → the password_changed mail. */
export async function handlePasswordReset(userId: string): Promise<void> {
  await db.transaction((tx) => queuePasswordChanged(tx, userId, "reset"));
}
