// Day 5 CORE against the local PostgreSQL:
//   - the migration drizzle/0004_day5_seo.sql is applied unchanged and only adds categories.body / faq;
//   - the catalog read path (queryCategories, the query behind the cached listCategories) returns both;
//   - the seo settings extension: the live row reads with the new defaults and a save round-trips them;
//   - every content-day5 step is idempotent (run twice in a rolled-back transaction).
// Every write happens inside a transaction that is rolled back; the id sequences those writes advance
// (categories; pages / page_sections from catalogSeo; blog_posts from blogPosts) are put back.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day5-core-api.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { queryCategories } from "@/lib/data/catalog";
import { SETTINGS_INPUTS } from "@/lib/panel/settings/schemas";
import { readSettingsRow, saveSettings } from "@/lib/panel/settings/service";
import type { Tx } from "@/lib/panel/tx";
import { STEPS } from "../../scripts/content-day5";

const MIGRATION_FILE = "drizzle/0004_day5_seo.sql";
const MIGRATION = readFileSync(path.resolve(MIGRATION_FILE), "utf8");
const SLUG = "day5-test-core-category";
const C = schema.categories;

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
/** Sequences advanced by the rolled-back writes below (nextval is not transactional). */
const SEQUENCES = ["categories_id_seq", "pages_id_seq", "page_sections_id_seq", "blog_posts_id_seq"] as const;
const seqBefore = new Map<string, Seq>();
let categoriesBefore: string;
let settingsBefore: string;

const readSeq = async (name: (typeof SEQUENCES)[number]): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from ${name}`));
  return { last_value: row.last_value, is_called: row.is_called };
};
const categoriesSnapshot = async () => JSON.stringify(await db.select().from(C).orderBy(C.id));
const settingsSnapshot = async () => JSON.stringify(await db.select().from(schema.settings).orderBy(schema.settings.key));

before(async () => {
  const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence('categories', 'id') as seq`);
  assert.equal(seq, "public.categories_id_seq");
  for (const name of SEQUENCES) seqBefore.set(name, await readSeq(name));
  categoriesBefore = await categoriesSnapshot();
  settingsBefore = await settingsSnapshot();
});

after(async () => {
  try {
    await db.delete(C).where(eq(C.slug, SLUG)); // never committed; defensive
    for (const name of SEQUENCES) {
      const seq = seqBefore.get(name)!;
      const table = name.replace(/_id_seq$/, "");
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${table}`));
      if (max === null || Number(max) <= Number(seq.last_value)) {
        await db.execute(sql`select setval(${name}::regclass, ${seq.last_value}::bigint, ${seq.is_called})`);
      }
      assert.deepEqual(await readSeq(name), seq, `${name} restored`);
    }
    assert.equal(await categoriesSnapshot(), categoriesBefore, "categories unchanged");
    assert.equal(await settingsSnapshot(), settingsBefore, "settings unchanged");
  } finally {
    await db.$client.end();
  }
});

describe("migration 0004_day5_seo", () => {
  test("is applied, and the applied file is the one in the repository", async () => {
    const rows = await db.execute<{ hash: string }>(sql`select hash from drizzle.__drizzle_migrations order by id`);
    assert.ok(rows.length >= 5);
    const expected = createHash("sha256").update(MIGRATION).digest("hex");
    assert.ok(rows.some((r) => r.hash === expected), `${MIGRATION_FILE} changed after it was applied: write a new migration instead`);
  });

  test("is additive only: two new columns on categories", () => {
    const statements = MIGRATION.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    assert.deepEqual(statements, [
      `ALTER TABLE "categories" ADD COLUMN "body" jsonb;`,
      `ALTER TABLE "categories" ADD COLUMN "faq" jsonb DEFAULT '[]'::jsonb NOT NULL;`,
    ]);
  });

  test("columns: body jsonb nullable, faq jsonb not null default []", async () => {
    const cols = await db.execute<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      sql`select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'categories' and column_name in ('body', 'faq') order by column_name`,
    );
    assert.deepEqual(
      cols.map((c) => ({ ...c })),
      [
        { column_name: "body", data_type: "jsonb", is_nullable: "YES", column_default: null },
        { column_name: "faq", data_type: "jsonb", is_nullable: "NO", column_default: "'[]'::jsonb" },
      ],
    );
  });
});

describe("catalog read path", () => {
  test("every stored category has an faq array (the column default backfilled existing rows)", async () => {
    const rows = await db.select({ body: C.body, faq: C.faq }).from(C);
    assert.ok(rows.length > 0);
    for (const row of rows) assert.ok(Array.isArray(row.faq), "faq is always an array");
  });

  test("queryCategories returns body and faq; an insert without them gets null / []", async () => {
    await inRollback(async (tx) => {
      const [plain] = await tx.insert(C).values({ slug: SLUG, name: { tr: "Day5 test" }, position: 999 }).returning({ id: C.id, body: C.body, faq: C.faq });
      assert.equal(plain.body, null);
      assert.deepEqual(plain.faq, []);

      const body = { tr: "<h2>Seçim</h2><p>Metin</p>", en: "<p>Text</p>" };
      const faq = [
        { question: { tr: "Soru?" }, answer: { tr: "Cevap.", ar: "جواب." } },
        { question: "broken" },
        { answer: { tr: "no question" } },
        null,
      ];
      await tx.update(C).set({ body, faq: faq as never }).where(eq(C.id, plain.id));

      const list = await queryCategories(tx);
      const mine = list.find((c) => c.slug === SLUG);
      assert.ok(mine, "the visible test category is listed");
      assert.deepEqual(mine.body, body);
      assert.deepEqual(mine.faq, [{ question: { tr: "Soru?" }, answer: { tr: "Cevap.", ar: "جواب." } }], "malformed FAQ items are dropped");
      assert.equal(mine.productCount, 0);
      for (const c of list) assert.ok(Array.isArray(c.faq) && (c.body === null || typeof c.body === "object"));
    });
  });
});

describe("seo settings extension", () => {
  test("the live row reads with the new fields (defaults where never saved)", async () => {
    const row = await readSettingsRow("seo");
    assert.equal(typeof row.value.verification.google, "string");
    assert.equal(typeof row.value.returns.days, "number");
    assert.equal(typeof row.value.merchantCategory, "string");
    assert.ok(SETTINGS_INPUTS.seo.safeParse(row.value).success, "the SEO editor opens without errors");
  });

  test("a save stores verification, returns and merchantCategory, and they read back", async () => {
    await inRollback(async (tx) => {
      const row = await readSettingsRow("seo", tx);
      const value = SETTINGS_INPUTS.seo.parse({
        ...row.value,
        verification: { google: "day5-test_G00gle", bing: "0123456789ABCDEF", yandex: "abc123" },
        returns: { days: 30, freeReturns: false },
        merchantCategory: "2747",
      });
      const saved = await saveSettings(tx, "seo", { value, updatedAt: row.updatedAt ? new Date(row.updatedAt) : null });
      assert.deepEqual(Object.keys(saved.audit.after as object).sort(), ["merchantCategory", "returns", "verification"]);
      const back = await readSettingsRow("seo", tx);
      assert.deepEqual(back.value.verification, { google: "day5-test_G00gle", bing: "0123456789ABCDEF", yandex: "abc123" });
      assert.deepEqual(back.value.returns, { days: 30, freeReturns: false });
      assert.equal(back.value.merchantCategory, "2747");
      assert.deepEqual(back.value.defaultTitle, row.value.defaultTitle, "other fields untouched");
    });
  });
});

describe("content-day5 steps", () => {
  for (const step of STEPS) {
    test(`${step.key} (${step.owner}) is idempotent: a second run has nothing to do`, async () => {
      await inRollback(async (tx) => {
        await step.run(tx as never);
        const second = await step.run(tx as never);
        assert.deepEqual([second.inserted, second.updated], [[], []], second.inserted.concat(second.updated).join("\n"));
      });
    });
  }
});
