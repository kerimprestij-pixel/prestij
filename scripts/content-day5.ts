/**
 * Day-5 content (search visibility) for EXISTING databases. A fresh database gets the same content from
 * the seed definitions (scripts/seed-data/**); the client's live database gets it from this script.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/content-day5.ts [--dry-run] [--only=catalogSeo,blogPosts] [--allow-production]
 *
 * Rules (every step; same as content-day4.ts, see docs/DAY5-SEO.md §6):
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
 *
 * Owners: each area owns ONE exported function below (edit only your own function, with the Edit tool,
 * after re-reading the file; helpers you need go inside your own section or in your own seed-data file).
 *   catalogSeo   CONTENT-CATALOG   settings.seo texts, categories (names, SEO, body, faq), products (SEO,
 *                                  description sections, hand-soap warnings), /urunler page, /kurumsal,
 *                                  /numune, /iletisim SEO, page `hakkimizda`, section copy corrections,
 *                                  legal page descriptions, footer menu links, media alt texts
 *   blogPosts    CONTENT-BLOG      the published blog posts (scripts/seed-data/blog.ts)
 * Each step gets a DB test (tests/db/day5-<area>-*.test.ts): inside a rolled-back transaction, run the
 * step twice and assert that the second report has no inserted or updated lines.
 */
import { eq } from "drizzle-orm";
import { blogPosts as blogPostsTable } from "@/db/schema";
import { readingMinutes } from "@/lib/panel/blog/reading";
import {
  decideDefaultUpdate,
  emptyReport,
  runContentSteps,
  SKIP_REASON,
  type ContentReport,
  type ContentStepDefinition,
} from "./seed-data/content-helpers";
import type { ScriptDb } from "./seed-data/db";
import { runCatalogSeo } from "./seed-data/catalog-seo";
import {
  BLOG_BODY_FIXES,
  BLOG_POSTS,
  blogPostRow,
  earlierBodies,
  existingBlogPostIds,
  insertBlogPost,
  loadBlogRefs,
  type SeedBlogPost,
} from "./seed-data/blog";

// ---------------------------------------------------------------------------------------------
// CONTENT-CATALOG: catalog and site SEO content. Filled in by CONTENT-CATALOG.

/**
 * settings.seo description; SEO texts of home, /kurumsal, /numune, /iletisim; categories (el-sabunu →
 * "Sıvı El Sabunu", SEO texts, body, FAQ); products (SEO texts, sections appended to the description);
 * the home FAQ section, the /urunler copy page and /sayfa/hakkimizda (only when missing); menu links;
 * product photo alt texts; the legal pages' SEO descriptions (only where empty); copy corrections after the
 * first run (category and product texts, section texts of /kurumsal, /numune, /urunler and
 * /sayfa/hakkimizda, the hand-soap warnings), each only while the stored text is still a version the
 * script wrote earlier. The implementation and the previous seeded defaults it compares against are in
 * scripts/seed-data/catalog-seo.ts; the content is in the seed definitions.
 */
export async function catalogSeo(db: ScriptDb): Promise<ContentReport> {
  return runCatalogSeo(db);
}

// ---------------------------------------------------------------------------------------------
// CONTENT-BLOG: the blog posts. Filled in by CONTENT-BLOG.

/**
 * The seven published articles of scripts/seed-data/blog.ts (author PRESTİJ, tr/en/ar, covers from the
 * media library, related products, SEO texts). A post is inserted only while no post uses its slug. An
 * existing one is left as it is, with one exception: a post whose body was corrected after the first run
 * (BLOG_BODY_FIXES) gets the corrected body (and the reading time computed from it) while its stored body
 * is still exactly a version the script wrote earlier (earlierBodies: the version before each correction
 * round); a body the client edited is reported and left alone. A cover or
 * related product that cannot be found is left out of a new row and reported as skipped.
 */
export async function blogPosts(db: ScriptDb): Promise<ContentReport> {
  const report = emptyReport();
  const refs = await loadBlogRefs(db);
  const existing = await existingBlogPostIds(db);
  for (const post of BLOG_POSTS) {
    const id = existing.get(post.slug);
    if (id !== undefined) {
      if (BLOG_BODY_FIXES[post.slug]) await correctBlogPostBody(db, report, post, id);
      else report.skipped.push(`/blog/${post.slug}: a post with this slug already exists (#${id}), left as is`);
      continue;
    }
    const { values, missing } = blogPostRow(post, refs);
    const newId = await insertBlogPost(db, values);
    report.inserted.push(
      `blog_posts #${newId}: /blog/${post.slug} “${post.title.tr}” (published ${post.publishedAt.slice(0, 10)}, ${values.readingMinutes} dk)`,
    );
    for (const line of missing) report.skipped.push(`/blog/${post.slug}: ${line}`);
  }
  return report;
}

/** The body correction of one existing post (see blogPosts): only while the body is still the first version. */
async function correctBlogPostBody(db: ScriptDb, report: ContentReport, post: SeedBlogPost, id: number): Promise<void> {
  const where = `/blog/${post.slug} (#${id}) body`;
  const [row] = await db
    .select({ body: blogPostsTable.body, readingMinutes: blogPostsTable.readingMinutes })
    .from(blogPostsTable)
    .where(eq(blogPostsTable.id, id))
    .limit(1);
  if (!row) return;
  const decision = decideDefaultUpdate(row.body, post.body, ...earlierBodies(post));
  if (decision !== "update") {
    report.skipped.push(`${where}: ${SKIP_REASON[decision]}`);
    return;
  }
  // The stored body is one the script wrote. The panel computes the reading time from the Turkish body;
  // follow the corrected body unless the reading time was changed by hand.
  const stored = row.body as SeedBlogPost["body"];
  const minutes = row.readingMinutes === readingMinutes(stored.tr) ? readingMinutes(post.body.tr) : row.readingMinutes;
  await db.update(blogPostsTable).set({ body: post.body, readingMinutes: minutes, updatedAt: new Date() }).where(eq(blogPostsTable.id, id));
  report.updated.push(`blog_posts #${id}: /blog/${post.slug} body (corrections after review)${minutes !== row.readingMinutes ? `, reading time ${row.readingMinutes} → ${minutes} dk` : ""}`);
}

// ---------------------------------------------------------------------------------------------
// Runner

/** Every step, in run order (catalog first: blog posts link to categories and products). */
export const STEPS: ContentStepDefinition[] = [
  { key: "catalogSeo", owner: "CONTENT-CATALOG", run: catalogSeo },
  { key: "blogPosts", owner: "CONTENT-BLOG", run: blogPosts },
];

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  await runContentSteps({ title: "Day-5 content", steps: STEPS, argv });
}

// Run when executed directly (tests import the step functions without running anything).
if (/content-day5\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
