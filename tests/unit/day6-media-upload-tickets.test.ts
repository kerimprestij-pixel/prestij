// Day 6 MEDIA-UPLOAD: the declared-file rules shared by the browser and the ticket route
// (upload-rules.ts) and the signed upload ticket (tickets.ts): signing, expiry after 2 h, tampering,
// another editor, another purpose, staging keys, kind-aware size checks.
//   npx tsx --test tests/unit/day6-media-upload-tickets.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTokenSigner } from "@/lib/signed-token";
import { MEDIA_UPLOAD } from "@/lib/panel/media/types";
import { checkUploadSize } from "@/lib/panel/media/upload";
import {
  acceptFor,
  checkUploadCandidate,
  checkVideoDuration,
  checkVideoSize,
  classifyUpload,
  formatSeconds,
  sanitizeFileName,
} from "@/lib/panel/media/upload-rules";
import { createUploadTicket, incomingKey, MEDIA_UPLOAD_TOKEN_PURPOSE, readUploadTicket, uniqueUploadStem } from "@/lib/panel/media/tickets";

const MB = 1024 * 1024;

describe("classifyUpload / checkUploadCandidate", () => {
  test("images and videos by type, or by extension when the browser sends none", () => {
    assert.deepEqual(classifyUpload({ name: "a.jpg", type: "image/jpeg" }), { ok: true, kind: "image", mime: "image/jpeg", ext: "jpg" });
    assert.deepEqual(classifyUpload({ name: "a.PNG", type: "" }), { ok: true, kind: "image", mime: "image/png", ext: "png" });
    assert.deepEqual(classifyUpload({ name: "klip.mp4", type: "video/mp4" }), { ok: true, kind: "video", mime: "video/mp4", ext: "mp4" });
    assert.deepEqual(classifyUpload({ name: "klip.m4v", type: "video/x-m4v" }), { ok: true, kind: "video", mime: "video/mp4", ext: "mp4" });
    assert.deepEqual(classifyUpload({ name: "kayit.webm", type: "" }), { ok: true, kind: "video", mime: "video/webm", ext: "webm" });
    assert.deepEqual(classifyUpload({ name: "x.jpeg", type: "image/jpg" }), { ok: true, kind: "image", mime: "image/jpeg", ext: "jpg" });
  });

  test("clear Turkish refusals for MOV, HEIC, MKV, SVG, GIF and others", () => {
    const err = (name: string, type = "") => {
      const r = classifyUpload({ name, type });
      assert.ok(!r.ok, name);
      return r.error;
    };
    assert.match(err("IMG_0001.MOV", "video/quicktime"), /MOV.*MP4 \(H\.264\) olarak dışa aktarın/);
    assert.match(err("IMG_0001.mov"), /MOV/);
    assert.match(err("foto.heic", "image/heic"), /HEIC.*JPEG/);
    assert.match(err("film.mkv"), /MKV/);
    assert.match(err("logo.svg", "image/svg+xml"), /SVG/);
    assert.match(err("a.gif", "image/gif"), /GIF/);
    assert.match(err("a.avi", "video/x-msvideo"), /Desteklenmeyen video biçimi/);
    assert.match(err("a.pdf", "application/pdf"), /Desteklenmeyen biçim/);
  });

  test("kind filter and size limits per kind (15 MB images, 50 MB videos)", () => {
    assert.match((checkUploadCandidate({ name: "a.mp4", size: 10, type: "video/mp4" }, "image") as { error: string }).error, /yalnızca görsel/);
    assert.match((checkUploadCandidate({ name: "a.jpg", size: 10, type: "image/jpeg" }, "video") as { error: string }).error, /yalnızca video/);
    assert.ok(checkUploadCandidate({ name: "a.jpg", size: 15 * MB, type: "image/jpeg" }).ok);
    assert.match((checkUploadCandidate({ name: "a.jpg", size: 15 * MB + 1, type: "image/jpeg" }) as { error: string }).error, /Görsel çok büyük.*15 MB/);
    assert.ok(checkUploadCandidate({ name: "a.mp4", size: 50 * MB, type: "video/mp4" }).ok);
    assert.match((checkUploadCandidate({ name: "a.mp4", size: 50 * MB + 1, type: "video/mp4" }) as { error: string }).error, /Video çok büyük.*50 MB/);
    assert.match((checkUploadCandidate({ name: "a.mp4", size: 0, type: "video/mp4" }) as { error: string }).error, /boş/);
  });

  test("checkUploadSize is kind-aware (legacy route stays at 15 MB for images)", () => {
    assert.equal(checkUploadSize({ name: "a.mp4", size: 40 * MB }, "video"), null);
    assert.match(checkUploadSize({ name: "a.mp4", size: 51 * MB }, "video") ?? "", /"a\.mp4" çok büyük.*50 MB/);
    assert.match(checkUploadSize({ name: "a.jpg", size: 16 * MB }) ?? "", /15 MB/);
  });

  test("accept attributes, duration and size checks", () => {
    assert.equal(acceptFor("image"), MEDIA_UPLOAD.accept);
    assert.match(acceptFor("video"), /video\/mp4/);
    assert.match(acceptFor("all"), /image\/jpeg.*video\/webm/);
    assert.equal(checkVideoDuration(90_000), null);
    assert.equal(checkVideoDuration(90_400), null, "half a second of slack");
    assert.match(checkVideoDuration(102_000) ?? "", /en fazla 90 saniye.*1:42/);
    assert.match(checkVideoDuration(null) ?? "", /süresi okunamadı/);
    assert.match(checkVideoDuration(Number.POSITIVE_INFINITY) ?? "", /süresi okunamadı/);
    assert.equal(checkVideoSize(1920, 1080), null);
    assert.match(checkVideoSize(7680, 4320) ?? "", /çok yüksek/);
    assert.match(checkVideoSize(0, 1080) ?? "", /okunamadı/);
    assert.equal(formatSeconds(42_400), "0:42");
  });

  test("sanitizeFileName keeps the old behaviour and takes a fallback", () => {
    assert.equal(sanitizeFileName("C:\\fakepath\\Lavanta Şişe.JPG"), "Lavanta Şişe.JPG");
    assert.equal(sanitizeFileName(""), "görsel");
    assert.equal(sanitizeFileName("  ", "video"), "video");
    assert.equal(sanitizeFileName('a<b>"c.mp4'), "abc.mp4");
  });
});

describe("upload tickets", () => {
  let clock = Date.UTC(2026, 10, 12, 9, 0, 0);
  const signer = createTokenSigner("day6-media-upload-test-secret-0123456789", { now: () => clock });
  const base = { key: incomingKey("Tanıtım Videosu.mp4", "mp4", "0123456789abcdef01234567"), size: 1234, mime: "video/mp4", kind: "video" as const, folder: "urunler/lavanta", name: "Tanıtım Videosu.mp4", actorId: "editor-1" };

  test("staging keys: _incoming/<random>/<safe-name>.<ext>; stems never repeat", () => {
    assert.equal(base.key, "_incoming/0123456789abcdef01234567/tanitim-videosu.mp4");
    assert.match(incomingKey("x.png", "png"), /^_incoming\/[0-9a-f]{24}\/x\.png$/);
    assert.notEqual(incomingKey("x.png", "png"), incomingKey("x.png", "png"));
    assert.match(uniqueUploadStem("Lavanta Şişe.JPG"), /^lavanta-sise-[0-9a-f]{10}$/);
  });

  test("a fresh ticket reads back for its editor", () => {
    const token = createUploadTicket(base, signer);
    const read = readUploadTicket(token, "editor-1", signer);
    assert.ok(read.ok);
    assert.equal(read.ticket.key, base.key);
    assert.equal(read.ticket.size, 1234);
    assert.equal(read.ticket.kind, "video");
    assert.equal(read.ticket.folder, "urunler/lavanta");
    assert.equal(read.ticket.expiresAt?.getTime(), clock + MEDIA_UPLOAD.direct.ticketSeconds * 1000);
  });

  test("expires after two hours", () => {
    const token = createUploadTicket(base, signer);
    clock += MEDIA_UPLOAD.direct.ticketSeconds * 1000 - 1000;
    assert.ok(readUploadTicket(token, "editor-1", signer).ok);
    clock += 2000;
    const read = readUploadTicket(token, "editor-1", signer);
    assert.ok(!read.ok && read.reason === "expired");
    assert.match(!read.ok ? read.error : "", /süresi doldu/);
  });

  test("tampering, another editor, another purpose or another secret are refused", () => {
    const token = createUploadTicket(base, signer);
    const [v, body, sig] = token.split(".");
    const forged = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { p: { s: number } };
    forged.p.s = 999_999_999;
    const tampered = `${v}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    assert.ok(!readUploadTicket(tampered, "editor-1", signer).ok);
    assert.ok(!readUploadTicket(token, "editor-2", signer).ok, "another editor");
    assert.ok(!readUploadTicket(signer.signToken("review", { v: 1 }, 60), "editor-1", signer).ok, "another purpose");
    const other = createTokenSigner("another-secret-another-secret-0000", { now: () => clock });
    assert.ok(!readUploadTicket(token, "editor-1", other).ok, "another secret");
    assert.ok(!readUploadTicket(null, "editor-1", signer).ok);
    assert.ok(!readUploadTicket("v1.x.y", "editor-1", signer).ok);
  });

  test("a validly signed payload that points outside _incoming/ is still refused", () => {
    const payload = { v: 1, k: "urunler/lavanta/canli-dosya.webp", s: 10, t: "image/webp", d: "image", f: "urunler", n: "x.webp", a: "editor-1" };
    const token = signer.signToken(MEDIA_UPLOAD_TOKEN_PURPOSE, payload, 60);
    assert.ok(!readUploadTicket(token, "editor-1", signer).ok);
    const traversal = signer.signToken(MEDIA_UPLOAD_TOKEN_PURPOSE, { ...payload, k: "_incoming/../etc/passwd" }, 60);
    assert.ok(!readUploadTicket(traversal, "editor-1", signer).ok);
  });

  test("invalid ticket contents cannot be signed", () => {
    assert.throws(() => createUploadTicket({ ...base, folder: "Büyük Harf" }, signer));
    assert.throws(() => createUploadTicket({ ...base, size: 0 }, signer));
    assert.throws(() => createUploadTicket({ ...base, mime: "video/quicktime" }, signer));
  });
});
