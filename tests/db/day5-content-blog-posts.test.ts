// Day 5 CONTENT-BLOG against the local PostgreSQL: the `blogPosts` step of scripts/content-day5.ts and
// the seed path (seedBlogPosts) resolve every cover and related product in the live media library and
// catalog, insert complete published posts, are idempotent, never touch a post that already uses a seed
// slug (except the recorded body corrections, applied only to a body still in its first version), and the
// panel's editor can open and save a seeded post unchanged. The insert tests delete the seeded slugs first
// (inside the rolled-back transaction): the live database already holds the posts, and without that the
// insert branch and its field checks would not run at all (day 5 FIX).
// Every write happens inside a transaction that is rolled back; the blog_posts id sequence is put back
// and the table is asserted unchanged.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day5-content-blog-posts.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { readingMinutes } from "@/lib/panel/blog/reading";
import { blogPostInput } from "@/lib/panel/blog/schema";
import { saveBlogPost } from "@/lib/panel/blog/service";
import type { Tx } from "@/lib/panel/tx";
import { blogPosts } from "../../scripts/content-day5";
import type { ScriptDb } from "../../scripts/seed-data/db";
import { BLOG_AUTHOR, BLOG_BODY_FIXES, BLOG_POSTS, firstWrittenBody, loadBlogRefs, mediaStem, seedBlogPosts } from "../../scripts/seed-data/blog";
import { undoLocalizedFixes } from "../../scripts/seed-data/content-fixes";

const B = schema.blogPosts;
const SLUGS = BLOG_POSTS.map((p) => p.slug);

class Rollback extends Error {}
async function inRollback(fn: (tx: ScriptDb) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as ScriptDb);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

type Seq = { last_value: string; is_called: boolean };
let seq: Seq;
let postsBefore: string;

const readSeq = async (): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from blog_posts_id_seq`));
  return { last_value: row.last_value, is_called: row.is_called };
};
const postsSnapshot = async () => JSON.stringify(await db.select().from(B).orderBy(B.id));
const ourRows = (tx: ScriptDb) => tx.select().from(B).where(inArray(B.slug, SLUGS)).orderBy(B.id);
/** Removes the seeded posts inside the test's transaction (rolled back with it), like a database without them. */
const withoutSeededPosts = (tx: ScriptDb) => tx.delete(B).where(inArray(B.slug, SLUGS));
const CORRECTED = BLOG_POSTS.filter((p) => BLOG_BODY_FIXES[p.slug]);

before(async () => {
  const [{ name }] = await db.execute<{ name: string }>(sql`select pg_get_serial_sequence('blog_posts', 'id') as name`);
  assert.equal(name, "public.blog_posts_id_seq");
  seq = await readSeq();
  postsBefore = await postsSnapshot();
});

after(async () => {
  try {
    // Put the sequence back unless someone else inserted rows meanwhile (other agents share the DB).
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from blog_posts`));
    if (max === null || Number(max) <= Number(seq.last_value)) {
      await db.execute(sql`select setval('blog_posts_id_seq'::regclass, ${seq.last_value}::bigint, ${seq.is_called})`);
      assert.deepEqual(await readSeq(), seq, "blog_posts id sequence restored");
    }
    assert.equal(await postsSnapshot(), postsBefore, "blog_posts unchanged");
  } finally {
    await db.$client.end();
  }
});

describe("the live references", () => {
  test("every cover is in the media library and every related product is an active, sellable product", async () => {
    const refs = await loadBlogRefs(db as unknown as ScriptDb);
    for (const post of BLOG_POSTS) {
      assert.ok(refs.media.has(post.cover), `${post.slug}: cover "${post.cover}" found`);
      for (const slug of post.related) assert.ok(refs.products.has(slug), `${post.slug}: related product "${slug}" found`);
    }
    const mediaRows = await db.select({ id: schema.media.id, storageKey: schema.media.storageKey, width: schema.media.width, height: schema.media.height }).from(schema.media).where(inArray(schema.media.id, [...refs.media.values()]));
    for (const row of mediaRows) {
      assert.ok((row.width ?? 0) >= 1000 || (row.height ?? 0) >= 1000, `${mediaStem(row.storageKey)}: large enough for a cover / share image`);
    }
  });
});

describe("content-day5 blogPosts step", () => {
  test("inserts every missing post as a complete published article", async () => {
    await inRollback(async (tx) => {
      await withoutSeededPosts(tx);
      const report = await blogPosts(tx);
      assert.deepEqual(report.updated, [], "nothing to update in a database without the posts");
      assert.equal(report.inserted.length, BLOG_POSTS.length, report.inserted.join("\n"));
      assert.deepEqual(report.skipped, [], "every cover and related product resolves");

      const rows = await ourRows(tx);
      assert.equal(rows.length, BLOG_POSTS.length);
      for (const post of BLOG_POSTS) {
        const row = rows.find((r) => r.slug === post.slug);
        assert.ok(row, post.slug);
        assert.equal(row.status, "published");
        assert.equal(row.authorName, BLOG_AUTHOR);
        assert.equal(row.publishedAt?.toISOString(), new Date(post.publishedAt).toISOString());
        assert.ok(row.publishedAt!.getTime() < Date.now(), `${post.slug} is public now`);
        assert.deepEqual(row.title, post.title);
        assert.deepEqual(row.excerpt, post.excerpt);
        assert.deepEqual(row.body, post.body);
        assert.deepEqual(row.seo, { title: post.seo.title, description: post.seo.description });
        assert.deepEqual(row.tags, post.tags);
        assert.equal(row.readingMinutes, readingMinutes(post.body.tr));

        const [cover] = await tx.select({ storageKey: schema.media.storageKey }).from(schema.media).where(eq(schema.media.id, row.coverId!));
        assert.equal(mediaStem(cover.storageKey), post.cover, `${post.slug}: cover`);
        const related = await tx
          .select({ id: schema.products.id, slug: schema.products.slug, type: schema.products.type, status: schema.products.status })
          .from(schema.products)
          .where(inArray(schema.products.id, row.relatedProductIds ?? []));
        const bySlug = new Map(related.map((r) => [r.id, r]));
        assert.deepEqual((row.relatedProductIds ?? []).map((id) => bySlug.get(id)?.slug), post.related, `${post.slug}: related products in order`);
        for (const r of related) assert.ok(r.status === "active" && r.type !== "sample", `${post.slug}: ${r.slug}`);
      }
    });
  });

  test("idempotent: a second run has nothing to do (after inserting, and on the live rows)", async () => {
    await inRollback(async (tx) => {
      await withoutSeededPosts(tx);
      assert.equal((await blogPosts(tx)).inserted.length, BLOG_POSTS.length);
      const second = await blogPosts(tx);
      assert.deepEqual([second.inserted, second.updated], [[], []]);
      assert.equal(second.skipped.length, BLOG_POSTS.length, "one line per post: already exists / already up to date");
    });
    await inRollback(async (tx) => {
      await blogPosts(tx);
      const second = await blogPosts(tx);
      assert.deepEqual([second.inserted, second.updated], [[], []]);
    });
  });

  test("body corrections: applied to a post still in its first version, never to one the client edited", async () => {
    assert.ok(CORRECTED.length > 1);
    const firstWrittenAt = new Date("2026-11-10T22:02:47Z");
    await inRollback(async (tx) => {
      await withoutSeededPosts(tx);
      await blogPosts(tx);
      // Put every corrected post back to the version content-day5.ts first wrote (as on the live database).
      for (const post of CORRECTED) {
        const first = firstWrittenBody(post);
        assert.notDeepEqual(first, post.body, `${post.slug}: the record changes something`);
        await tx.update(B).set({ body: first, readingMinutes: readingMinutes(first.tr), updatedAt: firstWrittenAt }).where(eq(B.slug, post.slug));
      }
      const edited = CORRECTED[0];
      await tx.update(B).set({ body: { ...firstWrittenBody(edited), tr: "<p>day5-test: müşterinin düzenlediği metin</p>" } }).where(eq(B.slug, edited.slug));
      const [editedRow] = await tx.select().from(B).where(eq(B.slug, edited.slug));

      const report = await blogPosts(tx);
      assert.deepEqual(report.inserted, []);
      assert.equal(report.updated.length, CORRECTED.length - 1, report.updated.join("\n"));
      assert.ok(
        report.skipped.some((line) => line.startsWith(`/blog/${edited.slug} (#`) && line.endsWith("edited in the panel, left as is")),
        report.skipped.join("\n"),
      );
      for (const post of CORRECTED.slice(1)) {
        const [row] = await tx.select().from(B).where(eq(B.slug, post.slug));
        assert.deepEqual(row.body, post.body, `${post.slug}: corrected body`);
        assert.equal(row.readingMinutes, readingMinutes(post.body.tr), `${post.slug}: reading time follows the body`);
        assert.ok(row.updatedAt.getTime() > firstWrittenAt.getTime(), `${post.slug}: updatedAt moves (sitemap lastmod, IndexNow)`);
      }
      const [after] = await tx.select().from(B).where(eq(B.slug, edited.slug));
      assert.deepEqual(after, editedRow, "the edited post is untouched");
      const again = await blogPosts(tx);
      assert.deepEqual([again.inserted, again.updated], [[], []], "a second run has nothing to do");
    });
  });

  test("a later correction round (day-5 verification): a body still in its version before that round is updated", async () => {
    const canisters = BLOG_POSTS.find((p) => p.slug === "5-litre-20-litre-sivi-sabun-rehberi")!;
    const fixes = BLOG_BODY_FIXES[canisters.slug];
    assert.ok(fixes, "post 5 has a correction record");
    const writtenAt = new Date("2026-11-10T22:02:47Z");
    await inRollback(async (tx) => {
      // The live state before the verification run: round 2 not applied yet (the other posts are current).
      const before = undoLocalizedFixes(canisters.body, fixes, 2);
      assert.notDeepEqual(before, canisters.body);
      await tx.update(B).set({ body: before, readingMinutes: readingMinutes(before.tr), updatedAt: writtenAt }).where(eq(B.slug, canisters.slug));
      const report = await blogPosts(tx);
      assert.deepEqual(report.inserted, []);
      assert.equal(report.updated.length, 1, report.updated.join("\n"));
      assert.ok(report.updated[0].includes(`/blog/${canisters.slug} body`), report.updated[0]);
      const [row] = await tx.select().from(B).where(eq(B.slug, canisters.slug));
      assert.deepEqual(row.body, canisters.body);
      assert.equal(row.readingMinutes, readingMinutes(canisters.body.tr));
      assert.ok(row.updatedAt.getTime() > writtenAt.getTime());
      for (const l of ["tr", "en", "ar"] as const) assert.doesNotMatch(row.body[l]!, /Üretim tarihi|production date|تاريخ الإنتاج/);
      const again = await blogPosts(tx);
      assert.deepEqual([again.inserted, again.updated], [[], []], "a second run has nothing to do");
    });
  });

  test("a post that already uses a seed slug (edited by the client, or a draft) is left exactly as it is", async () => {
    await inRollback(async (tx) => {
      await blogPosts(tx);
      const slug = BLOG_POSTS[0].slug;
      await tx.update(B).set({ title: { tr: "day5-test düzenlenmiş başlık" }, status: "draft", body: { tr: "<p>day5-test</p>" } }).where(eq(B.slug, slug));
      const [edited] = await tx.select().from(B).where(eq(B.slug, slug));
      const report = await blogPosts(tx);
      assert.deepEqual([report.inserted, report.updated], [[], []]);
      assert.ok(report.skipped.some((line) => line.startsWith(`/blog/${slug}`)), report.skipped.join("\n"));
      const [after] = await tx.select().from(B).where(eq(B.slug, slug));
      assert.deepEqual(after, edited, "untouched");
    });
  });

  test("the panel's editor opens and saves a seeded post without changing it", async () => {
    await inRollback(async (tx) => {
      await blogPosts(tx);
      for (const post of BLOG_POSTS) {
        const [row] = await tx.select().from(B).where(eq(B.slug, post.slug));
        const input = blogPostInput.parse({
          id: row.id,
          updatedAt: row.updatedAt.toISOString(),
          title: row.title,
          slug: row.slug,
          excerpt: row.excerpt,
          body: row.body,
          coverId: row.coverId,
          authorName: row.authorName,
          tags: row.tags ?? [],
          relatedProductIds: row.relatedProductIds ?? [],
          status: row.status,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          seo: { title: row.seo?.title ?? null, description: row.seo?.description ?? null, ogImageId: null, noIndex: false },
        });
        const saved = await saveBlogPost(tx as unknown as Tx, input);
        assert.equal(saved.created, false);
        const [back] = await tx.select().from(B).where(eq(B.id, row.id));
        for (const key of ["title", "excerpt", "body", "coverId", "authorName", "tags", "relatedProductIds", "status", "seo", "readingMinutes"] as const) {
          assert.deepEqual(back[key], row[key], `${post.slug}: ${key} unchanged after a panel save`);
        }
        assert.equal(back.publishedAt?.toISOString(), row.publishedAt?.toISOString());
      }
    });
  });
});

describe("seed path (fresh database)", () => {
  test("seedBlogPosts inserts every post and refuses unknown references", async () => {
    await inRollback(async (tx) => {
      await tx.delete(B).where(inArray(B.slug, SLUGS)); // rolled back with the rest
      const refs = await loadBlogRefs(tx);
      assert.equal(await seedBlogPosts(tx, refs), BLOG_POSTS.length);
      const rows = await ourRows(tx);
      assert.deepEqual(rows.map((r) => r.slug), SLUGS, "inserted in chronological order (ids follow the dates)");
      assert.ok(rows.every((r) => r.coverId !== null && (r.relatedProductIds?.length ?? 0) > 0));

      await tx.delete(B).where(inArray(B.slug, SLUGS));
      await assert.rejects(seedBlogPosts(tx, { media: new Map(), products: refs.products }), /Blog seed references unknown ids/);
      assert.equal((await ourRows(tx)).length, 0, "nothing inserted when a reference is missing");
    });
  });
});
