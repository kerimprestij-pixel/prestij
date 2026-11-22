// Day 6 MEDIA-UPLOAD against the local PostgreSQL with a temp LocalStorage: the direct upload flow end to
// end (ticket → streamed local PUT → complete) for images and videos, the cover link and its usage
// protection, kind filters and kind-aware reference checks, every refusal deleting its staging object,
// poster replacement/removal, a video delete taking its auto cover along, the staging sweep, and the
// legacy multipart service refusing videos. Throwaway rows in folder "day6-test-media" and audit rows
// of a fake actor; everything is removed again and the id sequences restored.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day6-media-upload-direct.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "@/db";
import { LocalStorage } from "@/lib/media/storage";
import { PanelError } from "@/lib/panel/errors";
import { completeDirectUpload, receiveLocalUpload, startDirectUpload } from "@/lib/panel/media/direct-upload";
import { pruneIncomingUploads } from "@/lib/panel/media/jobs";
import { collectMediaUsage, ensureMediaExist, listMedia, mediaRefsByKind } from "@/lib/panel/media/queries";
import { readUploadTicket } from "@/lib/panel/media/tickets";
import { deleteMediaRow, updateMediaPoster, uploadMediaFiles } from "@/lib/panel/media/service";
import { MEDIA_UPLOAD, type PanelMedia } from "@/lib/panel/media/types";
import type { Tx } from "@/lib/panel/tx";
import { createTokenSigner } from "@/lib/signed-token";
import { ftyp, mp4, webm } from "../unit/day6-media-upload-fixtures";

const ACTOR_ID = "day6-test-media-actor";
const FOLDER = "day6-test-media";
const signer = createTokenSigner("day6-media-upload-db-test-secret-0123456789");
let tmpDir: string;
let storage: LocalStorage;
let jpeg: Buffer;

type SeqState = { table: string; name: string; lastValue: string; isCalled: boolean };
let sequences: SeqState[] = [];

async function readSequences(): Promise<SeqState[]> {
  const out: SeqState[] = [];
  for (const table of ["media", "audit_log"]) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    out.push({ table, name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
  return out;
}

async function cleanup() {
  const rows = await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.folder, FOLDER));
  if (rows.length) {
    // Videos first (their poster_id points at the covers).
    await db.update(schema.media).set({ posterId: null }).where(inArray(schema.media.id, rows.map((r) => r.id)));
    await db.delete(schema.media).where(inArray(schema.media.id, rows.map((r) => r.id)));
  }
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
}

const folderRows = () => db.select().from(schema.media).where(eq(schema.media.folder, FOLDER));
const deps = () => ({ actorId: ACTOR_ID, storage, signer });
const incomingEntries = () => (existsSync(path.join(tmpDir, "_incoming")) ? readdirSync(path.join(tmpDir, "_incoming")) : []);

/** Ticket → streamed local PUT → complete, like the panel's browser does. */
async function upload(
  name: string,
  bytes: Uint8Array,
  type: string,
  kind: "image" | "video",
  extra: { meta?: { width?: number; height?: number; durationMs?: number }; posterId?: number | null; purpose?: "poster" } = {},
) {
  const { ticket, upload: target } = await startDirectUpload({ name, size: bytes.length, type, kind, folder: FOLDER }, deps());
  assert.ok(target.url.startsWith(`${MEDIA_UPLOAD.direct.local}?ticket=`));
  assert.equal(target.method, "PUT");
  const { bytes: written } = await receiveLocalUpload(ticket, Readable.from([Buffer.from(bytes)]), bytes.length, deps());
  assert.equal(written, bytes.length);
  return { ticket, result: await completeDirectUpload({ ticket, ...extra }, deps()) };
}

/** Ticket + PUT only (for refusal tests): returns the ticket and its staging key. */
async function stage(name: string, bytes: Uint8Array, type: string, kind: "image" | "video") {
  const { ticket } = await startDirectUpload({ name, size: bytes.length, type, kind, folder: FOLDER }, deps());
  await receiveLocalUpload(ticket, Readable.from([Buffer.from(bytes)]), bytes.length, deps());
  const [entry] = incomingEntries();
  assert.ok(entry, "staged");
  return { ticket };
}

const invalid = (pattern: RegExp) => (e: unknown) => e instanceof PanelError && e.code === "invalid" && pattern.test(e.message);

before(async () => {
  await cleanup();
  assert.equal((await folderRows()).length, 0, "no leftovers from an earlier run");
  sequences = await readSequences();
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "prestij-day6-direct-"));
  storage = new LocalStorage(tmpDir, "/uploads");
  jpeg = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#8E61B6" } }).jpeg().toBuffer();
});

after(async () => {
  try {
    await cleanup();
    for (const s of sequences) {
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${s.table}`));
      if (max === null || Number(max) <= Number(s.lastValue)) await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
    rmSync(tmpDir, { recursive: true, force: true });
    assert.equal((await folderRows()).length, 0);
  } finally {
    await db.$client.end();
  }
});

let poster: PanelMedia;
let video: PanelMedia;

describe("direct upload: images", () => {
  test("ticket → local PUT → complete: processed variants, staging removed, audit entry", async () => {
    const { result } = await upload("C:\\fakepath\\Lavanta Şişe.jpg", jpeg, "image/jpeg", "image");
    const item = result.item;
    assert.equal(item.kind, "image");
    assert.equal(item.mime, "image/webp");
    assert.equal(item.originalName, "Lavanta Şişe.jpg");
    assert.equal(item.width, 900);
    assert.match(item.url, /^\/uploads\/day6-test-media\/lavanta-sise-[0-9a-f]{10}-900\.webp$/);
    for (const v of item.variants ?? []) assert.ok(existsSync(path.join(tmpDir, ...v.key.split("/"))), v.key);
    assert.deepEqual([...new Set((item.variants ?? []).map((v) => v.format))].sort(), ["avif", "webp"]);
    assert.deepEqual(incomingEntries(), [], "staging object deleted after processing");
    const audit = await db.select().from(schema.auditLog).where(sql`${schema.auditLog.entity} = 'media' and ${schema.auditLog.entityId} = ${String(item.id)}`);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "upload");
  });

  test("a cover image (purpose poster) is tagged video-poster", async () => {
    const { result } = await upload("tanitim-kapak.jpg", jpeg, "image/jpeg", "image", { purpose: "poster" });
    poster = result.item;
    const [row] = await db.select({ tags: schema.media.tags }).from(schema.media).where(eq(schema.media.id, poster.id));
    assert.deepEqual(row.tags, [MEDIA_UPLOAD.posterTag]);
  });
});

describe("direct upload: videos", () => {
  test("MP4: moved to its final key, bytes win over the browser, cover linked (blur copied)", async () => {
    const bytes = mp4({ duration: 12_500, width: 1280, height: 720 });
    const { result } = await upload("Tanıtım.mp4", bytes, "video/mp4", "video", { meta: { width: 1280, height: 720, durationMs: 12_480 }, posterId: poster.id });
    video = result.item;
    assert.deepEqual(result.warnings, []);
    assert.equal(video.kind, "video");
    assert.equal(video.mime, "video/mp4");
    assert.equal(video.durationMs, 12_500, "mvhd beats the browser's 12 480 ms");
    assert.equal(video.width, 1280);
    assert.equal(video.height, 720);
    assert.equal(video.bytes, bytes.length);
    assert.equal(video.posterId, poster.id);
    assert.equal(video.poster?.id, poster.id);
    assert.equal(video.variants, null);
    assert.equal(video.blurDataUrl, poster.blurDataUrl);
    assert.equal(video.dominantColor, poster.dominantColor);
    assert.match(video.url, /^\/uploads\/day6-test-media\/tanitim-[0-9a-f]{10}\.mp4$/);
    assert.ok(existsSync(path.join(tmpDir, ...video.url.replace("/uploads/", "").split("/"))));
    assert.deepEqual(incomingEntries(), []);
    const [audit] = await db.select().from(schema.auditLog).where(sql`${schema.auditLog.entity} = 'media' and ${schema.auditLog.entityId} = ${String(video.id)}`);
    assert.equal((audit.after as { durationMs: number }).durationMs, 12_500);
  });

  test("kind filters: video / image / all", async () => {
    const videos = await listMedia({ folder: FOLDER, kind: "video" });
    assert.deepEqual(videos.items.map((m) => m.id), [video.id]);
    assert.equal(videos.items[0].poster?.id, poster.id);
    const images = await listMedia({ folder: FOLDER, kind: "image" });
    assert.ok(images.items.every((m) => m.kind === "image"));
    assert.ok(images.items.some((m) => m.id === poster.id));
    const all = await listMedia({ folder: FOLDER, kind: "all" });
    assert.equal(all.items.length, images.items.length + 1);
    const defaults = await listMedia({ folder: FOLDER });
    assert.ok(!defaults.items.some((m) => m.id === video.id), "default kind is image");
  });

  test("the cover is protected while its video uses it (own usage kind, link to the video)", async () => {
    const usage = (await collectMediaUsage([poster.id])).get(poster.id) ?? [];
    assert.deepEqual(usage, [{ kind: "video_poster", label: "Tanıtım.mp4", detail: "Video kapak görseli", href: `/panel/medya?medya=${video.id}` }]);
    await assert.rejects(
      db.transaction((tx) => deleteMediaRow(tx as unknown as Tx, poster.id, { storage })),
      (e: unknown) => e instanceof PanelError && e.code === "in_use" && /Video kapak görseli/.test(e.message),
    );
  });

  test("ensureMediaExist checks kinds (an image field never accepts a video)", async () => {
    await db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      await assert.rejects(ensureMediaExist(t, [video.id], "logo.lightId"), (e: unknown) => e instanceof PanelError && e.fieldErrors?.["logo.lightId"] === "Bu alana yalnızca görsel seçilebilir; seçtiğiniz dosya bir video.");
      await ensureMediaExist(t, [video.id], "videoMediaId", { kind: "video" });
      await assert.rejects(ensureMediaExist(t, [poster.id], "videoMediaId", { kind: "video" }), invalid(/yalnızca video/));
      await ensureMediaExist(t, [video.id, poster.id], "media", { kind: "all" });
      await assert.rejects(ensureMediaExist(t, [2_147_483_000], "videoMediaId", { kind: "video" }), invalid(/videolardan biri artık/));
    });
    assert.deepEqual(mediaRefsByKind({ videoMediaId: 5, posterImageId: "6", items: [{ imageId: 7 }, { videoMediaIds: [9] }], mediaIds: [8, 8] }), { image: [6, 7, 8], video: [5, 9] });
  });

  test("moov at the end: accepted with a faststart warning", async () => {
    const { result } = await upload("sonda.mp4", mp4({ faststart: false }), "video/mp4", "video", { meta: { width: 1280, height: 720, durationMs: 12_500 } });
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /optimize edilmemiş/);
  });

  test("WebM from a recorder: the browser's duration is used; without it the file is refused", async () => {
    const bytes = webm({ durationTicks: null, width: 640, height: 360 });
    const { result } = await upload("kayit.webm", bytes, "video/webm", "video", { meta: { width: 640, height: 360, durationMs: 3_200 } });
    assert.equal(result.item.mime, "video/webm");
    assert.equal(result.item.durationMs, 3_200);
    assert.match(result.item.url, /\.webm$/);
    assert.equal(result.item.poster, null);

    const { ticket } = await stage("kayit2.webm", bytes, "video/webm", "video");
    await assert.rejects(completeDirectUpload({ ticket }, deps()), invalid(/süresi okunamadı/));
    assert.deepEqual(incomingEntries(), [], "refused staging object deleted");
  });
});

describe("refusals delete the staging object and create no row", () => {
  test("type and container mismatches, MOV, HEVC, too long", async () => {
    const before = (await folderRows()).length;
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer();
    const cases: [string, Uint8Array, string, "image" | "video", RegExp][] = [
      ["sahte.mp4", png, "video/mp4", "video", /bir video dosyası değil/],
      ["sahte.png", mp4(), "image/png", "image", /bir video; görsel olarak yüklenemez/],
      ["iphone.mp4", Buffer.concat([Buffer.from(ftyp("qt  ", ["qt  "])), Buffer.alloc(64)]), "video/mp4", "video", /MOV.*MP4 \(H\.264\) olarak dışa aktarın/],
      ["hevc.mp4", mp4({ codec: "hvc1" }), "video/mp4", "video", /HEVC/],
      ["uzun.mp4", mp4({ duration: 120_000 }), "video/mp4", "video", /en fazla 90 saniye.*2:00/],
    ];
    for (const [name, bytes, type, kind, pattern] of cases) {
      const { ticket } = await stage(name, bytes, type, kind);
      await assert.rejects(completeDirectUpload({ ticket, meta: { width: 10, height: 10, durationMs: 1000 } }, deps()), invalid(pattern), name);
      assert.deepEqual(incomingEntries(), [], `${name}: staging deleted`);
    }
    assert.equal((await folderRows()).length, before);
  });

  test("size: wrong Content-Length, a longer body, a stored size that differs", async () => {
    const { ticket } = await startDirectUpload({ name: "a.jpg", size: jpeg.length, type: "image/jpeg", kind: "image", folder: FOLDER }, deps());
    await assert.rejects(receiveLocalUpload(ticket, Readable.from([jpeg]), jpeg.length + 1, deps()), invalid(/boyutla uyuşmuyor/));
    await assert.rejects(receiveLocalUpload(ticket, Readable.from([jpeg, Buffer.alloc(10)]), null, deps()), invalid(/boyuttan büyük/));
    assert.deepEqual(incomingEntries(), [], "nothing kept from an oversized body");

    const short = await startDirectUpload({ name: "b.jpg", size: jpeg.length, type: "image/jpeg", kind: "image", folder: FOLDER }, deps());
    await assert.rejects(receiveLocalUpload(short.ticket, Readable.from([jpeg.subarray(0, 100)]), null, deps()), invalid(/eksik ulaştı/));
    assert.deepEqual(incomingEntries(), []);

    // An object that differs from the ticket by the time complete runs (e.g. a replaced staging object).
    const third = await startDirectUpload({ name: "c.jpg", size: jpeg.length, type: "image/jpeg", kind: "image", folder: FOLDER }, deps());
    const key = readUploadTicket(third.ticket, ACTOR_ID, signer);
    assert.ok(key.ok);
    await storage.put(key.ticket.key, jpeg.subarray(0, 500));
    await assert.rejects(completeDirectUpload({ ticket: third.ticket }, deps()), invalid(/eksik ya da farklı yüklendi/));
    assert.equal(await storage.stat(key.ticket.key), null);
    await assert.rejects(completeDirectUpload({ ticket: third.ticket }, deps()), invalid(/depoya ulaşmadı/), "nothing stored");
  });

  test("tickets: another editor, a forged token; declared files refused at the ticket step", async () => {
    const { ticket } = await startDirectUpload({ name: "a.jpg", size: 10, type: "image/jpeg", kind: "image", folder: FOLDER }, deps());
    await assert.rejects(receiveLocalUpload(ticket, Readable.from([Buffer.alloc(10)]), 10, { ...deps(), actorId: "someone-else" }), invalid(/bileti geçersiz/));
    await assert.rejects(completeDirectUpload({ ticket: `${ticket}x` }, deps()), invalid(/bileti geçersiz/));
    await assert.rejects(startDirectUpload({ name: "a.mp4", size: 10, type: "video/mp4", kind: "image", folder: FOLDER }, deps()), invalid(/yalnızca görsel/));
    await assert.rejects(startDirectUpload({ name: "a.mov", size: 10, type: "video/quicktime", kind: "video", folder: FOLDER }, deps()), invalid(/MOV/));
    await assert.rejects(startDirectUpload({ name: "a.mp4", size: 60 * 1024 * 1024, type: "video/mp4", kind: "video", folder: FOLDER }, deps()), invalid(/50 MB/));
  });

  test("a video row cannot use another video as its cover (final file removed again)", async () => {
    const { ticket } = await stage("ikinci.mp4", mp4(), "video/mp4", "video");
    const filesBefore = readdirSync(path.join(tmpDir, FOLDER)).length;
    await assert.rejects(completeDirectUpload({ ticket, posterId: video.id }, deps()), invalid(/yalnızca bir görsel/));
    assert.equal(readdirSync(path.join(tmpDir, FOLDER)).length, filesBefore, "the moved file is deleted when the row fails");
  });
});

describe("covers and deletes", () => {
  test("updateMediaPoster: replace (the unused auto cover goes), remove, wrong kinds, stale editor", async () => {
    const { result: second } = await upload("yeni-kapak.jpg", jpeg, "image/jpeg", "image");
    const replaced = await db.transaction((tx) => updateMediaPoster(tx as unknown as Tx, { id: video.id, posterId: second.item.id, updatedAt: new Date(video.updatedAt) }, { storage }));
    assert.equal(replaced.media.posterId, second.item.id);
    assert.equal(replaced.before, poster.id);
    assert.deepEqual(replaced.removed.map((m) => m.id), [poster.id], "the auto cover, now unused, is deleted");
    await replaced.removeFiles();
    assert.equal((await db.select().from(schema.media).where(eq(schema.media.id, poster.id))).length, 0);
    for (const v of poster.variants ?? []) assert.equal(existsSync(path.join(tmpDir, ...v.key.split("/"))), false);

    await assert.rejects(
      db.transaction((tx) => updateMediaPoster(tx as unknown as Tx, { id: video.id, posterId: null, updatedAt: new Date(video.updatedAt) })),
      (e: unknown) => e instanceof PanelError && e.code === "conflict",
    );
    await assert.rejects(
      db.transaction((tx) => updateMediaPoster(tx as unknown as Tx, { id: second.item.id, posterId: null, updatedAt: new Date(second.item.updatedAt) })),
      invalid(/yalnızca videolara/),
    );
    await assert.rejects(
      db.transaction((tx) => updateMediaPoster(tx as unknown as Tx, { id: video.id, posterId: video.id, updatedAt: new Date(replaced.media.updatedAt) })),
      invalid(/kendi kapağı/),
    );
    const removed = await db.transaction((tx) => updateMediaPoster(tx as unknown as Tx, { id: video.id, posterId: null, updatedAt: new Date(replaced.media.updatedAt) }));
    assert.equal(removed.media.posterId, null);
    assert.equal(removed.media.blurDataUrl, null);
    assert.deepEqual(removed.removed, [], "a hand-picked (untagged) cover is never deleted");
    video = removed.media;
  });

  test("deleting a video takes its unused auto cover with it", async () => {
    const { result: cover } = await upload("klip-kapak.jpg", jpeg, "image/jpeg", "image", { purpose: "poster" });
    const { result: clip } = await upload("klip.mp4", mp4(), "video/mp4", "video", { posterId: cover.item.id });
    const outcome = await db.transaction((tx) => deleteMediaRow(tx as unknown as Tx, clip.item.id, { storage }));
    assert.equal(outcome.before.kind, "video");
    assert.deepEqual(outcome.alsoDeleted.map((m) => m.id), [cover.item.id]);
    await outcome.removeFiles();
    assert.equal(existsSync(path.join(tmpDir, ...clip.item.url.replace("/uploads/", "").split("/"))), false);
    assert.equal((await db.select().from(schema.media).where(inArray(schema.media.id, [clip.item.id, cover.item.id]))).length, 0);
  });
});

describe("staging sweep and legacy route", () => {
  test("pruneIncomingUploads deletes staging files older than a day, keeps fresh ones", async () => {
    await storage.put("_incoming/oldone/a.mp4", Buffer.from("x"));
    await storage.put("_incoming/fresh/b.mp4", Buffer.from("y"));
    const old = new Date(Date.now() - (MEDIA_UPLOAD.direct.incomingMaxAgeHours + 2) * 3600_000);
    utimesSync(path.join(tmpDir, "_incoming", "oldone", "a.mp4"), old, old);
    const counts = await pruneIncomingUploads(storage);
    assert.deepEqual(counts, { deleted: 1, failed: 0 });
    assert.deepEqual(incomingEntries(), ["fresh"]);
    await storage.delete("_incoming/fresh/b.mp4");
  });

  test("the legacy multipart service refuses videos with a pointer to the new flow", async () => {
    await assert.rejects(
      uploadMediaFiles([{ name: "klip.mp4", data: Buffer.from(mp4()) }], { folder: FOLDER, actorId: ACTOR_ID, storage }),
      invalid(/"klip\.mp4" bir video/),
    );
  });
});
