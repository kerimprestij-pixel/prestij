// Day 6: what a video file really is, from its bytes (never the client's type or name). No
// dependencies and no Node APIs: a small ISO-BMFF (MP4) box walker and an EBML (WebM) reader.
//
// Order matters: AVIF and HEIC images are ISO-BMFF too (an `ftyp` box with an image brand), so they are
// handed back to the image path (sniffImage) instead of being taken for videos. MOV (`qt  `), MKV and
// HEVC are refused with a hint the owner can act on ("MP4 (H.264) olarak dışa aktarın").
//
// MP4: duration from `mvhd`, display size from the video track's `tkhd` (rotation applied), codec from
// its `stsd`, "faststart" = `moov` before `mdat` (otherwise the browser must fetch the tail first; it
// still plays thanks to Range, only later). When `moov` sits after the media data, probeVideo follows
// the top-level boxes with a few small range reads instead of downloading the file.
// WebM: DocType "webm" in the EBML header; duration (Segment › Info, absent in MediaRecorder output),
// size and codec (Tracks) when they are in the first bytes.
import { sanitizeFileName } from "./upload-rules";

export type VideoFormat = "mp4" | "webm";
export type VideoMime = "video/mp4" | "video/webm";

/** Major brands accepted as MP4 (the contract's whitelist). */
export const MP4_BRANDS: ReadonlySet<string> = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "M4V "]);
/** ISO-BMFF image brands (AVIF, HEIC/HEIF and their sequences): not videos, the image path decides. */
export const HEIF_BRANDS: ReadonlySet<string> = new Set([
  "avif", "avis", "heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "mif2", "msf1",
]);
/** H.264 sample entries: the only MP4 video codec every browser plays. */
export const MP4_H264_CODECS: ReadonlySet<string> = new Set(["avc1", "avc3"]);
const MP4_HEVC_CODECS: ReadonlySet<string> = new Set(["hvc1", "hev1", "dvh1", "dvhe"]);
/** WebM may only carry these video codecs. */
export const WEBM_CODECS: ReadonlySet<string> = new Set(["V_VP8", "V_VP9", "V_AV1"]);

/** How many bytes of the file the first look needs. */
export const VIDEO_HEAD_BYTES = 64 * 1024;
/** Upper bound for reading a `moov` box (sample tables of a 90 s clip are far smaller). */
export const MAX_MOOV_BYTES = 4 * 1024 * 1024;

export type VideoContainer = { format: VideoFormat; mime: VideoMime; brand: string | null };
export type ContainerSniff = { ok: true; container: VideoContainer } | { ok: false; error: string };

export type VideoInfo = {
  durationMs: number | null;
  /** Display size (an MP4 rotated by 90° reports its height as width). */
  width: number | null;
  height: number | null;
  /** MP4 sample entry ("avc1") or WebM CodecID ("V_VP9") of the video track. */
  codec: string | null;
  /** MP4 only: false when the file has a moov box but no video track (audio only). */
  hasVideo: boolean | null;
};

export type VideoProbe = VideoContainer & VideoInfo & {
  /** MP4: moov before mdat (null: unknown, e.g. WebM or moov not found). */
  faststart: boolean | null;
};

export type VideoProbeResult = { ok: true; video: VideoProbe } | { ok: false; error: string };

/** Reads `length` bytes at `offset` (shorter at the end of the file). */
export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

// ---------------------------------------------------------------------------------------------------
// Byte helpers

const ascii = (b: Uint8Array, offset: number, length: number): string =>
  offset + length <= b.length ? String.fromCharCode(...b.subarray(offset, offset + length)) : "";
const u32 = (b: Uint8Array, o: number) => (o + 4 <= b.length ? ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0 : 0);
const s32 = (b: Uint8Array, o: number) => u32(b, o) | 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const FOURCC = /^[\x20-\x7e]{4}$/;

const nameOf = (fileName: string | null | undefined) => sanitizeFileName(fileName, "video");

// ---------------------------------------------------------------------------------------------------
// Container detection (first bytes only)

/**
 * `null` when the bytes are not a video container (then they may be an image: let sniffImage decide).
 * Otherwise the container, or a Turkish refusal (MOV, MKV, unknown MP4 brand).
 */
export function detectVideoContainer(head: Uint8Array, fileName?: string | null): ContainerSniff | null {
  const name = nameOf(fileName);
  if (head.length >= 12 && ascii(head, 4, 4) === "ftyp") {
    const brand = ascii(head, 8, 4);
    if (HEIF_BRANDS.has(brand)) return null;
    if (brand === "qt  ") {
      return { ok: false, error: `"${name}" bir MOV (iPhone) videosu. Videoyu MP4 (H.264) olarak dışa aktarın ve tekrar yükleyin.` };
    }
    if (!MP4_BRANDS.has(brand)) {
      return { ok: false, error: `"${name}" desteklenmeyen bir video biçimi. MP4 (H.264) olarak dışa aktarın ya da WebM yükleyin.` };
    }
    return { ok: true, container: { format: "mp4", mime: "video/mp4", brand } };
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    const docType = ebmlDocType(head);
    if (docType === "webm") return { ok: true, container: { format: "webm", mime: "video/webm", brand: null } };
    if (docType === "matroska") {
      return { ok: false, error: `"${name}" bir MKV dosyası. Videoyu MP4 (H.264) ya da WebM olarak dışa aktarın.` };
    }
    return { ok: false, error: `"${name}" desteklenmeyen bir video biçimi. MP4 (H.264) olarak dışa aktarın ya da WebM yükleyin.` };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// MP4 (ISO-BMFF)

type Box = { type: string; start: number; payload: number; end: number };

/** Child boxes in [from, to); stops at a malformed or truncated box. */
function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let offset = from;
  const limit = Math.min(to, b.length);
  while (offset + 8 <= limit) {
    let size = u32(b, offset);
    const type = ascii(b, offset + 4, 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > limit) return;
      size = u64(b, offset + 8);
      header = 16;
    } else if (size === 0) {
      size = limit - offset;
    }
    if (size < header || !FOURCC.test(type)) return;
    const end = offset + size;
    yield { type, start: offset, payload: offset + header, end: Math.min(end, limit) };
    if (end > limit) return;
    offset = end;
  }
}

const child = (b: Uint8Array, parent: Box, type: string): Box | null => {
  for (const box of boxes(b, parent.payload, parent.end)) if (box.type === type) return box;
  return null;
};

type Track = { handler: string | null; width: number | null; height: number | null; codec: string | null };

function parseTrak(b: Uint8Array, trak: Box): Track {
  const track: Track = { handler: null, width: null, height: null, codec: null };
  const tkhd = child(b, trak, "tkhd");
  if (tkhd) {
    const p = tkhd.payload;
    const v1 = b[p] === 1;
    const matrix = p + (v1 ? 52 : 40);
    const w = Math.round(u32(b, p + (v1 ? 88 : 76)) / 65536);
    const h = Math.round(u32(b, p + (v1 ? 92 : 80)) / 65536);
    // Matrix [a b u; c d v; x y w] in 16.16: a ≈ 0 and |b| ≈ 1 means a 90° or 270° rotation.
    const a = s32(b, matrix) / 65536;
    const bb = s32(b, matrix + 4) / 65536;
    const rotated = Math.abs(a) < 0.5 && Math.abs(bb) > 0.5;
    if (w > 0 && h > 0) {
      track.width = rotated ? h : w;
      track.height = rotated ? w : h;
    }
  }
  const mdia = child(b, trak, "mdia");
  if (mdia) {
    const hdlr = child(b, mdia, "hdlr");
    if (hdlr) track.handler = ascii(b, hdlr.payload + 8, 4) || null;
    const minf = child(b, mdia, "minf");
    const stbl = minf ? child(b, minf, "stbl") : null;
    const stsd = stbl ? child(b, stbl, "stsd") : null;
    if (stsd && u32(b, stsd.payload + 4) > 0) {
      const codec = ascii(b, stsd.payload + 12, 4);
      track.codec = FOURCC.test(codec) ? codec : null;
    }
  }
  return track;
}

/** Duration, display size and codec from a complete or partial `moov` box (starting at its header). */
export function parseMoov(moov: Uint8Array): VideoInfo {
  const info: VideoInfo = { durationMs: null, width: null, height: null, codec: null, hasVideo: null };
  const top = boxes(moov, 0, moov.length).next();
  if (top.done || top.value.type !== "moov") return info;
  const tracks: Track[] = [];
  for (const box of boxes(moov, top.value.payload, top.value.end)) {
    if (box.type === "mvhd") {
      const p = box.payload;
      const v1 = moov[p] === 1;
      const timescale = u32(moov, p + (v1 ? 20 : 12));
      const duration = v1 ? u64(moov, p + 24) : u32(moov, p + 16);
      const unknown = v1 ? duration >= 2 ** 53 : duration === 0xffffffff;
      if (timescale > 0 && duration > 0 && !unknown) info.durationMs = Math.round((duration / timescale) * 1000);
    } else if (box.type === "trak") {
      tracks.push(parseTrak(moov, box));
    }
  }
  if (tracks.length > 0) {
    const video = tracks.find((t) => t.handler === "vide") ?? tracks.find((t) => t.handler === null && t.width !== null);
    info.hasVideo = Boolean(video);
    if (video) {
      info.width = video.width;
      info.height = video.height;
      info.codec = video.codec;
    }
  }
  return info;
}

/** Follows the top-level boxes (head first, then small range reads) to the `moov` box. */
async function findMoov(head: Uint8Array, size: number, read: RangeReader): Promise<{ moov: Uint8Array | null; afterMdat: boolean }> {
  let offset = 0;
  let afterMdat = false;
  for (let step = 0; step < 32 && offset + 8 <= size; step++) {
    const header = offset + 16 <= head.length ? head.subarray(offset, offset + 16) : await read(offset, Math.min(16, size - offset));
    if (header.length < 8) break;
    let boxSize = u32(header, 0);
    const type = ascii(header, 4, 4);
    let headerSize = 8;
    if (boxSize === 1) {
      if (header.length < 16) break;
      boxSize = u64(header, 8);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = size - offset;
    }
    if (boxSize < headerSize || !FOURCC.test(type)) break;
    if (type === "moov") {
      const length = Math.min(boxSize, MAX_MOOV_BYTES, size - offset);
      const moov = offset + length <= head.length ? head.subarray(offset, offset + length) : await read(offset, length);
      return { moov, afterMdat };
    }
    if (type === "mdat") afterMdat = true;
    offset += boxSize;
  }
  return { moov: null, afterMdat };
}

// ---------------------------------------------------------------------------------------------------
// WebM (EBML)

type Vint = { value: number; length: number };

/** An element ID (the marker bit kept, as written in the spec: 0x1A45DFA3). */
function readId(b: Uint8Array, offset: number): Vint | null {
  const first = b[offset];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23; // 1..4 for IDs
  if (length < 1 || length > 4 || offset + length > b.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + b[offset + i];
  return { value, length };
}

/** A data size (marker removed); `value` -1 = unknown size (all value bits set). */
function readSize(b: Uint8Array, offset: number): Vint | null {
  const first = b[offset];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23; // 1..8
  if (length < 1 || length > 8 || offset + length > b.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[offset + i];
    if (b[offset + i] !== 0xff) allOnes = false;
  }
  return { value: allOnes ? -1 : value, length };
}

type Element = { id: number; data: number; end: number; unknownSize: boolean };

function* elements(b: Uint8Array, from: number, to: number): Generator<Element> {
  let offset = from;
  const limit = Math.min(to, b.length);
  while (offset < limit) {
    const id = readId(b, offset);
    if (!id) return;
    const size = readSize(b, offset + id.length);
    if (!size) return;
    const data = offset + id.length + size.length;
    const unknownSize = size.value < 0;
    const end = unknownSize ? limit : data + size.value;
    yield { id: id.value, data, end: Math.min(end, limit), unknownSize };
    if (unknownSize || end > limit) return;
    offset = end;
  }
}

const uintOf = (b: Uint8Array, e: Element) => {
  let value = 0;
  for (let i = e.data; i < e.end && i < e.data + 8; i++) value = value * 256 + b[i];
  return value;
};
const floatOf = (b: Uint8Array, e: Element) => {
  const view = new DataView(b.buffer, b.byteOffset + e.data, e.end - e.data);
  return e.end - e.data === 4 ? view.getFloat32(0) : e.end - e.data === 8 ? view.getFloat64(0) : NaN;
};
const stringOf = (b: Uint8Array, e: Element) => String.fromCharCode(...b.subarray(e.data, e.end)).replace(/\0+$/, "");

const EBML = 0x1a45dfa3;
const DOC_TYPE = 0x4282;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const CODEC_ID = 0x86;
const VIDEO = 0xe0;
const PIXEL_WIDTH = 0xb0;
const PIXEL_HEIGHT = 0xba;
const CLUSTER = 0x1f43b675;

function ebmlDocType(b: Uint8Array): string | null {
  const header = elements(b, 0, b.length).next();
  if (header.done || header.value.id !== EBML) return null;
  for (const e of elements(b, header.value.data, header.value.end)) if (e.id === DOC_TYPE) return stringOf(b, e);
  return null;
}

/** Duration, size and codec from the first bytes of a WebM file (whatever is present). */
export function parseWebm(b: Uint8Array): VideoInfo {
  const info: VideoInfo = { durationMs: null, width: null, height: null, codec: null, hasVideo: null };
  for (const top of elements(b, 0, b.length)) {
    if (top.id !== SEGMENT) continue;
    let scale = 1_000_000;
    let duration: number | null = null;
    for (const e of elements(b, top.data, top.end)) {
      if (e.id === CLUSTER) break;
      if (e.id === INFO) {
        for (const f of elements(b, e.data, e.end)) {
          if (f.id === TIMECODE_SCALE) scale = uintOf(b, f) || scale;
          else if (f.id === DURATION) duration = floatOf(b, f);
        }
      } else if (e.id === TRACKS) {
        for (const entry of elements(b, e.data, e.end)) {
          if (entry.id !== TRACK_ENTRY) continue;
          let type = 0;
          let codec: string | null = null;
          let width: number | null = null;
          let height: number | null = null;
          for (const f of elements(b, entry.data, entry.end)) {
            if (f.id === TRACK_TYPE) type = uintOf(b, f);
            else if (f.id === CODEC_ID) codec = stringOf(b, f);
            else if (f.id === VIDEO) {
              for (const g of elements(b, f.data, f.end)) {
                if (g.id === PIXEL_WIDTH) width = uintOf(b, g) || null;
                else if (g.id === PIXEL_HEIGHT) height = uintOf(b, g) || null;
              }
            }
          }
          if (type === 1 && info.codec === null) {
            info.hasVideo = true;
            info.codec = codec;
            info.width = width;
            info.height = height;
          }
        }
      }
    }
    if (duration !== null && Number.isFinite(duration) && duration > 0) info.durationMs = Math.round((duration * scale) / 1_000_000);
    break;
  }
  return info;
}

// ---------------------------------------------------------------------------------------------------
// The whole check

function codecProblem(format: VideoFormat, codec: string | null, name: string): string | null {
  if (!codec) return null; // not in the bytes we read: the browser already decoded it before sending
  if (format === "mp4") {
    if (MP4_H264_CODECS.has(codec)) return null;
    if (MP4_HEVC_CODECS.has(codec)) {
      return `"${name}" HEVC (H.265) ile kodlanmış; birçok tarayıcı bu videoyu oynatamaz. Videoyu MP4 (H.264) olarak dışa aktarın.`;
    }
    return `"${name}" desteklenmeyen bir kodlamayla kaydedilmiş (${codec.trim()}). Videoyu MP4 (H.264) olarak dışa aktarın.`;
  }
  if (WEBM_CODECS.has(codec)) return null;
  return `"${name}" desteklenmeyen bir kodlamayla kaydedilmiş (${codec}). Videoyu MP4 (H.264) olarak dışa aktarın.`;
}

/**
 * The video check of the complete step: `null` when the file is not a video container (try the image
 * path), a Turkish refusal, or what the bytes say (duration/size/codec may be null when not present in
 * what was read; the caller falls back to the browser's measurement and validates it).
 */
export async function probeVideo(read: RangeReader, size: number, fileName?: string | null): Promise<VideoProbeResult | null> {
  const name = nameOf(fileName);
  const head = await read(0, Math.min(size, VIDEO_HEAD_BYTES));
  const sniff = detectVideoContainer(head, fileName);
  if (sniff === null) return null;
  if (!sniff.ok) return sniff;
  const { container } = sniff;

  let info: VideoInfo;
  let faststart: boolean | null = null;
  if (container.format === "mp4") {
    const { moov, afterMdat } = await findMoov(head, size, read);
    info = moov ? parseMoov(moov) : { durationMs: null, width: null, height: null, codec: null, hasVideo: null };
    faststart = moov ? !afterMdat : null;
  } else {
    info = parseWebm(head);
  }
  if (info.hasVideo === false) return { ok: false, error: `"${name}" içinde görüntü yok (yalnızca ses). Görüntülü bir MP4 ya da WebM yükleyin.` };
  const problem = codecProblem(container.format, info.codec, name);
  if (problem) return { ok: false, error: problem };
  return { ok: true, video: { ...container, ...info, faststart } };
}

/** Convenience for in-memory bytes (tests, the legacy route). */
export function bufferReader(data: Uint8Array): RangeReader {
  return async (offset, length) => data.subarray(offset, Math.min(data.length, offset + length));
}
