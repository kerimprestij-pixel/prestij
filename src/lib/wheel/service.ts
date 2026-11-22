// Gift wheel DB services (WHEEL-SERVER): spin, bind, claim/issue, auto-apply. Every function takes the
// executor (`db` or a transaction) and no Next request APIs, so DB tests call them directly; the Route
// Handler, the Server Actions and the auth hooks (src/lib/wheel/hooks.ts) read cookies/session/IP and
// pass plain values in. Pure rules: ./eligibility, ./pick, ./code, ./prize.
//
// Life of a spin (wheel_spins.status):
//   spun     a guest spun (POST /api/wheel/spin); the httpOnly cookie prestij_wheel names the row;
//   bound    tied to an account: at sign-up (registerAction, "register"), at a sign-in of an unverified
//            account ("sign_in"), or spun while signed in ("signed_in"); at most ONE bound/claimed spin
//            per account and round (partial unique index wheel_spins_user_round_unique);
//   claimed  the prize coupon was issued (coupons row: source "wheel", owner, single use, valid
//            validityHours from now), mailed (wheel_prize) and, when possible, put on the cart;
//   expired  the hold ran out unclaimed (set lazily and by wheel.purge). The hold end is frozen in the
//            prize snapshot at spin time (spin time + holdDays then; FIX COR-2), so a later holdDays change
//            never moves a date the visitor was shown. Rows without it use created_at + the current holdDays.
// Where prizes are issued: claimWheel (signed in), afterSignIn (an existing account signs in with a
// held spin), completeEmailVerification (the register-bound spin, device independent: no cookie).
import "server-only";
import { createHmac, hkdfSync } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { absoluteUrl, href } from "@/i18n/paths";
import { isAnonymizedEmail } from "@/lib/account/service";
import { COUNTED_STATUSES } from "@/lib/b2b/queries";
import { applyCouponToCart, type ApplyCouponToCartResult } from "@/lib/cart/mutations";
import { loadCommerceSettings, type CommerceSettings } from "@/lib/cart/settings";
import { RETAIL_CUSTOMER, type CustomerContext } from "@/lib/cart/types";
import { resolveCustomerContext } from "@/lib/customer/resolve";
import { isUniqueViolation, pgConstraint, safeErrorInfo } from "@/lib/db-errors";
import { enqueueEmail } from "@/lib/email";
import type { Tx } from "@/lib/panel/tx";
import { parseSettings } from "@/lib/settings/types";
import { generateWheelCode } from "./code";
import { isSpinHeld, isStaffRoleString, spinHoldUntil, spinHoldUntilOf, wheelAccountReason, wheelScheduleState, type WheelAccountFacts } from "./eligibility";
import { consumeWheelSpinLimit, type ClaimLimiter } from "./limits";
import { pickWeightedIndex, type RandomInt } from "./pick";
import { prizeCouponDescription, prizeSnapshot } from "./prize";
import { findActiveWheelCoupon } from "./prize-coupons";
import type { GiftWheelSettings, WheelBoundVia, WheelEligibilityReason, WheelErrorCode, WheelPrizeSnapshot } from "./types";

export type { ClaimLimiter } from "./limits";

const s = schema.wheelSpins;
const c = schema.coupons;
const u = schema.user;
const HOUR_MS = 60 * 60 * 1000;
/** A "register" bind only goes to an unverified account created this recently (defence in depth). */
const REGISTER_BIND_MAX_AGE_MS = HOUR_MS;
/** Attempts to find a free prize code (31^6 codes: a second attempt is already astronomically rare). */
const CODE_ATTEMPTS = 8;

export type WheelSpinRow = typeof schema.wheelSpins.$inferSelect;

// ---------------------------------------------------------------------------------------------------
// Configuration (always uncached: a panel change applies to the very next spin)

export type WheelConfig = {
  wheel: GiftWheelSettings;
  /** The heavy-parcel surcharge is on (free-shipping prizes say that it is not included). */
  heavySurcharge: boolean;
};

export async function readWheelConfig(executor: Tx): Promise<WheelConfig> {
  const st = schema.settings;
  const rows = await executor.select({ key: st.key, value: st.value }).from(st).where(inArray(st.key, ["giftWheel", "shipping"]));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const shipping = parseSettings("shipping", byKey.get("shipping"));
  return { wheel: parseSettings("giftWheel", byKey.get("giftWheel")), heavySurcharge: Boolean(shipping.heavy?.enabled && shipping.heavy.feePerKg > 0) };
}

// ---------------------------------------------------------------------------------------------------
// Accounts

export type WheelAccount = WheelAccountFacts & {
  id: string;
  email: string;
  name: string;
  locale: Locale;
  banned: boolean;
  emailVerified: boolean;
  /** Deleted the KVKK way (anonymizeAccount). */
  anonymized: boolean;
  createdAt: Date;
  /** Pricing context (coupon owner checks, auto-apply). */
  customer: CustomerContext;
};

/** The account as the wheel rules see it, read fresh from the DB; null for an unknown id. */
export async function loadWheelAccount(executor: Tx, userId: string, commerce?: CommerceSettings): Promise<WheelAccount | null> {
  if (!userId) return null;
  const [row] = await executor
    .select({
      id: u.id,
      email: u.email,
      name: u.name,
      locale: u.locale,
      role: u.role,
      banned: u.banned,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt,
      companyId: u.companyId,
      customerGroupId: u.customerGroupId,
    })
    .from(u)
    .where(eq(u.id, userId))
    .limit(1);
  if (!row) return null;
  const settings = commerce ?? (await loadCommerceSettings(executor));
  const company =
    row.companyId != null
      ? ((
          await executor
            .select({ id: schema.companies.id, status: schema.companies.status, groupId: schema.companies.groupId, paymentTerms: schema.companies.paymentTerms })
            .from(schema.companies)
            .where(eq(schema.companies.id, row.companyId))
            .limit(1)
        )[0] ?? null)
      : null;
  const groupId = row.customerGroupId ?? company?.groupId ?? null;
  const g = schema.customerGroups;
  const group =
    groupId != null
      ? ((
          await executor
            .select({ id: g.id, slug: g.slug, discountPercent: g.discountPercent, isBusiness: g.isBusiness, showPricesExVat: g.showPricesExVat })
            .from(g)
            .where(eq(g.id, groupId))
            .limit(1)
        )[0] ?? null)
      : null;
  const banned = row.banned ?? false;
  const customer = banned ? { ...RETAIL_CUSTOMER } : resolveCustomerContext({ user: row, company, group, b2b: settings.b2b });
  const o = schema.orders;
  const [ordered] = await executor
    .select({ id: o.id })
    .from(o)
    .where(sql`${o.status} in ${COUNTED_STATUSES} and (${o.userId} = ${row.id} or lower(${o.email}) = ${row.email.trim().toLowerCase()})`)
    .limit(1);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    locale: isLocale(row.locale) ? row.locale : "tr",
    banned,
    emailVerified: row.emailVerified,
    anonymized: isAnonymizedEmail(row.email),
    createdAt: row.createdAt,
    customer,
    staff: isStaffRoleString(row.role),
    business: customer.isBusiness,
    hasOrdered: Boolean(ordered),
  };
}

/** The account already received a prize in `round`. */
export async function claimedInRound(executor: Tx, userId: string, round: number): Promise<boolean> {
  const [row] = await executor
    .select({ id: s.id })
    .from(s)
    .where(and(eq(s.userId, userId), eq(s.round, round), eq(s.status, "claimed")))
    .limit(1);
  return Boolean(row);
}

/** The account's newest bound spin that can still be claimed (any round), or null. */
async function accountHeldSpin(executor: Tx, userId: string, holdDays: number, now: Date): Promise<WheelSpinRow | null> {
  const rows = await executor
    .select()
    .from(s)
    .where(and(eq(s.userId, userId), eq(s.status, "bound"), isNull(s.couponId)))
    .orderBy(desc(s.createdAt), desc(s.id))
    .limit(5);
  return rows.find((row) => isSpinHeld(row, holdDays, now)) ?? null;
}

/**
 * Marks the account's bound spins whose hold ran out as "expired" (the daily purge does it too), so a
 * stale bound row never blocks the account's one bound/claimed slot of its round.
 */
async function expireStaleBoundSpins(tx: Tx, userId: string, holdDays: number, now: Date): Promise<void> {
  await tx
    .update(s)
    .set({ status: "expired" })
    .where(and(eq(s.userId, userId), eq(s.status, "bound"), isNull(s.couponId), sql`${spinHoldEndSql(holdDays)} <= ${now.toISOString()}::timestamptz`));
}

/**
 * SQL twin of spinHoldUntilOf: the hold end frozen in the prize snapshot, else created_at + the current
 * holdDays (rows spun before the end was frozen). Used by the stale-bound expiry here and by the purge.
 */
export function spinHoldEndSql(holdDays: number) {
  return sql`coalesce((${s.prize}->>'holdUntil')::timestamptz, ${s.createdAt} + make_interval(days => ${Math.trunc(holdDays)}::int))`;
}

export async function findSpin(executor: Tx, spinId: number | null | undefined): Promise<WheelSpinRow | null> {
  if (!spinId || !Number.isSafeInteger(spinId) || spinId <= 0) return null;
  const [row] = await executor.select().from(s).where(eq(s.id, spinId)).limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Who is the visitor and what may they do (loadWheel, the spin route, claims)

export type WheelVisitor = {
  /** "eligible" = may spin now, or holds a spin to claim (`held`). */
  reason: WheelEligibilityReason;
  /** The signed-in account (null for guests and for refused, unknown or banned accounts). */
  account: WheelAccount | null;
  /** A spin the visitor still holds (shown again, never re-spun), or null. */
  held: WheelSpinRow | null;
};

/**
 * Applies every rule of contract §1.1 to the visitor: off → "disabled"; a signed-in account's rules
 * (staff, business, audience); a held spin (the account's bound one, else the cookie's own one) →
 * "eligible" with `held`; a prize already claimed this round (account) or a claimed cookie spin of this
 * round (guest: one spin per visitor) → "already_claimed"; then the schedule.
 */
export async function resolveWheelVisitor(
  executor: Tx,
  input: { config: WheelConfig; userId: string | null; cookieSpinId: number | null; now: Date; commerce?: CommerceSettings },
): Promise<WheelVisitor> {
  const { wheel } = input.config;
  const { now } = input;
  if (!wheel.enabled) return { reason: "disabled", account: null, held: null };

  let account: WheelAccount | null = null;
  if (input.userId) {
    account = await loadWheelAccount(executor, input.userId, input.commerce);
    if (!account || account.banned || account.anonymized) return { reason: "unavailable", account: null, held: null };
    const reason = wheelAccountReason(wheel, account);
    if (reason !== "eligible") return { reason, account, held: null };
  }

  const cookieSpin = await findSpin(executor, input.cookieSpinId);
  let held: WheelSpinRow | null = account ? await accountHeldSpin(executor, account.id, wheel.holdDays, now) : null;
  if (!held && cookieSpin && isSpinHeld(cookieSpin, wheel.holdDays, now) && (cookieSpin.userId == null || !account || cookieSpin.userId === account.id)) {
    held = cookieSpin;
  }

  if (account) {
    // An unbound spin cannot become a second prize in a round the account already has one for.
    if (held && held.status === "spun" && (await claimedInRound(executor, account.id, held.round))) held = null;
    if (!held && (await claimedInRound(executor, account.id, wheel.round))) return { reason: "already_claimed", account, held: null };
  } else if (!held && cookieSpin && cookieSpin.status === "claimed" && cookieSpin.round === wheel.round) {
    return { reason: "already_claimed", account: null, held: null };
  }

  if (held) return { reason: "eligible", account, held };
  const schedule = wheelScheduleState(wheel, now);
  return { reason: schedule === "live" ? "eligible" : schedule, account, held: null };
}

/** Index of the held spin's slice in the current slices; -1 when that slice was removed since. */
export function heldSliceIndex(spin: Pick<WheelSpinRow, "sliceKey">, wheel: Pick<GiftWheelSettings, "slices">): number {
  return wheel.slices.findIndex((slice) => slice.key === spin.sliceKey);
}

/** End of the spin's unclaimed hold (frozen at spin time; see spinHoldUntilOf). */
export function holdUntilOf(spin: Pick<WheelSpinRow, "createdAt" | "prize">, wheel: Pick<GiftWheelSettings, "holdDays">): Date {
  return spinHoldUntilOf(spin, wheel.holdDays);
}

/**
 * The account's held, unclaimed spin for the /hesap card (lead decision D15), found by the ACCOUNT alone (no
 * cookie: someone who signed in on another device has none): a spin bound to `userId` (status "bound", no
 * coupon), inside its frozen hold, while the wheel is switched on and the account may still take part. The
 * rules are exactly the ones claimSpinForAccount (claimWheel) applies, through the same resolveWheelVisitor
 * (account first, so a claim takes this very spin); the schedule does not apply (D8: a held spin may be
 * claimed after the campaign end, within its hold). Null otherwise. Read-only.
 */
export async function findAccountHeldSpin(
  executor: Tx,
  input: { config: WheelConfig; userId: string; now: Date; commerce?: CommerceSettings },
): Promise<WheelSpinRow | null> {
  if (!input.userId) return null;
  const visitor = await resolveWheelVisitor(executor, { config: input.config, userId: input.userId, cookieSpinId: null, now: input.now, commerce: input.commerce });
  const held = visitor.held;
  if (!visitor.account || visitor.reason !== "eligible" || !held) return null;
  return held.status === "bound" && held.userId === visitor.account.id ? held : null;
}

// ---------------------------------------------------------------------------------------------------
// Spin

let ipKey: Buffer | null = null;
/**
 * Keyed hash of the client IP (HKDF from BETTER_AUTH_SECRET, purpose "wheel-ip"): abuse checks only;
 * the IP itself is never stored. Null without an IP or without the secret.
 */
export function hashWheelIp(ip: string | null | undefined): string | null {
  const value = (ip ?? "").trim();
  if (!value) return null;
  if (!ipKey) {
    const secret = process.env.BETTER_AUTH_SECRET ?? "";
    if (secret.length < 16) return null;
    ipKey = Buffer.from(hkdfSync("sha256", secret, "prestij/wheel/v1", "wheel-ip", 32));
  }
  return createHmac("sha256", ipKey).update(value).digest("hex").slice(0, 40);
}

export type CreateSpinInput = {
  config: WheelConfig;
  /** The signed-in account (the spin is bound to it at once, bound_via "signed_in"), or null for a guest. */
  account: Pick<WheelAccount, "id"> | null;
  locale: Locale;
  ipHash: string | null;
  pagePath: string | null;
  now: Date;
  randomInt?: RandomInt;
};

export type CreateSpinResult = { ok: true; spin: WheelSpinRow; sliceIndex: number } | { ok: false; reason: "already_bound" };

/**
 * Picks the winning slice on the server (crypto.randomInt, weighted) and stores the spin with a
 * snapshot of the prize. For a signed-in account the row is bound at once; a concurrent spin of the
 * same account in the same round loses on the unique index ("already_bound": show the other one).
 */
export async function createSpin(tx: Tx, input: CreateSpinInput): Promise<CreateSpinResult> {
  const { wheel } = input.config;
  const sliceIndex = pickWeightedIndex(
    wheel.slices.map((slice) => slice.weight),
    input.randomInt,
  );
  const slice = wheel.slices[sliceIndex];
  if (input.account) await expireStaleBoundSpins(tx, input.account.id, wheel.holdDays, input.now);
  const values: typeof schema.wheelSpins.$inferInsert = {
    round: wheel.round,
    sliceKey: slice.key,
    // The hold end is frozen with the prize: the result screen and the cookie promise this date.
    prize: { ...prizeSnapshot(slice), holdUntil: spinHoldUntil(input.now, wheel.holdDays).toISOString() },
    status: input.account ? "bound" : "spun",
    userId: input.account?.id ?? null,
    boundVia: input.account ? "signed_in" : null,
    boundAt: input.account ? input.now : null,
    locale: input.locale,
    ipHash: input.ipHash,
    pagePath: input.pagePath,
    createdAt: input.now,
  };
  try {
    const [spin] = await tx.transaction(async (sp) => sp.insert(s).values(values).returning());
    return { ok: true, spin, sliceIndex };
  } catch (error) {
    if (isUniqueViolation(error) && pgConstraint(error) === "wheel_spins_user_round_unique") return { ok: false, reason: "already_bound" };
    throw error;
  }
}

export type SpinDecision =
  | { kind: "refused"; error: WheelErrorCode; retryAfterSeconds?: number }
  | { kind: "spin"; spin: WheelSpinRow; sliceIndex: number; signedIn: boolean; repeated: boolean };

/**
 * The spin route's decision, inside ITS transaction (`tx`): every rule of contract §1.1; a visitor who
 * already holds a spin gets the same one again (repeated); otherwise the per-IP spin limit is counted
 * on `tx` itself (never on the shared pool while this transaction holds a connection: SEC-1) and a new
 * spin is stored. A concurrent spin of the same account in the same round shows that spin instead.
 */
export async function spinWheel(
  tx: Tx,
  input: {
    config: WheelConfig;
    userId: string | null;
    cookieSpinId: number | null;
    ip: string;
    locale: Locale;
    pagePath: string | null;
    now: Date;
    commerce?: CommerceSettings;
    randomInt?: RandomInt;
  },
): Promise<SpinDecision> {
  const { config, userId, cookieSpinId, now, commerce } = input;
  const visitor = await resolveWheelVisitor(tx, { config, userId, cookieSpinId, now, commerce });
  if (visitor.reason !== "eligible") return { kind: "refused", error: visitor.reason };
  if (visitor.held) return { kind: "spin", spin: visitor.held, sliceIndex: heldSliceIndex(visitor.held, config.wheel), signedIn: Boolean(visitor.account), repeated: true };

  const limit = await consumeWheelSpinLimit(tx, input.ip);
  if (!limit.allowed) return { kind: "refused", error: "spin_limit", retryAfterSeconds: limit.retryAfterMinutes * 60 };

  const created = await createSpin(tx, {
    config,
    account: visitor.account,
    locale: input.locale,
    ipHash: hashWheelIp(input.ip),
    pagePath: input.pagePath,
    now,
    randomInt: input.randomInt,
  });
  if (created.ok) return { kind: "spin", spin: created.spin, sliceIndex: created.sliceIndex, signedIn: Boolean(visitor.account), repeated: false };
  // The same account spun on another device a moment ago: show that spin.
  const again = await resolveWheelVisitor(tx, { config, userId, cookieSpinId, now, commerce });
  return again.held
    ? { kind: "spin", spin: again.held, sliceIndex: heldSliceIndex(again.held, config.wheel), signedIn: true, repeated: true }
    : { kind: "refused", error: again.reason === "eligible" ? "already_claimed" : again.reason };
}

/**
 * A guest's held spin that is already bound to an account (sign-up done, e-mail not verified yet): the
 * prize waits for the verification, so the result screen asks for that instead of a sign-up (COR-1).
 */
export function isSpinPendingVerification(spin: Pick<WheelSpinRow, "status">, signedIn: boolean): boolean {
  return !signedIn && spin.status === "bound";
}

// ---------------------------------------------------------------------------------------------------
// Bind

export type BindOutcome =
  /** Now bound to the account. */
  | "bound"
  /** Was already bound to this account. */
  | "already_bound"
  /** Already claimed by this account. */
  | "claimed"
  /** The account already has a bound or claimed spin in that round. */
  | "already_claimed"
  /** Bound to or claimed by another account (a shared browser): left alone. */
  | "taken"
  | "expired"
  | "not_found"
  | "disabled"
  /** The account may not take part (staff, business, audience). */
  | "not_eligible"
  /** wheel-claim:ip limit reached. */
  | "limited";

/**
 * Ties a held, unbound spin to `userId` (status "bound"). Locks the spin row; never steals a spin bound
 * to another account; marks an over-hold spin "expired". `consumeClaimLimit` runs only when the bind
 * is about to happen, on this transaction (after the spin row lock: lock order spin row → counter). The update runs in a savepoint, so the unique-index refusal ("already_claimed")
 * leaves the caller's transaction usable.
 */
export async function bindSpin(
  tx: Tx,
  input: { spinId: number; userId: string; via: WheelBoundVia; config: WheelConfig; now: Date; consumeClaimLimit?: ClaimLimiter },
): Promise<BindOutcome> {
  const { wheel } = input.config;
  if (!wheel.enabled) return "disabled";
  const [spin] = await tx.select().from(s).where(eq(s.id, input.spinId)).for("update");
  if (!spin) return "not_found";
  if (spin.userId && spin.userId !== input.userId) return "taken";
  if (spin.status === "claimed") return spin.userId === input.userId ? "claimed" : "taken";
  if (!isSpinHeld(spin, wheel.holdDays, input.now)) {
    if (spin.status !== "expired") await tx.update(s).set({ status: "expired" }).where(eq(s.id, spin.id));
    return "expired";
  }
  if (spin.status === "bound") return "already_bound";
  if (input.consumeClaimLimit && !(await input.consumeClaimLimit(tx))) return "limited";
  await expireStaleBoundSpins(tx, input.userId, wheel.holdDays, input.now);
  try {
    await tx.transaction(async (sp) => {
      await sp.update(s).set({ status: "bound", userId: input.userId, boundVia: input.via, boundAt: input.now }).where(eq(s.id, spin.id));
    });
    return "bound";
  } catch (error) {
    if (isUniqueViolation(error) && pgConstraint(error) === "wheel_spins_user_round_unique") return "already_claimed";
    throw error;
  }
}

/**
 * registerAction (via "register", brand-new account) and the EMAIL_NOT_VERIFIED sign-in (via
 * "sign_in"): binds the visitor's cookie spin to the account when the account may take part. No prize
 * yet (that waits for the e-mail verification). Never throws (a savepoint keeps the caller's
 * transaction, e.g. the consent record, intact); the outcome is never shown to the visitor.
 */
export async function bindSpinToAccount(
  tx: Tx,
  input: { spinId: number | null; userId: string; via: Extract<WheelBoundVia, "register" | "sign_in">; now?: Date; consumeClaimLimit?: ClaimLimiter },
): Promise<BindOutcome> {
  if (!input.spinId) return "not_found";
  const now = input.now ?? new Date();
  try {
    return await tx.transaction(async (sp) => {
      const config = await readWheelConfig(sp);
      if (!config.wheel.enabled) return "disabled";
      const account = await loadWheelAccount(sp, input.userId);
      if (!account || account.banned || account.anonymized) return "not_found";
      if (wheelAccountReason(config.wheel, account) !== "eligible") return "not_eligible";
      // Sign-up: only the account this very sign-up created (unverified, minutes old), never an older one.
      if (input.via === "register" && (account.emailVerified || now.getTime() - account.createdAt.getTime() > REGISTER_BIND_MAX_AGE_MS)) return "not_eligible";
      return bindSpin(sp, { spinId: input.spinId!, userId: input.userId, via: input.via, config, now, consumeClaimLimit: input.consumeClaimLimit });
    });
  } catch (error) {
    console.error("[wheel] bind failed", { via: input.via, ...safeErrorInfo(error) });
    return "not_found";
  }
}

/**
 * registerAction's wheel step. Only an account created by THIS sign-up takes the visitor's spin: for an
 * address that already had an account the answer must stay identical and nothing may change (no
 * enumeration, and the spin never goes to somebody else's account) → null, nothing touched.
 */
export async function bindSpinAtRegistration(
  tx: Tx,
  input: { existedBefore: boolean; spinId: number | null; userId: string; now?: Date; consumeClaimLimit?: ClaimLimiter },
): Promise<BindOutcome | null> {
  if (input.existedBefore || !input.spinId) return null;
  return bindSpinToAccount(tx, { spinId: input.spinId, userId: input.userId, via: "register", now: input.now, consumeClaimLimit: input.consumeClaimLimit });
}

// ---------------------------------------------------------------------------------------------------
// Issue (the prize coupon)

export type IssuedPrize = {
  spinId: number;
  couponId: number;
  code: string;
  endsAt: Date;
  prize: WheelPrizeSnapshot;
  /** False when this call found the prize already issued (double click, retry): no second mail. */
  created: boolean;
};

function firstName(name: string | null | undefined, email: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return (first || email.split("@")[0] || "").slice(0, 60);
}

/**
 * Issues the prize of a spin bound to `account`: a coupons row (source "wheel", owned by the account,
 * single use, per-customer limit 1, unscoped, min_order_total from the snapshot, valid from now for
 * validityHours) with a fresh CARK-XXXXXX code (retried on a collision), the spin marked "claimed",
 * and the `wheel_prize` mail queued in the same transaction. Locks the spin row; a spin this account
 * already claimed returns its existing coupon (created: false). Null when the spin is not bound to the
 * account or no longer held. The caller checked the account rules.
 */
export async function issueSpinPrize(
  tx: Tx,
  input: { spinId: number; account: WheelAccount; config: WheelConfig; now: Date; randomInt?: RandomInt },
): Promise<IssuedPrize | null> {
  const { wheel } = input.config;
  const { account, now } = input;
  const [spin] = await tx.select().from(s).where(eq(s.id, input.spinId)).for("update");
  if (!spin || spin.userId !== account.id) return null;
  if (spin.status === "claimed" && spin.couponId != null) {
    const [coupon] = await tx.select({ id: c.id, code: c.code, endsAt: c.endsAt }).from(c).where(eq(c.id, spin.couponId)).limit(1);
    return coupon && coupon.endsAt ? { spinId: spin.id, couponId: coupon.id, code: coupon.code, endsAt: coupon.endsAt, prize: spin.prize, created: false } : null;
  }
  if (spin.status !== "bound" || !isSpinHeld(spin, wheel.holdDays, now)) return null;

  const endsAt = new Date(now.getTime() + wheel.validityHours * HOUR_MS);
  const prize = spin.prize;
  let coupon: { id: number; code: string } | null = null;
  for (let attempt = 0; attempt < CODE_ATTEMPTS && !coupon; attempt++) {
    const code = generateWheelCode(input.randomInt);
    try {
      const [row] = await tx.transaction(async (sp) =>
        sp
          .insert(c)
          .values({
            code,
            description: prizeCouponDescription(prize, spin.round),
            type: prize.type,
            value: prize.type === "free_shipping" ? 0 : prize.value,
            minOrderTotal: Math.max(0, prize.minOrderTotal),
            maxUses: 1,
            usedCount: 0,
            perCustomerLimit: 1,
            productIds: null,
            categoryIds: null,
            customerGroupIds: null,
            isActive: true,
            source: "wheel",
            userId: account.id,
            startsAt: now,
            endsAt,
          })
          .returning({ id: c.id, code: c.code }),
      );
      coupon = row;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error; // a taken code: try another one
    }
  }
  if (!coupon) throw new Error("wheel: could not find a free prize code");

  await tx.update(s).set({ status: "claimed", couponId: coupon.id, claimedAt: now }).where(eq(s.id, spin.id));
  await enqueueEmail(tx, {
    template: "wheel_prize",
    to: account.email,
    locale: account.locale,
    data: {
      name: firstName(account.name, account.email),
      prize: prize.label,
      type: prize.type,
      value: prize.value,
      minOrderTotal: prize.minOrderTotal,
      code: coupon.code,
      endsAt: endsAt.toISOString(),
      cartUrl: absoluteUrl(href(account.locale, "cart")),
      shopUrl: absoluteUrl(href(account.locale, "products")),
      heavySurcharge: input.config.heavySurcharge,
    },
    related: { type: "user", id: account.id },
    dedupeKey: `wheel:spin:${spin.id}:prize`,
  });
  return { spinId: spin.id, couponId: coupon.id, code: coupon.code, endsAt, prize, created: true };
}

// ---------------------------------------------------------------------------------------------------
// Claim (signed-in visitor, sign-in) and verification

export type ClaimOutcome =
  | { ok: true; issued: IssuedPrize; account: WheelAccount }
  | { ok: false; error: Extract<WheelErrorCode, WheelEligibilityReason | "no_spin" | "spin_expired" | "claim_limit"> };

/**
 * Turns the visitor's held spin into a prize for `userId`: the account rules, the held spin (the
 * account's own bound spin first, found by the account without any cookie, e.g. from the /hesap card on
 * another device (D15); else the cookie's spin), the per-IP claim limit, bind (when still unbound), issue.
 * Runs inside the caller's transaction.
 */
export async function claimSpinForAccount(
  tx: Tx,
  input: {
    userId: string;
    cookieSpinId: number | null;
    via: Extract<WheelBoundVia, "sign_in" | "signed_in">;
    config: WheelConfig;
    now: Date;
    commerce?: CommerceSettings;
    consumeClaimLimit?: ClaimLimiter;
    randomInt?: RandomInt;
  },
): Promise<ClaimOutcome> {
  const { config, now } = input;
  const visitor = await resolveWheelVisitor(tx, { config, userId: input.userId, cookieSpinId: input.cookieSpinId, now, commerce: input.commerce });
  if (!visitor.account) return { ok: false, error: visitor.reason === "eligible" ? "unavailable" : (visitor.reason as Exclude<WheelEligibilityReason, "eligible">) };
  if (visitor.reason !== "eligible") return { ok: false, error: visitor.reason };
  if (!visitor.held) return { ok: false, error: "no_spin" };
  const account = visitor.account;
  const held = visitor.held;

  // Lock order as in bindSpin: the spin row first, then the claim counter (on this transaction).
  await tx.select({ id: s.id }).from(s).where(eq(s.id, held.id)).for("update");
  if (input.consumeClaimLimit && !(await input.consumeClaimLimit(tx))) return { ok: false, error: "claim_limit" };
  if (held.status === "spun") {
    const bound = await bindSpin(tx, { spinId: held.id, userId: account.id, via: input.via, config, now });
    if (bound === "already_claimed") return { ok: false, error: "already_claimed" };
    if (bound === "expired") return { ok: false, error: "spin_expired" };
    if (bound === "disabled") return { ok: false, error: "disabled" };
    if (bound !== "bound" && bound !== "already_bound" && bound !== "claimed") return { ok: false, error: "no_spin" };
  }
  const issued = await issueSpinPrize(tx, { spinId: held.id, account, config, now, randomInt: input.randomInt });
  if (!issued) return { ok: false, error: "spin_expired" };
  return { ok: true, issued, account };
}

/**
 * completeEmailVerification: issues the prizes of the account's held, bound spins (bound at sign-up or
 * at an unverified sign-in) once the address is verified. Device independent: no cookie needed (the
 * verification link may open on another device). Over-hold spins are marked "expired". Returns the
 * issued prizes (empty when the account may not take part or nothing is held).
 */
export async function issueBoundPrizes(tx: Tx, userId: string, now = new Date()): Promise<IssuedPrize[]> {
  const config = await readWheelConfig(tx);
  if (!config.wheel.enabled) return [];
  const spins = await tx
    .select()
    .from(s)
    .where(and(eq(s.userId, userId), eq(s.status, "bound"), isNull(s.couponId)))
    .orderBy(s.createdAt, s.id)
    .limit(5);
  if (spins.length === 0) return [];
  const account = await loadWheelAccount(tx, userId);
  if (!account || !account.emailVerified || account.anonymized || account.banned) return [];
  if (wheelAccountReason(config.wheel, account) !== "eligible") return [];
  const issued: IssuedPrize[] = [];
  for (const spin of spins) {
    if (!isSpinHeld(spin, config.wheel.holdDays, now)) {
      await tx.update(s).set({ status: "expired" }).where(eq(s.id, spin.id));
      continue;
    }
    const prize = await issueSpinPrize(tx, { spinId: spin.id, account, config, now });
    if (prize) issued.push(prize);
  }
  return issued;
}

// ---------------------------------------------------------------------------------------------------
// Auto-apply (contract §1.1 "Auto-apply")

/**
 * Puts the account's usable prize (the one that expires first) on the account's own cart in "auto"
 * mode: never over a code already on the cart, kept for later when the cart cannot use it now (min.
 * basket, no eligible line, no benefit); nothing is written unless it applies. Only a live cart that
 * belongs to the account (a guest cart would show "another account's code" after sign-out). `code`: a
 * specific prize (the one just issued) instead of the best one. Null when there is nothing to apply.
 */
export async function autoApplyWheelPrize(
  tx: Tx,
  input: { userId: string; cartId: string | null; now: Date; code?: string; customer?: CustomerContext; commerce?: CommerceSettings },
): Promise<ApplyCouponToCartResult | null> {
  if (!input.cartId) return null;
  const [cart] = await tx.select({ userId: schema.carts.userId }).from(schema.carts).where(eq(schema.carts.id, input.cartId)).limit(1);
  if (!cart || cart.userId !== input.userId) return null;
  const code = input.code ?? (await findActiveWheelCoupon(tx, input.userId, input.now))?.code;
  if (!code) return null;
  const commerce = input.commerce ?? (await loadCommerceSettings(tx));
  const customer = input.customer ?? (await loadWheelAccount(tx, input.userId, commerce))?.customer;
  if (!customer) return null;
  return applyCouponToCart(tx, { cartId: input.cartId, code, customer, now: input.now, mode: "auto", settings: commerce });
}

// ---------------------------------------------------------------------------------------------------
// Sign-in effects (called inside afterSignIn's transaction)

export type WheelSignInResult = {
  /** A prize was issued by this sign-in. */
  claimed: boolean;
  /** The account's prize went onto the cart. */
  applied: boolean;
  /** The cookie's spin is now claimed by this account: the cookie can go. */
  clearCookie: boolean;
};

/**
 * After a successful sign-in (and the automatic sign-in of e-mail verification): claim the held spin
 * when the account may take part and has no prize this round (bound_via "sign_in"), then auto-apply the
 * account's prize to the (just attached) cart. Each part runs in a savepoint and never throws, so the
 * cart attach and order linking of the sign-in always survive.
 */
export async function wheelSignInEffects(
  tx: Tx,
  input: { userId: string; cartId: string | null; cookieSpinId: number | null; now: Date; consumeClaimLimit?: ClaimLimiter },
): Promise<WheelSignInResult> {
  const result: WheelSignInResult = { claimed: false, applied: false, clearCookie: false };
  try {
    await tx.transaction(async (sp) => {
      const config = await readWheelConfig(sp);
      if (!config.wheel.enabled) return;
      const commerce = await loadCommerceSettings(sp);
      const claim = await claimSpinForAccount(sp, { userId: input.userId, cookieSpinId: input.cookieSpinId, via: "sign_in", config, now: input.now, commerce, consumeClaimLimit: input.consumeClaimLimit });
      if (claim.ok) result.claimed = claim.issued.created;
      const applied = await autoApplyWheelPrize(sp, { userId: input.userId, cartId: input.cartId, now: input.now, commerce, customer: claim.ok ? claim.account.customer : undefined });
      result.applied = applied?.status === "applied";
      if (input.cookieSpinId) {
        const spin = await findSpin(sp, input.cookieSpinId);
        result.clearCookie = Boolean(spin && spin.status === "claimed" && spin.userId === input.userId);
      }
    });
  } catch (error) {
    console.error("[wheel] sign-in effects failed", { userId: input.userId, ...safeErrorInfo(error) });
    return { claimed: false, applied: false, clearCookie: false };
  }
  return result;
}

/**
 * completeEmailVerification's wheel part: issue the bound prizes in a savepoint (a wheel error never
 * rolls back the order linking or the welcome mail). Returns how many prizes were issued.
 */
export async function wheelVerificationEffects(tx: Tx, userId: string, now = new Date()): Promise<number> {
  try {
    return await tx.transaction(async (sp) => (await issueBoundPrizes(sp, userId, now)).filter((p) => p.created).length);
  } catch (error) {
    console.error("[wheel] verification effects failed", { userId, ...safeErrorInfo(error) });
    return 0;
  }
}
