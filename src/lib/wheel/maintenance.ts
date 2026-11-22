// Gift wheel housekeeping for the daily jobs (src/lib/wheel/jobs.ts). No Next APIs; bounded batches;
// idempotent and safe to run twice at once.
//   purgeWheelSpins       expire spins whose hold ran out; delete unclaimed spins older than 30 days
//                         (KVKK: the visitor never claimed, nothing to keep); drop the IP hash of older
//                         claimed spins (they stay for the statistics, without any personal trace).
//   queueWheelReminders   `wheel_prize_reminder` about a day before an unused prize expires, once per
//                         prize (wheel_spins.reminded_at + the mail's dedupe key), only to accounts with an
//                         ACTIVE (confirmed) newsletter subscription, as a marketing mail with unsubscribe
//                         links. Off with giftWheel.reminderEnabled or the template switch in the panel.
import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { schema } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { absoluteUrl, href } from "@/i18n/paths";
import { isAnonymizedEmail } from "@/lib/account/service";
import { enqueueEmail, newsletterUnsubscribeLinks } from "@/lib/email";
import type { Tx } from "@/lib/panel/tx";
import { readWheelConfig, spinHoldEndSql } from "./service";
import { WHEEL_PURGE_AFTER_DAYS } from "./types";

const s = schema.wheelSpins;
const c = schema.coupons;
const u = schema.user;
const n = schema.newsletterSubscribers;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Rows per purge statement (the next run continues). */
export const WHEEL_PURGE_BATCH = 5000;
/** Reminders per run. */
export const WHEEL_REMIND_BATCH = 100;
/**
 * Reminder window. The job runs once a day, so a prize is caught on the one run where it has between
 * 12 and 36 hours left ("about a day before"); never in its last hour, never within 12 hours of the
 * claim (the prize mail was just sent).
 */
export const WHEEL_REMIND_WINDOW = { maxHoursLeft: 36, minHoursLeft: 1, minHoursSinceClaim: 12 } as const;

type Scope = { now?: Date; /** Tests: only these spins (the database is shared). */ spinIds?: number[] };

const only = (ids: number[] | undefined) => (ids ? inArray(s.id, ids.length ? ids : [0]) : undefined);

export async function purgeWheelSpins(executor: Tx, options: Scope = {}): Promise<{ expired: number; purged: number; anonymized: number }> {
  const now = options.now ?? new Date();
  const { wheel } = await readWheelConfig(executor);
  const purgeCut = new Date(now.getTime() - WHEEL_PURGE_AFTER_DAYS * DAY_MS);
  return executor.transaction(async (tx) => {
    const expired = await tx
      .update(s)
      .set({ status: "expired" })
      // The hold end frozen with each spin (older rows: created_at + the current holdDays).
      .where(and(inArray(s.status, ["spun", "bound"]), isNull(s.couponId), sql`${spinHoldEndSql(wheel.holdDays)} <= ${now.toISOString()}::timestamptz`, only(options.spinIds)))
      .returning({ id: s.id });
    const doomed = tx
      .select({ id: s.id })
      .from(s)
      .where(and(ne(s.status, "claimed"), lt(s.createdAt, purgeCut), only(options.spinIds)))
      .limit(WHEEL_PURGE_BATCH);
    const purged = await tx.delete(s).where(inArray(s.id, doomed)).returning({ id: s.id });
    const scrub = tx
      .select({ id: s.id })
      .from(s)
      .where(and(eq(s.status, "claimed"), isNotNull(s.ipHash), lt(s.createdAt, purgeCut), only(options.spinIds)))
      .limit(WHEEL_PURGE_BATCH);
    const anonymized = await tx.update(s).set({ ipHash: null }).where(inArray(s.id, scrub)).returning({ id: s.id });
    return { expired: expired.length, purged: purged.length, anonymized: anonymized.length };
  });
}

function firstName(name: string | null | undefined, email: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return (first || email.split("@")[0] || "").slice(0, 60);
}

export async function queueWheelReminders(executor: Tx, options: Scope & { limit?: number } = {}): Promise<{ queued: number; skipped: number; disabled: number }> {
  const now = options.now ?? new Date();
  const config = await readWheelConfig(executor);
  if (!config.wheel.reminderEnabled) return { queued: 0, skipped: 0, disabled: 1 };
  const limit = Math.max(1, Math.min(WHEEL_REMIND_BATCH, options.limit ?? WHEEL_REMIND_BATCH));
  const latest = new Date(now.getTime() + WHEEL_REMIND_WINDOW.maxHoursLeft * HOUR_MS);
  const earliest = new Date(now.getTime() + WHEEL_REMIND_WINDOW.minHoursLeft * HOUR_MS);
  const claimedBefore = new Date(now.getTime() - WHEEL_REMIND_WINDOW.minHoursSinceClaim * HOUR_MS);

  return executor.transaction(async (tx) => {
    const rows = await tx
      .select({
        spinId: s.id,
        prize: s.prize,
        spinLocale: s.locale,
        code: c.code,
        endsAt: c.endsAt,
        type: c.type,
        value: c.value,
        minOrderTotal: c.minOrderTotal,
        userId: u.id,
        email: u.email,
        name: u.name,
        userLocale: u.locale,
        subscriberId: n.id,
      })
      .from(s)
      .innerJoin(c, eq(c.id, s.couponId))
      .innerJoin(u, eq(u.id, s.userId))
      .innerJoin(n, and(sql`lower(${n.email}) = lower(${u.email})`, eq(n.status, "active")))
      .where(
        and(
          eq(s.status, "claimed"),
          isNull(s.remindedAt),
          lte(s.claimedAt, claimedBefore),
          eq(c.source, "wheel"),
          eq(c.isActive, true),
          sql`${c.userId} = ${s.userId}`,
          or(isNull(c.maxUses), sql`${c.usedCount} < ${c.maxUses}`),
          sql`${c.endsAt} > ${earliest.toISOString()}::timestamptz and ${c.endsAt} <= ${latest.toISOString()}::timestamptz`,
          eq(u.emailVerified, true),
          sql`coalesce(${u.banned}, false) = false`,
          only(options.spinIds),
        ),
      )
      .orderBy(asc(c.endsAt), asc(s.id))
      .limit(limit)
      .for("update", { of: s, skipLocked: true });

    let queued = 0;
    let skipped = 0;
    for (const row of rows) {
      await tx.update(s).set({ remindedAt: now }).where(eq(s.id, row.spinId));
      if (isAnonymizedEmail(row.email) || !row.endsAt) {
        skipped++;
        continue;
      }
      const locale: Locale = isLocale(row.userLocale) ? row.userLocale : isLocale(row.spinLocale) ? row.spinLocale : "tr";
      const mail = await enqueueEmail(tx, {
        template: "wheel_prize_reminder",
        to: row.email,
        locale,
        data: {
          name: firstName(row.name, row.email),
          prize: row.prize.label,
          type: row.type,
          value: row.value,
          minOrderTotal: row.minOrderTotal,
          code: row.code,
          endsAt: row.endsAt.toISOString(),
          cartUrl: absoluteUrl(href(locale, "cart")),
          shopUrl: absoluteUrl(href(locale, "products")),
          heavySurcharge: config.heavySurcharge,
        },
        related: { type: "user", id: row.userId },
        dedupeKey: `wheel:spin:${row.spinId}:reminder`,
        unsubscribe: newsletterUnsubscribeLinks(row.subscriberId, locale),
      });
      // null: switched off in the panel, or queued before.
      if (mail) queued++;
      else skipped++;
    }
    return { queued, skipped, disabled: 0 };
  });
}
