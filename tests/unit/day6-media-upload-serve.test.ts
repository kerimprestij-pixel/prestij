// Day 6 MEDIA-UPLOAD: serving local uploads with HTTP Range (src/app/uploads/serve.ts and the route):
// the Range parser, 206 for Safari's bytes=0-1, open/suffix ranges, 416, ignored multi-range, HEAD without
// a body, ETag/304, If-Range, streaming, and what is never served (_incoming/, unknown types, traversal).
//   npx tsx --test tests/unit/day6-media-upload-serve.test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { parseRange, serveUpload, UPLOAD_CONTENT_TYPES } from "@/app/uploads/serve";
import * as route from "@/app/uploads/[...key]/route";

describe("parseRange", () => {
  const size = 1000;
  test("single ranges", () => {
    assert.deepEqual(parseRange("bytes=0-1", size), { start: 0, end: 1 });
    assert.deepEqual(parseRange("bytes=100-", size), { start: 100, end: 999 });
    assert.deepEqual(parseRange("bytes=-200", size), { start: 800, end: 999 });
    assert.deepEqual(parseRange("bytes=-5000", size), { start: 0, end: 999 });
    assert.deepEqual(parseRange("bytes=900-5000", size), { start: 900, end: 999 }, "end clamped to the file");
    assert.deepEqual(parseRange(" BYTES = 5 - 9 ", size), { start: 5, end: 9 });
  });
  test("unsatisfiable", () => {
    assert.equal(parseRange("bytes=1000-", size), "unsatisfiable");
    assert.equal(parseRange("bytes=5-3", size), "unsatisfiable");
    assert.equal(parseRange("bytes=-0", size), "unsatisfiable");
    assert.equal(parseRange("bytes=0-", 0), "unsatisfiable");
  });
  test("absent, malformed or multi-range: ignored (whole file)", () => {
    for (const header of [null, "", "bytes=", "bytes=-", "items=0-1", "bytes=0-1,5-9", "bytes=a-b", "0-1"]) assert.equal(parseRange(header, size), null, String(header));
  });
});

describe("serveUpload", () => {
  let root: string;
  const video = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
  const get = (key: string, headers: Record<string, string> = {}, method = "GET") =>
    serveUpload(new Request(`http://check.localhost/uploads/${key}`, { method, headers }), key, root);

  before(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "prestij-day6-serve-"));
    mkdirSync(path.join(root, "urunler"), { recursive: true });
    mkdirSync(path.join(root, "_incoming", "abc"), { recursive: true });
    mkdirSync(path.join(root, "klasor.mp4"), { recursive: true });
    writeFileSync(path.join(root, "urunler", "tanitim.mp4"), video);
    writeFileSync(path.join(root, "urunler", "kayit.webm"), video.subarray(0, 100));
    writeFileSync(path.join(root, "urunler", "foto-768.webp"), Buffer.from("RIFFxxxxWEBP"));
    writeFileSync(path.join(root, "urunler", "bos.mp4"), Buffer.alloc(0));
    writeFileSync(path.join(root, "urunler", "notlar.txt"), "x");
    writeFileSync(path.join(root, "_incoming", "abc", "ham.mp4"), video);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test("no Range: 200, whole file streamed, Accept-Ranges and immutable caching", async () => {
    const res = await get("urunler/tanitim.mp4");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "video/mp4");
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal(res.headers.get("content-length"), "4096");
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("etag"));
    assert.ok(res.headers.get("last-modified"));
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), video);
  });

  test("Safari's first request (bytes=0-1): 206 with an exact Content-Range", async () => {
    const res = await get("urunler/tanitim.mp4", { range: "bytes=0-1" });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), "bytes 0-1/4096");
    assert.equal(res.headers.get("content-length"), "2");
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0, 1]);
  });

  test("open-ended and suffix ranges", async () => {
    const tail = await get("urunler/tanitim.mp4", { range: "bytes=4000-" });
    assert.equal(tail.status, 206);
    assert.equal(tail.headers.get("content-range"), "bytes 4000-4095/4096");
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), video.subarray(4000));
    const suffix = await get("urunler/tanitim.mp4", { range: "bytes=-10" });
    assert.equal(suffix.headers.get("content-range"), "bytes 4086-4095/4096");
    assert.equal((await suffix.arrayBuffer()).byteLength, 10);
  });

  test("unsatisfiable: 416 with bytes */size and no body", async () => {
    const res = await get("urunler/tanitim.mp4", { range: "bytes=5000-6000" });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get("content-range"), "bytes */4096");
    assert.equal((await res.arrayBuffer()).byteLength, 0);
  });

  test("a multi-range request gets the whole file (allowed by RFC 9110)", async () => {
    const res = await get("urunler/tanitim.mp4", { range: "bytes=0-1,10-20" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-length"), "4096");
  });

  test("HEAD: same headers, no body (for full and partial requests)", async () => {
    const head = await get("urunler/tanitim.mp4", {}, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "4096");
    assert.equal(head.body, null);
    const partial = await get("urunler/tanitim.mp4", { range: "bytes=0-99" }, "HEAD");
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-length"), "100");
    assert.equal(partial.body, null);
  });

  test("ETag revalidation (304) and If-Range", async () => {
    const first = await get("urunler/tanitim.mp4");
    const etag = first.headers.get("etag")!;
    await first.arrayBuffer();
    const cached = await get("urunler/tanitim.mp4", { "if-none-match": etag });
    assert.equal(cached.status, 304);
    assert.equal(cached.body, null);
    const sameVersion = await get("urunler/tanitim.mp4", { range: "bytes=0-9", "if-range": etag });
    assert.equal(sameVersion.status, 206);
    await sameVersion.arrayBuffer();
    const otherVersion = await get("urunler/tanitim.mp4", { range: "bytes=0-9", "if-range": '"old"' });
    assert.equal(otherVersion.status, 200, "a changed representation is sent whole");
    await otherVersion.arrayBuffer();
  });

  test("WebM and images keep working; an empty file is an empty 200", async () => {
    const webm = await get("urunler/kayit.webm", { range: "bytes=0-9" });
    assert.equal(webm.headers.get("content-type"), "video/webm");
    assert.equal(webm.status, 206);
    await webm.arrayBuffer();
    const image = await get("urunler/foto-768.webp");
    assert.equal(image.headers.get("content-type"), "image/webp");
    assert.equal(await image.text(), "RIFFxxxxWEBP");
    const empty = await get("urunler/bos.mp4");
    assert.equal(empty.status, 200);
    assert.equal(empty.headers.get("content-length"), "0");
  });

  test("never served: staging uploads, unknown types, folders, missing files, traversal", async () => {
    for (const key of ["_incoming/abc/ham.mp4", "_INCOMING/abc/ham.mp4", "_Incoming/abc/ham.mp4", "_incominG/abc/ham.mp4", "urunler/notlar.txt", "klasor.mp4", "urunler/yok.mp4", "../secret.mp4", "urunler/../../x.mp4", "/abs.mp4", ""]) {
      const res = await get(key);
      assert.equal(res.status, 404, key);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
  });

  test("content types: images plus mp4/webm", () => {
    assert.deepEqual(Object.keys(UPLOAD_CONTENT_TYPES).sort(), ["avif", "jpeg", "jpg", "mp4", "png", "webm", "webp"]);
  });
});

describe("route", () => {
  test("exports GET and HEAD (HEAD must not run a full GET)", () => {
    assert.equal(typeof route.GET, "function");
    assert.equal(typeof route.HEAD, "function");
  });

  test("404 unless the local driver is configured", async () => {
    const saved = process.env.STORAGE_DRIVER;
    process.env.STORAGE_DRIVER = "supabase";
    try {
      const res = await route.GET(new Request("http://check.localhost/uploads/a.mp4"), { params: Promise.resolve({ key: ["a.mp4"] }) });
      assert.equal(res.status, 404);
    } finally {
      if (saved === undefined) delete process.env.STORAGE_DRIVER;
      else process.env.STORAGE_DRIVER = saved;
    }
  });

  test("serves from LOCAL_UPLOAD_DIR with ranges", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "prestij-day6-route-"));
    const saved = { driver: process.env.STORAGE_DRIVER, dir: process.env.LOCAL_UPLOAD_DIR };
    process.env.STORAGE_DRIVER = "local";
    process.env.LOCAL_UPLOAD_DIR = dir;
    try {
      mkdirSync(path.join(dir, "v"));
      writeFileSync(path.join(dir, "v", "a.mp4"), Buffer.alloc(300, 7));
      const res = await route.HEAD(new Request("http://check.localhost/uploads/v/a.mp4", { method: "HEAD", headers: { range: "bytes=0-1" } }), {
        params: Promise.resolve({ key: ["v", "a.mp4"] }),
      });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get("content-range"), "bytes 0-1/300");
    } finally {
      if (saved.driver === undefined) delete process.env.STORAGE_DRIVER;
      else process.env.STORAGE_DRIVER = saved.driver;
      if (saved.dir === undefined) delete process.env.LOCAL_UPLOAD_DIR;
      else process.env.LOCAL_UPLOAD_DIR = saved.dir;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
