// Day 5 SEO-TECH against the local PostgreSQL:
//   - querySitemapData (the query behind the cached sitemap) returns the indexable records with product
//     images (gallery order, at most five) and blog covers; noindex, draft and future posts stay out;
//   - the `seo.indexnow` job is registered (daily), skips itself outside production, and with an injected
//     fetch submits exactly the sitemap's URLs (no network).
// The only writes are blog posts inside a transaction that is rolled back; the id sequence is put back
// and the table is compared before/after.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day5-seotech-crawl.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getJob } from "@/lib/cron/registry";
import { loadJobs } from "@/lib/cron/run";
import { querySitemapData } from "@/lib/data/sitemap";
import type { Tx } from "@/lib/panel/tx";
import { INDEXNOW_JOB_KEY, runIndexNow } from "@/lib/seo/indexnow";
import { indexNowDeps, seoIndexNowJob } from "@/lib/seo/jobs";
import { buildSitemap, SITEMAP_PRODUCT_IMAGES } from "@/lib/seo/sitemap-entries";

const ORIGIN = "https://prestij.example";
const B = schema.blogPosts;

class Rollback extends Error {}
async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

type Seq = { last_value: string; is_called: boolean };
const readSeq = async (): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from blog_posts_id_seq`));
  return { last_value: row.last_value, is_called: row.is_called };
};
const postsSnapshot = async () => JSON.stringify(await db.select().from(B).orderBy(B.id));
const jobRunsSnapshot = async () => JSON.stringify(await db.select().from(schema.jobRuns).orderBy(schema.jobRuns.job));

let savedOrigin: string | undefined;
let postSeq: Seq;
let postsBefore: string;
let jobRunsBefore: string;

before(async () => {
  savedOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  postSeq = await readSeq();
  postsBefore = await postsSnapshot();
  jobRunsBefore = await jobRunsSnapshot();
});

after(async () => {
  try {
    if (savedOrigin === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = savedOrigin;
    await db.delete(B).where(sql`${B.slug} like 'day5-test-seotech-%'`); // never committed; defensive
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from blog_posts`));
    if (max === null || Number(max) <= Number(postSeq.last_value)) {
      await db.execute(sql`select setval('blog_posts_id_seq'::regclass, ${postSeq.last_value}::bigint, ${postSeq.is_called})`);
    }
    assert.deepEqual(await readSeq(), postSeq, "blog_posts id sequence restored");
    assert.equal(await postsSnapshot(), postsBefore, "blog_posts unchanged");
    assert.equal(await jobRunsSnapshot(), jobRunsBefore, "job_runs unchanged (the job was never run through runJob)");
  } finally {
    await db.$client.end();
  }
});

describe("querySitemapData", () => {
  test("products: every active standard/bundle product without noIndex, with ≤ 5 of its own images in gallery order", async () => {
    const data = await querySitemapData();
    const p = schema.products;
    const rows = await db
      .select({ id: p.id, slug: p.slug, seo: p.seo })
      .from(p)
      .where(and(eq(p.status, "active"), inArray(p.type, ["standard", "bundle"]), eq(p.businessOnly, false)))
      .orderBy(asc(p.position), asc(p.id));
    const expected = rows.filter((r) => !r.seo?.noIndex);
    assert.deepEqual(data.products.map((x) => x.slug), expected.map((r) => r.slug));
    assert.ok(data.products.length > 0, "the live catalog has products");
    for (const [i, item] of data.products.entries()) {
      const pm = schema.productMedia;
      const gallery = await db
        .select({ url: schema.media.url })
        .from(pm)
        .innerJoin(schema.media, eq(schema.media.id, pm.mediaId))
        .where(eq(pm.productId, expected[i].id))
        .orderBy(asc(pm.position), asc(pm.id));
      const images = item.images ?? [];
      assert.ok(images.length <= SITEMAP_PRODUCT_IMAGES, item.slug);
      assert.equal(new Set(images).size, images.length, `${item.slug}: no duplicate images`);
      const galleryUrls = [...new Set(gallery.map((g) => g.url))];
      assert.deepEqual(images.slice(0, Math.min(galleryUrls.length, SITEMAP_PRODUCT_IMAGES)), galleryUrls.slice(0, SITEMAP_PRODUCT_IMAGES), `${item.slug}: gallery order first`);
      assert.ok(!Number.isNaN(Date.parse(item.updatedAt)));
    }
    // Samples are never listed.
    assert.equal(data.products.some((x) => x.slug.endsWith("-numune")), false);
  });

  test("posts: public, indexable posts with their cover; drafts, future and noindex posts stay out", async () => {
    const [cover] = await db.select({ id: schema.media.id, url: schema.media.url }).from(schema.media).orderBy(asc(schema.media.id)).limit(1);
    assert.ok(cover, "the media library has rows");
    await inRollback(async (tx) => {
      const day = 24 * 60 * 60 * 1000;
      const base = { title: { tr: "Test" }, body: { tr: "<p>x</p>" }, tags: [] as string[], relatedProductIds: [] as number[] };
      await tx.insert(B).values([
        { ...base, slug: "day5-test-seotech-public", status: "published", publishedAt: new Date(Date.now() - day), coverId: cover.id },
        { ...base, slug: "day5-test-seotech-nocover", status: "published", publishedAt: new Date(Date.now() - 2 * day) },
        { ...base, slug: "day5-test-seotech-draft", status: "draft", publishedAt: new Date(Date.now() - day) },
        { ...base, slug: "day5-test-seotech-future", status: "published", publishedAt: new Date(Date.now() + day) },
        { ...base, slug: "day5-test-seotech-noindex", status: "published", publishedAt: new Date(Date.now() - day), seo: { noIndex: true } },
      ]);
      const data = await querySitemapData(tx);
      const mine = data.posts.filter((x) => x.slug.startsWith("day5-test-seotech-"));
      assert.deepEqual(
        mine.map((x) => [x.slug, x.images ?? null]),
        [
          ["day5-test-seotech-public", [cover.url]],
          ["day5-test-seotech-nocover", null],
        ],
      );
      // And the sitemap lists them, the blog index included, with the cover as an image entry.
      const map = buildSitemap(data, ["tr", "en", "ar"]);
      const entry = map.find((e) => e.url === `${ORIGIN}/en/blog/day5-test-seotech-public`);
      assert.ok(entry);
      assert.equal(entry.images?.length, 1);
      assert.ok(map.some((e) => e.url === `${ORIGIN}/tr/blog`));
      assert.equal(map.some((e) => e.url.includes("day5-test-seotech-draft") || e.url.includes("future") || e.url.includes("noindex")), false);
    });
  });
});

describe("querySitemapData (day 5 FIX)", () => {
  test("a business-only product is left out (its page is noindex, like the feed leaves it out)", async () => {
    const p = schema.products;
    const before = await querySitemapData();
    const slug = before.products[0]?.slug;
    assert.ok(slug, "the live catalog has products");
    await inRollback(async (tx) => {
      await tx.update(p).set({ businessOnly: true }).where(eq(p.slug, slug));
      const data = await querySitemapData(tx);
      assert.equal(data.products.some((x) => x.slug === slug), false);
      assert.equal(data.products.length, before.products.length - 1);
    });
  });

  test("home and urunler page rows: their last change (and the urunler noindex switch) reach the sitemap data", async () => {
    const pages = schema.pages;
    const data = await querySitemapData();
    const [home] = await db.select({ updatedAt: pages.updatedAt }).from(pages).where(and(eq(pages.slug, "home"), eq(pages.isPublished, true)));
    const [urunler] = await db.select({ updatedAt: pages.updatedAt, seo: pages.seo }).from(pages).where(and(eq(pages.slug, "urunler"), eq(pages.isPublished, true)));
    assert.equal(data.homeUpdatedAt, home?.updatedAt.toISOString());
    assert.deepEqual(data.productsPage, urunler ? { updatedAt: urunler.updatedAt.toISOString(), noIndex: urunler.seo?.noIndex === true } : undefined);
    assert.equal(data.pages.some((x) => x.slug === "home" || x.slug === "urunler"), false, "neither is a /sayfa page");
    if (urunler) {
      await inRollback(async (tx) => {
        await tx.update(pages).set({ seo: { ...(urunler.seo ?? {}), noIndex: true } }).where(eq(pages.slug, "urunler"));
        const hidden = await querySitemapData(tx);
        assert.equal(hidden.productsPage?.noIndex, true);
        assert.equal(buildSitemap(hidden, ["tr", "en", "ar"]).some((e) => e.url === `${ORIGIN}/tr/urunler`), false);
      });
    }
  });

  test("a scheduled post saved before it went live: lastmod is the publish date, not the older save time", async () => {
    await inRollback(async (tx) => {
      const day = 24 * 60 * 60 * 1000;
      const savedAt = new Date(Date.now() - 10 * day);
      const liveAt = new Date(Date.now() - day);
      await tx.insert(B).values({
        slug: "day5-test-seotech-scheduled",
        title: { tr: "Test" },
        body: { tr: "<p>x</p>" },
        tags: [],
        relatedProductIds: [],
        status: "published",
        publishedAt: liveAt,
        createdAt: savedAt,
        updatedAt: savedAt,
      });
      const data = await querySitemapData(tx);
      const item = data.posts.find((x) => x.slug === "day5-test-seotech-scheduled");
      assert.equal(item?.updatedAt, liveAt.toISOString());
    });
  });
});

describe("seo.indexnow job", () => {
  test("registered in the daily group through src/lib/cron/jobs.ts", async () => {
    await loadJobs();
    const job = getJob(INDEXNOW_JOB_KEY);
    assert.ok(job);
    assert.equal(job.group, "daily");
    assert.equal(job, seoIndexNowJob);
  });

  test("outside production it does nothing (no data read, no network)", async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "tests never run with NODE_ENV=production");
    assert.deepEqual(await seoIndexNowJob.run(), { skipped: 1, notProduction: 1 });
  });

  test("with production settings and an injected fetch it submits exactly the sitemap's URLs", async () => {
    const posted: { url: string; body: { host: string; key: string; keyLocation: string; urlList: string[] } }[] = [];
    const deps = indexNowDeps({
      env: { NODE_ENV: "production", INDEXNOW_KEY: "seotech-test-key-0001" },
      origin: ORIGIN,
      fetch: async (url, init) => {
        posted.push({ url, body: JSON.parse(init.body) });
        return { status: 202 };
      },
      loadLastRun: async () => null,
    });
    const entries = await deps.loadEntries();
    const result = await runIndexNow(deps);
    assert.equal(result.submitted, entries.length);
    assert.equal(result.requests, 1);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].url, "https://api.indexnow.org/indexnow");
    assert.equal(posted[0].body.host, "prestij.example");
    assert.equal(posted[0].body.keyLocation, `${ORIGIN}/indexnow-key.txt`);
    assert.deepEqual(posted[0].body.urlList, entries.map((e) => e.url));
    assert.ok(posted[0].body.urlList.includes(`${ORIGIN}/tr/urunler/lavanta`));
  });

  test("the real last-run reader returns the stored row (or null) without writing", async () => {
    const last = await indexNowDeps().loadLastRun();
    const [row] = await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, INDEXNOW_JOB_KEY));
    assert.deepEqual(last, row ? { status: row.lastStatus ?? null, result: row.lastResult ?? null } : null);
  });
});
