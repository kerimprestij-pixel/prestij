// Storefront side of moved slugs (rows written by recordMove in src/lib/panel/redirects.ts).
// Call redirectIfMoved in a page's not-found branch, right before notFound().
import { eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { permanentRedirect } from "next/navigation";
import { db, schema } from "@/db";
import type { Locale } from "@/i18n/config";
import { localizePath } from "@/i18n/paths";
import { TAGS } from "@/lib/cache-tags";

/** Target of a moved canonical path ("/urunler/eski" → "/urunler/yeni"), or null. Cached (tag `redirects`). */
export async function findRedirect(folderPath: string): Promise<string | null> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.redirects);
  const path = folderPath.trim().toLowerCase().replace(/\/+$/, "");
  if (!path.startsWith("/") || path.length > 300) return null;
  const [row] = await db
    .select({ toPath: schema.redirects.toPath })
    .from(schema.redirects)
    .where(eq(schema.redirects.fromPath, path))
    .limit(1);
  return row?.toPath ?? null;
}

/**
 * When `folderPath` (canonical Turkish path, e.g. "/urunler/eski") was moved, permanently redirects to
 * the new path in `locale` ("/en/products/yeni"); otherwise returns and the caller continues (notFound).
 * Inside a streamed Suspense boundary Next sends the redirect as a client-side redirect (the status line
 * is already 200 by then).
 */
export async function redirectIfMoved(locale: Locale, folderPath: string): Promise<void> {
  const to = await findRedirect(folderPath);
  if (to) permanentRedirect(localizePath(locale, to));
}
