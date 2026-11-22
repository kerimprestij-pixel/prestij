// Subscription plan reads: the cached storefront list (static product pages) and fresh reads.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import { TAGS } from "@/lib/cache-tags";
import type { DbExecutor } from "@/lib/cart/settings";
import type { StorefrontPlan } from "./types";

const sp = schema.subscriptionPlans;
const columns = { id: sp.id, name: sp.name, interval: sp.interval, intervalCount: sp.intervalCount, percent: sp.discountPercent };

/** Active plans in panel order, fresh (cart actions, account page, renewals). */
export async function loadActivePlans(executor: DbExecutor = db): Promise<StorefrontPlan[]> {
  return executor.select(columns).from(sp).where(eq(sp.isActive, true)).orderBy(asc(sp.position), asc(sp.id));
}

/**
 * Active plans for static product pages (cached; the panel's plan editor invalidates the tag). The
 * cart re-reads the plan when the line is priced, so a stale list can never change what is charged.
 */
export async function getActiveSubscriptionPlans(): Promise<StorefrontPlan[]> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.subscriptionPlans);
  return loadActivePlans();
}
