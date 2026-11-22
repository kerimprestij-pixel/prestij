// Links the wheel dialog shows: the campaign terms ("Hediye Çarkı Kampanya Koşulları", CONTENT's legal
// page) and the KVKK notice. Each only when its page exists and is published (no dead link).
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@/db";
import type { Locale } from "@/i18n/config";
import { href } from "@/i18n/paths";
import type { Tx } from "@/lib/panel/tx";
import { WHEEL_TERMS_PAGE_SLUG } from "./types";

/** Slug of the campaign terms page (/sayfa/<slug>, legal document key "wheel_terms"): src/lib/wheel/types.ts. */
export { WHEEL_TERMS_PAGE_SLUG };
/** The KVKK notice (seeded legal page). */
export const WHEEL_PRIVACY_PAGE_SLUG = "kvkk";

export async function wheelLegalLinks(executor: Tx, locale: Locale): Promise<{ terms: string | null; privacy: string | null }> {
  const p = schema.pages;
  const rows = await executor
    .select({ slug: p.slug })
    .from(p)
    .where(and(inArray(p.slug, [WHEEL_TERMS_PAGE_SLUG, WHEEL_PRIVACY_PAGE_SLUG]), eq(p.isPublished, true)));
  const has = (slug: string) => rows.some((r) => r.slug === slug);
  return {
    terms: has(WHEEL_TERMS_PAGE_SLUG) ? href(locale, "page", { slug: WHEEL_TERMS_PAGE_SLUG }) : null,
    privacy: has(WHEEL_PRIVACY_PAGE_SLUG) ? href(locale, "page", { slug: WHEEL_PRIVACY_PAGE_SLUG }) : null,
  };
}
