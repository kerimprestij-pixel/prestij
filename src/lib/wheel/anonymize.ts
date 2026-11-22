// Gift wheel part of account deletion (anonymizeAccount, src/lib/account/service.ts). Kept tiny and
// free of other app imports so the account service can call it without import cycles.
//   - the account's spins lose their link to the user and their IP hash (they stay for statistics);
//   - the account's unused prize coupons are switched off (a used one stays as the order's record).
// The coupon rows keep user_id: a wheel coupon always has an owner (coupons_wheel_owner_check), and the
// anonymized user row itself stays.
import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { Tx } from "@/lib/panel/tx";

export type WheelAnonymizeResult = { unlinkedSpins: number; deactivatedPrizes: number };

export async function anonymizeWheelData(tx: Tx, userId: string, now = new Date()): Promise<WheelAnonymizeResult> {
  const s = schema.wheelSpins;
  const c = schema.coupons;
  const spins = await tx.update(s).set({ userId: null, ipHash: null }).where(eq(s.userId, userId)).returning({ id: s.id });
  const prizes = await tx
    .update(c)
    .set({ isActive: false, updatedAt: now })
    .where(and(eq(c.source, "wheel"), eq(c.userId, userId), eq(c.isActive, true), or(isNull(c.maxUses), sql`${c.usedCount} < ${c.maxUses}`)))
    .returning({ id: c.id });
  return { unlinkedSpins: spins.length, deactivatedPrizes: prizes.length };
}
