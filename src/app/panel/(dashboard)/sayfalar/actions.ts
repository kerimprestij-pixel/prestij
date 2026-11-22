"use server";
// Pages and sections (editor+). Schema + run: src/lib/panel/content/action-defs.ts; rules: pages-service.ts.
import { panelAction } from "@/lib/panel/action";
import { createPageDef, deletePageDef, savePageDef } from "@/lib/panel/content/action-defs";

export const createPageAction = panelAction({ minRole: "editor", ...createPageDef });
export const savePageAction = panelAction({ minRole: "editor", ...savePageDef });
export const deletePageAction = panelAction({ minRole: "editor", ...deletePageDef });
