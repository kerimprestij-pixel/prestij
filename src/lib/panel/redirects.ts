// Moved slugs. When the panel changes a product/category/page/post slug, recordMove stores the old
// canonical Turkish folder path → the new one, so old links keep working (redirectIfMoved in
// src/lib/data/redirects.ts). Chains collapse (x→a + a→b = x→b) and loops are removed. Callers
// invalidate TAGS.redirects (recordMove returns true when it changed anything).
import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { schema } from "@/db";
import { PanelError } from "./errors";
import type { Tx } from "./tx";

const r = schema.redirects;

/** Canonical folder path: "/segment(/segment)*" of lower-case slug characters. */
const CANONICAL_PATH = /^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/** Canonical paths for the routes that use slugs (Turkish folder names, no locale). */
export const canonicalPath = {
  product: (slug: string) => `/urunler/${slug}`,
  category: (slug: string) => `/kategori/${slug}`,
  page: (slug: string) => `/sayfa/${slug}`,
  post: (slug: string) => `/blog/${slug}`,
} as const;

/** Trims, drops a trailing slash and lower-cases; throws PanelError("invalid") for anything else. */
export function normalizeRedirectPath(path: string): string {
  const value = path.trim().replace(/\/+$/, "").toLowerCase();
  if (!CANONICAL_PATH.test(value)) throw new PanelError("invalid", `Geçersiz yönlendirme yolu: ${path.slice(0, 80)}`);
  return value;
}

/**
 * Records that `fromPath` now lives at `toPath` (both canonical, e.g. "/urunler/eski" → "/urunler/yeni"):
 * 1. a redirect *from* the new path is dropped (that URL is live again);
 * 2. every redirect that pointed to the old path now points to the new one (chains collapse);
 * 3. self-redirects are removed (loops);
 * 4. old → new is inserted or updated.
 * Returns true when anything changed. Run it in the same transaction as the slug change.
 */
export async function recordMove(tx: Tx, fromPath: string, toPath: string): Promise<boolean> {
  const from = normalizeRedirectPath(fromPath);
  const to = normalizeRedirectPath(toPath);
  if (from === to) return false;

  await tx.delete(r).where(eq(r.fromPath, to));
  await tx.update(r).set({ toPath: to, updatedAt: new Date() }).where(and(eq(r.toPath, from), ne(r.fromPath, to)));
  await tx.delete(r).where(sql`${r.fromPath} = ${r.toPath}`);
  await tx
    .insert(r)
    .values({ fromPath: from, toPath: to, permanent: true })
    .onConflictDoUpdate({ target: r.fromPath, set: { toPath: to, permanent: true, updatedAt: new Date() } });
  return true;
}

/**
 * Removes redirects that point to `path` (e.g. when the product/page there is deleted, so old links
 * 404 instead of redirecting to a 404) and the redirect from it. Returns the number of rows removed.
 */
export async function dropRedirectsTo(tx: Tx, path: string): Promise<number> {
  const target = normalizeRedirectPath(path);
  const removed = await tx
    .delete(r)
    .where(sql`${r.toPath} = ${target} or ${r.fromPath} = ${target}`)
    .returning({ id: r.id });
  return removed.length;
}
