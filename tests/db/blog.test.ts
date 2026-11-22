// Blog + media delete guard against the local PostgreSQL (BLOG-MEDIA, day 3): create/save through
// executePanelAction with a fake editor, slug uniqueness, optimistic locking, publish/schedule,
// redirects on slug changes, storefront visibility of scheduled posts, link check before delete, and
// "an image used as a blog cover / share image cannot be deleted". Everything it creates (posts,
// media + files in a temp dir, a temp page, redirects, audit rows) is removed; counts are checked.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/blog.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { db, schema } from "@/db";
import { nextScheduledAt, selectPublicPost, selectPublicPosts } from "@/lib/data/blog";
import { LocalStorage } from "@/lib/media/storage";
import { executePanelAction } from "@/lib/panel/action-core";
import { listPanelPosts } from "@/lib/panel/blog/queries";
import { blogPostInput } from "@/lib/panel/blog/schema";
import { deleteBlogPost, findPostLinks, saveBlogPost } from "@/lib/panel/blog/service";
import { PanelError } from "@/lib/panel/errors";
import { mediaUsage } from "@/lib/panel/media/queries";
import { deleteMediaRow, uploadMediaFiles } from "@/lib/panel/media/service";
import type { StaffSession } from "@/lib/session";

const ACTOR_ID = "blogmedia-test-actor";
const ACTOR = {
  user: { id: ACTOR_ID, name: "Blog Media Test", email: "blogmedia@test.local", role: "editor", banned: false },
  session: { id: "blogmedia-test-session" },
  staffRole: "editor",
} as unknown as StaffSession;
const S = "blogmedia-dbtest-"; // slugs owned by this file
const FOLDER = "blogmedia-dbtest";

const COUNT_TABLES = ["blog_posts", "media", "redirects", "audit_log", "pages", "page_sections"] as const;
let counts: Record<string, number>;
let tmpDir: string;
let storage: LocalStorage;

async function countRows(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of COUNT_TABLES) {
    const rows = await db.execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${t}`));
    out[t] = Number(rows[0].n);
  }
  return out;
}

async function cleanup() {
  await db.delete(schema.blogPosts).where(like(schema.blogPosts.slug, `${S}%`));
  await db.delete(schema.redirects).where(or(like(schema.redirects.fromPath, `/blog/${S}%`), like(schema.redirects.toPath, `/blog/${S}%`)));
  await db.delete(schema.pages).where(like(schema.pages.slug, `${S}%`)); // sections cascade
  const leftovers = await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.folder, FOLDER));
  if (leftovers.length) await db.delete(schema.media).where(inArray(schema.media.id, leftovers.map((r) => r.id)));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
}

type SeqState = { table: string; name: string; lastValue: string; isCalled: boolean };
let sequences: SeqState[] = [];

async function readSequences(): Promise<SeqState[]> {
  const out: SeqState[] = [];
  for (const table of COUNT_TABLES) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    out.push({ table, name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
  return out;
}

/** Puts the id sequences back unless someone else inserted rows meanwhile (other agents share the DB). */
async function restoreSequences() {
  for (const s of sequences) {
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${s.table}`));
    if (max === null || Number(max) <= Number(s.lastValue)) {
      await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
  }
}

const saveSpec = {
  schema: blogPostInput,
  run: async (input: z.output<typeof blogPostInput>, { tx }: { tx: Parameters<typeof saveBlogPost>[0] }) => {
    const r = await saveBlogPost(tx, input);
    return { data: { ...r.post, updatedAt: r.post.updatedAt.toISOString(), publishedAt: r.post.publishedAt?.toISOString() ?? null }, tags: r.tags, audit: r.audit };
  },
};
const save = (value: Record<string, unknown>) => executePanelAction(saveSpec, ACTOR, value);
const words = (n: number) => Array.from({ length: n }, (_, i) => `kelime${i}`).join(" ");
const post = (slug: string, extra: Record<string, unknown> = {}) => ({
  id: null,
  updatedAt: null,
  title: { tr: `Test yazısı ${slug}` },
  slug: `${S}${slug}`,
  status: "draft",
  ...extra,
});

async function row(slug: string) {
  const [r] = await db.select().from(schema.blogPosts).where(eq(schema.blogPosts.slug, `${S}${slug}`));
  return r;
}

before(async () => {
  await cleanup();
  counts = await countRows();
  sequences = await readSequences();
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "prestij-blogmedia-"));
  storage = new LocalStorage(tmpDir, "/uploads");
});

after(async () => {
  await cleanup();
  await restoreSequences();
  rmSync(tmpDir, { recursive: true, force: true });
  try {
    assert.deepEqual(await countRows(), counts, "row counts are back to the start");
  } finally {
    await db.$client.end();
  }
});

describe("saving posts", () => {
  test("creates a draft: sanitized body, reading minutes from TR, normalized tags, tags + audit", async () => {
    const { result, tags } = await save(
      post("a", {
        body: { tr: `<h2>Ara başlık</h2><p>${words(450)}</p><script>alert(1)</script>`, en: "<p>Short English</p>" },
        excerpt: { tr: "Kısa özet" },
        tags: [" Bakım ", "bakım", "Koku"],
        authorName: "  Editör  ",
      }),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    const r = await row("a");
    assert.equal(r.status, "draft");
    assert.equal(r.publishedAt, null);
    assert.equal(r.readingMinutes, 2);
    assert.ok(!r.body?.tr.includes("script"));
    assert.deepEqual(r.tags, ["Bakım", "Koku"]);
    assert.equal(r.authorName, "Editör");
    assert.deepEqual(tags.sort(), ["blog", `post:${S}a`].sort());
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
    assert.ok(audits.some((a) => a.action === "create" && a.entity === "blog_post" && a.entityId === String(r.id)));
  });

  test("slug must be unique (field error next to the slug)", async () => {
    const { result } = await save(post("a"));
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, "invalid");
    assert.match((!result.ok && result.fieldErrors?.slug) || "", /başka bir yazıda/);
  });

  test("publishing needs a Turkish body; unknown cover / products are refused next to the field", async () => {
    const noBody = await save(post("b", { status: "published" }));
    assert.equal(!noBody.result.ok && noBody.result.fieldErrors?.["body.tr"], "Yayınlamak için Türkçe metni yazın.");
    const badCover = await save(post("b", { coverId: 2_147_480_000 }));
    assert.ok(!badCover.result.ok && badCover.result.fieldErrors?.coverId);
    const badProduct = await save(post("b", { relatedProductIds: [2_147_480_000] }));
    assert.ok(!badProduct.result.ok && badProduct.result.fieldErrors?.relatedProductIds);
    assert.equal(await row("b"), undefined, "nothing was stored");
  });

  test("a stale updatedAt is a conflict", async () => {
    const r = await row("a");
    const { result } = await save({ ...post("a"), id: r.id, updatedAt: new Date(r.updatedAt.getTime() - 60_000).toISOString() });
    assert.equal(!result.ok && result.code, "conflict");
  });

  test("publishing without a date stamps now; a public slug change redirects, a draft's does not", async () => {
    const a = await row("a");
    const before = Date.now();
    const published = await save({ ...post("a", { body: { tr: "<p>Merhaba dünya</p>" } }), id: a.id, updatedAt: a.updatedAt.toISOString(), status: "published" });
    assert.equal(published.result.ok, true, JSON.stringify(published.result));
    const pubRow = await row("a");
    assert.ok(pubRow.publishedAt && pubRow.publishedAt.getTime() >= before - 1000 && pubRow.publishedAt.getTime() <= Date.now() + 1000);
    assert.equal(pubRow.readingMinutes, 1);
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
    assert.ok(audits.some((x) => x.action === "publish" && x.entityId === String(a.id)));

    const moved = await save({
      ...post("a2", { body: { tr: "<p>Merhaba dünya</p>" } }),
      title: pubRow.title,
      id: a.id,
      updatedAt: pubRow.updatedAt.toISOString(),
      status: "published",
      publishedAt: pubRow.publishedAt!.toISOString(),
    });
    assert.equal(moved.result.ok, true, JSON.stringify(moved.result));
    assert.ok(moved.tags.includes("redirects") && moved.tags.includes(`post:${S}a`) && moved.tags.includes(`post:${S}a2`));
    const [redirect] = await db.select().from(schema.redirects).where(eq(schema.redirects.fromPath, `/blog/${S}a`));
    assert.equal(redirect?.toPath, `/blog/${S}a2`);

    const draft = await save(post("c"));
    assert.equal(draft.result.ok, true);
    const c = await row("c");
    const renamed = await save({ ...post("c2"), id: c.id, updatedAt: c.updatedAt.toISOString() });
    assert.equal(renamed.result.ok, true);
    assert.ok(!renamed.tags.includes("redirects"));
    const none = await db.select().from(schema.redirects).where(eq(schema.redirects.fromPath, `/blog/${S}c`));
    assert.equal(none.length, 0);
  });
});

describe("storefront visibility", () => {
  test("a scheduled post is hidden until its time, then appears; drafts never", async () => {
    const now = new Date();
    const at = new Date(now.getTime() + 3600_000);
    const created = await save(post("sched", { status: "published", body: { tr: "<p>Planlı yazı</p>" }, publishedAt: at.toISOString() }));
    assert.equal(created.result.ok, true, JSON.stringify(created.result));

    const mine = (list: { slug: string }[]) => list.map((p) => p.slug).filter((s) => s.startsWith(S)).sort();
    assert.deepEqual(mine(await selectPublicPosts(now)), [`${S}a2`], "only the published post; draft c2 and the scheduled one are hidden");
    const hidden = await selectPublicPost(`${S}sched`, now);
    assert.equal(hidden.post, null);
    assert.equal(hidden.scheduledAt?.toISOString(), at.toISOString());
    const next = await nextScheduledAt(now);
    assert.ok(next && next.getTime() <= at.getTime());

    const later = new Date(at.getTime() + 1000);
    assert.deepEqual(mine(await selectPublicPosts(later)), [`${S}a2`, `${S}sched`]);
    const shown = await selectPublicPost(`${S}sched`, later);
    assert.equal(shown.post?.slug, `${S}sched`);
    assert.equal((await selectPublicPost(`${S}c2`, later)).post, null, "drafts are never public");

    // Panel list: counts per tab and the scheduled filter (search by the test slug prefix).
    const list = await listPanelPosts({ q: S });
    assert.deepEqual(list.counts, { all: 3, published: 1, scheduled: 1, draft: 1 });
    const scheduled = await listPanelPosts({ q: S, filter: "scheduled" });
    assert.deepEqual(scheduled.rows.map((r) => r.slug), [`${S}sched`]);
    assert.equal(scheduled.rows[0].status, "published");
  });
});

describe("deleting posts", () => {
  test("refused while a page section links to the post; then deleted with its redirects", async () => {
    const [page] = await db
      .insert(schema.pages)
      .values({ slug: `${S}page`, kind: "custom", title: { tr: "Blog test sayfası" }, isPublished: false })
      .returning({ id: schema.pages.id });
    const [section] = await db
      .insert(schema.pageSections)
      .values({ pageId: page.id, type: "rich_text", content: { html: { tr: `<p><a href="/blog/${S}a2?x=1">Yazı</a></p>` } } })
      .returning({ id: schema.pageSections.id });

    const a2 = await row("a2");
    const links = await findPostLinks(db, `${S}a2`);
    assert.equal(links.length, 1);
    assert.equal(links[0].href, `/panel/sayfalar/${page.id}`);
    assert.deepEqual(await findPostLinks(db, `${S}a`), [], "a slug prefix is not a link to another post");

    await assert.rejects(
      db.transaction((tx) => deleteBlogPost(tx, { id: a2.id, updatedAt: a2.updatedAt })),
      (e: unknown) => e instanceof PanelError && e.code === "in_use" && /Blog test sayfası/.test(e.message),
    );

    await db.delete(schema.pageSections).where(eq(schema.pageSections.id, section.id));
    const { tags } = await db.transaction((tx) => deleteBlogPost(tx, { id: a2.id, updatedAt: a2.updatedAt }));
    assert.ok(tags.includes("blog") && tags.includes(`post:${S}a2`) && tags.includes("redirects"));
    assert.equal(await row("a2"), undefined);
    const left = await db.select().from(schema.redirects).where(or(eq(schema.redirects.toPath, `/blog/${S}a2`), eq(schema.redirects.fromPath, `/blog/${S}a`)));
    assert.equal(left.length, 0, "old links to a deleted post 404 instead of redirecting");
    await assert.rejects(db.transaction((tx) => deleteBlogPost(tx, { id: a2.id, updatedAt: a2.updatedAt })), (e: unknown) => e instanceof PanelError && e.code === "not_found");
  });
});

describe("media delete guard", () => {
  test("an image used as a blog cover or share image cannot be deleted; once unused it goes with its files", async () => {
    const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#C2ADD1" } }).jpeg().toBuffer();
    const png = await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#329BC0" } }).png().toBuffer();
    const [cover, share] = await uploadMediaFiles(
      [
        { name: "blog-kapak.jpg", data: jpeg },
        { name: "blog-paylasim.png", data: png },
      ],
      { folder: FOLDER, actorId: ACTOR_ID, storage },
    );
    assert.ok(readdirSync(tmpDir, { recursive: true }).length > 0, "files were written");

    const created = await save(post("cover", { coverId: cover.id, seo: { ogImageId: share.id } }));
    assert.equal(created.result.ok, true, JSON.stringify(created.result));
    const p = await row("cover");

    const coverUsage = await mediaUsage(cover.id);
    assert.deepEqual(coverUsage.map((u) => [u.kind, u.detail, u.href]), [["blog", "Kapak görseli", `/panel/blog/${p.id}`]]);
    await assert.rejects(
      db.transaction((tx) => deleteMediaRow(tx, cover.id, { storage })),
      (e: unknown) => e instanceof PanelError && e.code === "in_use" && /Kapak görseli/.test(e.message),
    );
    const viaAction = await executePanelAction(
      { schema: z.object({ id: z.number() }), run: async (input, { tx }) => { await deleteMediaRow(tx, input.id, { storage }); return {}; } },
      ACTOR,
      { id: share.id },
    );
    assert.equal(!viaAction.result.ok && viaAction.result.code, "in_use");
    assert.match(!viaAction.result.ok ? viaAction.result.error : "", /SEO paylaşım görseli/);

    // Free both images, then delete them: rows and every file variant are gone.
    const freed = await save({ ...post("cover"), id: p.id, updatedAt: p.updatedAt.toISOString(), coverId: null, seo: { ogImageId: null } });
    assert.equal(freed.result.ok, true, JSON.stringify(freed.result));
    for (const media of [cover, share]) {
      const { removeFiles } = await db.transaction((tx) => deleteMediaRow(tx, media.id, { storage }));
      await removeFiles();
      const [left] = await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.id, media.id));
      assert.equal(left, undefined);
    }
    const files = readdirSync(tmpDir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
    assert.deepEqual(files.map((f) => f.name), [], "all variants removed from storage");
    assert.ok(!existsSync(path.join(tmpDir, cover.url.replace(/^\/uploads\//, ""))));
  });
});
