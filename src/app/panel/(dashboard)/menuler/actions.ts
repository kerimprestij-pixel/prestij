"use server";
// Storefront menus (editor+). Schema + run: src/lib/panel/content/action-defs.ts; rules: menus-service.ts.
import { panelAction } from "@/lib/panel/action";
import { saveMenusDef } from "@/lib/panel/content/action-defs";

export const saveMenusAction = panelAction({ minRole: "editor", ...saveMenusDef });
