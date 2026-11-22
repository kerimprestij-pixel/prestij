import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DbExecutor } from "@/lib/cart/settings";
import { LEGAL_KEYS, type LegalDocumentInput } from "./legal-render";

export type CheckoutLegalDocs = { preInformation: LegalDocumentInput; distanceSales: LegalDocumentInput };

/** Current pre_information and distance_sales documents, read fresh (the version is what gets stored). */
export async function loadCheckoutLegalDocs(executor: DbExecutor = db): Promise<CheckoutLegalDocs> {
  const t = schema.legalDocuments;
  const rows = await executor
    .select({ key: t.key, version: t.version, title: t.title, body: t.body })
    .from(t)
    .where(and(inArray(t.key, [LEGAL_KEYS.preInformation, LEGAL_KEYS.distanceSales]), eq(t.isCurrent, true)))
    .orderBy(desc(t.updatedAt));
  const pick = (key: string) => rows.find((r) => r.key === key) ?? null;
  return { preInformation: pick(LEGAL_KEYS.preInformation), distanceSales: pick(LEGAL_KEYS.distanceSales) };
}
