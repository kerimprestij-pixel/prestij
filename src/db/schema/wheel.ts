// Day 6: the gift wheel (Hediye Çarkı). One row per spin; the prize itself becomes a `coupons` row
// (source "wheel", owned by the account) when it is claimed. Configuration lives in the settings key
// `giftWheel` (src/lib/settings/types.ts), not in a table.
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { coupons, type CouponType } from "./commerce";
import { id, type Kurus, type LocalizedText } from "./common";
import { user } from "./auth";

/** spun (anonymous) → bound (tied to an account, waiting for e-mail verification or eligibility) → claimed (coupon issued); expired = hold ran out. */
export const WHEEL_SPIN_STATUSES = ["spun", "bound", "claimed", "expired"] as const;
export type WheelSpinStatus = (typeof WHEEL_SPIN_STATUSES)[number];

/** How a spin got its account: sign-up (register), sign-in of an existing account, or spun while signed in. */
export const WHEEL_BOUND_VIA = ["register", "sign_in", "signed_in"] as const;
export type WheelBoundVia = (typeof WHEEL_BOUND_VIA)[number];

/** The prize as it was when the wheel stopped (a later edit of the slices never changes a won prize). */
export type WheelPrizeSnapshot = {
  type: CouponType;
  /** Percent for "percent", kuruş for "fixed", 0 for "free_shipping". */
  value: number;
  label: LocalizedText;
  /** Minimum basket in kuruş (0 = none). */
  minOrderTotal: Kurus;
  /**
   * End of the unclaimed hold (ISO), frozen when the wheel stopped (day 6 FIX): a later change of
   * giftWheel.holdDays never moves a promised "claim until" date. Older rows without it fall back to
   * created_at + the current holdDays. A JSON field, not a column (no migration).
   */
  holdUntil?: string;
};

export const wheelSpins = pgTable(
  "wheel_spins",
  {
    id: id(),
    /** `giftWheel.round` at spin time ("Yeni tur başlat" makes everyone eligible again). */
    round: integer().notNull(),
    /** Stable key of the slice that won (`giftWheel.slices[].key`). */
    sliceKey: text().notNull(),
    prize: jsonb().$type<WheelPrizeSnapshot>().notNull(),
    status: text().$type<WheelSpinStatus>().notNull().default("spun"),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    boundVia: text().$type<WheelBoundVia>(),
    /** The issued prize coupon (status "claimed"). */
    couponId: integer().references(() => coupons.id, { onDelete: "set null" }),
    /** Storefront language of the spin (texts of the prize e-mail when the account has no locale). */
    locale: text().notNull().default("tr"),
    /** Salted hash of the client IP (abuse checks only; never the IP itself). */
    ipHash: text(),
    /** Canonical Turkish path the spin happened on, without query string, at most 200 characters. */
    pagePath: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    boundAt: timestamp({ withTimezone: true }),
    claimedAt: timestamp({ withTimezone: true }),
    /** When the "your prize expires soon" e-mail was queued (job wheel.remind; at most once). */
    remindedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index().on(t.userId),
    index().on(t.createdAt),
    // One prize per account per round: at most one bound or claimed spin.
    uniqueIndex("wheel_spins_user_round_unique")
      .on(t.userId, t.round)
      .where(sql`${t.userId} is not null and ${t.status} in ('bound', 'claimed')`),
    // A prize coupon belongs to exactly one spin.
    uniqueIndex("wheel_spins_coupon_unique").on(t.couponId).where(sql`${t.couponId} is not null`),
    check("wheel_spins_status_check", sql`${t.status} in ('spun', 'bound', 'claimed', 'expired')`),
    check("wheel_spins_bound_via_check", sql`${t.boundVia} is null or ${t.boundVia} in ('register', 'sign_in', 'signed_in')`),
    check("wheel_spins_page_path_check", sql`${t.pagePath} is null or char_length(${t.pagePath}) <= 200`),
  ],
).enableRLS();
