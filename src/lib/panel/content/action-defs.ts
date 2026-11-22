// Schema + run of every CONTENT Server Action, without the session/Next half. The "use server" files in
// /panel/sayfalar, /panel/menuler and /panel/duyurular wrap these with panelAction({ minRole: "editor" });
// the DB tests run the very same definitions through executePanelAction.
import "server-only";
import type { z } from "zod";
import { TAGS } from "@/lib/cache-tags";
import type { PanelActionOptions } from "@/lib/panel/action-core";
import { deleteAnnouncement, reorderAnnouncements, saveAnnouncement, type SaveAnnouncementResult } from "./announcements-service";
import { saveMenus, type SaveMenusResult } from "./menus-service";
import { createPage, deletePage, savePage, type SavePageResult } from "./pages-service";
import {
  announcementDeleteSchema,
  announcementOrderSchema,
  announcementSaveSchema,
  menusSaveSchema,
  pageCreateSchema,
  pageDeleteSchema,
  pageSaveSchema,
} from "./schemas";

type Def<S extends z.ZodType, T = undefined> = Pick<PanelActionOptions<S, T>, "schema" | "run">;

export const createPageDef: Def<typeof pageCreateSchema, { id: number }> = {
  schema: pageCreateSchema,
  run: async (input, { tx }) => {
    const { id, audit } = await createPage(tx, input);
    // A new page starts unpublished: nothing on the storefront changes yet, so no tags.
    return { data: { id }, message: "Sayfa oluşturuldu. Bölümlerini ekleyip yayınlayabilirsiniz.", audit };
  },
};

export const savePageDef: Def<typeof pageSaveSchema, SavePageResult> = {
  schema: pageSaveSchema,
  run: async (input, { tx }) => {
    const { result, audit, tags } = await savePage(tx, input);
    return { data: result, message: "Sayfa kaydedildi. Değişiklikler sitede yayında.", tags, audit };
  },
};

export const deletePageDef: Def<typeof pageDeleteSchema> = {
  schema: pageDeleteSchema,
  run: async (input, { tx }) => {
    const { audit, tags } = await deletePage(tx, input);
    return { message: "Sayfa silindi.", tags, audit };
  },
};

export const saveMenusDef: Def<typeof menusSaveSchema, SaveMenusResult> = {
  schema: menusSaveSchema,
  run: async (input, { tx }) => {
    const { result, audit } = await saveMenus(tx, input);
    if (result.changed.length === 0) return { data: result, message: "Menülerde değişiklik yok." };
    return { data: result, message: "Menüler kaydedildi. Sitede yayında.", tags: [TAGS.menus], audit };
  },
};

export const saveAnnouncementDef: Def<typeof announcementSaveSchema, SaveAnnouncementResult> = {
  schema: announcementSaveSchema,
  run: async (input, { tx }) => {
    const { result, audit } = await saveAnnouncement(tx, input);
    return { data: result, message: result.created ? "Duyuru oluşturuldu." : "Duyuru kaydedildi.", tags: [TAGS.announcements], audit };
  },
};

export const reorderAnnouncementsDef: Def<typeof announcementOrderSchema> = {
  schema: announcementOrderSchema,
  run: async (input, { tx }) => {
    const { audit } = await reorderAnnouncements(tx, input.ids);
    if (!audit) return { message: "Sıralama zaten bu şekilde." };
    return { message: "Sıralama kaydedildi.", tags: [TAGS.announcements], audit };
  },
};

export const deleteAnnouncementDef: Def<typeof announcementDeleteSchema> = {
  schema: announcementDeleteSchema,
  run: async (input, { tx }) => {
    const { audit } = await deleteAnnouncement(tx, input);
    return { message: "Duyuru silindi.", tags: [TAGS.announcements], audit };
  },
};
