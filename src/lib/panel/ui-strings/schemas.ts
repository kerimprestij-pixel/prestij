// UI text override payloads and per-key checks. Pure (zod + the built-in dictionaries): the editor runs
// the same checks while typing that the server runs on save.
import { z } from "zod";
import type { Locale } from "@/db/schema/common";
import { updatedAtInput } from "@/lib/panel/schemas";
import { findUiString, UI_STRING_LOCALES } from "./catalog";
import { validateOverride } from "./template";

/** Longest override (the longest built-in text is about 300 characters). */
export const UI_STRING_MAX = 1000;
/** Most keys one save may change. */
export const UI_STRING_BATCH_MAX = 300;

export type UiStringOverride = Partial<Record<Locale, string>>;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** One override text: line breaks become spaces (UI texts are single-line), trimmed; "" = not overridden. */
export const overrideTextInput = z
  .union([z.string(), z.null()], { error: "Metin girin." })
  .optional()
  .transform((v) => (typeof v === "string" ? v.replace(/\s*[\r\n]+\s*/g, " ").trim() : ""))
  .pipe(
    z
      .string()
      .max(UI_STRING_MAX, `En fazla ${UI_STRING_MAX} karakter girebilirsiniz.`)
      .refine((v) => !CONTROL_CHARS.test(v), "Metin geçersiz karakterler içeriyor."),
  );

export const uiStringValueInput = z.object({ tr: overrideTextInput, en: overrideTextInput, ar: overrideTextInput });

export const uiStringItemInput = z.object({
  key: z.string({ error: "Metin anahtarı eksik." }).trim().min(1, "Metin anahtarı eksik.").max(200, "Metin anahtarı geçersiz."),
  value: uiStringValueInput,
  /** The override's updatedAt the editor loaded, or null when there was no override. */
  updatedAt: z
    .union([z.null(), updatedAtInput])
    .optional()
    .transform((v) => v ?? null),
});

export const uiStringsSaveSchema = z.object({
  items: z
    .array(uiStringItemInput)
    .min(1, "Kaydedilecek değişiklik yok.")
    .max(UI_STRING_BATCH_MAX, `Tek seferde en fazla ${UI_STRING_BATCH_MAX} metin kaydedilebilir.`),
});
export type UiStringsSaveInput = z.output<typeof uiStringsSaveSchema>;
export type UiStringSaveItem = UiStringsSaveInput["items"][number];

export const uiStringResetSchema = z.object({ key: uiStringItemInput.shape.key, updatedAt: updatedAtInput });

/** Only the non-empty, trimmed locales. */
export function compactOverride(value: UiStringOverride | null | undefined): UiStringOverride {
  const out: UiStringOverride = {};
  for (const locale of UI_STRING_LOCALES) {
    const text = value?.[locale]?.trim();
    if (text) out[locale] = text;
  }
  return out;
}

/**
 * Errors for one key's override: an unknown key (path "key"), or per locale when the text drops or
 * adds a {placeholder} or breaks the plural syntax of that language's built-in text.
 */
export function uiStringValueErrors(key: string, value: UiStringOverride): Partial<Record<Locale | "key", string>> {
  const entry = findUiString(key);
  if (!entry) return { key: "Bu metin artık sitede kullanılmıyor. Sayfayı yenileyin." };
  const errors: Partial<Record<Locale, string>> = {};
  for (const locale of UI_STRING_LOCALES) {
    const text = value[locale]?.trim();
    if (!text) continue;
    const message = validateOverride(entry[locale], text, locale);
    if (message) errors[locale] = message;
  }
  return errors;
}
