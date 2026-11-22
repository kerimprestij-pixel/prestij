// Imports the client's product photos and logo into the media library.
//   npx tsx --env-file=.env.local scripts/import-media.ts [--force]
// Re-runs are fast: variant files that already exist are reused (use --force to re-encode).
// Also generates src/app/icon.png and src/app/apple-icon.png from the logo's crown.
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { media } from "@/db/schema/site";
import { processImage, type NewMediaValues } from "@/lib/media/process";
import { getStorage } from "@/lib/media/storage";
import { createScriptDb, type ScriptDb } from "./seed-data/db";
import { LOGO_SOURCE, SOURCE_ROOT, readImageList, type ImageRow } from "./seed-data/image-list";
import { buildLogoAssets } from "./seed-data/logo";
import { altFor } from "./seed-data/media-alt";

export type ImportedImage = ImageRow & { mediaId: number };

export type ImportedMedia = {
  images: ImportedImage[];
  /** File stem → media id (for "@media:<stem>" references). Includes the logo stems. */
  byStem: Map<string, number>;
  logo: { lightId: number; darkId: number; originalId: number };
  report: {
    sources: number;
    sourceBytes: number;
    outputBytes: number;
    avifBytes: number;
    webpBytes: number;
    files: number;
    written: number;
    reused: number;
    seconds: number;
  };
};

const LOGO_ALT = { tr: "PRESTİJ logosu", en: "PRESTİJ logo", ar: "شعار PRESTİJ" };

async function upsertMedia(db: ScriptDb, values: NewMediaValues): Promise<number> {
  const rest: Partial<NewMediaValues> = { ...values };
  delete rest.storageKey;
  const [row] = await db
    .insert(media)
    .values(values)
    .onConflictDoUpdate({ target: media.storageKey, set: { ...rest, updatedAt: new Date() } })
    .returning({ id: media.id });
  return row.id;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function importAllMedia(
  db: ScriptDb,
  { force = false, log = console.log }: { force?: boolean; log?: (message: string) => void } = {},
): Promise<ImportedMedia> {
  const started = Date.now();
  const storage = getStorage();
  const counters = { files: 0, written: 0, reused: 0 };
  const onFile = ({ reused }: { reused: boolean }) => {
    counters.files++;
    if (reused) counters.reused++;
    else counters.written++;
  };

  const rows = await readImageList();
  let sourceBytes = 0;
  let done = 0;
  const processed: NewMediaValues[] = [];

  const images = await mapLimit(rows, 3, async (row) => {
    const file = path.join(SOURCE_ROOT, ...row.file.split("/"));
    const input = await readFile(file); // Buffer input: libvips cannot open long Windows paths itself
    sourceBytes += input.length;
    const values = await processImage(input, {
      folder: `urunler/${row.urun}`,
      stem: row.stem,
      alt: altFor(row),
      tags: [row.urun, row.ambalaj],
      skipExisting: !force,
      storage,
      onFile,
    });
    const mediaId = await upsertMedia(db, values);
    processed.push(values);
    done++;
    if (done % 10 === 0 || done === rows.length) log(`  media ${done}/${rows.length}`);
    return { ...row, mediaId };
  });

  // Logo: transparent light + dark variants, the untouched original, and the app icons.
  const logoSource = await readFile(LOGO_SOURCE);
  sourceBytes += logoSource.length;
  const logoAssets = await buildLogoAssets(logoSource);
  const logoOptions = { folder: "marka", widths: [240, 480, 960], keepPng: true, placeholder: false, storage, onFile } as const;
  const [lightValues, darkValues] = await Promise.all([
    processImage(logoAssets.light, { ...logoOptions, stem: "prestij-logo", alt: LOGO_ALT, tags: ["logo"] }),
    processImage(logoAssets.dark, { ...logoOptions, stem: "prestij-logo-dark", alt: LOGO_ALT, tags: ["logo", "dark"] }),
  ]);
  const originalKey = "marka/prestij-logo-original.png";
  await storage.put(originalKey, logoSource, "image/png");
  onFile({ reused: false });
  const originalValues: NewMediaValues = {
    storageKey: originalKey,
    url: storage.publicUrl(originalKey),
    mime: "image/png",
    width: 710,
    height: 380,
    bytes: logoSource.length,
    alt: LOGO_ALT,
    blurDataUrl: null,
    dominantColor: null,
    variants: [{ width: 710, height: 380, format: "png", key: originalKey, bytes: logoSource.length }],
    folder: "marka",
    tags: ["logo", "original"],
  };
  const [lightId, darkId, originalId] = [
    await upsertMedia(db, lightValues),
    await upsertMedia(db, darkValues),
    await upsertMedia(db, originalValues),
  ];
  const appDir = path.join(process.cwd(), "src", "app");
  await Promise.all([
    writeFile(path.join(appDir, "icon.png"), logoAssets.icon),
    writeFile(path.join(appDir, "apple-icon.png"), logoAssets.appleIcon),
  ]);

  const byStem = new Map<string, number>(images.map((i) => [i.stem, i.mediaId]));
  byStem.set("prestij-logo", lightId).set("prestij-logo-dark", darkId).set("prestij-logo-original", originalId);

  const allVariants = [...processed, lightValues, darkValues, originalValues].flatMap((v) => v.variants ?? []);
  const sum = (format?: string) => allVariants.filter((v) => !format || v.format === format).reduce((n, v) => n + v.bytes, 0);

  return {
    images,
    byStem,
    logo: { lightId, darkId, originalId },
    report: {
      sources: rows.length + 1,
      sourceBytes,
      outputBytes: sum(),
      avifBytes: sum("avif"),
      webpBytes: sum("webp"),
      ...counters,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    },
  };
}

export function formatMediaReport(r: ImportedMedia["report"]): string {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return [
    `Media: ${r.sources} sources (${mb(r.sourceBytes)}) -> ${r.files} files (${mb(r.outputBytes)}: AVIF ${mb(r.avifBytes)}, WebP ${mb(r.webpBytes)})`,
    `       ${r.written} written, ${r.reused} reused, ${r.seconds}s`,
  ].join("\n");
}

async function main() {
  const { db, close } = createScriptDb();
  try {
    const result = await importAllMedia(db, { force: process.argv.includes("--force") });
    console.log(formatMediaReport(result.report));
    const icon = await stat(path.join(process.cwd(), "src", "app", "icon.png"));
    console.log(`Icons: src/app/icon.png (${icon.size} B), src/app/apple-icon.png`);
  } finally {
    await close();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/import-media.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
