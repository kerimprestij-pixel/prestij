// Favorites (the heart on product cards / product pages, /hesap/favoriler). The user id always comes
// from the session. Only active, listable products (standard and bundle, not business-only) can be
// added; removing works for any product id (a product archived later can still be removed).
import "server-only";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { schema } from "@/db";
import type { Tx } from "@/lib/panel/tx";
import { AccountError } from "./errors";

/** Favorites one customer may keep (the viewer state carries at most MAX_VIEWER_FAVORITES = 500). */
export const MAX_FAVORITES = 200;

const f = schema.favorites;
const p = schema.products;

/**
 * Adds or removes a favorite. Idempotent (adding twice or removing a missing one is fine). Throws
 * AccountError "not_found" for a product that cannot be favorited, "limit" beyond MAX_FAVORITES.
 */
export async function setFavorite(tx: Tx, userId: string, productId: number, favorite: boolean, now = new Date()): Promise<{ favorite: boolean }> {
  if (!favorite) {
    await tx.delete(f).where(and(eq(f.userId, userId), eq(f.productId, productId)));
    return { favorite: false };
  }
  const [product] = await tx
    .select({ id: p.id })
    .from(p)
    .where(and(eq(p.id, productId), eq(p.status, "active"), inArray(p.type, ["standard", "bundle"]), eq(p.businessOnly, false)))
    .limit(1);
  if (!product) throw new AccountError("not_found");
  // Serialize one user's concurrent adds so the limit holds (the user row is the lock).
  await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).for("update");
  const [{ n }] = await tx.select({ n: count() }).from(f).where(eq(f.userId, userId));
  const [existing] = await tx.select({ productId: f.productId }).from(f).where(and(eq(f.userId, userId), eq(f.productId, productId))).limit(1);
  if (existing) return { favorite: true };
  if (n >= MAX_FAVORITES) throw new AccountError("limit");
  await tx.insert(f).values({ userId, productId, createdAt: now }).onConflictDoNothing();
  return { favorite: true };
}

/** The user's favorite product ids, newest first. */
export async function listFavoriteIds(executor: Tx, userId: string): Promise<number[]> {
  const rows = await executor.select({ productId: f.productId }).from(f).where(eq(f.userId, userId)).orderBy(desc(f.createdAt), desc(f.productId)).limit(MAX_FAVORITES);
  return rows.map((r) => r.productId);
}
