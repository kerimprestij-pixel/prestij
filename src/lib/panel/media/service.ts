// Media library writes. Uploads (legacy multipart route): validate every file first (size, sniffed type,
// pixel limit), then encode AVIF/WebP variants into the upload storage, then insert the rows and audit
// entries in one transaction; files written for a failed request are removed again. Day 6: both panel
// clients use the direct flow (direct-upload.ts) instead; videos are refused here. No Next APIs
// (DB-testable).
import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema";
import { deleteMediaFiles, processImage, type NewMediaValues } from "@/lib/media/process";
import { getUploadStorage, storageForMediaUrl, type StorageAdapter } from "@/lib/media/storage";
import { toMediaLike, type MediaVariant } from "@/lib/media/types";
import { safeErrorInfo } from "@/lib/db-errors";
import { writeAudit } from "../audit";
import { assertFresh } from "../concurrency";
import { PanelError } from "../errors";
import type { Tx } from "../tx";
import { lockPosterImage } from "./direct-upload";
import { describeUsage, mediaUsage, panelMediaColumns, toPanelMedia } from "./queries";
import { uniqueUploadStem } from "./tickets";
import { MEDIA_UPLOAD, type PanelMedia } from "./types";
import { checkUploadSize, sanitizeFileName, sniffImage } from "./upload";
import { detectVideoContainer } from "./video-sniff";

export type UploadFile = { name: string; data: Buffer };

/**
 * Validates, processes and stores uploaded images; returns the new rows. Throws PanelError("invalid")
 * with a Turkish message naming the file when one of them is refused (nothing is stored then).
 */
export async function uploadMediaFiles(
  files: readonly UploadFile[],
  { folder, actorId, storage = getUploadStorage() }: { folder: string; actorId: string | null; storage?: StorageAdapter },
): Promise<PanelMedia[]> {
  if (files.length === 0) throw new PanelError("invalid", "Yüklenecek görsel seçin.");
  if (files.length > MEDIA_UPLOAD.maxFiles) {
    throw new PanelError("invalid", `Tek seferde en fazla ${MEDIA_UPLOAD.maxFiles} görsel yükleyebilirsiniz.`);
  }

  for (const file of files) {
    const sizeError = checkUploadSize({ name: file.name, size: file.data.length });
    if (sizeError) throw new PanelError("invalid", sizeError);
    if (detectVideoContainer(file.data.subarray(0, 4096), file.name) !== null) {
      throw new PanelError("invalid", `"${sanitizeFileName(file.name, "video")}" bir video. Videoları Medya sayfasındaki “Yükle” düğmesiyle yükleyin.`);
    }
    const sniff = await sniffImage(file.data, file.name);
    if (!sniff.ok) throw new PanelError("invalid", sniff.error);
  }

  const processed: { values: NewMediaValues; originalName: string }[] = [];
  try {
    for (const file of files) {
      const values = await processImage(file.data, {
        folder,
        stem: uniqueUploadStem(file.name),
        storage,
        limitInputPixels: MEDIA_UPLOAD.maxPixels,
        sequential: true,
      });
      processed.push({ values, originalName: sanitizeFileName(file.name) });
    }

    return await db.transaction(async (tx) => {
      const rows = await tx
        .insert(schema.media)
        .values(processed.map(({ values, originalName }) => ({ ...values, kind: "image" as const, originalName })))
        .returning(panelMediaColumns);
      for (const row of rows) {
        await writeAudit(tx, {
          actorId,
          action: "upload",
          entity: "media",
          entityId: row.id,
          after: { url: row.url, folder: row.folder, originalName: row.originalName, width: row.width, height: row.height, bytes: row.bytes },
        });
      }
      return rows.map(toPanelMedia);
    });
  } catch (error) {
    await Promise.all(
      processed.map(({ values }) =>
        deleteMediaFiles({ storageKey: values.storageKey, variants: values.variants ?? null }, storage).catch(() => undefined),
      ),
    );
    if (error instanceof PanelError) throw error;
    console.error("[panel] media upload failed", safeErrorInfo(error));
    throw new PanelError("server", "Görsel işlenemedi. Dosya bozuk olabilir; başka bir görselle tekrar deneyin.");
  }
}

/** Alt text TR/EN/AR (null = decorative), locked by the updatedAt the editor loaded. */
export async function updateMediaAlt(
  tx: Tx,
  input: { id: number; alt: LocalizedText | null; updatedAt: Date },
): Promise<{ media: PanelMedia; before: LocalizedText | null }> {
  const m = schema.media;
  const [row] = await tx.select({ id: m.id, alt: m.alt, updatedAt: m.updatedAt }).from(m).where(eq(m.id, input.id)).for("update");
  if (!row) throw new PanelError("not_found", "Dosya bulunamadı. Silinmiş olabilir.");
  assertFresh(row.updatedAt, input.updatedAt);
  const [updated] = await tx.update(m).set({ alt: input.alt, updatedAt: new Date() }).where(eq(m.id, input.id)).returning(panelMediaColumns);
  return { media: await withPoster(tx, toPanelMedia(updated)), before: row.alt ?? null };
}

/**
 * Day 6: sets (or, with null, removes) the cover image of a video, locked by the updatedAt the editor
 * loaded. The cover must be an image; its blur placeholder and dominant colour are copied onto the video.
 * A video that is used somewhere (product gallery, hero, video section) keeps a cover: removing it would
 * silently drop the video from product pages, its VideoObject and the video sitemap, and block the next
 * save of that product. It can only be replaced then (FIX COR-8/SEO-2).
 */
export async function updateMediaPoster(
  tx: Tx,
  input: { id: number; posterId: number | null; updatedAt: Date },
  { storage }: { storage?: StorageAdapter } = {},
): Promise<{ media: PanelMedia; before: number | null; removed: PanelMedia[]; removeFiles: () => Promise<void> }> {
  const m = schema.media;
  const [row] = await tx.select({ id: m.id, kind: m.kind, posterId: m.posterId, updatedAt: m.updatedAt }).from(m).where(eq(m.id, input.id)).for("update");
  if (!row) throw new PanelError("not_found", "Video bulunamadı. Silinmiş olabilir.");
  if (row.kind !== "video") throw new PanelError("invalid", "Kapak görseli yalnızca videolara eklenir.");
  assertFresh(row.updatedAt, input.updatedAt);
  if (input.posterId === input.id) throw new PanelError("invalid", "Bir video kendi kapağı olamaz.");
  if (input.posterId === null && row.posterId !== null) {
    const usage = await mediaUsage(input.id, tx);
    if (usage.length > 0) {
      throw new PanelError(
        "in_use",
        `Bu video kullanımda (${describeUsage(usage)}); kapak görselini kaldırmak yerine “Bu kareyi kapak yap” veya “Kütüphaneden seç” ile değiştirin.`,
      );
    }
  }
  const cover = input.posterId ? await lockPosterImage(tx, input.posterId) : null;
  const [updated] = await tx
    .update(m)
    .set({
      posterId: cover?.id ?? null,
      blurDataUrl: cover?.blurDataUrl ?? null,
      dominantColor: cover?.dominantColor ?? null,
      updatedAt: new Date(),
    })
    .where(eq(m.id, input.id))
    .returning(panelMediaColumns);

  // The cover the panel captured for this video (tag "video-poster") is garbage once replaced and unused.
  const replaced = row.posterId && row.posterId !== (cover?.id ?? null) ? await dropUnusedAutoPoster(tx, row.posterId) : null;
  return {
    media: { ...toPanelMedia(updated), poster: cover ? toMediaLike(cover) : null },
    before: row.posterId ?? null,
    removed: replaced ? [replaced.media] : [],
    removeFiles: async () => {
      if (replaced) await deleteMediaFiles(replaced.files, storage ?? storageForMediaUrl(replaced.files.url));
    },
  };
}

type StoredFiles = { url: string; storageKey: string; variants: MediaVariant[] | null };

/** Deletes an auto-captured cover image (tag "video-poster") when nothing uses it any more. */
async function dropUnusedAutoPoster(tx: Tx, posterId: number): Promise<{ media: PanelMedia; files: StoredFiles } | null> {
  const m = schema.media;
  const [cover] = await tx
    .select({ ...panelMediaColumns, tags: m.tags, storageKey: m.storageKey })
    .from(m)
    .where(eq(m.id, posterId))
    .for("update");
  if (!cover || cover.kind !== "image" || !(cover.tags ?? []).includes(MEDIA_UPLOAD.posterTag)) return null;
  if ((await mediaUsage(cover.id, tx)).length > 0) return null;
  await tx.delete(m).where(eq(m.id, cover.id));
  return { media: toPanelMedia(cover), files: { url: cover.url, storageKey: cover.storageKey, variants: cover.variants ?? null } };
}

/** Attaches the cover image to a video row (images unchanged). */
async function withPoster(tx: Tx, media: PanelMedia): Promise<PanelMedia> {
  if (!media.posterId) return media;
  const [cover] = await tx
    .select({ id: schema.media.id, url: schema.media.url, width: schema.media.width, height: schema.media.height, alt: schema.media.alt, blurDataUrl: schema.media.blurDataUrl, dominantColor: schema.media.dominantColor, variants: schema.media.variants })
    .from(schema.media)
    .where(eq(schema.media.id, media.posterId));
  return { ...media, poster: cover ? toMediaLike(cover) : null };
}

/** Sets the library folder of several files (a label only: URLs and files do not change). */
export async function moveMedia(tx: Tx, input: { ids: number[]; folder: string }): Promise<{ id: number; from: string }[]> {
  const m = schema.media;
  const ids = [...new Set(input.ids)];
  const before = await tx.select({ id: m.id, folder: m.folder }).from(m).where(inArray(m.id, ids)).for("update");
  if (before.length === 0) throw new PanelError("not_found", "Seçilen dosyalar bulunamadı.");
  const moved = before.filter((r) => r.folder !== input.folder);
  if (moved.length > 0) {
    await tx.update(m).set({ folder: input.folder, updatedAt: new Date() }).where(inArray(m.id, moved.map((r) => r.id)));
  }
  return moved.map((r) => ({ id: r.id, from: r.folder }));
}

/**
 * Deletes a media row inside `tx` when nothing references it (otherwise PanelError("in_use") listing
 * the places). Returns a function that removes the files; call it after the commit. Day 6: deleting a
 * video also deletes the cover image the panel captured for it (tag "video-poster") once nothing else
 * uses that image; `alsoDeleted` lists it.
 */
export async function deleteMediaRow(
  tx: Tx,
  id: number,
  { storage }: { storage?: StorageAdapter } = {},
): Promise<{ before: PanelMedia; alsoDeleted: PanelMedia[]; removeFiles: () => Promise<void> }> {
  const [row] = await tx.select({ ...panelMediaColumns, storageKey: schema.media.storageKey }).from(schema.media).where(eq(schema.media.id, id)).for("update");
  if (!row) throw new PanelError("not_found", "Dosya bulunamadı. Daha önce silinmiş olabilir.");
  const noun = row.kind === "video" ? "video" : "görsel";

  const usage = await mediaUsage(id, tx);
  if (usage.length > 0) {
    throw new PanelError("in_use", `Bu ${noun} kullanımda olduğu için silinemez: ${describeUsage(usage)}. Önce bu yerlerden kaldırın.`);
  }

  await tx.delete(schema.media).where(eq(schema.media.id, id));
  const cover = row.kind === "video" && row.posterId ? await dropUnusedAutoPoster(tx, row.posterId) : null;
  const files: StoredFiles[] = [{ url: row.url, storageKey: row.storageKey, variants: row.variants ?? null }, ...(cover ? [cover.files] : [])];

  return {
    before: toPanelMedia(row),
    alsoDeleted: cover ? [cover.media] : [],
    removeFiles: async () => {
      await Promise.all(files.map((f) => deleteMediaFiles(f, storage ?? storageForMediaUrl(f.url))));
    },
  };
}
