// Theme editor payloads and choices. Pure (zod only): used by the actions and the editor.
import { z } from "zod";
import type { ThemeTokens } from "@/db/schema";
import { hexColorInput, idInput, optionalHexColorInput, scheduleInput, textInput, updatedAtInput } from "@/lib/panel/schemas";

export const THEME_COLOR_KEYS = ["brand", "accent", "background", "surface", "text"] as const;
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

export const THEME_COLOR_LABELS: Record<ThemeColorKey, { label: string; help: string }> = {
  brand: { label: "Ana renk", help: "Logo, ana butonlar ve duyuru şeridi. Koyu ve doygun bir renk önerilir." },
  accent: { label: "Vurgu rengi", help: "Altın detaylar, sepet sayacı ve vurgulu duyurular." },
  background: { label: "Arka plan", help: "Sayfanın zemin rengi. Çok açık bir ton seçin." },
  surface: { label: "Kart yüzeyi", help: "Kartlar, sepet ve form alanlarının zemini." },
  text: { label: "Metin", help: "Ana metin rengi. Okunabilirlik için gerekirse otomatik koyulaştırılır." },
};

/** Radius presets the engine knows (engine.ts RADIUS). */
export const THEME_RADIUS_OPTIONS = [
  { value: "none", label: "Keskin köşeler" },
  { value: "sm", label: "Hafif yuvarlak" },
  { value: "md", label: "Orta" },
  { value: "lg", label: "Yuvarlak" },
  { value: "full", label: "Hap butonlar" },
] as const;
export type ThemeRadius = (typeof THEME_RADIUS_OPTIONS)[number]["value"];

/** Only fonts loaded by src/lib/fonts.ts (Latin faces; Arabic pages always use their own faces). */
export const THEME_FONT_OPTIONS = [
  { value: "cormorant", label: "Cormorant Garamond (zarif, serif)" },
  { value: "manrope", label: "Manrope (sade, modern)" },
] as const;
export type ThemeFont = (typeof THEME_FONT_OPTIONS)[number]["value"];

export const DEFAULT_HEADING_FONT: ThemeFont = "cormorant";
export const DEFAULT_BODY_FONT: ThemeFont = "manrope";

export const THEME_PRIORITY_MAX = 100;

const radiusInput = z.enum(THEME_RADIUS_OPTIONS.map((o) => o.value) as [ThemeRadius, ...ThemeRadius[]], {
  error: "Geçerli bir köşe stili seçin.",
});
const fontInput = z.enum(THEME_FONT_OPTIONS.map((o) => o.value) as [ThemeFont, ...ThemeFont[]], {
  error: "Listeden bir yazı tipi seçin.",
});

export const themeNameInput = textInput({ max: 60, requiredMessage: "Tema adı gerekli." });

export const themeSaveSchema = z
  .object({
    id: idInput,
    name: themeNameInput,
    colors: z.object({
      brand: hexColorInput,
      accent: hexColorInput,
      background: hexColorInput,
      surface: hexColorInput,
      text: hexColorInput,
    }),
    /** Empty = derived automatically from the light colors. */
    dark: z.object({
      brand: optionalHexColorInput,
      accent: optionalHexColorInput,
      background: optionalHexColorInput,
      surface: optionalHexColorInput,
      text: optionalHexColorInput,
    }),
    radius: radiusInput,
    fonts: z.object({ heading: fontInput, body: fontInput }),
    isScheduled: z.boolean({ error: "Geçersiz değer." }),
    schedule: scheduleInput,
    priority: z.coerce
      .number({ error: "Bir sayı girin." })
      .int("Tam sayı girin.")
      .min(0, "Öncelik 0 ile 100 arasında olmalı.")
      .max(THEME_PRIORITY_MAX, "Öncelik 0 ile 100 arasında olmalı."),
    updatedAt: updatedAtInput,
  })
  .superRefine((v, ctx) => {
    if (!v.isScheduled) return;
    if (!v.schedule.startsAt) ctx.addIssue({ code: "custom", path: ["schedule", "startsAt"], message: "Planlı tema için başlangıç zamanı gerekli." });
    if (!v.schedule.endsAt) ctx.addIssue({ code: "custom", path: ["schedule", "endsAt"], message: "Planlı tema için bitiş zamanı gerekli." });
  });

export type ThemeSaveInput = z.output<typeof themeSaveSchema>;

export const themeCreateSchema = z.object({
  name: themeNameInput,
  /** Copy this theme; omitted = the default theme. */
  fromId: idInput.optional().nullable(),
});
export type ThemeCreateInput = z.output<typeof themeCreateSchema>;

export const themeRefSchema = z.object({ id: idInput, updatedAt: updatedAtInput });
export type ThemeRefInput = z.output<typeof themeRefSchema>;

/** Editor state → stored tokens (keeps decor, which the panel does not edit). */
export function tokensFromInput(
  input: Pick<ThemeSaveInput, "colors" | "dark" | "radius" | "fonts">,
  keep?: Pick<ThemeTokens, "decor">,
): ThemeTokens {
  const dark: NonNullable<ThemeTokens["dark"]> = {};
  for (const key of THEME_COLOR_KEYS) {
    const value = input.dark[key];
    if (value) dark[key] = value;
  }
  const tokens: ThemeTokens = {
    colors: { ...input.colors },
    radius: input.radius,
    fonts: { heading: input.fonts.heading, body: input.fonts.body },
  };
  if (Object.keys(dark).length > 0) tokens.dark = dark;
  if (keep?.decor) tokens.decor = keep.decor;
  return tokens;
}
