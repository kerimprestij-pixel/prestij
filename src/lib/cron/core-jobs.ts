// Core scheduled jobs: stale card orders, expired carts, rate-limit counters, auth verification rows.
import "server-only";
import { lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { expireStalePendingOrders } from "@/lib/orders/status";
import { pruneRateLimits } from "@/lib/rate-limit-store";
import { registerJob } from "./registry";

/**
 * Card orders still pending_payment after this many minutes are cancelled and restocked (after asking the
 * provider). PayTR orders wait longer: until their latest attempt is PAYTR_VERIFY_WINDOW_MINUTES (45) old and
 * Durum Sorgu says "not paid" (expireStalePendingOrders). Each run is bounded (EXPIRY_LIMITS), so the
 * "frequent" group may run every 5 minutes (Vercel Pro, RUNBOOK CF-2).
 */
export const ORDER_PAYMENT_TIMEOUT_MINUTES = 30;
/** Expired carts are kept one more day (a request that just loaded one never loses it mid-flight). */
const CART_GRACE_MS = 24 * 60 * 60_000;
const CART_BATCH = 1000;
const CART_MAX_BATCHES = 20;

/** Deletes carts (and their items, by cascade) that expired more than a day ago, in batches. */
export async function pruneExpiredCarts(now: Date = new Date()): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - CART_GRACE_MS).toISOString();
  const carts = schema.carts;
  let deleted = 0;
  for (let i = 0; i < CART_MAX_BATCHES; i++) {
    const rows = await db.execute<{ id: string }>(sql`
      delete from ${carts} where ${carts.id} in (
        select ${carts.id} from ${carts} where ${carts.expiresAt} < ${cutoff}::timestamptz limit ${CART_BATCH}
      ) returning ${carts.id}`);
    deleted += rows.length;
    if (rows.length < CART_BATCH) break;
  }
  return { deleted };
}

/** Deletes expired Better Auth verification rows (e-mail verification and password reset tokens). */
export async function pruneExpiredVerifications(now: Date = new Date()): Promise<{ deleted: number }> {
  const v = schema.verification;
  const rows = await db.delete(v).where(lt(v.expiresAt, now)).returning({ id: v.id });
  return { deleted: rows.length };
}

export const ordersExpireJob = registerJob({
  key: "orders.expire",
  group: "frequent",
  label: "Ödenmeyen kart siparişlerini iptal et",
  run: async () => {
    const { expired, paid, waiting, unknown, deferred, failed } = await expireStalePendingOrders(ORDER_PAYMENT_TIMEOUT_MINUTES);
    return { expired, paid, waiting, unknown, deferred, failed };
  },
});

export const cartsPruneJob = registerJob({
  key: "carts.prune",
  group: "daily",
  label: "Süresi dolan sepetleri temizle",
  run: async () => pruneExpiredCarts(),
});

export const rateLimitsPruneJob = registerJob({
  key: "ratelimits.prune",
  group: "daily",
  label: "Eski deneme sayaçlarını temizle",
  run: async () => {
    const { counters, authRows } = await pruneRateLimits();
    return { counters, authRows };
  },
});

export const authPruneJob = registerJob({
  key: "auth.prune",
  group: "daily",
  label: "Süresi dolan doğrulama kayıtlarını temizle",
  run: async () => pruneExpiredVerifications(),
});
