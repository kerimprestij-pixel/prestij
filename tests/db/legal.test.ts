// Versioned legal documents against the local PostgreSQL: publish (old row isCurrent=false, new row
// current, in one transaction), optimistic lock, unique version labels, the one-current-per-key index,
// restore, legal page title follow-up, and the checkout loader reading the new version. Almost every
// test runs inside a transaction that is rolled back; the one committed Server Action round trip is
// undone right away. The final hook checks rows, legal pages and the id sequence are back to the start.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/legal.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadCheckoutLegalDocs } from "@/lib/orders/legal-docs";
import { executePanelAction } from "@/lib/panel/action-core";
import { PanelError } from "@/lib/panel/errors";
import { cleanStoredBody, splitLocalizedBody } from "@/lib/panel/legal/schemas";
import { getLegalEditorData, legalPagesFor, legalPublishOptions, listLegalDocuments, publishLegalVersion, restoreLegalVersion } from "@/lib/panel/legal/service";
import type { Tx } from "@/lib/panel/tx";
import type { StaffSession } from "@/lib/session";

const ACTOR_ID = "settings-legal-test-actor";
const ACTOR = {
  user: { id: ACTOR_ID, name: "Settings Legal Test", email: "settings-legal@test.local", role: "admin", banned: false },
  session: { id: "settings-legal-test-session" },
  staffRole: "admin",
} as unknown as StaffSession;

const L = schema.legalDocuments;
class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back (other agents never see these rows). */
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

async function snapshotLegal() {
  const rows = await db.select().from(L).orderBy(L.id);
  return JSON.stringify(rows);
}
async function snapshotLegalPages() {
  const rows = await db
    .select({ id: schema.pages.id, title: schema.pages.title, seo: schema.pages.seo, updatedAt: schema.pages.updatedAt })
    .from(schema.pages)
    .where(eq(schema.pages.kind, "legal"))
    .orderBy(schema.pages.id);
  return JSON.stringify(rows);
}
async function readSequence(name = "legal_documents_id_seq") {
  const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${name}`));
  return { last_value: row.last_value, is_called: row.is_called };
}

/** Puts a sequence back unless someone else inserted rows meanwhile (other agents share the DB). */
async function restoreSequence(table: string, name: string, snap: { last_value: string; is_called: boolean }) {
  const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${table}`));
  if (max === null || Number(max) <= Number(snap.last_value)) {
    await db.execute(sql`select setval(${name}::regclass, ${snap.last_value}::bigint, ${snap.is_called})`);
  }
}

let legalBefore: string;
let pagesBefore: string;
let seqBefore: { last_value: string; is_called: boolean };
let auditSeqBefore: { last_value: string; is_called: boolean };

async function currentOf(executor: Tx, key: string) {
  const [row] = await executor.select().from(L).where(and(eq(L.key, key), eq(L.isCurrent, true)));
  assert.ok(row, `${key} has a current version`);
  return row;
}

/** A publish payload built from the current version (as the editor sends it). */
function payloadFrom(row: typeof L.$inferSelect, over: Partial<Parameters<typeof publishLegalVersion>[1]> = {}) {
  const parts = splitLocalizedBody(row.body);
  return {
    key: row.key,
    baseId: row.id,
    baseUpdatedAt: row.updatedAt,
    version: "sl-test-2",
    title: row.title,
    showNotice: parts.hasNotice,
    notice: parts.notice,
    body: parts.body,
    ...over,
  };
}

async function expectPanelError(promise: Promise<unknown>, code: string, field?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PanelError, String(error));
    assert.equal(error.code, code);
    if (field) assert.ok(error.fieldErrors?.[field], `field error at ${field}`);
    return true;
  });
}

async function oneCurrentPerKey(executor: Tx = db as unknown as Tx) {
  const rows = await executor
    .select({ key: L.key, current: sql<number>`count(*) filter (where ${L.isCurrent})::int` })
    .from(L)
    .groupBy(L.key);
  for (const r of rows) assert.equal(r.current, 1, `${r.key}: exactly one current version`);
  return rows.length;
}

before(async () => {
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
  legalBefore = await snapshotLegal();
  pagesBefore = await snapshotLegalPages();
  seqBefore = await readSequence();
  auditSeqBefore = await readSequence("audit_log_id_seq");
});

after(async () => {
  try {
    await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
    await restoreSequence("legal_documents", "legal_documents_id_seq", seqBefore);
    await restoreSequence("audit_log", "audit_log_id_seq", auditSeqBefore);
    assert.equal(await snapshotLegal(), legalBefore, "legal_documents rows are back to the start");
    assert.equal(await snapshotLegalPages(), pagesBefore, "legal pages are back to the start");
    assert.deepEqual(await readSequence(), seqBefore, "legal_documents_id_seq is back to the start");
  } finally {
    await db.$client.end();
  }
});

describe("legal documents", () => {
  test("every key has exactly one current version", async () => {
    assert.ok((await oneCurrentPerKey()) >= 5);
  });

  test("list and editor data: current version, history, checkout keys, legal pages", async () => {
    const list = await listLegalDocuments();
    const ds = list.find((d) => d.key === "distance_sales");
    assert.ok(ds?.version && ds.checkout);
    assert.ok(ds.pages.some((p) => p.slug === "mesafeli-satis-sozlesmesi"));
    assert.equal(list.find((d) => d.key === "kvkk")?.checkout, false);
    const editor = await getLegalEditorData("kvkk");
    assert.ok(editor?.current);
    assert.equal(editor.versions.filter((v) => v.isCurrent).length, 1);
    assert.notEqual(editor.nextVersion, editor.current.version);
    assert.equal(await getLegalEditorData("yok_boyle_bir_metin"), null);
  });

  test("publish: the new row becomes current, the old one stays as history, checkout reads the new one", async () => {
    await inRollback(async (tx) => {
      const before = await currentOf(tx, "pre_information");
      const result = await publishLegalVersion(
        tx,
        payloadFrom(before, { body: { tr: "<h2>Yeni</h2><p>Güncel ön bilgilendirme <script>x</script>metni.</p>" } }),
      );
      const now = await currentOf(tx, "pre_information");
      assert.equal(now.id, result.id);
      assert.equal(now.version, "sl-test-2");
      assert.equal(now.body.tr.includes("<script"), false);
      assert.match(now.body.tr, /^<aside class="legal-draft" role="note">/);
      assert.deepEqual(now.seo, before.seo);
      const [old] = await tx.select().from(L).where(eq(L.id, before.id));
      assert.equal(old.isCurrent, false);
      assert.equal(old.body.tr, before.body.tr, "the old text is kept unchanged");
      assert.deepEqual(result.tags.sort(), ["legal", "pages"]);
      assert.equal(result.nextVersion, "sl-test-3");
      await oneCurrentPerKey(tx);
      const docs = await loadCheckoutLegalDocs(tx);
      assert.equal(docs.preInformation?.version, "sl-test-2");
      assert.match(docs.preInformation?.body.tr ?? "", /Güncel ön bilgilendirme metni/);
    });
  });

  test("optimistic lock: a stale updatedAt or an older base version is a conflict", async () => {
    await inRollback(async (tx) => {
      const row = await currentOf(tx, "kvkk");
      await expectPanelError(publishLegalVersion(tx, payloadFrom(row, { baseUpdatedAt: new Date(row.updatedAt.getTime() - 1000) })), "conflict");
      await expectPanelError(publishLegalVersion(tx, payloadFrom(row, { baseId: row.id + 100000 })), "conflict");
      await expectPanelError(publishLegalVersion(tx, payloadFrom(row, { baseId: null, baseUpdatedAt: null })), "conflict");
      // A second editor who loaded the same base loses after the first one published.
      await publishLegalVersion(tx, payloadFrom(row));
      await expectPanelError(publishLegalVersion(tx, payloadFrom(row, { version: "sl-test-other" })), "conflict");
      await expectPanelError(publishLegalVersion(tx, { ...payloadFrom(row), key: "yok_boyle_bir_metin", baseId: null, baseUpdatedAt: null }), "not_found");
    });
  });

  test("version labels are unique per key, ignoring case", async () => {
    await inRollback(async (tx) => {
      const row = await currentOf(tx, "returns");
      await expectPanelError(publishLegalVersion(tx, payloadFrom(row, { version: row.version.toUpperCase() })), "invalid", "version");
      // The same label on another key is fine.
      const cookies = await currentOf(tx, "cookies");
      await publishLegalVersion(tx, payloadFrom(cookies, { version: "sl-test-shared" }));
      await publishLegalVersion(tx, payloadFrom(row, { version: "sl-test-shared" }));
    });
  });

  test("the database refuses a second current version of a key", async () => {
    await inRollback(async (tx) => {
      const row = await currentOf(tx, "kvkk");
      await assert.rejects(
        tx.transaction(async (sp) => {
          await sp.insert(L).values({ key: row.key, version: "sl-test-dup", title: row.title, body: row.body, isCurrent: true });
        }),
        (error: unknown) => /legal_documents_one_current|duplicate key/i.test(String((error as { cause?: unknown }).cause ?? error)),
      );
    });
  });

  test("restore publishes a copy of an older version as a new current version", async () => {
    await inRollback(async (tx) => {
      const original = await currentOf(tx, "kvkk");
      const published = await publishLegalVersion(
        tx,
        payloadFrom(original, { title: { tr: "Kişisel Veriler (sl-test)" }, body: { tr: "<p>Geçici metin</p>" }, showNotice: false }),
      );
      const restored = await restoreLegalVersion(tx, { key: "kvkk", sourceId: original.id, version: "sl-test-3", baseId: published.id, baseUpdatedAt: published.updatedAt });
      const now = await currentOf(tx, "kvkk");
      assert.equal(now.id, restored.id);
      assert.deepEqual(now.title, original.title);
      assert.deepEqual(now.body, cleanStoredBody(original.body));
      assert.deepEqual(splitLocalizedBody(now.body).body, splitLocalizedBody(original.body).body);
      await oneCurrentPerKey(tx);
      // A version of another key cannot be restored here.
      const other = await currentOf(tx, "returns");
      await expectPanelError(
        restoreLegalVersion(tx, { key: "kvkk", sourceId: other.id, version: "sl-test-4", baseId: now.id, baseUpdatedAt: now.updatedAt }),
        "not_found",
      );
    });
  });

  test("a renamed document renames its legal page, unless the page title was customised", async () => {
    await inRollback(async (tx) => {
      const row = await currentOf(tx, "returns");
      const [page] = (await legalPagesFor(["returns"], tx)).get("returns") ?? [];
      assert.ok(page, "returns has a legal page");
      const renamed = { tr: "İade Koşulları (sl-test)", en: "Returns (sl-test)" };
      const first = await publishLegalVersion(tx, payloadFrom(row, { title: renamed }));
      assert.ok(first.tags.includes(`page:${page.slug}`));
      const [after1] = await tx.select().from(schema.pages).where(eq(schema.pages.id, page.id));
      assert.deepEqual(after1.title, renamed);
      if (after1.seo?.title) assert.deepEqual(after1.seo.title, renamed);
      assert.ok(first.audit.some((a) => a.entity === "page" && a.entityId === page.id));

      await tx.update(schema.pages).set({ title: { tr: "Özel sayfa başlığı" } }).where(eq(schema.pages.id, page.id));
      const now = await currentOf(tx, "returns");
      const second = await publishLegalVersion(tx, payloadFrom(now, { version: "sl-test-3", title: { tr: "Yine yeni ad (sl-test)" } }));
      const [after2] = await tx.select().from(schema.pages).where(eq(schema.pages.id, page.id));
      assert.deepEqual(after2.title, { tr: "Özel sayfa başlığı" });
      assert.ok(second.tags.includes("legal"));
    });
  });

  test("Server Action path: schema, audit row, tags; then undone", async () => {
    const row = await currentOf(db as unknown as Tx, "cookies");
    const parts = splitLocalizedBody(row.body);
    const created: number[] = [];
    try {
      const invalid = await executePanelAction(legalPublishOptions, ACTOR, {
        key: "cookies",
        baseId: row.id,
        baseUpdatedAt: row.updatedAt.toISOString(),
        version: " ",
        title: { tr: "" },
        showNotice: true,
        notice: { tr: "" },
        body: { tr: "<p></p>" },
      });
      assert.equal(invalid.result.ok, false);
      if (!invalid.result.ok) {
        assert.equal(invalid.result.code, "invalid");
        for (const key of ["version", "title.tr", "notice.tr", "body.tr"]) assert.ok(invalid.result.fieldErrors?.[key], key);
      }

      const { result, tags } = await executePanelAction(legalPublishOptions, ACTOR, {
        key: "cookies",
        baseId: row.id,
        baseUpdatedAt: row.updatedAt.toISOString(),
        version: "sl-test-action",
        title: row.title,
        showNotice: parts.hasNotice,
        notice: parts.notice,
        body: parts.body,
      });
      assert.ok(result.ok, JSON.stringify(result));
      if (!result.ok || !result.data) return;
      created.push(result.data.id);
      assert.deepEqual(tags.sort(), ["legal", "pages"]);
      assert.match(result.message ?? "", /Sitedeki sayfa/);
      const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
      assert.equal(audit.length, 1);
      assert.equal(audit[0].action, "publish");
      assert.equal(audit[0].entity, "legal_document");
      assert.equal(audit[0].entityId, String(result.data.id));
      assert.equal((audit[0].before as { version: string }).version, row.version);
      assert.equal((await currentOf(db as unknown as Tx, "cookies")).version, "sl-test-action");
    } finally {
      // Undo: drop the new version first (partial unique index), then the original is current again.
      if (created.length) await db.delete(L).where(inArray(L.id, created));
      await db.update(L).set({ isCurrent: true, updatedAt: row.updatedAt }).where(eq(L.id, row.id));
      await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
    }
    assert.equal((await currentOf(db as unknown as Tx, "cookies")).id, row.id);
  });
});
