"use server";
import { TAGS } from "@/lib/cache-tags";
import { panelAction } from "@/lib/panel/action";
import { themeCreateSchema, themeRefSchema, themeSaveSchema } from "@/lib/panel/theme/schemas";
import { createTheme, deleteTheme, saveTheme, setDefaultTheme } from "@/lib/panel/theme/service";

/** New theme (copy of the default, or of `fromId`); the client then opens its editor. */
export const createThemeAction = panelAction({
  minRole: "editor",
  schema: themeCreateSchema,
  run: async (input, { tx }) => {
    const { id, audit } = await createTheme(tx, input);
    // A new theme is neither default nor scheduled, so the storefront is unchanged: no tags (the panel
    // page refreshes instead).
    return { data: { id }, message: "Tema oluşturuldu.", audit };
  },
});

export const saveThemeAction = panelAction({
  minRole: "editor",
  schema: themeSaveSchema,
  run: async (input, { tx }) => {
    const { updatedAt, audit } = await saveTheme(tx, input);
    return { data: { updatedAt: updatedAt.toISOString() }, message: "Tema kaydedildi.", tags: [TAGS.theme], audit };
  },
});

export const setDefaultThemeAction = panelAction({
  minRole: "editor",
  schema: themeRefSchema,
  run: async (input, { tx }) => {
    const { changed, audit } = await setDefaultTheme(tx, input);
    return {
      message: changed ? "Varsayılan tema değiştirildi." : "Bu tema zaten varsayılan.",
      tags: [TAGS.theme],
      audit,
    };
  },
});

export const deleteThemeAction = panelAction({
  minRole: "editor",
  schema: themeRefSchema,
  run: async (input, { tx }) => {
    const { clearedCampaigns, audit } = await deleteTheme(tx, input);
    const n = clearedCampaigns.length;
    return {
      message: n > 0 ? `Tema silindi; ${n} kampanyanın tema bağlantısı kaldırıldı.` : "Tema silindi.",
      tags: n > 0 ? [TAGS.theme, TAGS.campaigns] : [TAGS.theme],
      audit,
    };
  },
});
