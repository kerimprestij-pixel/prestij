"use server";
import { TAGS } from "@/lib/cache-tags";
import { panelAction } from "@/lib/panel/action";
import { uiStringResetSchema, uiStringsSaveSchema } from "@/lib/panel/ui-strings/schemas";
import { saveUiStrings } from "@/lib/panel/ui-strings/service";

/** Saves the changed keys (payload { items: [{ key, value: { tr, en, ar }, updatedAt }] }). */
export const saveUiStringsAction = panelAction({
  minRole: "editor",
  schema: uiStringsSaveSchema,
  run: async (input, { tx }) => {
    const { versions, changed, audit } = await saveUiStrings(tx, input.items);
    return {
      data: { versions },
      message: changed === 0 ? "Değişiklik yoktu." : changed === 1 ? "Metin kaydedildi." : `${changed} metin kaydedildi.`,
      tags: changed > 0 ? [TAGS.uiStrings] : [],
      audit,
    };
  },
});

/** "Varsayılana dön": removes the key's override in every language. */
export const resetUiStringAction = panelAction({
  minRole: "editor",
  schema: uiStringResetSchema,
  run: async (input, { tx }) => {
    const { versions, changed, audit } = await saveUiStrings(tx, [{ key: input.key, value: { tr: "", en: "", ar: "" }, updatedAt: input.updatedAt }]);
    return {
      data: { versions },
      message: "Varsayılan metne dönüldü.",
      tags: changed > 0 ? [TAGS.uiStrings] : [],
      audit,
    };
  },
});
