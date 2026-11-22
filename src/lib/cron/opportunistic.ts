// The Vercel Hobby cron runs once a day, but unpaid card orders hold stock for 30 minutes only. So a
// placed order also runs `orders.expire` after the response, at most once per 5 minutes per server
// instance (same advisory lock as the cron: a concurrent run is skipped).
import "server-only";
import { after } from "next/server";
import { safeErrorInfo } from "@/lib/db-errors";
import { ordersExpireJob } from "./core-jobs";
import { runJob } from "./run";

export const OPPORTUNISTIC_EXPIRY_INTERVAL_MS = 5 * 60_000;

const state = globalThis as typeof globalThis & { __prestijLastOrdersExpire?: number };

/**
 * Schedules `orders.expire` with `after()` unless it ran on this instance in the last 5 minutes.
 * Returns true when scheduled. Outside a request scope (scripts, tests) it does nothing.
 */
export function scheduleOpportunisticOrderExpiry(now: number = Date.now()): boolean {
  const last = state.__prestijLastOrdersExpire ?? 0;
  if (now - last < OPPORTUNISTIC_EXPIRY_INTERVAL_MS) return false;
  state.__prestijLastOrdersExpire = now;
  try {
    after(async () => {
      try {
        await runJob(ordersExpireJob);
      } catch (error) {
        console.error("[cron] opportunistic orders.expire failed", safeErrorInfo(error));
      }
    });
    return true;
  } catch {
    state.__prestijLastOrdersExpire = last; // no request scope: nothing was scheduled
    return false;
  }
}
