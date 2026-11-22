// Image pipeline shared by scripts/import-media.ts and panel uploads: one source image in, AVIF + WebP
// variants out (never upscaled), plus blur placeholder and dominant color for the `media` row.
// Server/script use only. Always pass Buffers to sharp (libvips cannot open Windows paths > 260 chars).
import { randomBytes } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import type { LocalizedText } from "@/db/schema/common";
import type { media, MediaVariant } from "@/db/schema/site";
import { assertValidKey, getStorage, type StorageAdapter } from "./storage";

export const DEFAULT_WIDTHS: readonly number[] = [480, 768, 1200, 1800];
const AVIF = { quality: 50, effort: 4 } as const;
const WEBP = { quality: 78, effort: 5 } as const;
const BLUR_WIDTH = 16;

/** Insert values for the `media` table produced by processImage. */
export type NewMediaValues = Omit<typeof media.$inferInsert, "id" | "createdAt" | "updatedAt">;

export type ProcessImageOptions = {
  /** Storage folder, e.g. "urunler/lavanta". Also stored in media.folder. */
  folder: string;
  /** File name without extension; variant files are "<stem>-<width>.<ext>". */
  stem: string;
  alt?: LocalizedText | null;
  tags?: string[] | null;
  /** Target widths (default 480/768/1200/1800); the source width is added when it is smaller than the largest. */
  widths?: readonly number[];
  storage?: StorageAdapter;
  /** Reuse variant files that already exist under the same key instead of re-encoding them. */
  skipExisting?: boolean;
  /** Also store a full-size PNG (logos for e-mails/PDFs). <Img> ignores PNG variants. */
  keepPng?: boolean;
  /** Blur placeholder: "auto" (default) generates one only for fully opaque images. */
  placeholder?: boolean | "auto";
  /** Called once per variant file, e.g. to log progress. */
  onFile?: (file: { key: string; bytes: number; reused: boolean }) => void;
  /** Refuse sources above this many pixels (decompression-bomb guard; sharp's default is 268 MP). */
  limitInputPixels?: number;
  /**
   * Day 6: encode the variants one after another instead of all at once (panel uploads on a 2 GB
   * serverless function: every encode decodes the source again). Default false (the import script).
   */
  sequential?: boolean;
};

/** Widths to generate for a source: the targets that fit, plus the source width when it is below the largest target. */
export function targetWidths(sourceWidth: number, widths: readonly number[] = DEFAULT_WIDTHS): number[] {
  const largest = Math.max(...widths);
  const out = new Set(widths.filter((w) => w <= sourceWidth));
  if (sourceWidth < largest) out.add(sourceWidth);
  return [...out].sort((a, b) => a - b);
}

const TURKISH: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };

/** Safe, URL-friendly stem from an uploaded file name; unique by default (uploads never overwrite old URLs). */
export function makeStem(fileName: string, { unique = true }: { unique?: boolean } = {}): string {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (ch) => TURKISH[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "gorsel";
  return unique ? `${base}-${randomBytes(3).toString("hex")}` : base;
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const MIME: Record<MediaVariant["format"], string> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
};

export async function processImage(input: Buffer, options: ProcessImageOptions): Promise<NewMediaValues> {
  const { folder, stem, storage = getStorage(), skipExisting = false, keepPng = false, onFile } = options;
  assertValidKey(`${folder}/${stem}`);

  const sharpOptions = { failOn: "none", ...(options.limitInputPixels ? { limitInputPixels: options.limitInputPixels } : {}) } as const;
  const source = () => sharp(input, sharpOptions).autoOrient();
  const meta = await sharp(input, sharpOptions).metadata();
  if (options.limitInputPixels && (meta.width ?? 0) * (meta.height ?? 0) > options.limitInputPixels) {
    throw new Error(`Image exceeds the pixel limit: ${folder}/${stem}`);
  }
  const srcWidth = meta.autoOrient?.width ?? meta.width;
  const srcHeight = meta.autoOrient?.height ?? meta.height;
  if (!srcWidth || !srcHeight) throw new Error(`Cannot read image size for ${folder}/${stem}`);

  const small = source().resize({ width: 64, withoutEnlargement: true });
  const stats = await small.stats();
  const wantsBlur = options.placeholder === "auto" || options.placeholder === undefined ? stats.isOpaque : options.placeholder;

  const store = async (
    key: string,
    format: MediaVariant["format"],
    width: number,
    expectedHeight: number,
    encode: () => Promise<{ data: Buffer; info: OutputInfo }>,
  ): Promise<MediaVariant> => {
    if (skipExisting) {
      const existing = await storage.stat(key);
      if (existing && existing.bytes > 0) {
        onFile?.({ key, bytes: existing.bytes, reused: true });
        return { width, height: expectedHeight, format, key, bytes: existing.bytes };
      }
    }
    const { data, info } = await encode();
    await storage.put(key, data, MIME[format]);
    onFile?.({ key, bytes: data.length, reused: false });
    return { width: info.width, height: info.height, format, key, bytes: data.length };
  };

  const widths = targetWidths(srcWidth, options.widths);
  const tasks: (() => Promise<MediaVariant>)[] = [];
  for (const width of widths) {
    const height = Math.round((srcHeight * width) / srcWidth);
    const resized = () => source().resize({ width, withoutEnlargement: true, kernel: "lanczos3" });
    tasks.push(
      () =>
        store(`${folder}/${stem}-${width}.avif`, "avif", width, height, () =>
          resized().avif(AVIF).toBuffer({ resolveWithObject: true }),
        ),
      () =>
        store(`${folder}/${stem}-${width}.webp`, "webp", width, height, () =>
          resized().webp(WEBP).toBuffer({ resolveWithObject: true }),
        ),
    );
  }
  if (keepPng) {
    tasks.push(() =>
      store(`${folder}/${stem}.png`, "png", srcWidth, srcHeight, () =>
        source().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true }),
      ),
    );
  }
  const makeBlur = () =>
    wantsBlur
      ? source()
          .resize({ width: BLUR_WIDTH })
          .blur(0.8)
          .webp({ quality: 50 })
          .toBuffer()
          .then((b) => `data:image/webp;base64,${b.toString("base64")}`)
      : Promise.resolve(null);

  let variants: MediaVariant[];
  let blur: string | null;
  if (options.sequential) {
    variants = [];
    for (const task of tasks) variants.push(await task());
    blur = await makeBlur();
  } else {
    [variants, blur] = await Promise.all([Promise.all(tasks.map((task) => task())), makeBlur()]);
  }

  // The largest WebP is the fallback <img src> and the row's canonical file.
  const fallback = variants
    .filter((v) => v.format === "webp")
    .reduce((a, b) => (b.width > a.width ? b : a));

  return {
    storageKey: fallback.key,
    url: storage.publicUrl(fallback.key),
    mime: "image/webp",
    width: fallback.width,
    height: fallback.height,
    bytes: fallback.bytes,
    alt: options.alt ?? null,
    blurDataUrl: blur,
    dominantColor: toHex(stats.dominant),
    variants,
    folder,
    tags: options.tags ?? null,
  };
}

/** Removes every file of a media row (call before deleting the row). */
export async function deleteMediaFiles(
  row: { storageKey: string; variants: MediaVariant[] | null },
  storage: StorageAdapter = getStorage(),
): Promise<void> {
  const keys = new Set([row.storageKey, ...(row.variants ?? []).map((v) => v.key)]);
  await Promise.all([...keys].map((key) => storage.delete(key)));
}
