// Day-3 panel core against the local PostgreSQL: executePanelAction (the session-free half of
// panelAction) with a fake actor, recordMove chains/loops, mediaUsage, upload → alt edit (optimistic
// lock) → delete. Every row, audit entry and file it creates is removed again; the final hook checks
// that the row counts are back where they started.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/panel-core.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { db, schema } from "@/db";
import { LocalStorage } from "@/lib/media/storage";
import { toPayloadFormData } from "@/lib/panel/action-types";
import { executePanelAction } from "@/lib/panel/action-core";
import { PanelError } from "@/lib/panel/errors";
import { collectMediaUsage, listMedia, mediaIdsInJson, mediaUsage } from "@/lib/panel/media/queries";
import { deleteMediaRow, updateMediaAlt, uploadMediaFiles } from "@/lib/panel/media/service";
import { dropRedirectsTo, normalizeRedirectPath, recordMove } from "@/lib/panel/redirects";
import { positiveKurusInput } from "@/lib/panel/schemas";
import type { StaffSession } from "@/lib/session";

const ACTOR_ID = "core-server-test-actor";
const ACTOR = {
  user: { id: ACTOR_ID, name: "Core Server Test", email: "core-server@test.local", role: "editor", banned: false },
  session: { id: "core-server-test-session" },
  staffRole: "editor",
} as unknown as StaffSession;
const P = "/urunler/cs-test-"; // redirect paths owned by this file
const FOLDER = "core-server-test";

const COUNT_TABLES = ["media", "redirects", "audit_log", "page_sections", "products", "settings"] as const;
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
  await db.delete(schema.redirects).where(or(like(schema.redirects.fromPath, `${P}%`), like(schema.redirects.toPath, `${P}%`)));
  const leftovers = await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.folder, FOLDER));
  if (leftovers.length) await db.delete(schema.media).where(inArray(schema.media.id, leftovers.map((r) => r.id)));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
}

const SEQ_TABLES = ["media", "redirects", "audit_log"] as const;
type SeqState = { table: string; name: string; lastValue: string; isCalled: boolean };
let sequences: SeqState[] = [];

async function readSequences(): Promise<SeqState[]> {
  const out: SeqState[] = [];
  for (const table of SEQ_TABLES) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    out.push({ table, name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
  return out;
}

/** Puts the id sequences back, unless someone else inserted rows meanwhile (other agents share the DB). */
async function restoreSequences() {
  for (const s of sequences) {
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${s.table}`));
    if (max === null || Number(max) <= Number(s.lastValue)) {
      await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
  }
}

async function redirectRows() {
  const rows = await db
    .select({ from: schema.redirects.fromPath, to: schema.redirects.toPath })
    .from(schema.redirects)
    .where(or(like(schema.redirects.fromPath, `${P}%`), like(schema.redirects.toPath, `${P}%`)));
  return rows.map((r) => `${r.from}>${r.to}`).sort();
}

before(async () => {
  await cleanup();
  counts = await countRows();
  sequences = await readSequences();
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "prestij-core-server-"));
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

describe("executePanelAction", () => {
  const redirectSchema = z.object({ from: z.string(), to: z.string() });

  test("unreadable payload → invalid", async () => {
    const form = new FormData();
    form.set("payload", "{not json");
    const { result, tags } = await executePanelAction({ schema: redirectSchema, run: async () => ({}) }, ACTOR, form);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, "invalid");
    assert.deepEqual(tags, []);
    const missing = await executePanelAction({ schema: redirectSchema, run: async () => ({}) }, ACTOR, new FormData());
    assert.equal(!missing.result.ok && missing.result.code, "invalid");
  });

  test("schema errors come back with dotted paths and Turkish messages", async () => {
    const s = z.object({ items: z.array(z.object({ price: positiveKurusInput })) });
    const { result } = await executePanelAction({ schema: s, run: async () => ({}) }, ACTOR, toPayloadFormData({ items: [{ price: 100 }, { price: 0 }] }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "invalid");
    assert.equal(result.fieldErrors?.["items.1.price"], "Tutar sıfırdan büyük olmalı.");
    assert.equal(result.error, "Lütfen işaretli alanları düzeltin.");
  });

  test("success: one transaction, audit rows with the actor, deduplicated tags, afterCommit", async () => {
    let committed = false;
    const { result, tags } = await executePanelAction(
      {
        schema: redirectSchema,
        run: async (input, { tx, actor }) => {
          await tx.insert(schema.redirects).values({ fromPath: input.from, toPath: input.to });
          return {
            data: { actor: actor.user.id },
            message: "Kaydedildi.",
            tags: ["redirects", "redirects", "products", ""],
            audit: [
              { action: "create", entity: "redirect", entityId: input.from, after: { ...input, password: "never-stored", token: "x" } },
              { action: "note", entity: "redirect", actorId: null },
            ],
            afterCommit: () => {
              committed = true;
            },
          };
        },
      },
      ACTOR,
      toPayloadFormData({ from: `${P}a`, to: `${P}b` }),
    );
    assert.deepEqual(result, { ok: true, data: { actor: ACTOR_ID }, message: "Kaydedildi." });
    assert.deepEqual(tags, ["redirects", "products"]);
    assert.equal(committed, true);
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, `${P}a`));
    assert.equal(audits.length, 1);
    assert.equal(audits[0].userId, ACTOR_ID);
    assert.deepEqual(audits[0].after, { from: `${P}a`, to: `${P}b` }, "secret-looking keys are dropped");
    const system = await db.select().from(schema.auditLog).where(sql`${schema.auditLog.entity} = 'redirect' and ${schema.auditLog.action} = 'note' and ${schema.auditLog.userId} is null`);
    assert.equal(system.length, 1);
    await db.delete(schema.auditLog).where(eq(schema.auditLog.id, system[0].id));
    await db.delete(schema.redirects).where(eq(schema.redirects.fromPath, `${P}a`));
  });

  test("a PanelError rolls everything back (rows and audit) and is returned as is", async () => {
    const { result } = await executePanelAction(
      {
        schema: redirectSchema,
        run: async (input, { tx }) => {
          await tx.insert(schema.redirects).values({ fromPath: input.from, toPath: input.to });
          await tx.insert(schema.auditLog).values({ userId: ACTOR_ID, action: "x", entity: "redirect", entityId: `${P}rollback` });
          throw new PanelError("conflict", "Bu kayıt siz düzenlerken başka biri tarafından değiştirildi. Sayfayı yenileyin.", { name: "x" });
        },
      },
      ACTOR,
      toPayloadFormData({ from: `${P}rollback`, to: `${P}b` }),
    );
    assert.deepEqual(result, {
      ok: false,
      code: "conflict",
      error: "Bu kayıt siz düzenlerken başka biri tarafından değiştirildi. Sayfayı yenileyin.",
      fieldErrors: { name: "x" },
    });
    assert.deepEqual(await redirectRows(), []);
    assert.equal((await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, `${P}rollback`))).length, 0);
  });

  test("unique violation → invalid; unknown errors → generic message, logged without the message", async () => {
    const dup = await executePanelAction(
      {
        schema: redirectSchema,
        run: async (input, { tx }) => {
          await tx.insert(schema.redirects).values({ fromPath: input.from, toPath: input.to });
          await tx.insert(schema.redirects).values({ fromPath: input.from, toPath: input.to });
          return {};
        },
      },
      ACTOR,
      toPayloadFormData({ from: `${P}dup`, to: `${P}b` }),
    );
    assert.equal(!dup.result.ok && dup.result.code, "invalid");
    assert.deepEqual(await redirectRows(), []);

    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      const boom = await executePanelAction(
        { schema: redirectSchema, run: async () => { throw new Error("boom: buyer@example.com 05321234567"); } },
        ACTOR,
        toPayloadFormData({ from: "x", to: "y" }),
      );
      assert.deepEqual(boom.result, { ok: false, code: "server", error: "İşlem kaydedilemedi. Lütfen tekrar deneyin." });
    } finally {
      console.error = original;
    }
    assert.equal(logged.length, 1);
    assert.ok(!JSON.stringify(logged).includes("buyer@example.com"), "the error message (PII) is not logged");
  });
});

describe("recordMove", () => {
  const move = (from: string, to: string) => db.transaction((tx) => recordMove(tx, `${P}${from}`, `${P}${to}`));

  test("normalizes paths and refuses non-canonical ones", () => {
    assert.equal(normalizeRedirectPath(" /urunler/Eski/ "), "/urunler/eski");
    for (const bad of ["urunler/x", "/urunler/x y", "//evil", "/urunler/../x", "https://x.com/a", "/urunler/ç"]) {
      assert.throws(() => normalizeRedirectPath(bad), PanelError, bad);
    }
  });

  test("x→a + a→b collapses to x→b and a→b", async () => {
    assert.equal(await move("x", "a"), true);
    assert.deepEqual(await redirectRows(), [`${P}x>${P}a`]);
    await move("a", "b");
    assert.deepEqual(await redirectRows(), [`${P}a>${P}b`, `${P}x>${P}b`]);
    await move("b", "c");
    assert.deepEqual(await redirectRows(), [`${P}a>${P}c`, `${P}b>${P}c`, `${P}x>${P}c`]);
  });

  test("moving back to an old path removes the loop and keeps the others pointing at it", async () => {
    await move("c", "a"); // a is live again
    assert.deepEqual(await redirectRows(), [`${P}b>${P}a`, `${P}c>${P}a`, `${P}x>${P}a`]);
    assert.equal(await move("a", "a"), false, "same path is a no-op");
  });

  test("a→b then b→a leaves only b→a", async () => {
    await db.delete(schema.redirects).where(like(schema.redirects.fromPath, `${P}%`));
    await move("p", "q");
    await move("q", "p");
    assert.deepEqual(await redirectRows(), [`${P}q>${P}p`]);
  });

  test("dropRedirectsTo removes the redirects to and from a deleted target", async () => {
    await move("r", "p");
    assert.deepEqual(await redirectRows(), [`${P}q>${P}p`, `${P}r>${P}p`]);
    assert.equal(await db.transaction((tx) => dropRedirectsTo(tx, `${P}p`)), 2);
    assert.deepEqual(await redirectRows(), []);
  });
});

describe("media", () => {
  let uploadedId = 0;
  let uploadedUpdatedAt = "";
  let uploadedKeys: string[] = [];

  test("mediaIdsInJson finds ids under image/media keys at any depth", () => {
    const ids = mediaIdsInJson({ imageId: 1, mobileImageId: "2", items: [{ imageId: 3, productId: 99 }, { mediaIds: [4, "x", 5] }], productIds: [7], seo: { ogImageId: 6 } });
    assert.deepEqual([...ids].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  });

  test("mediaUsage lists product images, page sections and settings logos", async () => {
    const [pm] = await db.select({ mediaId: schema.productMedia.mediaId, productId: schema.productMedia.productId }).from(schema.productMedia).limit(1);
    assert.ok(pm, "seeded product media exist");
    const usage = await mediaUsage(pm.mediaId);
    assert.ok(usage.some((u) => u.kind === "product_media" && u.href === `/panel/urunler/${pm.productId}`), JSON.stringify(usage));

    const sections = await db.select({ content: schema.pageSections.content, pageId: schema.pageSections.pageId }).from(schema.pageSections);
    const withImage = sections.map((s) => ({ ...s, ids: [...mediaIdsInJson(s.content)] })).find((s) => s.ids.length > 0);
    assert.ok(withImage, "a seeded section references an image");
    const sectionUsage = await mediaUsage(withImage.ids[0]);
    assert.ok(sectionUsage.some((u) => u.kind === "section" && u.href === `/panel/sayfalar/${withImage.pageId}` && u.detail.startsWith("Bölüm: ")), JSON.stringify(sectionUsage));

    const [general] = await db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "general"));
    const lightId = (general?.value as { logo?: { lightId?: number } } | undefined)?.logo?.lightId;
    if (lightId) {
      const logoUsage = await mediaUsage(lightId);
      assert.ok(logoUsage.some((u) => u.kind === "settings" && u.detail === "Logo (açık zemin)"), JSON.stringify(logoUsage));
    }

    const [cat] = await db.select({ id: schema.categories.id, imageId: schema.categories.imageId }).from(schema.categories).where(sql`${schema.categories.imageId} is not null`).limit(1);
    if (cat?.imageId) {
      const map = await collectMediaUsage([cat.imageId, pm.mediaId]);
      assert.ok(map.get(cat.imageId)!.some((u) => u.kind === "category" && u.href === `/panel/kategoriler/${cat.id}`));
    }
  });

  test("an image in use cannot be deleted (in_use, places listed); nothing changes", async () => {
    const [pm] = await db.select({ mediaId: schema.productMedia.mediaId }).from(schema.productMedia).limit(1);
    await assert.rejects(
      db.transaction((tx) => deleteMediaRow(tx, pm.mediaId)),
      (e: unknown) => e instanceof PanelError && e.code === "in_use" && /kullanımda/.test(e.message),
    );
    const { result } = await executePanelAction(
      { schema: z.object({ id: z.number() }), run: async (input, { tx }) => { await deleteMediaRow(tx, input.id); return {}; } },
      ACTOR,
      toPayloadFormData({ id: pm.mediaId }),
    );
    assert.equal(!result.ok && result.code, "in_use");
    assert.equal((await db.select().from(schema.media).where(eq(schema.media.id, pm.mediaId))).length, 1);
  });

  test("upload: refused files store nothing", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#C2ADD1" } }).png().toBuffer();
    await assert.rejects(
      uploadMediaFiles([{ name: "ok.png", data: png }, { name: "kötü.svg", data: svg }], { folder: FOLDER, actorId: ACTOR_ID, storage }),
      (e: unknown) => e instanceof PanelError && e.code === "invalid" && /SVG/.test(e.message),
    );
    assert.equal((await db.select().from(schema.media).where(eq(schema.media.folder, FOLDER))).length, 0);
    await assert.rejects(uploadMediaFiles([], { folder: FOLDER, actorId: ACTOR_ID, storage }), PanelError);
  });

  test("upload: processed variants, row with original name, audit entry", async () => {
    const jpeg = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#8E61B6" } }).jpeg().toBuffer();
    const [item] = await uploadMediaFiles([{ name: "C:\\fakepath\\Lavanta Şişe.JPG", data: jpeg }], { folder: FOLDER, actorId: ACTOR_ID, storage });
    uploadedId = item.id;
    uploadedUpdatedAt = item.updatedAt;
    assert.equal(item.folder, FOLDER);
    assert.equal(item.originalName, "Lavanta Şişe.JPG");
    assert.equal(item.mime, "image/webp");
    assert.equal(item.width, 900);
    assert.match(item.url, /^\/uploads\/core-server-test\/lavanta-sise-[0-9a-f]{10}-900\.webp$/);
    const formats = new Set((item.variants ?? []).map((v) => v.format));
    assert.deepEqual([...formats].sort(), ["avif", "webp"]);
    uploadedKeys = (item.variants ?? []).map((v) => v.key);
    for (const key of uploadedKeys) assert.ok(existsSync(path.join(tmpDir, ...key.split("/"))), key);
    const audit = await db.select().from(schema.auditLog).where(sql`${schema.auditLog.entity} = 'media' and ${schema.auditLog.entityId} = ${String(item.id)}`);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "upload");
    assert.equal(audit[0].userId, ACTOR_ID);

    const listed = await listMedia({ q: "lavanta şişe", folder: FOLDER });
    assert.deepEqual(listed.items.map((m) => m.id), [item.id]);
    assert.ok(listed.folders.includes(FOLDER));
    const unused = await mediaUsage(item.id);
    assert.deepEqual(unused, []);
  });

  test("alt text: stale updatedAt → conflict, fresh → saved", async () => {
    assert.ok(uploadedId);
    const altSchema = z.object({ id: z.number(), alt: z.object({ tr: z.string() }).nullable(), updatedAt: z.string().transform((v) => new Date(v)) });
    const run = async (input: z.output<typeof altSchema>, { tx }: { tx: Parameters<typeof updateMediaAlt>[0] }) => {
      const { media } = await updateMediaAlt(tx, input);
      return { data: media.alt, audit: { action: "update", entity: "media", entityId: input.id } };
    };
    const stale = await executePanelAction({ schema: altSchema, run }, ACTOR, toPayloadFormData({ id: uploadedId, alt: { tr: "Eski" }, updatedAt: "2000-01-01T00:00:00.000Z" }));
    assert.equal(!stale.result.ok && stale.result.code, "conflict");
    const fresh = await executePanelAction({ schema: altSchema, run }, ACTOR, toPayloadFormData({ id: uploadedId, alt: { tr: "Lavanta şişesi" }, updatedAt: uploadedUpdatedAt }));
    assert.deepEqual(fresh.result, { ok: true, data: { tr: "Lavanta şişesi" } });
    const again = await executePanelAction({ schema: altSchema, run }, ACTOR, toPayloadFormData({ id: uploadedId, alt: { tr: "İkinci" }, updatedAt: uploadedUpdatedAt }));
    assert.equal(!again.result.ok && again.result.code, "conflict", "the first save changed updatedAt");
  });

  test("an unused upload is deleted with its files after commit", async () => {
    assert.ok(uploadedId);
    const { result } = await executePanelAction(
      {
        schema: z.object({ id: z.number() }),
        run: async (input, { tx }) => {
          const { removeFiles } = await deleteMediaRow(tx, input.id, { storage });
          return { afterCommit: removeFiles };
        },
      },
      ACTOR,
      toPayloadFormData({ id: uploadedId }),
    );
    assert.equal(result.ok, true);
    assert.equal((await db.select().from(schema.media).where(eq(schema.media.id, uploadedId))).length, 0);
    for (const key of uploadedKeys) assert.ok(!existsSync(path.join(tmpDir, ...key.split("/"))), key);
  });
});
