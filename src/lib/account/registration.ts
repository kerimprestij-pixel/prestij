// Records of a brand-new storefront account (registerAction, after Better Auth created the user), in the
// caller's transaction: the visitor's held gift-wheel spin, the optional newsletter double opt-in and the
// consent audit row. No Next APIs: tests/db/salesready-impl-a.test.ts calls it directly.
//
//   const records = await db.transaction((tx) => recordNewAccount(tx, { userId, email, locale, ip, … }));
//   registerMarketingNotice(records.newsletter) // the success screen's "confirmation e-mail" line
//
// Newsletter box (go-live SR-1): the form shows it only while the newsletter is on; here the setting the
// action read decides again, so a ticked box with the newsletter off never subscribes. The audit row says
// what really happened: marketingRequested (box offered and ticked), the newsletter outcome and whether a
// confirmation mail was queued. The wheel bind and the subscription run in savepoints, so neither can undo
// the consent record (proof of the accepted membership / KVKK versions).
import "server-only";
import type { Locale } from "@/i18n/config";
import { safeErrorInfo } from "@/lib/db-errors";
import { subscribeNewsletter } from "@/lib/newsletter/service";
import { writeAudit } from "@/lib/panel/audit";
import type { Tx } from "@/lib/panel/tx";
import type { ClaimLimiter } from "@/lib/wheel/limits";
import { bindSpinAtRegistration, type BindOutcome } from "@/lib/wheel/service";
import { registerNewsletterRequested, type RegisterNewsletterOutcome } from "./register-newsletter";

export type NewAccountRecordsInput = {
  userId: string;
  email: string;
  locale: Locale;
  /** Trusted client IP (newsletter consent hash, wheel claim limit); null when unknown. */
  ip: string | null;
  /** Current versions of the membership agreement and the KVKK notice the form linked. */
  versions: { membership: string | null; kvkk: string | null };
  /** The visitor's held gift-wheel spin (cookie), if any. */
  wheelSpinId: number | null;
  consumeClaimLimit?: ClaimLimiter;
  /** settings.newsletter.enabled as the action read it (isNewsletterEnabled): the box was offered. */
  newsletterEnabled: boolean;
  /** The submitted marketing box (ignored while the newsletter is off). */
  marketingTicked: boolean;
  now?: Date;
};

export type NewAccountRecords = {
  newsletter: RegisterNewsletterOutcome;
  /** A confirmation mail row was queued in this transaction. */
  newsletterMailQueued: boolean;
  wheel: BindOutcome | null;
};

export async function recordNewAccount(tx: Tx, input: NewAccountRecordsInput): Promise<NewAccountRecords> {
  const now = input.now ?? new Date();
  // Gift wheel: the spin waits for the e-mail verification (completeEmailVerification issues the prize,
  // on whatever device the link opens). Savepoint inside.
  const wheel = await bindSpinAtRegistration(tx, { existedBefore: false, spinId: input.wheelSpinId, userId: input.userId, consumeClaimLimit: input.consumeClaimLimit });

  const requested = registerNewsletterRequested({ newsletterEnabled: input.newsletterEnabled, ticked: input.marketingTicked });
  let newsletter: RegisterNewsletterOutcome = input.newsletterEnabled ? "not_requested" : "off";
  let newsletterMailQueued = false;
  if (requested) {
    try {
      const result = await tx.transaction((sp) =>
        subscribeNewsletter(sp, { email: input.email, locale: input.locale, source: wheel === "bound" ? "wheel" : "register", ip: input.ip }, { now }),
      );
      newsletter = result.ok ? result.outcome : result.reason;
      newsletterMailQueued = result.ok && result.emailId !== null;
    } catch (error) {
      console.error("[account] newsletter request at sign-up failed", safeErrorInfo(error));
      newsletter = "failed";
    }
  }

  await writeAudit(tx, {
    actorId: input.userId,
    action: "create",
    entity: "user",
    entityId: input.userId,
    // Proof of the accepted texts (KVKK / membership agreement) and of the marketing choice, no personal data.
    after: {
      registered: true,
      locale: input.locale,
      membershipVersion: input.versions.membership,
      kvkkVersion: input.versions.kvkk,
      marketingRequested: requested,
      newsletter,
      newsletterMailQueued,
      at: now.toISOString(),
    },
  });
  return { newsletter, newsletterMailQueued, wheel };
}
