// Day 6 MEDIA-UPLOAD: what a file really is, from its bytes (src/lib/panel/media/video-sniff.ts). Hand-built
// MP4/WebM fixtures (tests/unit/day6-media-upload-fixtures.ts) plus real images from sharp: the brand
// whitelist, MOV/HEIC/AVIF routing, MKV, HEVC and other codecs, mvhd v0/v1 duration, tkhd size with rotation,
// moov after mdat found through small range reads, audio-only files, WebM DocType/duration/size/codec.
//   npx tsx --test tests/unit/day6-media-upload-sniff.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import sharp from "sharp";
import { sniffImage } from "@/lib/panel/media/upload";
import { bufferReader, detectVideoContainer, MP4_BRANDS, parseMoov, probeVideo, VIDEO_HEAD_BYTES, type RangeReader } from "@/lib/panel/media/video-sniff";
import { box, concat, ftyp, mp4, mvhd, trak, webm } from "./day6-media-upload-fixtures";

const probe = (bytes: Uint8Array, name = "klip.mp4") => probeVideo(bufferReader(bytes), bytes.length, name);

describe("detectVideoContainer", () => {
  test("every whitelisted MP4 brand is a video", () => {
    for (const brand of MP4_BRANDS) {
      const result = detectVideoContainer(ftyp(brand), "a.mp4");
      assert.ok(result && result.ok, brand);
      assert.equal(result.ok && result.container.mime, "video/mp4");
    }
    assert.deepEqual([...MP4_BRANDS].sort(), ["M4V ", "avc1", "dash", "iso2", "iso3", "iso4", "iso5", "iso6", "isom", "mp41", "mp42"].sort());
  });

  test("MOV (qt) is refused with the MP4 (H.264) hint", () => {
    const result = detectVideoContainer(ftyp("qt  ", ["qt  "]), "IMG_1234.MOV");
    assert.ok(result && !result.ok);
    assert.match(result.error, /"IMG_1234\.MOV" bir MOV/);
    assert.match(result.error, /MP4 \(H\.264\) olarak dışa aktarın/);
  });

  test("AVIF / HEIC / HEIF brands go back to the image path (null)", () => {
    for (const brand of ["avif", "avis", "heic", "heix", "mif1", "msf1"]) assert.equal(detectVideoContainer(ftyp(brand, ["mif1"]), "x"), null, brand);
  });

  test("an unknown ISO brand is an unsupported video", () => {
    const result = detectVideoContainer(ftyp("3gp4", ["3gp4"]), "eski.3gp");
    assert.ok(result && !result.ok);
    assert.match(result.error, /desteklenmeyen bir video biçimi/);
  });

  test("WebM by EBML + DocType; Matroska is refused", () => {
    const ok = detectVideoContainer(webm(), "a.webm");
    assert.ok(ok && ok.ok && ok.container.format === "webm" && ok.container.mime === "video/webm");
    const mkv = detectVideoContainer(webm({ docType: "matroska" }), "film.mkv");
    assert.ok(mkv && !mkv.ok);
    assert.match(mkv.error, /MKV/);
  });

  test("images, garbage and tiny buffers are not video containers", async () => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).jpeg().toBuffer();
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#12345680" } }).png().toBuffer();
    assert.equal(detectVideoContainer(jpeg), null);
    assert.equal(detectVideoContainer(png), null);
    assert.equal(detectVideoContainer(new Uint8Array([0x1a, 0x45])), null);
    assert.equal(detectVideoContainer(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  });

  test("a real AVIF made by sharp is routed to sniffImage, which accepts it", async () => {
    const avif = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#8E61B6" } }).avif().toBuffer();
    assert.equal(detectVideoContainer(avif), null);
    assert.equal(await probe(avif, "a.avif"), null);
    const sniff = await sniffImage(avif, "a.avif");
    assert.ok(sniff.ok && sniff.format === "avif");
  });
});

describe("probeVideo: MP4", () => {
  test("faststart file: duration from mvhd, size from tkhd, codec from stsd", async () => {
    const result = await probe(mp4());
    assert.ok(result && result.ok);
    assert.deepEqual(
      { ...result.video },
      { format: "mp4", mime: "video/mp4", brand: "isom", durationMs: 12_500, width: 1280, height: 720, codec: "avc1", hasVideo: true, faststart: true },
    );
  });

  test("mvhd version 1 (64-bit duration) and another timescale", async () => {
    const result = await probe(mp4({ mvhdVersion: 1, timescale: 90_000, duration: 90_000 * 42 }));
    assert.ok(result && result.ok);
    assert.equal(result.video.durationMs, 42_000);
  });

  test("a 90° rotation matrix swaps width and height (portrait phone video)", async () => {
    const result = await probe(mp4({ width: 1920, height: 1080, rotate90: true }));
    assert.ok(result && result.ok);
    assert.equal(result.video.width, 1080);
    assert.equal(result.video.height, 1920);
  });

  test("moov after a large mdat is found with a few small range reads (no full download)", async () => {
    const bytes = mp4({ faststart: false, mdatBytes: 3 * VIDEO_HEAD_BYTES });
    let read = 0;
    const reader: RangeReader = async (offset, length) => {
      read += length;
      return bytes.subarray(offset, Math.min(bytes.length, offset + length));
    };
    const result = await probeVideo(reader, bytes.length, "sonda.mp4");
    assert.ok(result && result.ok);
    assert.equal(result.video.faststart, false);
    assert.equal(result.video.durationMs, 12_500);
    assert.equal(result.video.codec, "avc1");
    assert.ok(read < VIDEO_HEAD_BYTES + 4096, `read ${read} bytes of ${bytes.length}`);
  });

  test("HEVC is refused with the hint; other codecs too", async () => {
    for (const codec of ["hvc1", "hev1"]) {
      const result = await probe(mp4({ codec }), "iphone.mp4");
      assert.ok(result && !result.ok, codec);
      assert.match(result.error, /HEVC \(H\.265\)/);
      assert.match(result.error, /MP4 \(H\.264\) olarak dışa aktarın/);
    }
    const av1 = await probe(mp4({ codec: "av01" }));
    assert.ok(av1 && !av1.ok);
    assert.match(av1.error, /desteklenmeyen bir kodlamayla kaydedilmiş \(av01\)/);
    const avc3 = await probe(mp4({ codec: "avc3" }));
    assert.ok(avc3 && avc3.ok);
  });

  test("an audio-only MP4 is refused", async () => {
    const result = await probe(mp4({ audioOnly: true }), "ses.m4a");
    assert.ok(result && !result.ok);
    assert.match(result.error, /görüntü yok/);
  });

  test("no moov in the file: container accepted, values unknown (the browser's are validated instead)", async () => {
    const result = await probe(mp4({ withMoov: false }));
    assert.ok(result && result.ok);
    assert.equal(result.video.durationMs, null);
    assert.equal(result.video.width, null);
    assert.equal(result.video.faststart, null);
  });

  test("parseMoov tolerates truncation and junk", () => {
    const moov = box("moov", mvhd(600, 6000), trak("vide", "avc1", 640, 480));
    assert.equal(parseMoov(moov).durationMs, 10_000);
    const truncated = moov.subarray(0, 60);
    assert.doesNotThrow(() => parseMoov(truncated));
    assert.equal(parseMoov(new Uint8Array([1, 2, 3])).durationMs, null);
    assert.equal(parseMoov(concat(box("free", new Uint8Array(4)))).durationMs, null);
  });
});

describe("probeVideo: WebM", () => {
  test("duration (Info › Duration × TimecodeScale), size and codec from the head", async () => {
    const result = await probe(webm({ durationTicks: 4_500, width: 1280, height: 720, codec: "V_VP8" }), "a.webm");
    assert.ok(result && result.ok);
    assert.equal(result.video.format, "webm");
    assert.equal(result.video.durationMs, 4_500);
    assert.equal(result.video.width, 1280);
    assert.equal(result.video.height, 720);
    assert.equal(result.video.codec, "V_VP8");
    const scaled = await probe(webm({ durationTicks: 2_000, timecodeScale: 2_000_000 }), "b.webm");
    assert.ok(scaled && scaled.ok && scaled.video.durationMs === 4_000);
  });

  test("a recorder file without Duration: duration unknown, size still read", async () => {
    const result = await probe(webm({ durationTicks: null }), "kayit.webm");
    assert.ok(result && result.ok);
    assert.equal(result.video.durationMs, null);
    assert.equal(result.video.width, 640);
    assert.equal(result.video.codec, "V_VP9");
  });

  test("a codec WebM may not carry is refused", async () => {
    const result = await probe(webm({ codec: "V_MPEG4/ISO/AVC" }), "x.webm");
    assert.ok(result && !result.ok);
    assert.match(result.error, /desteklenmeyen bir kodlamayla/);
  });
});
