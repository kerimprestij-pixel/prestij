// Day 6 MEDIA-UPLOAD: the storage drivers of the direct upload flow (src/lib/media/storage.ts).
// SupabaseStorage is exercised against a fake fetch only (no network): the request shapes of upload
// signing, the browser's PUT target, authenticated HEAD stat, ranged reads, move, delete, the staging
// sweep listing, and the key-header fix (sb_secret_… only in `apikey`, legacy JWTs also as Bearer).
// LocalStorage: the local PUT target, streamed writes with a byte cap, ranged reads, move, stale listing.
//   npx tsx --test tests/unit/day6-media-upload-storage.test.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, afterEach, before, describe, test } from "node:test";
import {
  assertDriverUsable,
  INCOMING_PREFIX,
  isLegacyJwtKey,
  LocalStorage,
  storageDriver,
  SupabaseStorage,
  UploadTooLargeError,
} from "@/lib/media/storage";
import { MEDIA_UPLOAD } from "@/lib/panel/media/types";

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null };

const SUPABASE_URL = "https://proj.supabase.example";
const SECRET = "sb_secret_fake-test-key-0000000000";
const LEGACY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.ZmFrZS1zaWduYXR1cmU";

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let responder: (call: Call) => Response = () => new Response("{}", { status: 200 });

function installFetch() {
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    const body = typeof init.body === "string" ? init.body : init.body ? `<${(init.body as Uint8Array).byteLength} bytes>` : null;
    const call: Call = { url: String(input), method: init.method ?? "GET", headers, body };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
}

const env = (key = SECRET, extra: Record<string, string> = {}) =>
  ({ SUPABASE_URL: `${SUPABASE_URL}/`, SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_STORAGE_BUCKET: "media", ...extra }) as unknown as NodeJS.ProcessEnv;

describe("SupabaseStorage (fake fetch)", () => {
  before(installFetch);
  afterEach(() => {
    calls = [];
    responder = () => new Response("{}", { status: 200 });
  });
  after(() => {
    globalThis.fetch = realFetch;
  });

  test("key header fix: sb_secret_ only in apikey; a legacy JWT also as Bearer", async () => {
    assert.equal(isLegacyJwtKey(SECRET), false);
    assert.equal(isLegacyJwtKey(LEGACY), true);
    await new SupabaseStorage(env()).delete("a/b.webp");
    assert.equal(calls[0].headers.apikey, SECRET);
    assert.equal(calls[0].headers.authorization, undefined);
    await new SupabaseStorage(env(LEGACY)).delete("a/b.webp");
    assert.equal(calls[1].headers.apikey, LEGACY);
    assert.equal(calls[1].headers.authorization, `Bearer ${LEGACY}`);
  });

  test("put keeps working with the new headers (POST object, x-upsert, a year of caching)", async () => {
    const { url } = await new SupabaseStorage(env()).put("urunler/x-768.webp", Buffer.from("abc"), "image/webp");
    assert.equal(url, `${SUPABASE_URL}/storage/v1/object/public/media/urunler/x-768.webp`);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, `${SUPABASE_URL}/storage/v1/object/media/urunler/x-768.webp`);
    assert.equal(calls[0].headers["content-type"], "image/webp");
    assert.equal(calls[0].headers["x-upsert"], "true");
    assert.equal(calls[0].headers["cache-control"], "max-age=31536000");
    assert.equal(calls[0].headers.authorization, undefined);
  });

  test("createUploadTarget: POST upload/sign → the browser PUTs to the signed URL", async () => {
    responder = () => Response.json({ url: "/object/upload/sign/media/_incoming/abc/klip.mp4?token=tok123" });
    const target = await new SupabaseStorage(env()).createUploadTarget("_incoming/abc/klip.mp4", "video/mp4");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, `${SUPABASE_URL}/storage/v1/object/upload/sign/media/_incoming/abc/klip.mp4`);
    assert.equal(calls[0].body, "{}");
    assert.equal(calls[0].headers["content-type"], "application/json");
    assert.equal(calls[0].headers.apikey, SECRET);
    assert.equal(calls[0].headers["x-upsert"], undefined, "staging keys are never upserted");
    assert.equal(target.method, "PUT");
    assert.equal(target.url, `${SUPABASE_URL}/storage/v1/object/upload/sign/media/_incoming/abc/klip.mp4?token=tok123`);
    assert.deepEqual(target.headers, { "Content-Type": "video/mp4", "Cache-Control": "max-age=31536000", "x-upsert": "false" });
    assert.ok(!JSON.stringify(target).includes(SECRET), "the service key never reaches the browser");
  });

  test("createUploadTarget: a token field is used when given; the publishable key only when configured", async () => {
    responder = () => Response.json({ url: "/object/upload/sign/media/_incoming/a/b.png", token: "tok-field" });
    const target = await new SupabaseStorage(env(SECRET, { SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc" })).createUploadTarget("_incoming/a/b.png", "image/png");
    assert.equal(new URL(target.url).searchParams.get("token"), "tok-field");
    assert.equal(target.headers.apikey, "sb_publishable_abc");
  });

  test("createUploadTarget: errors (HTTP error, no URL, no token)", async () => {
    const storage = new SupabaseStorage(env());
    responder = () => new Response('{"statusCode":"403","error":"Unauthorized","message":"invalid key"}', { status: 403 });
    await assert.rejects(storage.createUploadTarget("_incoming/a/b.png", "image/png"), /403/);
    responder = () => Response.json({});
    await assert.rejects(storage.createUploadTarget("_incoming/a/b.png", "image/png"), /no URL/);
    responder = () => Response.json({ url: "/object/upload/sign/media/_incoming/a/b.png" });
    await assert.rejects(storage.createUploadTarget("_incoming/a/b.png", "image/png"), /no token/);
    await assert.rejects(storage.createUploadTarget("../x", "image/png"), /Invalid storage key/);
  });

  test("stat: authenticated HEAD on the object URL", async () => {
    responder = () => new Response(null, { status: 200, headers: { "content-length": "52428800" } });
    assert.deepEqual(await new SupabaseStorage(env()).stat("_incoming/a/b.mp4"), { bytes: 52_428_800 });
    assert.equal(calls[0].method, "HEAD");
    assert.equal(calls[0].url, `${SUPABASE_URL}/storage/v1/object/media/_incoming/a/b.mp4`);
    assert.equal(calls[0].headers.apikey, SECRET);
    responder = () => new Response(null, { status: 400 });
    assert.equal(await new SupabaseStorage(env()).stat("_incoming/a/missing.mp4"), null);
  });

  test("readRange: Range GET; 206, a server ignoring Range (200), 416 and 404", async () => {
    const storage = new SupabaseStorage(env());
    const file = Buffer.from(Array.from({ length: 100 }, (_, i) => i));
    responder = (call) => {
      const m = /bytes=(\d+)-(\d+)/.exec(call.headers.range ?? "")!;
      return new Response(file.subarray(Number(m[1]), Number(m[2]) + 1), { status: 206 });
    };
    assert.deepEqual([...(await storage.readRange("_incoming/a/b.mp4", 10, 13))!], [10, 11, 12, 13]);
    assert.equal(calls[0].headers.range, "bytes=10-13");
    assert.equal(calls[0].headers.apikey, SECRET);
    responder = () => new Response(file, { status: 200 });
    assert.deepEqual([...(await storage.readRange("_incoming/a/b.mp4", 98, 120))!], [98, 99]);
    responder = () => new Response(null, { status: 416 });
    assert.equal((await storage.readRange("_incoming/a/b.mp4", 500, 600))!.length, 0);
    responder = () => new Response("not found", { status: 404 });
    assert.equal(await storage.readRange("_incoming/a/b.mp4", 0, 1), null);
  });

  test("read: whole object, refused above the cap", async () => {
    const storage = new SupabaseStorage(env());
    responder = () => new Response(Buffer.alloc(10, 1), { status: 200, headers: { "content-length": "10" } });
    assert.equal((await storage.read("_incoming/a/b.png", 10))!.length, 10);
    responder = () => new Response(Buffer.alloc(11, 1), { status: 200, headers: { "content-length": "11" } });
    await assert.rejects(storage.read("_incoming/a/b.png", 10), UploadTooLargeError);
    responder = () => new Response(Buffer.alloc(11, 1), { status: 200 });
    await assert.rejects(storage.read("_incoming/a/b.png", 10), UploadTooLargeError, "no content-length: counted while reading");
    responder = () => new Response(null, { status: 404 });
    assert.equal(await storage.read("_incoming/a/b.png", 10), null);
  });

  test("move: POST /object/move { bucketId, sourceKey, destinationKey }", async () => {
    await new SupabaseStorage(env()).move("_incoming/a/klip.mp4", "urunler/klip-0123456789.mp4");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, `${SUPABASE_URL}/storage/v1/object/move`);
    assert.deepEqual(JSON.parse(calls[0].body!), { bucketId: "media", sourceKey: "_incoming/a/klip.mp4", destinationKey: "urunler/klip-0123456789.mp4" });
    responder = () => new Response("{}", { status: 400 });
    await assert.rejects(new SupabaseStorage(env()).move("_incoming/a/klip.mp4", "x/y.mp4"), /move failed/);
  });

  test("delete: 404 is fine, other errors throw", async () => {
    responder = () => new Response(null, { status: 404 });
    await new SupabaseStorage(env()).delete("_incoming/a/b.mp4");
    assert.equal(calls[0].method, "DELETE");
    responder = () => new Response("boom", { status: 500 });
    await assert.rejects(new SupabaseStorage(env()).delete("_incoming/a/b.mp4"), /500/);
  });

  test("listStale: lists _incoming/ folders, then their files, returns only old ones", async () => {
    const now = Date.UTC(2026, 10, 12, 12);
    responder = (call) => {
      const { prefix } = JSON.parse(call.body!) as { prefix: string };
      if (prefix === "_incoming/") return Response.json([{ name: "old", id: null }, { name: "new", id: null }]);
      if (prefix === "_incoming/old/") return Response.json([{ name: "klip.mp4", id: "1", created_at: new Date(now - 30 * 3600_000).toISOString() }]);
      if (prefix === "_incoming/new/") return Response.json([{ name: "foto.png", id: "2", created_at: new Date(now - 3600_000).toISOString() }]);
      return Response.json([]);
    };
    const keys = await new SupabaseStorage(env()).listStale(INCOMING_PREFIX, new Date(now - 24 * 3600_000), 100);
    assert.deepEqual(keys, ["_incoming/old/klip.mp4"]);
    assert.equal(calls[0].url, `${SUPABASE_URL}/storage/v1/object/list/media`);
    assert.deepEqual(JSON.parse(calls[0].body!), { prefix: "_incoming/", limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } });
  });

  test("missing configuration fails clearly", () => {
    assert.throws(() => new SupabaseStorage({} as NodeJS.ProcessEnv), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("driver selection", () => {
  test("STORAGE_DRIVER: local (default) | supabase; anything else throws", () => {
    assert.equal(storageDriver({} as NodeJS.ProcessEnv), "local");
    assert.equal(storageDriver({ STORAGE_DRIVER: " Supabase " } as unknown as NodeJS.ProcessEnv), "supabase");
    assert.throws(() => storageDriver({ STORAGE_DRIVER: "s3" } as unknown as NodeJS.ProcessEnv), /Unknown STORAGE_DRIVER/);
  });

  test("the local driver fails fast on Vercel (read-only file system)", () => {
    assert.throws(() => assertDriverUsable("local", { VERCEL: "1" } as unknown as NodeJS.ProcessEnv), /cannot store uploads on Vercel/);
    assert.doesNotThrow(() => assertDriverUsable("supabase", { VERCEL: "1" } as unknown as NodeJS.ProcessEnv));
    assert.doesNotThrow(() => assertDriverUsable("local", {} as NodeJS.ProcessEnv));
  });
});

describe("LocalStorage (temp dir)", () => {
  let root: string;
  let storage: LocalStorage;
  before(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "prestij-day6-local-"));
    storage = new LocalStorage(root, "/uploads");
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test("the PUT target is our own local route, with the ticket in the query", async () => {
    const target = await storage.createUploadTarget("_incoming/a/b.mp4", "video/mp4", { ticket: "v1.x+y/z" });
    assert.deepEqual(target, { method: "PUT", url: `${MEDIA_UPLOAD.direct.local}?ticket=v1.x%2By%2Fz`, headers: { "Content-Type": "video/mp4" } });
  });

  test("writeStream streams to disk; more than maxBytes aborts and leaves nothing", async () => {
    const data = Buffer.alloc(200_000, 9);
    const chunks = () => Readable.from([data.subarray(0, 70_000), data.subarray(70_000)]);
    assert.equal(await storage.writeStream("_incoming/r1/klip.mp4", chunks(), { maxBytes: data.length }), data.length);
    assert.deepEqual(readFileSync(path.join(root, "_incoming", "r1", "klip.mp4")), data);
    const web = new Blob([data]).stream();
    assert.equal(await storage.writeStream("_incoming/r1b/klip.mp4", web, { maxBytes: data.length }), data.length, "web ReadableStream body");
    await assert.rejects(storage.writeStream("_incoming/r2/klip.mp4", chunks(), { maxBytes: data.length - 1 }), UploadTooLargeError);
    assert.equal(existsSync(path.join(root, "_incoming", "r2", "klip.mp4")), false);
    await assert.rejects(storage.writeStream("../evil.mp4", chunks(), { maxBytes: 10 }), /Invalid storage key/);
  });

  test("readRange / read / stat", async () => {
    assert.deepEqual([...(await storage.readRange("_incoming/r1/klip.mp4", 0, 3))!], [9, 9, 9, 9]);
    assert.equal((await storage.readRange("_incoming/r1/klip.mp4", 199_998, 300_000))!.length, 2);
    assert.equal(await storage.readRange("_incoming/none/x.mp4", 0, 3), null);
    assert.equal((await storage.read("_incoming/r1/klip.mp4", 200_000))!.length, 200_000);
    await assert.rejects(storage.read("_incoming/r1/klip.mp4", 199_999), UploadTooLargeError);
    assert.deepEqual(await storage.stat("_incoming/r1/klip.mp4"), { bytes: 200_000 });
  });

  test("move renames into place and removes the empty staging folder", async () => {
    await storage.move("_incoming/r1/klip.mp4", "urunler/klip-0123456789.mp4");
    assert.ok(existsSync(path.join(root, "urunler", "klip-0123456789.mp4")));
    assert.equal(existsSync(path.join(root, "_incoming", "r1")), false);
    assert.ok(existsSync(path.join(root, "_incoming")), "the staging root itself stays");
  });

  test("listStale finds old staging files by mtime; delete prunes their folder", async () => {
    await storage.put("_incoming/old/a.png", Buffer.from("x"));
    await storage.put("_incoming/fresh/b.png", Buffer.from("y"));
    const old = new Date(Date.now() - 48 * 3600_000);
    utimesSync(path.join(root, "_incoming", "old", "a.png"), old, old);
    const keys = await storage.listStale(INCOMING_PREFIX, new Date(Date.now() - 24 * 3600_000), 50);
    assert.ok(keys.includes("_incoming/old/a.png"));
    assert.ok(!keys.includes("_incoming/fresh/b.png"));
    await storage.delete("_incoming/old/a.png");
    assert.equal(existsSync(path.join(root, "_incoming", "old")), false);
    assert.deepEqual(await storage.listStale("_incoming/missing/", new Date(), 5), []);
  });
});
