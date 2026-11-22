// Day 5 CONTENT-CATALOG: the catalogSeo step of scripts/content-day5.ts against the local PostgreSQL.
// Each test first puts the touched rows back to the pre-day-5 seeded state inside its transaction (so it
// works before and after the real run), then checks: everything is written as seeded and a second run has
// nothing to do; client edits are never overwritten; empty values count as never set. The copy corrections
// are checked from the first version (FIX, round 1) and from the version before round 2 (the day-5
// verification: legal page descriptions, section texts, hand-soap warnings, category copy), and the hero
// sublines from the version before round 3 (the second review, FIX2). Every write
// happens inside a transaction that is rolled back; the pages / page_sections id sequences are put back.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day5-content-catalog-step.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { sectionMeta, type SectionType } from "@/components/sections/schemas";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import { queryCategories } from "@/lib/data/catalog";
import type { Tx } from "@/lib/panel/tx";
import { seoSettings } from "@/lib/settings/types";
import { catalogSeo, STEPS } from "../../scripts/content-day5";
import { CATEGORY_COPY, CATEGORY_COPY_FIXES, PRODUCT_SEO, PRODUCT_SEO_FIXES } from "../../scripts/seed-data/catalog-copy";
import { CATALOG_SEO_PREVIOUS, stemOf } from "../../scripts/seed-data/catalog-seo";
import { undoLocalizedFixes } from "../../scripts/seed-data/content-fixes";
import { getAt, setAt } from "../../scripts/seed-data/content-helpers";
import { HOME_FAQ_SECTION, homePageMeta } from "../../scripts/seed-data/home-page";
import { MEDIA_ALT } from "../../scripts/seed-data/media-alt";
import { BUNDLE, HAND_SOAP_WARNINGS_FIXES, SCENTS } from "../../scripts/seed-data/products";
import { LEGAL_PAGE_DESCRIPTIONS, LEGAL_PAGES, MENUS, SEO_SETTINGS_TEXT } from "../../scripts/seed-data/site";
import { ABOUT_STORY_BODY_FIXES, SECTION_COPY_FIXES, SITE_PAGES } from "../../scripts/seed-data/site-pages";

const { settings, pages, pageSections, categories, products, menus, media } = schema;
const run = (tx: Tx) => catalogSeo(tx as never);

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

// ---------------------------------------------------------------------------------------------
// Sequences and snapshots (nothing may change outside the rolled-back transactions)

const SEQUENCES = ["pages_id_seq", "page_sections_id_seq"] as const;
type Seq = { last_value: string; is_called: boolean };
const seqBefore = new Map<string, Seq>();
let snapshotBefore = "";

const readSeq = async (name: string): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from ${name}`));
  return { last_value: row.last_value, is_called: row.is_called };
};

async function snapshot(): Promise<string> {
  const rows = await Promise.all([
    db.select().from(settings).where(eq(settings.key, "seo")),
    db.select().from(pages).orderBy(pages.id),
    db.select().from(pageSections).orderBy(pageSections.id),
    db.select().from(categories).orderBy(categories.id),
    db.select({ id: products.id, description: products.description, seo: products.seo, updatedAt: products.updatedAt }).from(products).orderBy(products.id),
    db.select().from(menus).orderBy(menus.id),
    db.select({ id: media.id, alt: media.alt, updatedAt: media.updatedAt }).from(media).orderBy(media.id),
  ]);
  return JSON.stringify(rows);
}

before(async () => {
  for (const name of SEQUENCES) seqBefore.set(name, await readSeq(name));
  snapshotBefore = await snapshot();
});

after(async () => {
  try {
    for (const [name, seq] of seqBefore) {
      const table = name.replace(/_id_seq$/, "");
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${table}`));
      if (max === null || Number(max) <= Number(seq.last_value)) {
        await db.execute(sql`select setval(${name}::regclass, ${seq.last_value}::bigint, ${seq.is_called})`);
      }
      assert.deepEqual(await readSeq(name), seq, `${name} restored`);
    }
    assert.equal(await snapshot(), snapshotBefore, "every touched table is unchanged");
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------
// The pre-day-5 state, rebuilt inside a transaction

const seedPage = (slug: string) => SITE_PAGES.find((p) => p.slug === slug)!;
const productSeeds = [...SCENTS, BUNDLE];

async function resetToPreviousDefaults(tx: Tx) {
  const p = CATALOG_SEO_PREVIOUS;
  const [seoRow] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, "seo"));
  assert.ok(seoRow, "the live database has a settings.seo row");
  await tx.update(settings).set({ value: { ...(seoRow.value as object), defaultTitle: p.siteTitle, description: p.siteDescription } }).where(eq(settings.key, "seo"));

  await tx.update(pages).set({ seo: p.homeSeo[0] }).where(eq(pages.slug, "home"));
  for (const slug of ["kurumsal", "numune", "iletisim"] as const) await tx.update(pages).set({ seo: p.pageSeo[slug] }).where(eq(pages.slug, slug));
  await tx.delete(pages).where(inArray(pages.slug, ["urunler", "hakkimizda"]));
  const [home] = await tx.select({ id: pages.id }).from(pages).where(eq(pages.slug, "home"));
  await tx.delete(pageSections).where(and(eq(pageSections.pageId, home.id), eq(pageSections.type, "faq")));

  for (const slug of Object.keys(CATEGORY_COPY) as (keyof typeof CATEGORY_COPY)[]) {
    await tx.update(categories).set({ name: p.categoryNames[slug], seo: null, body: null, faq: [] }).where(eq(categories.slug, slug));
  }
  for (const product of productSeeds) {
    await tx.update(products).set({ description: product.story, seo: p.productSeo(product) }).where(eq(products.slug, product.slug));
  }
  for (const key of ["header", "footer_shop", "footer_corporate"] as const) {
    await tx.update(menus).set({ items: p.menus[key][0] }).where(eq(menus.key, key));
  }
  const photos = await tx.select({ id: media.id, storageKey: media.storageKey }).from(media).where(like(media.storageKey, "urunler/%"));
  for (const photo of photos) {
    const stem = stemOf(photo.storageKey);
    if (stem && p.mediaAlt[stem]) await tx.update(media).set({ alt: p.mediaAlt[stem] }).where(eq(media.id, photo.id));
  }
}

const pageBySlug = async (tx: Tx, slug: string) => (await tx.select().from(pages).where(eq(pages.slug, slug)))[0];
const sectionsOf = async (tx: Tx, pageId: number) =>
  tx.select().from(pageSections).where(eq(pageSections.pageId, pageId)).orderBy(asc(pageSections.position), asc(pageSections.id));

// ---------------------------------------------------------------------------------------------

describe("catalogSeo on a pre-day-5 database", () => {
  test("is registered as the CONTENT-CATALOG step", () => {
    assert.deepEqual(STEPS.find((s) => s.key === "catalogSeo")?.owner, "CONTENT-CATALOG");
  });

  test("writes everything the seed definitions hold, then a second run has nothing to do", async () => {
    await inRollback(async (tx) => {
      await resetToPreviousDefaults(tx);
      const first = await run(tx);

      assert.equal(first.inserted.length, 3, first.inserted.join("\n"));
      assert.ok(first.inserted.some((l) => l.includes("faq on the home page")));
      assert.ok(first.inserted.some((l) => l.includes("/urunler copy page") && l.includes("rich_text, faq")));
      assert.ok(first.inserted.some((l) => l.includes("/sayfa/hakkimizda") && l.includes("story, packaging, rich_text, contact_info")));
      const updated = first.updated.join("\n");
      for (const expected of ["settings seo: description", "home seo", "kurumsal seo", "numune seo", "iletisim seo", "el-sabunu name, seo, body, faq", "dus-jeli seo, body, faq", "hediye-setleri seo, body, faq", "header →", "footer_shop →", "footer_corporate →", "49 product photos"]) {
        assert.ok(updated.includes(expected), `${expected}\n${updated}`);
      }
      for (const product of productSeeds) assert.ok(updated.includes(`${product.slug} description (sections appended), seo`), product.slug);
      assert.ok(!first.skipped.some((l) => l.includes("edited in the panel")), first.skipped.join("\n"));

      // settings.seo
      const [seoRow] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, "seo"));
      const seo = seoSettings.parse(seoRow.value);
      assert.deepEqual(seo.description, SEO_SETTINGS_TEXT.description);
      assert.equal(seo.titleTemplate, "%s | PRESTİJ", "other settings untouched");

      // Pages: SEO texts; the home FAQ right after the story, before the newsletter.
      const home = await pageBySlug(tx, "home");
      assert.deepEqual(home.seo, homePageMeta.seo);
      for (const slug of ["kurumsal", "numune", "iletisim"]) assert.deepEqual((await pageBySlug(tx, slug)).seo, seedPage(slug).seo, slug);
      const homeTypes = (await sectionsOf(tx, home.id)).map((s) => s.type);
      assert.equal(homeTypes.indexOf("faq"), homeTypes.indexOf("story") + 1);
      assert.equal(homeTypes.indexOf("newsletter"), homeTypes.indexOf("faq") + 1);
      const faq = (await sectionsOf(tx, home.id)).find((s) => s.type === "faq")!;
      assert.deepEqual((faq.content as { items: unknown[] }).items, HOME_FAQ_SECTION.content.items);

      // New pages: published, every section valid, images resolved to existing media.
      for (const slug of ["urunler", "hakkimizda"]) {
        const row = await pageBySlug(tx, slug);
        const seed = seedPage(slug);
        assert.ok(row.isPublished, slug);
        assert.deepEqual([row.kind, row.title, row.seo], [seed.kind, seed.title, seed.seo], slug);
        const rows = await sectionsOf(tx, row.id);
        assert.deepEqual(rows.map((s) => s.type), seed.sections.map((s) => s.type), slug);
        for (const s of rows) {
          assert.ok(sectionMeta[s.type as SectionType].schema.safeParse(s.content).success, `${slug} ${s.type}`);
          assert.equal(s.audience, "all");
        }
      }
      const about = await sectionsOf(tx, (await pageBySlug(tx, "hakkimizda")).id);
      const imageIds = JSON.stringify(about.map((s) => s.content)).match(/"imageId":(\d+|null)/g) ?? [];
      assert.equal(imageIds.length, 4);
      assert.ok(imageIds.every((m) => !m.endsWith("null")), "every image found in the media library");

      // Categories through the catalog read path the storefront uses.
      const listed = await queryCategories(tx);
      for (const [slug, copy] of Object.entries(CATEGORY_COPY)) {
        const category = listed.find((c) => c.slug === slug);
        assert.ok(category, slug);
        assert.deepEqual(category.name, copy.name);
        assert.deepEqual(category.body, copy.body);
        assert.deepEqual(category.faq, copy.faq, `${slug}: every FAQ item is well-formed`);
        assert.deepEqual({ title: category.seo?.title, description: category.seo?.description }, copy.seo);
      }

      // Products, menus, alt texts.
      for (const product of productSeeds) {
        const [row] = await tx.select({ description: products.description, seo: products.seo }).from(products).where(eq(products.slug, product.slug));
        assert.deepEqual(row.description, product.description, product.slug);
        assert.deepEqual(row.seo, product.seo, product.slug);
      }
      for (const key of ["header", "footer_shop", "footer_corporate"] as const) {
        const [row] = await tx.select({ items: menus.items }).from(menus).where(eq(menus.key, key));
        assert.deepEqual(row.items, MENUS[key], key);
      }
      const photos = await tx.select({ storageKey: media.storageKey, alt: media.alt }).from(media).where(like(media.storageKey, "urunler/%"));
      for (const photo of photos) {
        const stem = stemOf(photo.storageKey)!;
        if (MEDIA_ALT[stem]) assert.deepEqual(photo.alt, MEDIA_ALT[stem], stem);
      }

      const second = await run(tx);
      assert.deepEqual([second.inserted, second.updated], [[], []], second.inserted.concat(second.updated).join("\n"));
      assert.ok(second.skipped.some((l) => l.includes("page urunler: already exists")));
      assert.ok(second.skipped.some((l) => l.includes("media alt texts: 49 already up to date")));
    });
  });

  test("never overwrites client edits", async () => {
    await inRollback(async (tx) => {
      await resetToPreviousDefaults(tx);
      const custom: LocalizedText = { tr: "Müşterinin kendi metni" };
      await tx.update(categories).set({ seo: { title: custom } }).where(eq(categories.slug, "el-sabunu"));
      await tx.update(categories).set({ faq: [{ question: custom, answer: custom }] }).where(eq(categories.slug, "dus-jeli"));
      await tx.update(products).set({ description: { tr: "<p>Müşterinin açıklaması</p>" } }).where(eq(products.slug, "lavanta"));
      await tx.update(pages).set({ seo: { title: custom, description: custom } }).where(eq(pages.slug, "kurumsal"));
      const clientMenu = [{ label: { tr: "Bizim menü" }, href: "/iletisim" }];
      await tx.update(menus).set({ items: clientMenu }).where(eq(menus.key, "footer_corporate"));
      const [photo] = await tx.select({ id: media.id }).from(media).where(like(media.storageKey, "urunler/okyanus/%")).orderBy(media.id).limit(1);
      await tx.update(media).set({ alt: custom }).where(eq(media.id, photo.id));
      const [clientPage] = await tx.insert(pages).values({ slug: "urunler", kind: "landing", title: custom }).returning({ id: pages.id });

      const report = await run(tx);
      const skipped = report.skipped.join("\n");
      for (const expected of [
        "category el-sabunu seo.title: edited in the panel",
        "category dus-jeli faq: edited in the panel",
        "product lavanta description: edited in the panel",
        "page kurumsal seo.title: edited in the panel",
        "page kurumsal seo.description: edited in the panel",
        "menu footer_corporate: edited in the panel",
        `media #${photo.id} `,
        `page urunler: already exists (#${clientPage.id})`,
      ]) {
        assert.ok(skipped.includes(expected), `${expected}\n${skipped}`);
      }

      const [cat] = await tx.select({ seo: categories.seo, body: categories.body }).from(categories).where(eq(categories.slug, "el-sabunu"));
      assert.deepEqual(cat.seo, { title: custom, description: CATEGORY_COPY["el-sabunu"].seo.description }, "only the empty field is filled");
      assert.deepEqual(cat.body, CATEGORY_COPY["el-sabunu"].body, "untouched fields of the same row still update");
      const [gel] = await tx.select({ faq: categories.faq }).from(categories).where(eq(categories.slug, "dus-jeli"));
      assert.deepEqual(gel.faq, [{ question: custom, answer: custom }]);
      const [lavanta] = await tx.select({ description: products.description, seo: products.seo }).from(products).where(eq(products.slug, "lavanta"));
      assert.deepEqual(lavanta.description, { tr: "<p>Müşterinin açıklaması</p>" });
      assert.deepEqual(lavanta.seo, SCENTS.find((s) => s.slug === "lavanta")!.seo, "its SEO was still the seeded default");
      assert.deepEqual((await pageBySlug(tx, "kurumsal")).seo, { title: custom, description: custom });
      const [menu] = await tx.select({ items: menus.items }).from(menus).where(eq(menus.key, "footer_corporate"));
      assert.deepEqual(menu.items, clientMenu);
      const [alt] = await tx.select({ alt: media.alt }).from(media).where(eq(media.id, photo.id));
      assert.deepEqual(alt.alt, custom);
      assert.deepEqual(await sectionsOf(tx, clientPage.id), [], "the client's /urunler page gets no sections");

      const second = await run(tx);
      assert.deepEqual([second.inserted, second.updated], [[], []], second.inserted.concat(second.updated).join("\n"));
    });
  });

  test("keeps the other SEO fields and treats empty values as never set", async () => {
    await inRollback(async (tx) => {
      await resetToPreviousDefaults(tx);
      await tx.update(categories).set({ seo: { noIndex: false, ogImageId: 48 } }).where(eq(categories.slug, "hediye-setleri"));
      await tx.update(products).set({ seo: null }).where(eq(products.slug, "okyanus"));
      await run(tx);
      const [set] = await tx.select({ seo: categories.seo }).from(categories).where(eq(categories.slug, "hediye-setleri"));
      assert.deepEqual(set.seo, { noIndex: false, ogImageId: 48, ...CATEGORY_COPY["hediye-setleri"].seo });
      const [okyanus] = await tx.select({ seo: products.seo }).from(products).where(eq(products.slug, "okyanus"));
      assert.deepEqual(okyanus.seo, SCENTS.find((s) => s.slug === "okyanus")!.seo);
    });
  });
});

describe("catalogSeo: copy corrections after the first run (day 5 FIX)", () => {
  const aboutStory = () => seedPage("hakkimizda").sections.find((s) => s.type === "story")!.content as { body: LocalizedText };

  /** The rows as content-day5.ts first wrote them (the live database before the FIX run). */
  async function resetToFirstRun(tx: Tx) {
    for (const [slug, fixes] of Object.entries(CATEGORY_COPY_FIXES)) {
      const copy = CATEGORY_COPY[slug as keyof typeof CATEGORY_COPY];
      await tx
        .update(categories)
        .set({
          body: undoLocalizedFixes(copy.body, fixes?.body),
          seo: { title: copy.seo.title, description: undoLocalizedFixes(copy.seo.description, fixes?.seoDescription) },
        })
        .where(eq(categories.slug, slug));
    }
    for (const [slug, fixes] of Object.entries(PRODUCT_SEO_FIXES)) {
      const seo = PRODUCT_SEO[slug as keyof typeof PRODUCT_SEO];
      await tx
        .update(products)
        .set({ seo: { title: undoLocalizedFixes(seo.title, fixes?.title), description: undoLocalizedFixes(seo.description, fixes?.description) } })
        .where(eq(products.slug, slug));
    }
    const about = await pageBySlug(tx, "hakkimizda");
    assert.ok(about, "the live database has /sayfa/hakkimizda");
    const [story] = (await sectionsOf(tx, about.id)).filter((s) => s.type === "story");
    await tx
      .update(pageSections)
      .set({ content: { ...(story.content as object), body: undoLocalizedFixes(aboutStory().body, ABOUT_STORY_BODY_FIXES) } })
      .where(eq(pageSections.id, story.id));
    await tx.update(pages).set({ updatedAt: new Date("2026-11-10T22:02:47Z") }).where(eq(pages.id, about.id));
    return { about, story };
  }

  test("a value still in its first version gets the correction; a second run has nothing to do", async () => {
    await inRollback(async (tx) => {
      const { about, story } = await resetToFirstRun(tx);
      const first = await run(tx);
      const updated = first.updated.join("\n");
      for (const expected of ["el-sabunu body", "dus-jeli seo, body", "hediye-setleri body", "lavanta-latte seo", "okyanus seo", `page_sections #${story.id}: hakkimizda story body`]) {
        assert.ok(updated.includes(expected), `${expected}\n${updated}`);
      }
      assert.deepEqual(first.inserted, []);
      assert.ok(!first.skipped.some((l) => l.includes("edited in the panel")), first.skipped.join("\n"));
      for (const [slug, copy] of Object.entries(CATEGORY_COPY)) {
        const [row] = await tx.select({ body: categories.body, seo: categories.seo }).from(categories).where(eq(categories.slug, slug));
        assert.deepEqual(row.body, copy.body, slug);
        assert.deepEqual({ title: row.seo?.title, description: row.seo?.description }, copy.seo, slug);
      }
      for (const product of productSeeds) {
        const [row] = await tx.select({ seo: products.seo }).from(products).where(eq(products.slug, product.slug));
        assert.deepEqual(row.seo, product.seo, product.slug);
      }
      const [storyAfter] = await tx.select().from(pageSections).where(eq(pageSections.id, story.id));
      assert.deepEqual((storyAfter.content as { body: LocalizedText }).body, aboutStory().body);
      assert.equal((storyAfter.content as { imageId: number }).imageId, (story.content as { imageId: number }).imageId, "the rest of the section is kept");
      assert.ok((await pageBySlug(tx, "hakkimizda")).updatedAt.getTime() > Date.parse("2026-11-10T22:02:47Z"), "the page row moves with it");
      assert.equal(about.slug, "hakkimizda");
      const second = await run(tx);
      assert.deepEqual([second.inserted, second.updated], [[], []], second.inserted.concat(second.updated).join("\n"));
    });
  });

  test("a value the client edited since is left alone", async () => {
    await inRollback(async (tx) => {
      const { story } = await resetToFirstRun(tx);
      const custom: LocalizedText = { tr: "<p>Müşterinin kendi metni</p>" };
      await tx.update(categories).set({ body: custom }).where(eq(categories.slug, "hediye-setleri"));
      const storyContent = { ...(story.content as object), body: { tr: "Müşterinin hikâyesi" } };
      await tx.update(pageSections).set({ content: storyContent }).where(eq(pageSections.id, story.id));
      const report = await run(tx);
      const skipped = report.skipped.join("\n");
      assert.ok(skipped.includes("category hediye-setleri body: edited in the panel"), skipped);
      assert.ok(skipped.includes(`page hakkimizda story #${story.id} body: edited in the panel`), skipped);
      const [set] = await tx.select({ body: categories.body }).from(categories).where(eq(categories.slug, "hediye-setleri"));
      assert.deepEqual(set.body, custom);
      const [storyAfter] = await tx.select({ content: pageSections.content }).from(pageSections).where(eq(pageSections.id, story.id));
      // The edited body is kept; the section's other corrected text (the Arabic eyebrow, round 2) is
      // decided on its own, like the fields of a category row.
      assert.deepEqual(storyAfter.content, { ...storyContent, eyebrow: (aboutStory() as unknown as { eyebrow: LocalizedText }).eyebrow });
    });
  });
});

describe("catalogSeo: round-2 corrections (day-5 verification)", () => {
  // The day-6 campaign terms page (key wheel_terms) is created by content-day6.ts with its description
  // already set, so it was never a round-2 correction (and it may not exist yet in this database).
  const legalSlugs = LEGAL_PAGES.filter((p) => p.key !== "wheel_terms").map((p) => p.slug);
  const handSoaps = SCENTS.filter((s) => s.category === "el-sabunu");
  const seedSection = (page: string, type: string) => seedPage(page).sections.find((s) => s.type === type)!.content;
  const earlierWrite = new Date("2026-11-10T22:02:47Z");

  /** `value` with only the round-2 corrections undone at each path. */
  function beforeRound2<T>(value: T, list: readonly { path: readonly (string | number)[]; fixes: Parameters<typeof undoLocalizedFixes>[1] }[]): T {
    return list.reduce<T>((out, { path, fixes }) => setAt(out, [...path], undoLocalizedFixes(getAt(value, [...path]) as LocalizedText, fixes, 2)) as T, value);
  }

  /** The rows as the live database held them before the round-2 corrections (after the FIX run). */
  async function resetToRound1(tx: Tx) {
    for (const [slug, fixes] of Object.entries(CATEGORY_COPY_FIXES)) {
      const copy = CATEGORY_COPY[slug as keyof typeof CATEGORY_COPY];
      const [row] = await tx.select({ seo: categories.seo }).from(categories).where(eq(categories.slug, slug));
      await tx
        .update(categories)
        .set({
          body: undoLocalizedFixes(copy.body, fixes?.body, 2),
          seo: { ...(row.seo ?? {}), ...beforeRound2(copy.seo, [{ path: ["title"], fixes: fixes?.seoTitle }, { path: ["description"], fixes: fixes?.seoDescription }]) },
          faq: beforeRound2(copy.faq, fixes?.faq ?? []),
        })
        .where(eq(categories.slug, slug));
    }
    for (const scent of handSoaps) {
      await tx
        .update(products)
        .set({ warnings: undoLocalizedFixes(scent.warnings, HAND_SOAP_WARNINGS_FIXES, 2) })
        .where(inArray(products.slug, [scent.slug, `${scent.slug}-numune`]));
    }
    for (const slug of legalSlugs) {
      const page = await pageBySlug(tx, slug);
      assert.ok(page, `the live database has /sayfa/${slug}`);
      const seo = { ...(page.seo ?? {}) };
      delete seo.description;
      await tx.update(pages).set({ seo }).where(eq(pages.id, page.id));
    }
    for (const fix of SECTION_COPY_FIXES) {
      const page = await pageBySlug(tx, fix.page);
      const [section] = (await sectionsOf(tx, page.id)).filter((s) => s.type === fix.type);
      const path = [...fix.path];
      const text = undoLocalizedFixes(getAt(seedSection(fix.page, fix.type), path) as LocalizedText, fix.fixes, 2);
      await tx.update(pageSections).set({ content: setAt(section.content, path, text) as Record<string, unknown> }).where(eq(pageSections.id, section.id));
      await tx.update(pages).set({ updatedAt: earlierWrite }).where(eq(pages.id, page.id));
    }
  }

  test("a text still in its version before round 2 gets the correction; a second run has nothing to do", async () => {
    await inRollback(async (tx) => {
      await resetToRound1(tx);
      const first = await run(tx);
      const lines = first.updated.map((l) => l.replace(/^\S+ #\d+: /, "")).sort();
      const expected = [
        ...legalSlugs.map((slug) => `${slug} seo.description`),
        "el-sabunu body",
        "dus-jeli seo, body, faq",
        "hediye-setleri body, faq",
        ...handSoaps.flatMap((s) => [`${s.slug} warnings (eye-contact caution)`, `${s.slug}-numune warnings (eye-contact caution)`]),
        "kurumsal hero eyebrow, subline (corrections after review)",
        "kurumsal faq title (corrections after review)",
        "numune hero subline (corrections after review)",
        "urunler faq items.0.answer (corrections after review)",
        "hakkimizda story body, eyebrow (corrections after review)",
      ].sort();
      assert.deepEqual(lines, expected, first.updated.join("\n"));
      assert.deepEqual(first.inserted, []);

      for (const [slug, copy] of Object.entries(CATEGORY_COPY)) {
        const [row] = await tx.select({ body: categories.body, seo: categories.seo, faq: categories.faq }).from(categories).where(eq(categories.slug, slug));
        assert.deepEqual(row.body, copy.body, slug);
        assert.deepEqual({ title: row.seo?.title, description: row.seo?.description }, copy.seo, slug);
        assert.deepEqual(row.faq, copy.faq, slug);
      }
      for (const scent of handSoaps) {
        for (const slug of [scent.slug, `${scent.slug}-numune`]) {
          const [row] = await tx.select({ warnings: products.warnings }).from(products).where(eq(products.slug, slug));
          assert.deepEqual(row.warnings, scent.warnings, slug);
        }
      }
      for (const slug of legalSlugs) {
        const page = await pageBySlug(tx, slug);
        assert.deepEqual(page.seo?.description, LEGAL_PAGE_DESCRIPTIONS[slug], slug);
        assert.ok(page.seo?.title, `${slug}: the SEO title is kept`);
      }
      for (const fix of SECTION_COPY_FIXES) {
        const page = await pageBySlug(tx, fix.page);
        const [section] = (await sectionsOf(tx, page.id)).filter((s) => s.type === fix.type);
        assert.deepEqual(getAt(section.content, [...fix.path]), getAt(seedSection(fix.page, fix.type), [...fix.path]), `${fix.page} ${fix.type} ${fix.path.join(".")}`);
        assert.ok(sectionMeta[fix.type].schema.safeParse(section.content).success, `${fix.page} ${fix.type} still valid`);
        assert.ok(page.updatedAt.getTime() > earlierWrite.getTime(), `${fix.page}: the page row moves with its sections`);
      }

      const second = await run(tx);
      assert.deepEqual([second.inserted, second.updated], [[], []], second.inserted.concat(second.updated).join("\n"));
    });
  });

  test("a text the client edited is kept; the other corrected texts of the same row or section still update", async () => {
    await inRollback(async (tx) => {
      await resetToRound1(tx);
      const custom: LocalizedText = { tr: "Müşterinin kendi metni" };
      const kurumsal = await pageBySlug(tx, "kurumsal");
      const [hero] = (await sectionsOf(tx, kurumsal.id)).filter((s) => s.type === "hero");
      const heroContent = { ...(hero.content as object), subline: custom };
      await tx.update(pageSections).set({ content: heroContent }).where(eq(pageSections.id, hero.id));
      await tx.update(pages).set({ seo: { title: custom, description: custom } }).where(eq(pages.slug, "kvkk"));
      await tx.update(pages).set({ seo: null }).where(eq(pages.slug, "cerez-politikasi"));
      await tx.update(products).set({ warnings: custom }).where(eq(products.slug, "lavanta"));
      await tx.update(categories).set({ faq: [{ question: custom, answer: custom }] }).where(eq(categories.slug, "hediye-setleri"));

      const report = await run(tx);
      const skipped = report.skipped.join("\n");
      for (const expected of [
        `page kurumsal hero #${hero.id} subline: edited in the panel`,
        "page kvkk seo.description: edited in the panel",
        "product lavanta warnings: edited in the panel",
        "category hediye-setleri faq: edited in the panel",
      ]) {
        assert.ok(skipped.includes(expected), `${expected}\n${skipped}`);
      }
      const [heroAfter] = await tx.select({ content: pageSections.content }).from(pageSections).where(eq(pageSections.id, hero.id));
      assert.deepEqual(heroAfter.content, { ...heroContent, eyebrow: (seedSection("kurumsal", "hero") as { eyebrow: LocalizedText }).eyebrow });
      assert.deepEqual((await pageBySlug(tx, "kvkk")).seo, { title: custom, description: custom });
      assert.deepEqual((await pageBySlug(tx, "cerez-politikasi")).seo, { description: LEGAL_PAGE_DESCRIPTIONS["cerez-politikasi"] }, "an empty SEO row gets the description only");
      const [lavanta] = await tx.select({ warnings: products.warnings }).from(products).where(eq(products.slug, "lavanta"));
      assert.deepEqual(lavanta.warnings, custom);
      const [sample] = await tx.select({ warnings: products.warnings }).from(products).where(eq(products.slug, "lavanta-numune"));
      assert.deepEqual(sample.warnings, handSoaps.find((s) => s.slug === "lavanta")!.warnings, "the sample is decided on its own");
      const [set] = await tx.select({ body: categories.body, faq: categories.faq }).from(categories).where(eq(categories.slug, "hediye-setleri"));
      assert.deepEqual(set.faq, [{ question: custom, answer: custom }]);
      assert.deepEqual(set.body, CATEGORY_COPY["hediye-setleri"].body, "the body of the same row still updates");

      const second = await run(tx);
      assert.deepEqual([second.inserted, second.updated], [[], []], second.inserted.concat(second.updated).join("\n"));
    });
  });
});

describe("catalogSeo: round-3 corrections (second review, FIX2)", () => {
  const seedSection = (page: string, type: string) => seedPage(page).sections.find((s) => s.type === type)!.content;
  const round3 = SECTION_COPY_FIXES.filter((f) => Object.values(f.fixes).some((list) => list?.some((fix) => (fix.round ?? 1) === 3)));
  const earlierWrite = new Date("2026-11-10T22:02:47Z");

  /** The section texts as the live database held them after round 2 (only round 3 undone). */
  async function resetToRound2(tx: Tx) {
    const sections: { id: number; page: string; type: string }[] = [];
    for (const fix of round3) {
      const page = await pageBySlug(tx, fix.page);
      const [section] = (await sectionsOf(tx, page.id)).filter((s) => s.type === fix.type);
      const path = [...fix.path];
      const text = undoLocalizedFixes(getAt(seedSection(fix.page, fix.type), path) as LocalizedText, fix.fixes, 3);
      await tx.update(pageSections).set({ content: setAt(section.content, path, text) as Record<string, unknown> }).where(eq(pageSections.id, section.id));
      await tx.update(pages).set({ updatedAt: earlierWrite }).where(eq(pages.id, page.id));
      sections.push({ id: section.id, page: fix.page, type: fix.type });
    }
    return sections;
  }

  test("the /kurumsal and /numune hero sublines move from their round-2 text to the seed; a second run has nothing to do", async () => {
    assert.deepEqual(round3.map((f) => `${f.page} ${f.type} ${f.path.join(".")}`), ["kurumsal hero subline", "numune hero subline"]);
    await inRollback(async (tx) => {
      const sections = await resetToRound2(tx);
      const first = await run(tx);
      assert.deepEqual(
        first.updated.map((l) => l.replace(/^\S+ #\d+: /, "")).sort(),
        ["kurumsal hero subline (corrections after review)", "numune hero subline (corrections after review)"],
        first.updated.join("\n"),
      );
      assert.deepEqual(first.inserted, []);
      assert.ok(!first.skipped.some((l) => l.includes("edited in the panel")), first.skipped.join("\n"));
      for (const { id, page, type } of sections) {
        const [row] = await tx.select({ content: pageSections.content }).from(pageSections).where(eq(pageSections.id, id));
        assert.deepEqual(getAt(row.content, ["subline"]), getAt(seedSection(page, type), ["subline"]), `${page} ${type} subline`);
        assert.ok(sectionMeta[type as SectionType].schema.safeParse(row.content).success, `${page} ${type} still valid`);
        assert.ok((await pageBySlug(tx, page)).updatedAt.getTime() > earlierWrite.getTime(), `${page}: the page row moves with its section`);
      }
      const second = await run(tx);
      assert.deepEqual([second.inserted, second.updated], [[], []], second.inserted.concat(second.updated).join("\n"));
    });
  });

  test("a subline the client edited after round 2 is kept; the other one still updates", async () => {
    await inRollback(async (tx) => {
      const sections = await resetToRound2(tx);
      const numune = sections.find((s) => s.page === "numune")!;
      const [row] = await tx.select({ content: pageSections.content }).from(pageSections).where(eq(pageSections.id, numune.id));
      const custom: LocalizedText = { tr: "Müşterinin kendi metni", en: "The client's own text" };
      await tx.update(pageSections).set({ content: { ...(row.content as object), subline: custom } }).where(eq(pageSections.id, numune.id));
      const report = await run(tx);
      assert.ok(report.skipped.includes(`page numune hero #${numune.id} subline: edited in the panel, left as is`), report.skipped.join("\n"));
      assert.deepEqual(report.updated.map((l) => l.replace(/^\S+ #\d+: /, "")), ["kurumsal hero subline (corrections after review)"], report.updated.join("\n"));
      const [after] = await tx.select({ content: pageSections.content }).from(pageSections).where(eq(pageSections.id, numune.id));
      assert.deepEqual(getAt(after.content, ["subline"]), custom);
    });
  });
});
