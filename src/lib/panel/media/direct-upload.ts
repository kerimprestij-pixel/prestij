// Day 6: direct uploads (docs/DAY6-WHEEL-VIDEO.md §1.2 "Upload transport"). One file per request, sent by
// the browser straight to the storage, so no request body ever passes a serverless function (Vercel
// refuses bodies over ~4.5 MB):
//   1. startDirectUpload: validate the declared file → staging key + signed ticket + the PUT target;
//   2. the browser PUTs the file (Supabase signed URL; locally receiveLocalUpload streams it to disk);
//   3. completeDirectUpload: re-check the stored size (stat) and the real type (head bytes), then
//      image → read the original, encode the variants one after another, delete the staging object;
//      video → move to its final key and create the row (cover image linked via posterId).
//      Any mismatch deletes the staging object and answers with a Turkish error.
// Services take the storage and an executor (DB-testable); no Next APIs.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema";
import { mediaColumns } from "@/lib/data/media";
import { deleteMediaFiles, processImage, type NewMediaValues } from "@/lib/media/process";
import { getUploadStorage, LocalStorage, UploadTooLargeError, type StorageAdapter } from "@/lib/media/storage";
import { toMediaLike, type MediaKind } from "@/lib/media/types";
import { safeErrorInfo } from "@/lib/db-errors";
import type { TokenSigner } from "@/lib/signed-token";
import { writeAudit } from "../audit";
import { PanelError } from "../errors";
import type { Tx } from "../tx";
import { panelMediaColumns, toPanelMedia } from "./queries";
import { createUploadTicket, incomingKey, readUploadTicket, uniqueUploadStem, type UploadTicket } from "./tickets";
import { MEDIA_UPLOAD, type MediaUploadMeta, type MediaUploadTarget, type PanelMedia } from "./types";
import { sniffImage } from "./upload";
import { checkUploadCandidate, checkVideoDuration, checkVideoSize, formatMegabytes, maxUploadBytes, sanitizeFileName } from "./upload-rules";
import { probeVideo, type VideoProbe } from "./video-sniff";

type Signer = Pick<TokenSigner, "signToken" | "verifyToken">;
type Deps = { actorId: string; storage?: StorageAdapter; signer?: Signer };

export type StartUploadInput = { name: string; size: number; type: string; kind: MediaKind; folder: string };
export type StartUploadResult = { ticket: string; upload: MediaUploadTarget; expiresAt: string };

const NOT_SUPPORTED = "Bu depolama doğrudan yüklemeyi desteklemiyor. Yöneticinize başvurun.";

function requireDirect(storage: StorageAdapter): Required<Pick<StorageAdapter, "createUploadTarget" | "readRange" | "read" | "move">> {
  const { createUploadTarget, readRange, read, move } = storage;
  if (!createUploadTarget || !readRange || !read || !move) throw new PanelError("server", NOT_SUPPORTED);
  return {
    createUploadTarget: createUploadTarget.bind(storage),
    readRange: readRange.bind(storage),
    read: read.bind(storage),
    move: move.bind(storage),
  };
}

/** Step 1: validates the declared file and returns the ticket and where to PUT it. */
export async function startDirectUpload(input: StartUploadInput, { actorId, storage = getUploadStorage(), signer }: Deps): Promise<StartUploadResult> {
  const direct = requireDirect(storage);
  const check = checkUploadCandidate({ name: input.name, size: input.size, type: input.type }, input.kind);
  if (!check.ok) throw new PanelError("invalid", check.error);
  if (check.kind !== input.kind) throw new PanelError("invalid", "Dosya türü seçilen yükleme türüyle uyuşmuyor.");

  const name = sanitizeFileName(input.name, check.kind === "video" ? "video" : "görsel");
  const key = incomingKey(name, check.ext);
  const ticket = createUploadTicket({ key, size: input.size, mime: check.mime, kind: check.kind, folder: input.folder, name, actorId }, signer);
  let upload: MediaUploadTarget;
  try {
    upload = await direct.createUploadTarget(key, check.mime, { ticket });
  } catch (error) {
    console.error("[panel] media upload signing failed", safeErrorInfo(error));
    throw new PanelError("server", "Yükleme başlatılamadı. Biraz sonra tekrar deneyin.");
  }
  return { ticket, upload, expiresAt: new Date(Date.now() + MEDIA_UPLOAD.direct.ticketSeconds * 1000).toISOString() };
}

/**
 * Step 2 on the local driver: streams the PUT body to the ticket's staging key (never buffered). The
 * body must be exactly the declared size.
 */
export async function receiveLocalUpload(
  token: unknown,
  body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | null,
  contentLength: number | null,
  { actorId, storage = getUploadStorage(), signer }: Deps,
): Promise<{ bytes: number }> {
  if (!(storage instanceof LocalStorage)) throw new PanelError("not_found", "Bu yükleme adresi yalnızca yerel depolamada kullanılır.");
  const read = readUploadTicket(token, actorId, signer);
  if (!read.ok) throw new PanelError("invalid", read.error);
  const { ticket } = read;
  if (!body) throw new PanelError("invalid", "Dosya gönderilmedi.");
  if (contentLength !== null && contentLength !== ticket.size) {
    throw new PanelError("invalid", "Gönderilen dosya, yükleme biletindeki boyutla uyuşmuyor. Tekrar deneyin.");
  }
  let bytes: number;
  try {
    bytes = await storage.writeStream(ticket.key, body, { maxBytes: ticket.size });
  } catch (error) {
    if (error instanceof UploadTooLargeError) {
      throw new PanelError("invalid", "Gönderilen dosya, yükleme biletindeki boyuttan büyük. Tekrar deneyin.");
    }
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") throw new PanelError("conflict", "Bu dosya zaten gönderildi.");
    throw error;
  }
  if (bytes !== ticket.size) {
    await storage.delete(ticket.key).catch(() => undefined);
    throw new PanelError("invalid", "Dosya eksik ulaştı. Bağlantınızı kontrol edip tekrar deneyin.");
  }
  return { bytes };
}

export type CompleteUploadInput = {
  ticket: string;
  meta?: MediaUploadMeta | null;
  posterId?: number | null;
  alt?: LocalizedText | null;
  purpose?: "poster";
};

export type CompleteUploadResult = { item: PanelMedia; warnings: string[] };

/** Step 3: checks what arrived and turns it into a media row (see the file comment). */
export async function completeDirectUpload(
  input: CompleteUploadInput,
  { actorId, storage = getUploadStorage(), signer, executor = db }: Deps & { executor?: Tx },
): Promise<CompleteUploadResult> {
  const direct = requireDirect(storage);
  const read = readUploadTicket(input.ticket, actorId, signer);
  if (!read.ok) throw new PanelError("invalid", read.error);
  const ticket = read.ticket;
  const discard = () => storage.delete(ticket.key).catch(() => undefined);

  const stored = await storage.stat(ticket.key);
  if (!stored) throw new PanelError("invalid", `"${ticket.name}" depoya ulaşmadı. Dosyayı yeniden yükleyin.`);
  if (stored.bytes !== ticket.size) {
    await discard();
    throw new PanelError("invalid", `"${ticket.name}" eksik ya da farklı yüklendi (${formatMegabytes(stored.bytes)} / ${formatMegabytes(ticket.size)}). Tekrar deneyin.`);
  }
  if (stored.bytes > maxUploadBytes(ticket.kind)) {
    await discard();
    throw new PanelError("invalid", `"${ticket.name}" izin verilen boyuttan büyük.`);
  }

  let probe: Awaited<ReturnType<typeof probeVideo>>;
  try {
    probe = await probeVideo(
      async (offset, length) => (await direct.readRange(ticket.key, offset, offset + length - 1)) ?? new Uint8Array(),
      stored.bytes,
      ticket.name,
    );
  } catch (error) {
    await discard();
    console.error("[panel] media upload probe failed", safeErrorInfo(error));
    throw new PanelError("server", "Dosya okunamadı. Tekrar deneyin.");
  }

  if (probe === null) {
    if (ticket.kind === "video") {
      await discard();
      throw new PanelError("invalid", `"${ticket.name}" bir video dosyası değil. MP4 (H.264) ya da WebM yükleyin.`);
    }
    return completeImage(ticket, input, { storage, direct, executor, discard });
  }
  if (!probe.ok) {
    await discard();
    throw new PanelError("invalid", probe.error);
  }
  if (ticket.kind !== "video") {
    await discard();
    throw new PanelError("invalid", `"${ticket.name}" bir video; görsel olarak yüklenemez.`);
  }
  return completeVideo(ticket, probe.video, input, { storage, direct, executor, discard, bytes: stored.bytes });
}

type CompleteContext = {
  storage: StorageAdapter;
  direct: ReturnType<typeof requireDirect>;
  executor: Tx;
  discard: () => Promise<unknown>;
};

async function completeImage(ticket: UploadTicket, input: CompleteUploadInput, ctx: CompleteContext): Promise<CompleteUploadResult> {
  const { storage, direct, executor, discard } = ctx;
  let data: Buffer | null;
  try {
    data = await direct.read(ticket.key, MEDIA_UPLOAD.maxFileBytes);
  } catch (error) {
    await discard();
    if (error instanceof UploadTooLargeError) throw new PanelError("invalid", `"${ticket.name}" izin verilen boyuttan büyük.`);
    throw error;
  }
  if (!data) throw new PanelError("invalid", `"${ticket.name}" depoya ulaşmadı. Dosyayı yeniden yükleyin.`);
  const sniff = await sniffImage(data, ticket.name);
  if (!sniff.ok) {
    await discard();
    throw new PanelError("invalid", sniff.error);
  }

  let values: NewMediaValues | null = null;
  try {
    values = await processImage(data, {
      folder: ticket.folder,
      stem: uniqueUploadStem(ticket.name),
      storage,
      limitInputPixels: MEDIA_UPLOAD.maxPixels,
      sequential: true,
      tags: input.purpose === "poster" ? [MEDIA_UPLOAD.posterTag] : null,
    });
    data = null; // let the original go before the DB round trip
    const processed = values;
    const row = await executor.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(schema.media)
        .values({ ...processed, kind: "image", originalName: ticket.name, alt: input.alt ?? null })
        .returning(panelMediaColumns);
      await writeAudit(tx, {
        actorId: ticket.actorId,
        action: "upload",
        entity: "media",
        entityId: inserted.id,
        after: { url: inserted.url, folder: inserted.folder, originalName: inserted.originalName, width: inserted.width, height: inserted.height, bytes: inserted.bytes },
      });
      return inserted;
    });
    return { item: toPanelMedia(row), warnings: [] };
  } catch (error) {
    if (values) await deleteMediaFiles({ storageKey: values.storageKey, variants: values.variants ?? null }, storage).catch(() => undefined);
    if (error instanceof PanelError) throw error;
    console.error("[panel] media upload processing failed", safeErrorInfo(error));
    throw new PanelError("server", "Görsel işlenemedi. Dosya bozuk olabilir; başka bir görselle tekrar deneyin.");
  } finally {
    await discard();
  }
}

/** The values the browser measured, when they are usable (integers, in range). */
function cleanMeta(meta: MediaUploadMeta | null | undefined): MediaUploadMeta {
  const int = (n: unknown, max: number) => (typeof n === "number" && Number.isInteger(n) && n > 0 && n <= max ? n : undefined);
  return {
    width: int(meta?.width, 100_000),
    height: int(meta?.height, 100_000),
    durationMs: int(meta?.durationMs, 24 * 3600_000),
  };
}

const FASTSTART_WARNING =
  "Bu video akış için optimize edilmemiş (moov sonda); sitede oynamaya başlaması biraz gecikebilir. Mümkünse dışa aktarırken “web için optimize et / hızlı başlat” seçeneğini açın.";

async function completeVideo(
  ticket: UploadTicket,
  video: VideoProbe,
  input: CompleteUploadInput,
  ctx: CompleteContext & { bytes: number },
): Promise<CompleteUploadResult> {
  const { storage, direct, executor, discard } = ctx;
  const meta = cleanMeta(input.meta);
  // The bytes win over the browser; the browser fills in what the file does not say (WebM from a
  // recorder has no duration in its header) and is validated the same way.
  const durationMs = video.durationMs ?? meta.durationMs ?? null;
  const width = video.width ?? meta.width ?? null;
  const height = video.height ?? meta.height ?? null;
  const problem = checkVideoDuration(durationMs) ?? checkVideoSize(width, height);
  if (problem) {
    await discard();
    throw new PanelError("invalid", `"${ticket.name}": ${problem}`);
  }

  const finalKey = `${ticket.folder}/${uniqueUploadStem(ticket.name)}.${video.format}`;
  try {
    await direct.move(ticket.key, finalKey);
  } catch (error) {
    await discard();
    console.error("[panel] media upload move failed", safeErrorInfo(error));
    throw new PanelError("server", "Video kaydedilemedi. Tekrar deneyin.");
  }

  try {
    const { row, poster } = await executor.transaction(async (tx) => {
      const cover = input.posterId ? await lockPosterImage(tx, input.posterId) : null;
      const [inserted] = await tx
        .insert(schema.media)
        .values({
          storageKey: finalKey,
          url: storage.publicUrl(finalKey),
          mime: video.mime,
          kind: "video",
          width,
          height,
          bytes: ctx.bytes,
          durationMs,
          posterId: cover?.id ?? null,
          variants: null,
          blurDataUrl: cover?.blurDataUrl ?? null,
          dominantColor: cover?.dominantColor ?? null,
          alt: input.alt ?? null,
          folder: ticket.folder,
          originalName: ticket.name,
        })
        .returning(panelMediaColumns);
      await writeAudit(tx, {
        actorId: ticket.actorId,
        action: "upload",
        entity: "media",
        entityId: inserted.id,
        after: {
          url: inserted.url,
          folder: inserted.folder,
          originalName: inserted.originalName,
          mime: inserted.mime,
          width: inserted.width,
          height: inserted.height,
          bytes: inserted.bytes,
          durationMs: inserted.durationMs,
          posterId: inserted.posterId,
        },
      });
      return { row: inserted, poster: cover };
    });
    return {
      item: { ...toPanelMedia(row), poster: poster ? toMediaLike(poster) : null },
      warnings: video.format === "mp4" && video.faststart === false ? [FASTSTART_WARNING] : [],
    };
  } catch (error) {
    await deleteMediaFiles({ storageKey: finalKey, variants: null }, storage).catch(() => undefined);
    if (error instanceof PanelError) throw error;
    console.error("[panel] media video row failed", safeErrorInfo(error));
    throw new PanelError("server", "Video kaydedilemedi. Tekrar deneyin.");
  }
}

/**
 * The cover image of a video, locked FOR SHARE (a concurrent delete of it waits for this transaction
 * and then sees the link). PanelError when it is gone or not an image.
 */
export async function lockPosterImage(tx: Tx, posterId: number) {
  const [found] = await tx
    .select({ ...mediaColumns, kind: schema.media.kind })
    .from(schema.media)
    .where(eq(schema.media.id, posterId))
    .for("share");
  if (!found) throw new PanelError("invalid", "Kapak görseli bulunamadı; silinmiş olabilir.", { posterId: "Kapak görseli bulunamadı." });
  if (found.kind !== "image") throw new PanelError("invalid", "Kapak olarak yalnızca bir görsel seçilebilir.", { posterId: "Bir görsel seçin." });
  return found;
}
