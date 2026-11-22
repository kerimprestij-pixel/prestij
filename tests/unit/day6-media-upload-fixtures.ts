// Hand-built MP4 (ISO-BMFF) and WebM (EBML) bytes for the day-6 MEDIA-UPLOAD tests. Not real videos:
// just the container structure the sniffer reads (ftyp, moov/mvhd/trak/tkhd/hdlr/stsd, mdat; EBML
// header, Segment/Info/Tracks/Cluster), with filler where the media data would be. No dependencies.

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
};
const u64 = (n: number) => concat(u32(Math.floor(n / 2 ** 32)), u32(n % 2 ** 32));
const zeros = (n: number) => new Uint8Array(n);

/** An ISO-BMFF box: 32-bit size + four-character type + payload. */
export function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  return concat(u32(8 + body.length), enc(type), body);
}

export function ftyp(brand: string, compatible: string[] = ["isom", "mp42"]): Uint8Array {
  return box("ftyp", enc(brand), u32(0), ...compatible.map(enc));
}

export function mvhd(timescale: number, duration: number, version: 0 | 1 = 0): Uint8Array {
  const head = concat(new Uint8Array([version, 0, 0, 0]));
  const times = version === 1 ? concat(u64(0), u64(0), u32(timescale), u64(duration)) : concat(u32(0), u32(0), u32(timescale), u32(duration));
  return box("mvhd", head, times, zeros(80));
}

const fixed = (n: number) => u32(Math.round(n * 65536) >>> 0);

export function tkhd(width: number, height: number, { rotate90 = false, version = 0 as 0 | 1 } = {}): Uint8Array {
  const head = new Uint8Array([version, 0, 0, 3]);
  const times = version === 1 ? concat(u64(0), u64(0), u32(1), u32(0), u64(0)) : concat(u32(0), u32(0), u32(1), u32(0), u32(0));
  const middle = concat(zeros(8), zeros(2), zeros(2), zeros(2), zeros(2)); // reserved, layer, group, volume, reserved
  // Matrix: identity, or a 90° rotation (a=0, b=1, c=-1, d=0).
  const matrix = rotate90
    ? concat(fixed(0), fixed(1), u32(0), fixed(-1), fixed(0), u32(0), u32(0), u32(0), u32(0x40000000))
    : concat(fixed(1), fixed(0), u32(0), fixed(0), fixed(1), u32(0), u32(0), u32(0), u32(0x40000000));
  return box("tkhd", head, times, middle, matrix, fixed(width), fixed(height));
}

export function trak(handler: "vide" | "soun", codec: string, width = 0, height = 0, options: { rotate90?: boolean; version?: 0 | 1 } = {}): Uint8Array {
  const hdlr = box("hdlr", u32(0), u32(0), enc(handler), zeros(12), enc("handler\0"));
  const stsd = box("stsd", u32(0), u32(1), box(codec, zeros(70)));
  return box("trak", tkhd(width, height, options), box("mdia", box("mdhd", zeros(24)), hdlr, box("minf", box("stbl", stsd))));
}

export type Mp4Options = {
  brand?: string;
  timescale?: number;
  duration?: number;
  mvhdVersion?: 0 | 1;
  width?: number;
  height?: number;
  codec?: string;
  rotate90?: boolean;
  /** moov before mdat (default) or after it. */
  faststart?: boolean;
  /** Bytes of fake media data. */
  mdatBytes?: number;
  audioOnly?: boolean;
  withMoov?: boolean;
};

/** A small MP4: ftyp + moov (mvhd, video and audio tracks) + mdat, or ftyp + mdat + moov. */
export function mp4({
  brand = "isom",
  timescale = 1000,
  duration = 12_500,
  mvhdVersion = 0,
  width = 1280,
  height = 720,
  codec = "avc1",
  rotate90 = false,
  faststart = true,
  mdatBytes = 2048,
  audioOnly = false,
  withMoov = true,
}: Mp4Options = {}): Uint8Array {
  const tracks = audioOnly ? [trak("soun", "mp4a")] : [trak("vide", codec, width, height, { rotate90 }), trak("soun", "mp4a")];
  const moov = box("moov", mvhd(timescale, duration, mvhdVersion), ...tracks);
  const mdat = box("mdat", new Uint8Array(mdatBytes).fill(0x5a));
  if (!withMoov) return concat(ftyp(brand), mdat);
  return faststart ? concat(ftyp(brand), moov, mdat) : concat(ftyp(brand), mdat, moov);
}

// ---------------------------------------------------------------------------------------------------
// EBML / WebM

/** An EBML element with a 1..4 byte ID and an 8-byte size (or "unknown" size). */
export function ebml(id: number, payload: Uint8Array, { unknownSize = false } = {}): Uint8Array {
  const idBytes: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) idBytes.unshift(v & 0xff);
  const size = unknownSize ? new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]) : concat(new Uint8Array([0x01, 0, 0]), u32(0).subarray(0, 1), u32(payload.length));
  return concat(Uint8Array.from(idBytes), size, payload);
}

const uintBytes = (n: number) => {
  const out: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return Uint8Array.from(out.length ? out : [0]);
};
const f64 = (n: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n);
  return b;
};

export type WebmOptions = { docType?: string; codec?: string; width?: number; height?: number; durationTicks?: number | null; timecodeScale?: number };

/** EBML header + Segment (unknown size, like MediaRecorder) with Info, Tracks and a Cluster. */
export function webm({ docType = "webm", codec = "V_VP9", width = 640, height = 360, durationTicks = null, timecodeScale = 1_000_000 }: WebmOptions = {}): Uint8Array {
  const header = ebml(0x1a45dfa3, concat(ebml(0x4286, uintBytes(1)), ebml(0x4282, enc(docType)), ebml(0x4287, uintBytes(4))));
  const info = ebml(0x1549a966, concat(ebml(0x2ad7b1, uintBytes(timecodeScale)), ...(durationTicks !== null ? [ebml(0x4489, f64(durationTicks))] : []), ebml(0x4d80, enc("test"))));
  const video = ebml(0xe0, concat(ebml(0xb0, uintBytes(width)), ebml(0xba, uintBytes(height))));
  const audio = ebml(0xae, concat(ebml(0xd7, uintBytes(2)), ebml(0x83, uintBytes(2)), ebml(0x86, enc("A_OPUS"))));
  const videoTrack = ebml(0xae, concat(ebml(0xd7, uintBytes(1)), ebml(0x83, uintBytes(1)), ebml(0x86, enc(codec)), video));
  const tracks = ebml(0x1654ae6b, concat(audio, videoTrack));
  const cluster = ebml(0x1f43b675, concat(ebml(0xe7, uintBytes(0)), new Uint8Array(512).fill(0x33)), { unknownSize: true });
  return concat(header, ebml(0x18538067, concat(info, tracks, cluster), { unknownSize: true }));
}
