// CONTENT area against the local PostgreSQL: pages + sections (create, save with reorder/hide/edit/
// delete, optimistic lock, reference checks, slug move → redirect, fixed pages, delete guarded by
// links), announcements and menus. Runs the same schema+run definitions as the Server Actions
// (action-defs.ts) through executePanelAction with a fake editor. Shared rows (home page, menus,
// announcement order) are only changed inside transactions that are rolled back; every row, redirect
// and audit entry this file commits is removed again and the id sequences are restored.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/content.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { z } from "zod";
import { and, asc, eq, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { isSectionType } from "@/components/sections/schemas";
import { executePanelAction, type PanelActionOptions } from "@/lib/panel/action-core";
import {
  createPageDef,
  deleteAnnouncementDef,
  deletePageDef,
  saveAnnouncementDef,
  saveMenusDef,
  savePageDef,
} from "@/lib/panel/content/action-defs";
import { reorderAnnouncements } from "@/lib/panel/content/announcements-service";
import { saveMenus } from "@/lib/panel/content/menus-service";
import { getMenusEditorState, getPageEditorData, listPanelAnnouncements } from "@/lib/panel/content/queries";
import { menusSaveSchema } from "@/lib/panel/content/schemas";
import { loadSectionContent, normalizeSectionContent } from "@/lib/panel/content/sections";
import type { PageEditorState } from "@/lib/panel/content/types";
import { PanelError } from "@/lib/panel/errors";
import type { StaffSession } from "@/lib/session";

const ACTOR_ID = "content-test-actor";
const ACTOR = {
  user: { id: ACTOR_ID, name: "Content Test", email: "content@test.local", role: "editor", banned: false },
  session: { id: "content-test-session" },
  staffRole: "editor",
} as unknown as StaffSession;
const SLUG = "content-test-sayfa";
const SLUG2 = "content-test-yeni";
const TEXT = "content-test duyuru";

const COUNT_TABLES = ["pages", "page_sections", "announcements", "menus", "redirects", "audit_log"] as const;
const SEQ_TABLES = ["pages", "page_sections", "announcements", "redirects", "audit_log", "menus"] as const;
type SeqState = { table: string; name: string; lastValue: string; isCalled: boolean };

let counts: Record<string, number>;
let sequences: SeqState[] = [];
let pageId = 0;

class Rollback extends Error {}
/** Runs `fn` in a transaction that is always rolled back (for tests on shared rows). */
async function inRollback(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>) {
  await db
    .transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

async function countRows(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of COUNT_TABLES) {
    const rows = await db.execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${t}`));
    out[t] = Number(rows[0].n);
  }
  return out;
}

async function readSequences(): Promise<SeqState[]> {
  const out: SeqState[] = [];
  for (const table of SEQ_TABLES) {
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

async function cleanup() {
  await db.delete(schema.pages).where(like(schema.pages.slug, "content-test-%"));
  await db.delete(schema.announcements).where(sql`${schema.announcements.text}->>'tr' like ${`${TEXT}%`}`);
  await db
    .delete(schema.redirects)
    .where(or(like(schema.redirects.fromPath, "/sayfa/content-test-%"), like(schema.redirects.toPath, "/sayfa/content-test-%")));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
}

async function editorState(id: number): Promise<PageEditorState> {
  const data = await getPageEditorData(id);
  assert.ok(data, `page ${id} exists`);
  return data.page;
}

/** Loose view of an ActionResult for assertions. */
type Outcome<T> = { result: { ok: boolean; data?: T; code?: string; error?: string; fieldErrors?: Record<string, string> }; tags: string[] };

async function run<S extends z.ZodType, T>(def: Pick<PanelActionOptions<S, T>, "schema" | "run">, input: unknown): Promise<Outcome<T>> {
  const { result, tags } = await executePanelAction(def, ACTOR, input);
  return { result: result as Outcome<T>["result"], tags };
}

const newSection = (type: string, content: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  key: `new-${type}-${Math.random()}`,
  id: null,
  type,
  isVisible: true,
  audience: "all" as const,
  schedule: { startsAt: null, endsAt: null },
  content,
  ...extra,
});

before(async () => {
  await cleanup();
  counts = await countRows();
  sequences = await readSequences();
});

after(async () => {
  await cleanup();
  await restoreSequences();
  try {
    assert.deepEqual(await countRows(), counts, "row counts are back to the start");
  } finally {
    await db.$client.end();
  }
});

describe("pages", () => {
  test("create: an unpublished custom page; duplicate and reserved slugs are refused", async () => {
    const { result } = await run(createPageDef, { title: { tr: "Content Test" }, slug: SLUG });
    assert.equal(result.ok, true, JSON.stringify(result));
    pageId = result.data!.id;
    const [row] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
    assert.equal(row.kind, "custom");
    assert.equal(row.isPublished, false);

    const dup = await run(createPageDef, { title: { tr: "Kopya" }, slug: SLUG });
    assert.equal(dup.result.code, "invalid");
    assert.match(dup.result.fieldErrors?.slug ?? "", /başka bir sayfada/);

    const reserved = await run(createPageDef, { title: { tr: "Kurumsal" }, slug: "kurumsal" });
    assert.match(reserved.result.fieldErrors?.slug ?? "", /ayrılmış/);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, ACTOR_ID), eq(schema.auditLog.entity, "page"), eq(schema.auditLog.action, "create")));
    assert.equal(audit.length, 1);
  });

  test("save: sections are inserted in order, normalized and sanitized; page tags returned", async () => {
    const state = await editorState(pageId);
    const payload = {
      ...state,
      isPublished: true,
      seo: { ...state.seo, title: { tr: "Content Test SEO" } },
      sections: [
        newSection("hero", { headline: { tr: "  Test başlığı " }, eyebrow: { tr: "" }, primaryCta: { label: { tr: "Ürünler" }, href: "/urunler" } }),
        newSection("rich_text", { html: { tr: `<p onclick="x()">Merhaba<script>alert(1)</script></p>` } }),
        newSection("faq", { items: [{ question: { tr: "Soru 1" }, answer: { tr: "Cevap 1" } }, { question: { tr: "Soru 2" }, answer: { tr: "Cevap 2" } }] }),
      ],
    };
    const { result, tags } = await run(savePageDef, payload);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(new Set(tags), new Set(["pages", `page:${SLUG}`]));
    assert.equal(result.data!.sections.length, 3);

    const rows = await db.select().from(schema.pageSections).where(eq(schema.pageSections.pageId, pageId)).orderBy(asc(schema.pageSections.position));
    assert.deepEqual(rows.map((r) => [r.type, r.position]), [["hero", 0], ["rich_text", 1], ["faq", 2]]);
    assert.deepEqual(rows.map((r) => r.id), result.data!.sections.map((s) => s.id));
    const hero = rows[0].content as Record<string, unknown>;
    assert.deepEqual(hero.headline, { tr: "Test başlığı" });
    assert.equal("eyebrow" in hero, false);
    const html = ((rows[1].content as { html: { tr: string } }).html.tr);
    assert.ok(!/script|onclick/i.test(html), html);

    const [page] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
    assert.equal(page.isPublished, true);
    assert.deepEqual(page.seo, { title: { tr: "Content Test SEO" } });
  });

  test("a stale updatedAt is a conflict and writes nothing", async () => {
    const state = await editorState(pageId);
    const stale = { ...state, updatedAt: new Date(Date.parse(state.updatedAt) - 60_000).toISOString(), title: { tr: "Değişmemeli" } };
    const { result } = await run(savePageDef, stale);
    assert.equal(result.code, "conflict");
    const [page] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
    assert.deepEqual(page.title, { tr: "Content Test" });
  });

  test("reorder, hide, edit and delete in one save; untouched sections are not rewritten", async () => {
    const state = await editorState(pageId);
    const [hero, rich, faq] = state.sections;
    const before = await db.select().from(schema.pageSections).where(eq(schema.pageSections.pageId, pageId));
    const heroBefore = before.find((r) => r.id === hero.id)!;

    const editedRich = { ...rich, isVisible: false, content: { ...rich.content, html: { tr: "<p>Yeni metin</p>" } } };
    const { result } = await run(savePageDef, { ...state, sections: [hero, faq, editedRich] });
    assert.equal(result.ok, true, JSON.stringify(result));
    const rows = await db.select().from(schema.pageSections).where(eq(schema.pageSections.pageId, pageId)).orderBy(asc(schema.pageSections.position));
    assert.deepEqual(rows.map((r) => [r.type, r.position, r.isVisible]), [["hero", 0, true], ["faq", 1, true], ["rich_text", 2, false]]);
    assert.equal(rows[0].updatedAt.getTime(), heroBefore.updatedAt.getTime(), "the untouched hero row was not rewritten");
    assert.deepEqual((rows[2].content as { html: unknown }).html, { tr: "<p>Yeni metin</p>" });

    const next = await editorState(pageId);
    const removed = await run(savePageDef, { ...next, sections: next.sections.filter((s) => s.type !== "faq") });
    assert.equal(removed.result.ok, true);
    const left = await db.select({ type: schema.pageSections.type }).from(schema.pageSections).where(eq(schema.pageSections.pageId, pageId));
    assert.deepEqual(left.map((r) => r.type).sort(), ["hero", "rich_text"]);

    const audits = await db
      .select({ after: schema.auditLog.after })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, ACTOR_ID), eq(schema.auditLog.entity, "page"), eq(schema.auditLog.action, "update")));
    assert.equal(audits.length, 3);
  });

  test("refused: unknown type, a section of another page, a changed type, missing image or product", async () => {
    const state = await editorState(pageId);

    const unknown = await run(savePageDef, { ...state, sections: [newSection("marquee", {}), ...state.sections] });
    assert.equal(unknown.result.code, "invalid");
    assert.ok(unknown.result.fieldErrors?.["sections.0.type"]);

    const [foreign] = await db
      .select({ id: schema.pageSections.id, type: schema.pageSections.type, content: schema.pageSections.content })
      .from(schema.pageSections)
      .innerJoin(schema.pages, eq(schema.pages.id, schema.pageSections.pageId))
      .where(eq(schema.pages.slug, "home"))
      .limit(1);
    if (foreign) {
      const stolen = await run(savePageDef, {
        ...state,
        sections: [...state.sections, { ...newSection(foreign.type, loadSectionContent(foreign.type, foreign.content)), id: foreign.id }],
      });
      assert.equal(stolen.result.code, "conflict");
    }

    const retyped = await run(savePageDef, {
      ...state,
      sections: state.sections.map((s) => (s.type === "rich_text" ? { ...s, type: "faq", content: { items: [{ question: { tr: "S" }, answer: { tr: "C" } }] } } : s)),
    });
    assert.equal(retyped.result.code, "invalid");
    assert.ok(Object.keys(retyped.result.fieldErrors ?? {}).some((k) => /^sections\.\d+\.type$/.test(k)));

    const missingImage = await run(savePageDef, {
      ...state,
      sections: [newSection("image_banner", { imageId: 2_000_000_000, title: { tr: "Bant" } }), ...state.sections],
    });
    assert.equal(missingImage.result.code, "invalid");
    assert.ok(missingImage.result.fieldErrors?.["sections.0.content.imageId"], JSON.stringify(missingImage.result));

    const missingProduct = await run(savePageDef, {
      ...state,
      sections: [newSection("scent_showcase", { title: { tr: "Kokular" }, items: [{ productId: 2_000_000_000, imageId: null }] }), ...state.sections],
    });
    assert.ok(missingProduct.result.fieldErrors?.["sections.0.content.items.0.productId"], JSON.stringify(missingProduct.result));

    const unsafe = await run(savePageDef, {
      ...state,
      sections: [newSection("sample_cta", { title: { tr: "Numune" }, cta: { label: { tr: "Git" }, href: "javascript:alert(1)" } }), ...state.sections],
    });
    assert.ok(unsafe.result.fieldErrors?.["sections.0.content.cta.href"]);

    const count = await db.select({ id: schema.pageSections.id }).from(schema.pageSections).where(eq(schema.pageSections.pageId, pageId));
    assert.equal(count.length, 2, "nothing was written");
  });

  test("a slug change records a redirect; home and legal pages keep their address and stay published", async () => {
    const state = await editorState(pageId);
    const { result, tags } = await run(savePageDef, { ...state, slug: SLUG2 });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(tags.includes("redirects") && tags.includes(`page:${SLUG}`) && tags.includes(`page:${SLUG2}`), tags.join(","));
    const [redirect] = await db.select().from(schema.redirects).where(eq(schema.redirects.fromPath, `/sayfa/${SLUG}`));
    assert.equal(redirect?.toPath, `/sayfa/${SLUG2}`);

    const [home] = await db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.slug, "home"));
    if (home) {
      const homeState = await editorState(home.id);
      const moved = await run(savePageDef, { ...homeState, slug: "anasayfa" });
      assert.match(moved.result.fieldErrors?.slug ?? "", /sabit/);
      const hidden = await run(savePageDef, { ...homeState, isPublished: false });
      assert.ok(hidden.result.fieldErrors?.isPublished);
    }
  });

  test("delete: refused while an announcement links to the page; then page, sections and redirects go", async () => {
    const created = await run(saveAnnouncementDef, {
      id: null,
      text: { tr: `${TEXT} bağlantılı` },
      href: `/sayfa/${SLUG2}`,
      variant: "neutral",
      isActive: false,
      schedule: { startsAt: null, endsAt: null },
      updatedAt: null,
    });
    assert.equal(created.result.ok, true, JSON.stringify(created.result));

    const state = await editorState(pageId);
    const blocked = await run(deletePageDef, { id: pageId, updatedAt: state.updatedAt });
    assert.equal(blocked.result.code, "in_use");
    assert.match(blocked.result.error ?? "", /Duyuru/);

    const removedAnnouncement = await run(deleteAnnouncementDef, { id: created.result.data!.id, updatedAt: created.result.data!.updatedAt });
    assert.equal(removedAnnouncement.result.ok, true);

    const deleted = await run(deletePageDef, { id: pageId, updatedAt: state.updatedAt });
    assert.equal(deleted.result.ok, true, JSON.stringify(deleted.result));
    assert.ok(deleted.tags.includes("redirects") && deleted.tags.includes(`page:${SLUG2}`));
    assert.equal((await db.select().from(schema.pages).where(eq(schema.pages.id, pageId))).length, 0);
    assert.equal((await db.select().from(schema.pageSections).where(eq(schema.pageSections.pageId, pageId))).length, 0);
    assert.equal((await db.select().from(schema.redirects).where(like(schema.redirects.toPath, "/sayfa/content-test-%"))).length, 0);

    const [legal] = await db.select({ id: schema.pages.id, updatedAt: schema.pages.updatedAt }).from(schema.pages).where(eq(schema.pages.kind, "legal")).limit(1);
    if (legal) {
      const refused = await run(deletePageDef, { id: legal.id, updatedAt: legal.updatedAt.toISOString() });
      assert.equal(refused.result.code, "forbidden");
    }
  });

  test("every stored section can be saved by the editor as it is", async () => {
    const rows = await db.select({ id: schema.pageSections.id, type: schema.pageSections.type, content: schema.pageSections.content }).from(schema.pageSections);
    for (const row of rows) {
      if (!isSectionType(row.type)) continue;
      const result = normalizeSectionContent(row.type, loadSectionContent(row.type, row.content));
      assert.ok(result.ok, `section ${row.id} (${row.type}): ${result.ok ? "" : JSON.stringify(result.issues)}`);
    }
  });
});

describe("announcements", () => {
  test("create at the end, edit with the lock, reorder (rolled back), delete", async () => {
    const before = await listPanelAnnouncements();
    const created = await run(saveAnnouncementDef, {
      id: null,
      text: { tr: TEXT, en: "Test" },
      href: "/numune",
      variant: "accent",
      isActive: false,
      schedule: { startsAt: "2026-12-01T09:00", endsAt: "2026-12-31T21:00" },
      updatedAt: null,
    });
    assert.equal(created.result.ok, true, JSON.stringify(created.result));
    assert.deepEqual(created.tags, ["announcements"]);
    const id = created.result.data!.id;
    const [row] = await db.select().from(schema.announcements).where(eq(schema.announcements.id, id));
    assert.equal(row.position, Math.max(-1, ...before.map((a) => a.position)) + 1);
    assert.equal(row.startsAt?.toISOString(), "2026-12-01T06:00:00.000Z", "datetime-local is read as Istanbul time");

    const edit = { id, text: { tr: `${TEXT} düzenlendi` }, href: "", variant: "brand", isActive: false, schedule: { startsAt: null, endsAt: null } };
    const stale = await run(saveAnnouncementDef, { ...edit, updatedAt: new Date(row.updatedAt.getTime() - 1000).toISOString() });
    assert.equal(stale.result.code, "conflict");
    const saved = await run(saveAnnouncementDef, { ...edit, updatedAt: row.updatedAt.toISOString() });
    assert.equal(saved.result.ok, true);
    const [edited] = await db.select().from(schema.announcements).where(eq(schema.announcements.id, id));
    assert.equal(edited.href, null);
    assert.deepEqual(edited.text, { tr: `${TEXT} düzenlendi` });

    await inRollback(async (tx) => {
      const ids = (await listPanelAnnouncements(tx)).map((a) => a.id);
      const reversed = [...ids].reverse();
      const { audit } = await reorderAnnouncements(tx, reversed);
      assert.ok(audit);
      assert.deepEqual((await listPanelAnnouncements(tx)).map((a) => a.id), reversed);
      await assert.rejects(reorderAnnouncements(tx, reversed.slice(1)), (e) => e instanceof PanelError && e.code === "conflict");
    });

    const removed = await run(deleteAnnouncementDef, { id, updatedAt: saved.result.data!.updatedAt });
    assert.equal(removed.result.ok, true);
    assert.deepEqual((await listPanelAnnouncements()).map((a) => a.id), before.map((a) => a.id));
  });
});

describe("menus", () => {
  test("saving unchanged menus writes nothing", async () => {
    const state = await getMenusEditorState();
    const before = await db.select({ key: schema.menus.key, updatedAt: schema.menus.updatedAt }).from(schema.menus);
    const { result, tags } = await run(saveMenusDef, state);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.data?.changed, []);
    assert.deepEqual(tags, []);
    const afterRows = await db.select({ key: schema.menus.key, updatedAt: schema.menus.updatedAt }).from(schema.menus);
    assert.deepEqual(afterRows.map((r) => r.updatedAt.getTime()).sort(), before.map((r) => r.updatedAt.getTime()).sort());
  });

  test("a changed menu is saved and audited; a stale one is a conflict (rolled back)", async () => {
    const state = await getMenusEditorState();
    await inRollback(async (tx) => {
      const legal = state.menus.footer_legal;
      const payload = menusSaveSchema.parse({
        menus: { ...state.menus, footer_legal: { ...legal, items: [...legal.items].reverse().concat([{ label: { tr: "Test" }, href: "/sayfa/kvkk", highlight: true }]) } },
      });
      const { result, audit } = await saveMenus(tx, payload);
      assert.deepEqual(result.changed, ["footer_legal"]);
      assert.equal(audit.length, 1);
      const [row] = await tx.select().from(schema.menus).where(eq(schema.menus.key, "footer_legal"));
      assert.deepEqual(row.items.at(-1), { label: { tr: "Test" }, href: "/sayfa/kvkk", highlight: true });

      const stale = menusSaveSchema.parse({ menus: { ...state.menus } });
      await assert.rejects(saveMenus(tx, stale), (e) => e instanceof PanelError && e.code === "conflict");
    });
    const [row] = await db.select().from(schema.menus).where(eq(schema.menus.key, "footer_legal"));
    if (row) assert.equal(row.updatedAt.toISOString(), state.menus.footer_legal.updatedAt, "rolled back");
  });
});
