"use server";
// Announcement bar (editor+). Schema + run: src/lib/panel/content/action-defs.ts; rules: announcements-service.ts.
import { panelAction } from "@/lib/panel/action";
import { deleteAnnouncementDef, reorderAnnouncementsDef, saveAnnouncementDef } from "@/lib/panel/content/action-defs";

export const saveAnnouncementAction = panelAction({ minRole: "editor", ...saveAnnouncementDef });
export const reorderAnnouncementsAction = panelAction({ minRole: "editor", ...reorderAnnouncementsDef });
export const deleteAnnouncementAction = panelAction({ minRole: "editor", ...deleteAnnouncementDef });
