import { and, desc, eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema";
import { TAGS } from "@/lib/cache-tags";

export type LegalDocumentData = {
  key: string;
  version: string;
  title: LocalizedText;
  /** Panel-authored HTML per locale; sanitize before rendering. */
  body: LocalizedText;
  updatedAt: string;
};

/** The current version of a legal text (kvkk, distance_sales, …), or null. */
export async function getLegalDocument(key: string): Promise<LegalDocumentData | null> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.legal);

  const t = schema.legalDocuments;
  const [row] = await db
    .select({ key: t.key, version: t.version, title: t.title, body: t.body, updatedAt: t.updatedAt })
    .from(t)
    .where(and(eq(t.key, key), eq(t.isCurrent, true)))
    .orderBy(desc(t.updatedAt))
    .limit(1);
  return row ? { ...row, updatedAt: row.updatedAt.toISOString() } : null;
}
