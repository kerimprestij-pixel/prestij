/**
 * Day-6 content (gift wheel, campaign terms, launch checklist) for EXISTING databases. A fresh database
 * gets the same content from the seed definitions (scripts/seed-data/**); the client's live database
 * gets it from this script.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/content-day6.ts [--dry-run] [--only=giftWheelConfig,wheelTerms] [--allow-production]
 *
 * Rules (every step; same as content-day5.ts, see docs/DAY6-WHEEL-VIDEO.md §6 and docs/DAY5-SEO.md §6):
 *   - inserts only what is missing and never overwrites existing rows or anything the client edited;
 *   - updates only values that are still exactly the previous seeded default: compare with
 *     decideDefaultUpdate(current, next, ...previousDefaults) (sameJson: key order ignored) and report
 *     every other value as skipped with SKIP_REASON[decision] ("edited in the panel, left as is");
 *   - idempotent: a second run reports nothing to do (no inserted / updated lines);
 *   - write the rows through `db` (the step's transaction) only; no other connection, no network.
 * One transaction per step; `--dry-run` rolls every step back after printing what it would do.
 * Refuses NODE_ENV=production and a non-local DATABASE_URL unless `--allow-production` is passed.
 * While building, run only `--dry-run --only=<yourStep>`; INTEGRATE runs it for real, FINAL runs it again.
 * It does not invalidate a running server's caches: restart the server afterwards (or save once in the panel).
 * Importable without a database (tests import STEPS): no `@/db` or other server-only import at top level.
 *
 * Owners: each step is ONE exported function below, edited only by its owner (with the Edit tool, after
 * re-reading the file; helpers go inside your own section or in your own seed-data file).
 *   giftWheelConfig   CONTENT   the live `giftWheel` settings row (enabled, the six default slices of
 *                               contract §1.1 "Defaults"), inserted only when no giftWheel row exists
 *   wheelTerms        CONTENT   the legal document + page "Hediye Çarkı Kampanya Koşulları" (tr/en/ar draft,
 *                               marked "taslak — avukat onayı bekliyor")
 *   launchChecklist   CONTENT   the "Yayına çıkınca" items (src/lib/panel/seo/launch.ts): Supabase storage keys
 *                               + a test upload on the live site, review the wheel slices, lawyer review of the terms
 * Each step gets a DB test (tests/db/day6-content-*.test.ts): inside a rolled-back transaction, run the
 * step twice and assert that the second report has no inserted or updated lines (tests/db/day6-core-api.test.ts
 * also does this generically for every STEPS entry).
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { sectionMeta } from "@/components/sections/schemas";
import { legalDocuments, pages, pageSections, settings } from "@/db/schema";
import { emptyReport, runContentSteps, sameJson, SKIP_REASON, type ContentReport, type ContentStepDefinition } from "./seed-data/content-helpers";
import type { ScriptDb } from "./seed-data/db";
import { describeGiftWheel, giftWheelLiveSettings } from "./seed-data/gift-wheel";
import { LEGAL_VERSION, WHEEL_TERMS_LEGAL_DOCUMENT } from "./seed-data/legal";
import { LEGAL_PAGES, legalPageSeo } from "./seed-data/site";

// ---------------------------------------------------------------------------------------------
// CONTENT: the gift wheel configuration. Filled in by CONTENT.

/**
 * Inserts the live `giftWheel` settings row for the client's database (enabled, the six default slices
 * of src/lib/settings/types.ts GIFT_WHEEL_DEFAULT_SLICES) only when the key has no row yet; an existing
 * row (the client's own configuration) is left as it is and reported as skipped.
 * The stored document is the complete one the seed writes too (scripts/seed-data/gift-wheel.ts
 * giftWheelLiveSettings: every field filled in by the shared schema, like a panel save). There is no
 * earlier seeded giftWheel row, so nothing is ever updated.
 */
export async function giftWheelConfig(db: ScriptDb): Promise<ContentReport> {
  const report = emptyReport();
  const live = giftWheelLiveSettings();
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "giftWheel")).limit(1);
  if (row) {
    report.skipped.push(`settings giftWheel: a row already exists, ${sameJson(row.value, live) ? SKIP_REASON.up_to_date : SKIP_REASON.edited}`);
    return report;
  }
  // A panel save between the read and the insert keeps the panel's row (the primary key is the setting).
  const inserted = await db.insert(settings).values({ key: "giftWheel", value: live }).onConflictDoNothing().returning({ key: settings.key });
  if (inserted.length === 0) {
    report.skipped.push(`settings giftWheel: a row was saved meanwhile, ${SKIP_REASON.edited}`);
    return report;
  }
  report.inserted.push(`settings giftWheel: ${describeGiftWheel(live)}; the owner reviews the slices before launch`);
  return report;
}

// ---------------------------------------------------------------------------------------------
// CONTENT: the campaign terms. Filled in by CONTENT.

/**
 * The legal document and page "Hediye Çarkı Kampanya Koşulları" (tr/en/ar draft for the lawyer), when missing:
 *   - legal document `wheel_terms` (scripts/seed-data/legal.ts WHEEL_TERMS_LEGAL_DOCUMENT, version
 *     LEGAL_VERSION, marked "taslak — avukat onayı bekliyor"; listed on /panel/yasal like the others),
 *     unless any version of that key exists (the client may have published a reviewed one);
 *   - page /sayfa/hediye-carki-kampanya-kosullari (kind legal, published, SEO title + description of
 *     scripts/seed-data/site.ts LEGAL_PAGE_DESCRIPTIONS) with one `legal_document` section, unless a page
 *     already shows the document (under any slug) or the slug is taken by another page.
 * Same shape as the seed (scripts/seed.ts) and as content-day4's membership agreement. The footer menu is
 * not touched: the wheel dialog links to the page.
 */
export async function wheelTerms(db: ScriptDb): Promise<ContentReport> {
  const report = emptyReport();
  const doc = WHEEL_TERMS_LEGAL_DOCUMENT;

  const [existingDoc] = await db
    .select({ id: legalDocuments.id, version: legalDocuments.version })
    .from(legalDocuments)
    .where(eq(legalDocuments.key, doc.key))
    .orderBy(desc(legalDocuments.isCurrent), desc(legalDocuments.id))
    .limit(1);
  if (existingDoc) {
    report.skipped.push(`legal document "${doc.key}" already exists (#${existingDoc.id}, version ${existingDoc.version}), left as is`);
  } else {
    const [row] = await db
      .insert(legalDocuments)
      .values({ key: doc.key, version: LEGAL_VERSION, title: doc.title, body: doc.body, isCurrent: true })
      .returning({ id: legalDocuments.id });
    report.inserted.push(`legal_documents #${row.id}: ${doc.key} “${doc.title.tr}” (${LEGAL_VERSION}, tr/en/ar draft awaiting the lawyer's review)`);
  }

  const page = LEGAL_PAGES.find((p) => p.key === doc.key);
  if (!page) {
    report.skipped.push(`no seeded page for "${doc.key}"`);
    return report;
  }
  const [shownOn] = await db
    .select({ id: pages.id, slug: pages.slug })
    .from(pageSections)
    .innerJoin(pages, eq(pages.id, pageSections.pageId))
    .where(and(eq(pageSections.type, "legal_document"), sql`${pageSections.content}->>'key' = ${doc.key}`))
    .orderBy(asc(pages.id))
    .limit(1);
  if (shownOn) {
    report.skipped.push(`the "${doc.key}" document is already shown on /sayfa/${shownOn.slug} (pages #${shownOn.id}), left as is`);
    return report;
  }
  const [taken] = await db.select({ id: pages.id, kind: pages.kind }).from(pages).where(eq(pages.slug, page.slug)).limit(1);
  if (taken) {
    report.skipped.push(`/sayfa/${page.slug} already exists (pages #${taken.id}, ${taken.kind}) without the "${doc.key}" document, left as is`);
    return report;
  }
  const [created] = await db
    .insert(pages)
    .values({ slug: page.slug, kind: "legal", title: doc.title, seo: legalPageSeo(page.slug, doc.title), isPublished: true })
    .returning({ id: pages.id });
  const content = sectionMeta.legal_document.schema.parse({ key: doc.key });
  const [section] = await db
    .insert(pageSections)
    .values({ pageId: created.id, type: "legal_document", position: 0, content })
    .returning({ id: pageSections.id });
  report.inserted.push(`pages #${created.id}: /sayfa/${page.slug} (legal, published, SEO title and description) with page_sections #${section.id} legal_document "${doc.key}"`);
  return report;
}

// ---------------------------------------------------------------------------------------------
// CONTENT: the launch checklist content. Filled in by CONTENT.

/** The day-6 "Yayına çıkınca" steps (src/lib/panel/seo/launch.ts launchChecklist), listed in the report. */
export const DAY6_LAUNCH_STEP_KEYS = ["media-storage", "gift-wheel-slices", "wheel-terms-review"] as const;

/**
 * Day-6 launch checklist content, if any is stored in the database (the items themselves live in code):
 * nothing is. The "Yayına çıkınca" card on /panel/seo builds its steps from src/lib/panel/seo/launch.ts
 * on every visit (Supabase storage keys + a test upload on the live site, the wheel slices, the lawyer's
 * review of the campaign terms), with their done flags read from the environment, the settings and the
 * legal documents, so a stored copy would only go stale.
 */
export async function launchChecklist(db: ScriptDb): Promise<ContentReport> {
  void db;
  return {
    ...emptyReport(),
    skipped: [`launch checklist: the “Yayına çıkınca” steps live in code (src/lib/panel/seo/launch.ts: ${DAY6_LAUNCH_STEP_KEYS.join(", ")}); nothing to store`],
  };
}

// ---------------------------------------------------------------------------------------------
// Runner

/** Every step, in run order (the terms page exists before anything links to it). */
export const STEPS: ContentStepDefinition[] = [
  { key: "wheelTerms", owner: "CONTENT", run: wheelTerms },
  { key: "giftWheelConfig", owner: "CONTENT", run: giftWheelConfig },
  { key: "launchChecklist", owner: "CONTENT", run: launchChecklist },
];

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  await runContentSteps({ title: "Day-6 content", steps: STEPS, argv });
}

// Run when executed directly (tests import the step functions without running anything).
if (/content-day6\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
