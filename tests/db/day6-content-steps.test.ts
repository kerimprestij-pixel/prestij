// Day 6 CONTENT against the local PostgreSQL: the three steps of scripts/content-day6.ts.
//   - wheelTerms inserts the legal document "wheel_terms" (draft, tr/en/ar) and the page
//     /sayfa/hediye-carki-kampanya-kosullari exactly like the seed and content-day4 do, the panel can open
//     and save both, content-day5 (catalogSeo) then has nothing to do for the new page, and a client's own
//     document, a page that already shows the terms or another page on the slug are never touched;
//   - giftWheelConfig inserts the live giftWheel row only when the key has none (a client's row is kept);
//   - launchChecklist stores nothing;
//   - every step and the whole script are idempotent (a second run has nothing to do).
// The live database may or may not hold the day-6 rows yet (INTEGRATE runs the script for real), so the
// insert tests first remove them inside the rolled-back transaction. Every write happens inside a
// transaction that is rolled back (test slugs day6-test-…); the id sequences those writes advance are put
// back and the touched tables are compared before and after.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day6-content-steps.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageSaveSchema } from "@/lib/panel/content/schemas";
import { savePage } from "@/lib/panel/content/pages-service";
import { getPageEditorData } from "@/lib/panel/content/queries";
import { getLegalEditorData, listLegalDocuments } from "@/lib/panel/legal/service";
import { SETTINGS_INPUTS } from "@/lib/panel/settings/schemas";
import { loadSeoReport } from "@/lib/panel/seo/queries";
import { readSettingsRow } from "@/lib/panel/settings/service";
import type { Tx } from "@/lib/panel/tx";
import { catalogSeo } from "../../scripts/content-day5";
import { giftWheelConfig, launchChecklist, STEPS, wheelTerms } from "../../scripts/content-day6";
import type { ScriptDb } from "../../scripts/seed-data/db";
import { giftWheelLiveSettings } from "../../scripts/seed-data/gift-wheel";
import { LEGAL_VERSION, WHEEL_TERMS_LEGAL_DOCUMENT } from "../../scripts/seed-data/legal";
import { legalPageSeo } from "../../scripts/seed-data/site";

const KEY = WHEEL_TERMS_LEGAL_DOCUMENT.key;
const SLUG = "hediye-carki-kampanya-kosullari";
const OTHER_SLUG = "day6-test-kampanya-kosullari";
const { legalDocuments: LD, pages: P, pageSections: PS, settings: S } = schema;

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
const asTx = (tx: ScriptDb) => tx as unknown as Tx;

type Seq = { last_value: string; is_called: boolean };
/** Sequences advanced by the rolled-back inserts below (nextval is not transactional). */
const SEQUENCES = ["legal_documents_id_seq", "pages_id_seq", "page_sections_id_seq"] as const;
/** Tables these tests write (compared before and after). */
const SNAPSHOT_TABLES = ["settings", "legal_documents", "pages", "page_sections"] as const;
const seqBefore = new Map<string, Seq>();
const tablesBefore = new Map<string, string>();

const readSeq = async (name: string): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from ${name}`));
  return { last_value: row.last_value, is_called: row.is_called };
};
const tableHash = async (table: string): Promise<string> => {
  const [row] = await db.execute<{ h: string }>(sql.raw(`select count(*)::text || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as h from "${table}" t`));
  return row.h;
};

/** Pages showing the terms (any slug) and the seeded slug: their ids. */
async function termsPageIds(tx: ScriptDb): Promise<number[]> {
  const shown = await tx
    .select({ id: PS.pageId })
    .from(PS)
    .where(and(eq(PS.type, "legal_document"), sql`${PS.content}->>'key' = ${KEY}`));
  const bySlug = await tx.select({ id: P.id }).from(P).where(inArray(P.slug, [SLUG, OTHER_SLUG]));
  return [...new Set([...shown.map((r) => r.id), ...bySlug.map((r) => r.id)])];
}

/** Inside the test's transaction: a database without the day-6 terms (document and pages). */
async function withoutTerms(tx: ScriptDb): Promise<void> {
  const ids = await termsPageIds(tx);
  if (ids.length) await tx.delete(P).where(inArray(P.id, ids)); // sections cascade
  await tx.delete(LD).where(eq(LD.key, KEY));
}

/** Inside the test's transaction: a database without a giftWheel settings row. */
const withoutWheelRow = (tx: ScriptDb) => tx.delete(S).where(eq(S.key, "giftWheel"));

const nothingToDo = (r: { inserted: string[]; updated: string[] }) => assert.deepEqual([r.inserted, r.updated], [[], []], r.inserted.concat(r.updated).join("\n"));

before(async () => {
  for (const name of SEQUENCES) seqBefore.set(name, await readSeq(name));
  for (const t of SNAPSHOT_TABLES) tablesBefore.set(t, await tableHash(t));
  const [left] = await db.execute<{ n: string }>(sql`select count(*)::text as n from pages where slug like 'day6-test-%'`);
  assert.equal(left.n, "0", "no day6-test pages left over from an earlier run");
});

after(async () => {
  try {
    for (const name of SEQUENCES) {
      const seq = seqBefore.get(name)!;
      const table = name.replace(/_id_seq$/, "");
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${table}`));
      // Put the sequence back unless someone else inserted rows meanwhile (other agents share the DB).
      if (max === null || Number(max) <= Number(seq.last_value)) {
        await db.execute(sql`select setval(${name}::regclass, ${seq.last_value}::bigint, ${seq.is_called})`);
        assert.deepEqual(await readSeq(name), seq, `${name} restored`);
      }
    }
    for (const t of SNAPSHOT_TABLES) assert.equal(await tableHash(t), tablesBefore.get(t), `${t} unchanged`);
  } finally {
    await db.$client.end();
  }
});

describe("wheelTerms", () => {
  test("inserts the draft document and its legal page like the seed does; a second run has nothing to do", async () => {
    await inRollback(async (tx) => {
      await withoutTerms(tx);
      const first = await wheelTerms(tx);
      assert.equal(first.inserted.length, 2, first.inserted.join("\n"));
      assert.deepEqual([first.updated, first.skipped], [[], []]);
      assert.match(first.inserted[0], /^legal_documents #\d+: wheel_terms “Hediye Çarkı Kampanya Koşulları” \(taslak-1, /);
      assert.match(first.inserted[1], new RegExp(`^pages #\\d+: /sayfa/${SLUG} \\(legal, published, SEO title and description\\) with page_sections #\\d+ legal_document "wheel_terms"$`));

      const docs = await tx.select().from(LD).where(eq(LD.key, KEY));
      assert.equal(docs.length, 1);
      const [doc] = docs;
      assert.equal(doc.version, LEGAL_VERSION);
      assert.equal(doc.isCurrent, true);
      assert.deepEqual(doc.title, WHEEL_TERMS_LEGAL_DOCUMENT.title);
      assert.deepEqual(doc.body, WHEEL_TERMS_LEGAL_DOCUMENT.body);
      assert.equal(doc.seo, null, "like the other documents (the page carries the SEO texts)");

      const [page] = await tx.select().from(P).where(eq(P.slug, SLUG));
      assert.ok(page);
      assert.equal(page.kind, "legal");
      assert.equal(page.isPublished, true);
      assert.deepEqual(page.title, WHEEL_TERMS_LEGAL_DOCUMENT.title);
      assert.deepEqual(page.seo, legalPageSeo(SLUG, WHEEL_TERMS_LEGAL_DOCUMENT.title));
      const sections = await tx.select().from(PS).where(eq(PS.pageId, page.id));
      assert.equal(sections.length, 1);
      const [section] = sections;
      assert.deepEqual(
        { type: section.type, position: section.position, isVisible: section.isVisible, audience: section.audience, content: section.content, startsAt: section.startsAt, endsAt: section.endsAt },
        { type: "legal_document", position: 0, isVisible: true, audience: "all", content: { key: KEY }, startsAt: null, endsAt: null },
      );

      const second = await wheelTerms(tx);
      nothingToDo(second);
      assert.ok(second.skipped.some((l) => l.startsWith(`legal document "${KEY}" already exists (#${doc.id}, version ${LEGAL_VERSION})`)), second.skipped.join("\n"));
      assert.ok(second.skipped.some((l) => l.startsWith(`the "${KEY}" document is already shown on /sayfa/${SLUG} (pages #${page.id})`)), second.skipped.join("\n"));
    });
  });

  test("the panel lists, opens and saves the new document and page unchanged", async () => {
    await inRollback(async (tx) => {
      await withoutTerms(tx);
      await wheelTerms(tx);
      const [page] = await tx.select().from(P).where(eq(P.slug, SLUG));

      const listed = (await listLegalDocuments(asTx(tx))).find((d) => d.key === KEY);
      assert.ok(listed, "/panel/yasal lists the terms");
      assert.equal(listed.version, LEGAL_VERSION);
      assert.equal(listed.checkout, false, "not a checkout text");
      assert.deepEqual(listed.pages, [{ slug: SLUG, isPublished: true }]);
      const editor = await getLegalEditorData(KEY, asTx(tx));
      assert.ok(editor?.current);
      assert.equal(editor.current.version, LEGAL_VERSION);
      assert.deepEqual(editor.current.body, WHEEL_TERMS_LEGAL_DOCUMENT.body);

      const data = await getPageEditorData(page.id, asTx(tx));
      assert.ok(data);
      const { result } = await savePage(asTx(tx), pageSaveSchema.parse(data.page));
      assert.ok(result);
      const [after] = await tx.select().from(P).where(eq(P.id, page.id));
      assert.deepEqual([after.slug, after.kind, after.isPublished, after.seo], [SLUG, "legal", true, page.seo], "saving unchanged keeps the page");
      const sections = await tx.select({ type: PS.type, content: PS.content }).from(PS).where(eq(PS.pageId, page.id));
      assert.deepEqual(sections, [{ type: "legal_document", content: { key: KEY } }]);
    });
  });

  test("SEO Kontrol grades the new page good in tr, en and ar, with no duplicate title or description", async () => {
    await inRollback(async (tx) => {
      await withoutTerms(tx);
      await wheelTerms(tx);
      const [page] = await tx.select({ id: P.id }).from(P).where(eq(P.slug, SLUG));
      const report = await loadSeoReport(asTx(tx));
      const rows = report.rows.filter((r) => r.key === `page:${page.id}`);
      assert.deepEqual(rows.map((r) => r.locale).sort(), ["ar", "en", "tr"]);
      for (const row of rows) {
        assert.equal(row.status, "good", `${row.locale}: ${JSON.stringify(row.findings)}`);
        assert.equal(row.path, row.locale === "tr" ? `/tr/sayfa/${SLUG}` : `/${row.locale}/page/${SLUG}`);
      }
    });
  });

  test("content-day5 (catalogSeo) finds the new page's description already in place", async () => {
    await inRollback(async (tx) => {
      await withoutTerms(tx);
      await wheelTerms(tx);
      const report = await catalogSeo(tx);
      assert.ok(!report.updated.some((l) => l.includes(SLUG)), report.updated.join("\n"));
      assert.ok(report.skipped.includes(`page ${SLUG} seo.description: already up to date`), report.skipped.join("\n"));
    });
  });

  test("a document of the client's (any version) is kept; the missing page is still added", async () => {
    await inRollback(async (tx) => {
      await withoutTerms(tx);
      const own = { key: KEY, version: "2026-12 v1", title: { tr: "Kampanya Koşulları" }, body: { tr: "<p>Avukat onaylı metin.</p>" }, isCurrent: true };
      const [row] = await tx.insert(LD).values(own).returning({ id: LD.id });
      const report = await wheelTerms(tx);
      assert.ok(report.skipped.includes(`legal document "${KEY}" already exists (#${row.id}, version 2026-12 v1), left as is`), report.skipped.join("\n"));
      assert.equal(report.inserted.length, 1);
      assert.match(report.inserted[0], new RegExp(`/sayfa/${SLUG} `));
      const docs = await tx.select({ version: LD.version, body: LD.body }).from(LD).where(eq(LD.key, KEY));
      assert.deepEqual(docs, [{ version: "2026-12 v1", body: own.body }]);
      nothingToDo(await wheelTerms(tx));
    });
  });

  test("a page already showing the terms under another slug, or another page on the slug, is left alone", async () => {
    await inRollback(async (tx) => {
      await withoutTerms(tx);
      const [moved] = await tx
        .insert(P)
        .values({ slug: OTHER_SLUG, kind: "legal", title: { tr: "Kampanya koşulları" }, isPublished: true })
        .returning({ id: P.id });
      await tx.insert(PS).values({ pageId: moved.id, type: "legal_document", position: 0, content: { key: KEY } });
      const report = await wheelTerms(tx);
      assert.ok(report.skipped.includes(`the "${KEY}" document is already shown on /sayfa/${OTHER_SLUG} (pages #${moved.id}), left as is`), report.skipped.join("\n"));
      assert.deepEqual(await tx.select({ id: P.id }).from(P).where(eq(P.slug, SLUG)), [], "no second page with the terms");
      assert.equal(report.inserted.length, 1, "the document itself is still added");
    });
    await inRollback(async (tx) => {
      await withoutTerms(tx);
      const [taken] = await tx.insert(P).values({ slug: SLUG, kind: "custom", title: { tr: "Başka bir sayfa" }, isPublished: false }).returning({ id: P.id });
      const report = await wheelTerms(tx);
      assert.ok(report.skipped.includes(`/sayfa/${SLUG} already exists (pages #${taken.id}, custom) without the "${KEY}" document, left as is`), report.skipped.join("\n"));
      assert.deepEqual(await tx.select({ id: PS.id }).from(PS).where(eq(PS.pageId, taken.id)), [], "the client's page gets no section");
      const [still] = await tx.select({ kind: P.kind, isPublished: P.isPublished }).from(P).where(eq(P.id, taken.id));
      assert.deepEqual(still, { kind: "custom", isPublished: false });
    });
  });
});

describe("giftWheelConfig", () => {
  test("inserts the live row when the key has none; a second run has nothing to do", async () => {
    await inRollback(async (tx) => {
      await withoutWheelRow(tx);
      assert.equal((await readSettingsRow("giftWheel", asTx(tx))).value.enabled, false, "without a row the wheel is off");
      const first = await giftWheelConfig(tx);
      assert.equal(first.inserted.length, 1);
      assert.match(first.inserted[0], /^settings giftWheel: gift wheel on, 6 slices \(/);
      assert.deepEqual([first.updated, first.skipped], [[], []]);

      const [row] = await tx.select({ value: S.value }).from(S).where(eq(S.key, "giftWheel"));
      assert.deepEqual(row.value, giftWheelLiveSettings());
      const read = await readSettingsRow("giftWheel", asTx(tx));
      assert.equal(read.value.enabled, true);
      assert.equal(read.value.slices.length, 6);
      assert.ok(read.updatedAt, "a stored row");
      assert.ok(SETTINGS_INPUTS.giftWheel.safeParse(read.value).success, "the panel editor accepts it");

      const second = await giftWheelConfig(tx);
      nothingToDo(second);
      assert.deepEqual(second.skipped, ["settings giftWheel: a row already exists, already up to date"]);
    });
  });

  test("the client's own configuration is kept as it is", async () => {
    await inRollback(async (tx) => {
      await withoutWheelRow(tx);
      const live = giftWheelLiveSettings();
      const own = { ...live, enabled: false, round: 4, validityHours: 48, slices: live.slices.slice(0, 4) };
      await tx.insert(S).values({ key: "giftWheel", value: own });
      const report = await giftWheelConfig(tx);
      nothingToDo(report);
      assert.deepEqual(report.skipped, ["settings giftWheel: a row already exists, edited in the panel, left as is"]);
      const [row] = await tx.select({ value: S.value }).from(S).where(eq(S.key, "giftWheel"));
      assert.deepEqual(row.value, own);
    });
  });
});

describe("launchChecklist", () => {
  test("stores nothing", async () => {
    await inRollback(async (tx) => {
      const before = await Promise.all(SNAPSHOT_TABLES.map((t) => tx.execute(sql.raw(`select count(*)::text as n from "${t}"`))));
      const report = await launchChecklist(tx);
      nothingToDo(report);
      const afterRun = await Promise.all(SNAPSHOT_TABLES.map((t) => tx.execute(sql.raw(`select count(*)::text as n from "${t}"`))));
      assert.deepEqual(afterRun, before);
    });
  });
});

describe("the whole script", () => {
  test("on a database without the day-6 rows: everything once, then nothing to do", async () => {
    await inRollback(async (tx) => {
      await withoutTerms(tx);
      await withoutWheelRow(tx);
      const first = [];
      for (const step of STEPS) first.push(await step.run(tx));
      assert.deepEqual(first.map((r) => r.inserted.length), [2, 1, 0]);
      for (const step of STEPS) nothingToDo(await step.run(tx));
    });
  });
});
