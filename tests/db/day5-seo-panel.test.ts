// Day 5 SEO-PANEL against the local PostgreSQL:
//   - category editor: body (sanitized) + FAQ saved under the optimistic lock, read back by the editor and
//     by the storefront read path (queryCategories), audited field by field; a payload without the new
//     fields keeps them;
//   - SEO settings: verification codes (a pasted meta tag is reduced to the code), return policy and
//     Google product category through the panel schema and the settings action's run();
//   - SEO Kontrol: loadSeoReport on the live data (the right pages, no samples) and right after a save.
// Every write happens inside a transaction that is rolled back; the categories id sequence is put back
// and the categories/settings tables are compared with their state before the run.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day5-seo-panel.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { queryCategories } from "@/lib/data/catalog";
import { categorySaveSchema } from "@/lib/panel/categories/schema";
import { loadCategoryState, saveCategory } from "@/lib/panel/categories/service";
import { PanelError } from "@/lib/panel/errors";
import { loadSeoReport } from "@/lib/panel/seo/queries";
import { readSettingsRow, settingsActionOptions } from "@/lib/panel/settings/service";
import type { Tx } from "@/lib/panel/tx";

const SLUG = "day5-test-seo-panel";
const C = schema.categories;
const GOOGLE_CODE = "AbCdEf0123456789_-AbCdEf0123456789xyzXYZ123";
const words = (n: number) => Array.from({ length: n }, (_, i) => `kelime${i}`).join(" ");

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
let categorySeq: Seq;
let categoriesBefore: string;
let settingsBefore: string;

const readSeq = async (): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from categories_id_seq`));
  return { last_value: row.last_value, is_called: row.is_called };
};
const categoriesSnapshot = async () => JSON.stringify(await db.select().from(C).orderBy(C.id));
const settingsSnapshot = async () => JSON.stringify(await db.select().from(schema.settings).orderBy(schema.settings.key));

before(async () => {
  categorySeq = await readSeq();
  categoriesBefore = await categoriesSnapshot();
  settingsBefore = await settingsSnapshot();
});

after(async () => {
  try {
    await db.delete(C).where(eq(C.slug, SLUG)); // never committed; defensive
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from categories`));
    if (max === null || Number(max) <= Number(categorySeq.last_value)) {
      await db.execute(sql`select setval('categories_id_seq'::regclass, ${categorySeq.last_value}::bigint, ${categorySeq.is_called})`);
    }
    assert.deepEqual(await readSeq(), categorySeq, "categories id sequence restored");
    assert.equal(await categoriesSnapshot(), categoriesBefore, "categories unchanged");
    assert.equal(await settingsSnapshot(), settingsBefore, "settings unchanged");
  } finally {
    await db.$client.end();
  }
});

describe("category editor: body + FAQ", () => {
  test("create with body and FAQ: sanitized, read back by the editor and the storefront read, audited", async () => {
    await inRollback(async (tx) => {
      const created = await saveCategory(
        tx,
        categorySaveSchema.parse({
          id: null,
          updatedAt: null,
          slug: SLUG,
          name: { tr: "Day5 test kategori" },
          description: null,
          body: { tr: '<h2>Seçim</h2><p>Metin<script>alert(1)</script> <a href="/numune" onclick="x()">numune</a></p>', en: "<p>Text</p>" },
          faq: [
            { question: { tr: "Hangi boyu seçmeliyim?" }, answer: { tr: "Evde pompalı şişe.\n\nİşletmede bidon." } },
            { question: { tr: "Numune var mı?", en: "Samples?" }, answer: { tr: "<p>Evet <a href=\"/numune\">numune</a></p>", en: "Yes." } },
          ],
          imageId: null,
          accentColor: "",
          // Visible: the storefront read (queryCategories) lists visible categories only.
          isVisible: true,
          seo: { title: null, description: null, ogImageId: null, noIndex: false },
        }),
      );
      assert.equal(created.created, true);
      assert.deepEqual(created.tags, ["categories", "products"]);
      const body = { tr: '<h2>Seçim</h2><p>Metin <a href="/numune">numune</a></p>', en: "<p>Text</p>" };
      assert.deepEqual(created.state.body, body);
      assert.equal(created.state.faq.length, 2);
      assert.equal(created.state.faq[1].answer.tr, '<p>Evet <a href="/numune">numune</a></p>');
      const after = created.audit.after as Record<string, unknown>;
      assert.deepEqual(after.body, body);
      assert.equal((after.faq as unknown[]).length, 2);

      const loaded = await loadCategoryState(tx, created.id);
      assert.deepEqual(loaded?.body, body);
      assert.deepEqual(loaded?.faq, created.state.faq);

      const storefront = (await queryCategories(tx)).find((c) => c.slug === SLUG);
      assert.ok(storefront, "the storefront read path sees the new category");
      assert.deepEqual(storefront.body, body);
      assert.deepEqual(storefront.faq, created.state.faq);
    });
  });

  test("update: a payload without body/FAQ keeps them; changing only the FAQ audits only the FAQ; stale stamp → conflict", async () => {
    await inRollback(async (tx) => {
      const created = await saveCategory(
        tx,
        categorySaveSchema.parse({
            id: null,
            updatedAt: null,
            slug: SLUG,
            name: { tr: "Day5 test" },
            description: null,
            body: { tr: "<p>Gövde</p>" },
            faq: [
              { question: { tr: "Bir?" }, answer: { tr: "1" } },
              { question: { tr: "İki?" }, answer: { tr: "2" } },
            ],
            imageId: null,
            accentColor: "",
            isVisible: false,
            seo: { title: null, description: null, ogImageId: null, noIndex: false },
        }),
      );
      // An older caller (no body/faq keys), renaming the category.
      const { body: _body, faq: _faq, ...older } = created.state;
      void _body;
      void _faq;
      const renamed = await saveCategory(tx, categorySaveSchema.parse({ ...older, name: { tr: "Day5 test yeni ad" } }));
      assert.deepEqual(renamed.state.body, { tr: "<p>Gövde</p>" });
      assert.equal(renamed.state.faq.length, 2);
      assert.deepEqual(Object.keys(renamed.audit.after as object), ["name"]);
      assert.deepEqual(Object.keys(renamed.audit.before as object), ["name"]);

      // Reordering the FAQ (the editor sends everything).
      const reordered = await saveCategory(tx, categorySaveSchema.parse({ ...renamed.state, faq: [...renamed.state.faq].reverse() }));
      assert.deepEqual(reordered.state.faq.map((f) => f.question.tr), ["İki?", "Bir?"]);
      assert.deepEqual(Object.keys(reordered.audit.after as object), ["faq"]);

      // Clearing the body.
      const cleared = await saveCategory(tx, categorySaveSchema.parse({ ...reordered.state, body: { tr: "<p><br></p>" } }));
      assert.equal(cleared.state.body, null);
      const [row] = await tx.select({ body: C.body }).from(C).where(eq(C.id, created.id));
      assert.equal(row.body, null);

      // The stamp from before the last save is stale.
      await assert.rejects(
        saveCategory(tx, categorySaveSchema.parse({ ...reordered.state, name: { tr: "X" } })),
        (e: unknown) => e instanceof PanelError && e.code === "conflict",
      );
    });
  });
});

describe("SEO settings", () => {
  test("verification (pasted meta tag), returns and merchant category go through the panel schema and the action's run", async () => {
    await inRollback(async (tx) => {
      const row = await readSettingsRow("seo", tx);
      const opts = settingsActionOptions("seo");
      const input = await opts.schema.parseAsync({
        ...row.value,
        verification: { google: `<meta name="google-site-verification" content="${GOOGLE_CODE}" />`, bing: "", yandex: "yandex-verification: 1a2b3c4d5e6f7a8b" },
        returns: { days: 30, freeReturns: false },
        merchantCategory: "2747",
        updatedAt: row.updatedAt,
      });
      const result = await opts.run(input, { tx });
      assert.deepEqual(result.tags, ["settings"]);
      assert.equal(result.message, "SEO ayarları kaydedildi.");
      assert.deepEqual(Object.keys(result.audit.after as object).sort(), ["merchantCategory", "returns", "verification"]);

      const saved = await readSettingsRow("seo", tx);
      assert.deepEqual(saved.value.verification, { google: GOOGLE_CODE, bing: "", yandex: "1a2b3c4d5e6f7a8b" });
      assert.deepEqual(saved.value.returns, { days: 30, freeReturns: false });
      assert.equal(saved.value.merchantCategory, "2747");
      assert.equal(saved.value.titleTemplate, row.value.titleTemplate, "other fields untouched");

      // The editor that loaded the row before this save is now stale.
      const stale = await opts.schema.parseAsync({ ...row.value, updatedAt: row.updatedAt });
      await assert.rejects(opts.run(stale, { tx }), (e: unknown) => e instanceof PanelError && e.code === "conflict");
    });
  });
});

describe("SEO Kontrol report", () => {
  test("covers home, /urunler, visible categories, active standard/bundle products, published pages and posts; never samples", async () => {
    const report = await loadSeoReport();
    const locales = (await readSettingsRow("locales")).value.enabled;
    const keys = [...new Set(report.rows.map((r) => r.key))];
    assert.equal(keys[0], "home");
    assert.equal(keys[1], "products");
    for (const key of keys) assert.equal(report.rows.filter((r) => r.key === key).length, locales.length, key);

    const visible = await db.select({ id: C.id }).from(C).where(eq(C.isVisible, true));
    for (const c of visible) assert.ok(keys.includes(`category:${c.id}`), `category ${c.id}`);
    const hidden = await db.select({ id: C.id }).from(C).where(eq(C.isVisible, false));
    for (const c of hidden) assert.ok(!keys.includes(`category:${c.id}`), `hidden category ${c.id}`);

    const P = schema.products;
    const listed = await db.select({ id: P.id }).from(P).where(and(eq(P.status, "active"), inArray(P.type, ["standard", "bundle"])));
    for (const p of listed) assert.ok(keys.includes(`product:${p.id}`), `product ${p.id}`);
    const samples = await db.select({ id: P.id }).from(P).where(eq(P.type, "sample"));
    for (const p of samples) assert.ok(!keys.includes(`product:${p.id}`), `sample ${p.id}`);

    const pages = await db.select({ id: schema.pages.id, slug: schema.pages.slug, kind: schema.pages.kind }).from(schema.pages).where(eq(schema.pages.isPublished, true));
    for (const p of pages.filter((p) => p.kind !== "home" && p.slug !== "home" && p.slug !== "urunler")) {
      assert.ok(keys.includes(`page:${p.id}`), `page ${p.slug}`);
    }
    assert.equal(report.counts.missing + report.counts.improve + report.counts.good, report.rows.length);
    for (const row of report.rows) assert.ok(row.path.startsWith(`/${row.locale}`), row.path);
  });

  test("reflects a category save at once (uncached): a complete category is good in Turkish, the missing English body is reported", async () => {
    await inRollback(async (tx) => {
      const created = await saveCategory(
        tx,
        categorySaveSchema.parse({
          id: null,
          updatedAt: null,
          slug: SLUG,
          name: { tr: "Day5 Test Sıvı El Sabunu", en: "Day5 Test Liquid Hand Soap" },
          description: null,
          body: { tr: `<h2>Seçim</h2><p>${words(180)}</p>` },
          faq: [],
          imageId: null,
          accentColor: "",
          isVisible: true,
          seo: {
            title: { tr: "Day5 Test Sıvı El Sabunu – pompalı şişe ve bidon" },
            description: { tr: "a".repeat(140), en: "b".repeat(140) },
            ogImageId: null,
            noIndex: false,
          },
        }),
      );
      const report = await loadSeoReport(tx);
      const row = (locale: string) => report.rows.find((r) => r.key === `category:${created.id}` && r.locale === locale)!;
      assert.ok(row("tr"), "the new category is in the report");
      assert.deepEqual(
        row("tr").findings.filter((f) => f.severity !== "info").map((f) => f.code),
        [],
        JSON.stringify(row("tr").findings),
      );
      assert.equal(row("tr").status, "good");
      assert.equal(row("tr").body?.words, 181);
      assert.equal(row("tr").editHref, `/panel/kategoriler/${created.id}`);
      assert.ok(row("en").untranslated.includes("kategori metni"), JSON.stringify(row("en").untranslated));
      assert.equal(row("en").status, "improve");

      // Hidden with noindex → flagged; hidden from the store → gone.
      const noindex = await saveCategory(tx, categorySaveSchema.parse({ ...created.state, seo: { ...created.state.seo, noIndex: true } }));
      let again = await loadSeoReport(tx);
      assert.ok(again.rows.find((r) => r.key === `category:${created.id}` && r.locale === "tr")!.findings.some((f) => f.code === "noindex"));
      await saveCategory(tx, categorySaveSchema.parse({ ...noindex.state, isVisible: false }));
      again = await loadSeoReport(tx);
      assert.ok(!again.rows.some((r) => r.key === `category:${created.id}`));
    });
  });
});
