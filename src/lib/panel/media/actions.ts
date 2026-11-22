"use server";
// Media library Server Actions (editor+). Uploads go through the route handler POST /panel/api/media
// (multipart is too large for a Server Action). Every function re-checks the session and role.
import { z } from "zod";
import { TAGS } from "@/lib/cache-tags";
import { panelAction, requirePanelActor } from "../action";
import { auditChanges } from "../audit";
import { folderInput, idInput, mediaIdInput, optionalLocalizedTextOf, updatedAtInput } from "../schemas";
import { collectMediaUsage, getPanelMedia, listMedia, mediaUsage } from "./queries";
import { deleteMediaRow, moveMedia, updateMediaAlt, updateMediaPoster } from "./service";
import { MEDIA_KIND_FILTERS, type MediaListInput, type MediaListResult, type MediaUsage, type PanelMedia } from "./types";

/** Tags of everything that renders media (alt text, files): the media cache and the pages embedding images. */
const MEDIA_TAGS = [TAGS.media, TAGS.products, TAGS.pages, TAGS.categories, TAGS.blog];

const listInput = z.object({
  q: z.string().max(200).optional().catch(undefined),
  folder: z.string().max(60).optional().catch(undefined),
  cursor: z.number().int().positive().nullable().optional().catch(undefined),
  /** Day 6: "image" (default; also for anything unknown), "video" or "all". */
  kind: z.enum(MEDIA_KIND_FILTERS).optional().catch(undefined),
});

/** One page of the library (newest first) plus the folder list; images only unless `kind` says otherwise. */
export async function listMediaAction(input: MediaListInput = {}): Promise<MediaListResult> {
  await requirePanelActor("editor");
  const parsed = listInput.parse(input ?? {});
  return listMedia({ q: parsed.q, folder: parsed.folder, cursor: parsed.cursor ?? null, kind: parsed.kind ?? "image" });
}

/** Media rows by id, in the given order (e.g. to show a picker's current selection). */
export async function getMediaItemsAction(ids: number[]): Promise<PanelMedia[]> {
  await requirePanelActor("editor");
  const list = z.array(idInput).max(200).catch([]).parse(ids);
  return getPanelMedia(list);
}

/** Every place that uses an image or video (detail drawer, delete confirmation). */
export async function getMediaUsageAction(id: number): Promise<MediaUsage[]> {
  await requirePanelActor("editor");
  return mediaUsage(idInput.parse(id));
}

/** Usage counts for several images at once (grid badges). */
export async function getMediaUsageCountsAction(ids: number[]): Promise<Record<number, number>> {
  await requirePanelActor("editor");
  const list = z.array(idInput).max(200).catch([]).parse(ids);
  const map = await collectMediaUsage(list);
  return Object.fromEntries([...map].map(([id, usage]) => [id, usage.length]));
}

/** Alt text TR/EN/AR (all empty = decorative image). Locked by the row's updatedAt. */
export const updateMediaAltAction = panelAction({
  minRole: "editor",
  schema: z.object({ id: idInput, alt: optionalLocalizedTextOf({ max: 250 }), updatedAt: updatedAtInput }),
  run: async (input, { tx }) => {
    const { media, before } = await updateMediaAlt(tx, input);
    return {
      data: media,
      message: "Alternatif metin kaydedildi.",
      tags: MEDIA_TAGS,
      audit: { action: "update", entity: "media", entityId: input.id, ...auditChanges({ alt: before }, { alt: input.alt }) },
    };
  },
});

/** Adds the file name to both sides of an audit change (unchanged, so it reads as context, not a change). */
function withName(name: string | null | undefined, changes: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  return name ? { before: { originalName: name, ...changes.before }, after: { originalName: name, ...changes.after } } : changes;
}

/** Day 6: sets or removes the cover image of a video (the cover must be an image). Locked by updatedAt. */
export const updateMediaPosterAction = panelAction({
  minRole: "editor",
  schema: z.object({ id: idInput, posterId: mediaIdInput, updatedAt: updatedAtInput }),
  run: async (input, { tx }) => {
    const { media, before, removed, removeFiles } = await updateMediaPoster(tx, { id: input.id, posterId: input.posterId, updatedAt: input.updatedAt });
    return {
      data: { media, removed: removed.map((m) => m.id) },
      message: input.posterId ? "Kapak görseli güncellendi." : "Kapak görseli kaldırıldı.",
      tags: MEDIA_TAGS,
      audit: [
        // The file name on both sides gives the İşlem Kaydı row its subject ("Medya · tanitim.mp4").
        { action: "update", entity: "media", entityId: input.id, ...withName(media.originalName, auditChanges({ posterId: before }, { posterId: input.posterId })) },
        ...removed.map((m) => ({
          action: "delete",
          entity: "media",
          entityId: m.id,
          before: { url: m.url, folder: m.folder, originalName: m.originalName, kind: "image", reason: input.posterId ? "Video kapağı değiştirildi" : "Video kapağı kaldırıldı" },
        })),
      ],
      afterCommit: removeFiles,
    };
  },
});

/** Moves images to another library folder (a label only: URLs and files stay where they are). */
export const moveMediaAction = panelAction({
  minRole: "editor",
  schema: z.object({
    ids: z.array(idInput, { error: "Dosya seçin." }).min(1, "Dosya seçin.").max(200, "En fazla 200 dosya taşıyabilirsiniz."),
    folder: folderInput,
  }),
  run: async (input, { tx }) => {
    const moved = await moveMedia(tx, input);
    return {
      data: { moved: moved.length, folder: input.folder },
      message: moved.length > 0 ? `${moved.length} dosya “${input.folder}” klasörüne taşındı.` : "Seçilen dosyalar zaten bu klasörde.",
      audit: moved.map((r) => ({ action: "move", entity: "media", entityId: r.id, before: { folder: r.from }, after: { folder: input.folder } })),
    };
  },
});

/**
 * Deletes an image or video that nothing uses (otherwise `in_use` with the list of places); files go after
 * commit. A video takes its unused auto-captured cover image with it.
 */
export const deleteMediaAction = panelAction({
  minRole: "editor",
  schema: z.object({ id: idInput }),
  run: async (input, { tx }) => {
    const { before, alsoDeleted, removeFiles } = await deleteMediaRow(tx, input.id);
    const video = before.kind === "video";
    return {
      data: { id: input.id, alsoDeleted: alsoDeleted.map((m) => m.id) },
      message: video ? (alsoDeleted.length > 0 ? "Video ve kapak görseli silindi." : "Video silindi.") : "Görsel silindi.",
      tags: MEDIA_TAGS,
      audit: [before, ...alsoDeleted].map((row) => ({
        action: "delete",
        entity: "media",
        entityId: row.id,
        before: { url: row.url, folder: row.folder, originalName: row.originalName, alt: row.alt, kind: row.kind ?? "image" },
      })),
      afterCommit: removeFiles,
    };
  },
});
