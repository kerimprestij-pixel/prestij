// Zod building blocks for panel action schemas. Messages are Turkish and shown next to the field.
// Pure (zod only): the same schemas can validate on the client before submitting.
import { z } from "zod";
import type { LocalizedText } from "@/db/schema/common";
import { HREF_MESSAGE, isSafeHref } from "@/lib/safe-href";
import { parseIstanbulDateTimeLocal, parseTryAmount, SLUG_MAX_LENGTH, SLUG_PATTERN } from "./format";

/** C0/C1 control characters except tab, line feed and carriage return. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const NO_CONTROL = "Metin geçersiz karakterler içeriyor.";

// ---------------------------------------------------------------------------------------------------
// Text

type TextInputOptions = { max?: number; requiredMessage?: string };

const plainText = (max: number) =>
  z
    .string({ error: "Metin girin." })
    .trim()
    .max(max, `En fazla ${max} karakter girebilirsiniz.`)
    .refine((v) => !CONTROL_CHARS.test(v), NO_CONTROL);

const requiredText = (max: number, requiredMessage: string) => plainText(max).refine((v) => v.length > 0, requiredMessage);

const optionalText = (max: number) =>
  z
    .union([plainText(max), z.null()])
    .optional()
    .transform((v) => (v ? v : null));

/**
 * Trimmed plain text without control characters (default max 500). Required by default (output
 * `string`); `required: false` turns ""/null/missing into null (output `string | null`).
 */
export function textInput(opts: TextInputOptions & { required: false }): ReturnType<typeof optionalText>;
export function textInput(opts?: TextInputOptions & { required?: true }): ReturnType<typeof requiredText>;
export function textInput(opts?: TextInputOptions & { required?: boolean }): ReturnType<typeof optionalText> | ReturnType<typeof requiredText>;
export function textInput(opts: TextInputOptions & { required?: boolean } = {}) {
  const { max = 500, requiredMessage = "Bu alan zorunlu." } = opts;
  return opts.required === false ? optionalText(max) : requiredText(max, requiredMessage);
}

const optionalLocaleText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" ? v.trim() : ""))
    .pipe(z.string().max(max, `En fazla ${max} karakter girebilirsiniz.`).refine((v) => !CONTROL_CHARS.test(v), NO_CONTROL));

function compactLocalized(v: { tr: string; en: string; ar: string }): LocalizedText {
  const out: LocalizedText = { tr: v.tr };
  if (v.en) out.en = v.en;
  if (v.ar) out.ar = v.ar;
  return out;
}

/**
 * Localized text with a required Turkish value; en/ar optional (empty → omitted). All values trimmed.
 * Error paths: "<field>.tr", "<field>.en", "<field>.ar".
 */
export function localizedTextOf({ max = 2000, requiredMessage = "Türkçe metin gerekli." }: { max?: number; requiredMessage?: string } = {}) {
  return z
    .object({
      tr: z
        .string({ error: requiredMessage })
        .trim()
        .min(1, requiredMessage)
        .max(max, `En fazla ${max} karakter girebilirsiniz.`)
        .refine((v) => !CONTROL_CHARS.test(v), NO_CONTROL),
      en: optionalLocaleText(max),
      ar: optionalLocaleText(max),
    }, { error: requiredMessage })
    .transform(compactLocalized);
}

/** Localized text that may be left empty entirely (→ null). A translation without Turkish is refused. */
export function optionalLocalizedTextOf({ max = 2000 }: { max?: number } = {}) {
  return z
    .union([
      z.object({ tr: optionalLocaleText(max), en: optionalLocaleText(max), ar: optionalLocaleText(max) }),
      z.null(),
    ])
    .optional()
    .transform((v, ctx): LocalizedText | null => {
      if (!v || (!v.tr && !v.en && !v.ar)) return null;
      if (!v.tr) {
        ctx.addIssue({ code: "custom", message: "Önce Türkçe metni girin.", path: ["tr"] });
        return z.NEVER;
      }
      return compactLocalized(v);
    });
}

/** tr required (max 2000), en/ar optional, trimmed. */
export const localizedTextInput = localizedTextOf();
/** Same as localizedTextInput but the whole value may be empty (→ null). */
export const optionalLocalizedTextInput = optionalLocalizedTextOf();

// ---------------------------------------------------------------------------------------------------
// Slugs and links

export const SLUG_MESSAGE = "Kısa ad yalnızca küçük harf (a–z), rakam ve tire içerebilir.";

/** URL slug: trimmed, lower-cased, a–z 0–9 and single hyphens, 1–80 characters. */
export const slugInput = z
  .string({ error: "Kısa ad girin." })
  .trim()
  .toLowerCase()
  .min(1, "Kısa ad girin.")
  .max(SLUG_MAX_LENGTH, `Kısa ad en fazla ${SLUG_MAX_LENGTH} karakter olabilir.`)
  .regex(SLUG_PATTERN, SLUG_MESSAGE);

// The link rule itself lives in src/lib/safe-href.ts (zod-free, so the storefront applies it on render).
export { HREF_MESSAGE, isSafeHref };

/** A required link (see isSafeHref), trimmed. */
export const hrefInput = z
  .string({ error: "Bağlantı girin." })
  .trim()
  .min(1, "Bağlantı girin.")
  .refine((v) => isSafeHref(v), HREF_MESSAGE);

/** An optional link: "" / null → null. */
export const optionalHrefInput = z
  .union([z.string(), z.null()])
    .optional()
  .transform((v) => (typeof v === "string" ? v.trim() : ""))
  .refine((v) => v === "" || isSafeHref(v), HREF_MESSAGE)
  .transform((v) => (v === "" ? null : v));

// ---------------------------------------------------------------------------------------------------
// Numbers

/** Largest money value accepted (int4 column limit, ≈ 21 million TL). */
export const MAX_KURUS = 2_000_000_000;

/** Money in kuruş (integer ≥ 0). Also accepts a Turkish-formatted string ("1.499,90" → 149990). */
export const kurusInput = z
  .union([z.number(), z.string()], { error: "Geçerli bir tutar girin." })
  .transform((v, ctx) => {
    const n = typeof v === "number" ? v : parseTryAmount(v);
    if (n === null || !Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Geçerli bir tutar girin." });
      return z.NEVER;
    }
    return n;
  })
  .pipe(
    z
      .number()
      .int("Tutar kuruş cinsinden tam sayı olmalı.")
      .min(0, "Tutar negatif olamaz.")
      .max(MAX_KURUS, "Tutar çok büyük."),
  );

/** Money in kuruş, greater than zero (prices). */
export const positiveKurusInput = kurusInput.pipe(z.number().min(1, "Tutar sıfırdan büyük olmalı."));

/** Whole percent within [min, max] (default 0–100). */
export function percentInputRange(min = 0, max = 100) {
  return z
    .number({ error: "Geçerli bir yüzde girin." })
    .int("Yüzde tam sayı olmalı.")
    .min(min, `Yüzde en az ${min} olmalı.`)
    .max(max, `Yüzde en fazla ${max} olabilir.`);
}

/** Whole percent 0–100. */
export const percentInput = percentInputRange(0, 100);

/** Positive integer id (also from a numeric string). */
export const idInput = z.coerce
  .number({ error: "Geçersiz kayıt." })
  .int("Geçersiz kayıt.")
  .positive("Geçersiz kayıt.")
  .max(2_147_483_647, "Geçersiz kayıt.");

// ---------------------------------------------------------------------------------------------------
// Colors, dates, media

/** "#abc" or "#aabbcc" (any case) → "#AABBCC". */
export const hexColorInput = z
  .string({ error: "Renk kodu girin." })
  .trim()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, "Renk #RRGGBB biçiminde olmalı (ör. #03265F).")
  .transform((v) => {
    const hex = v.slice(1);
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return `#${full.toUpperCase()}`;
  });

/** Optional color: "" / null → null. */
export const optionalHexColorInput = z
  .union([z.string(), z.null()])
    .optional()
  .transform((v) => (typeof v === "string" ? v.trim() : ""))
  .pipe(z.union([z.literal(""), hexColorInput]))
  .transform((v) => (v === "" ? null : v));

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Optional instant: a Date, an ISO string with zone ("2026-11-09T11:30:00.000Z") or a
 * datetime-local value ("2026-11-09T14:30", read as Europe/Istanbul). ""/null → null.
 */
export const dateTimeInput = z
  .union([z.date(), z.string(), z.null()], { error: "Geçerli bir tarih ve saat girin." })
  .optional()
  .transform((v, ctx): Date | null => {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) {
      if (!Number.isNaN(v.getTime())) return v;
    } else {
      const local = parseIstanbulDateTimeLocal(v);
      if (local) return local;
      if (ISO_WITH_ZONE.test(v.trim())) {
        const d = new Date(v.trim());
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
    ctx.addIssue({ code: "custom", message: "Geçerli bir tarih ve saat girin." });
    return z.NEVER;
  });

/** Publish window; both ends optional, the end must be after the start (error path "endsAt"). */
export const scheduleInput = z
  .object({ startsAt: dateTimeInput, endsAt: dateTimeInput })
  .superRefine((v, ctx) => {
    if (v.startsAt && v.endsAt && v.endsAt.getTime() <= v.startsAt.getTime()) {
      ctx.addIssue({ code: "custom", message: "Bitiş zamanı başlangıçtan sonra olmalı.", path: ["endsAt"] });
    }
  });

export type ScheduleValue = z.output<typeof scheduleInput>;

/** The `updatedAt` an editor loaded (ISO string), required for assertFresh. */
export const updatedAtInput = z
  .union([z.string(), z.date()], { error: "Kayıt sürümü eksik. Sayfayı yenileyin." })
  .transform((v, ctx) => {
    const d = v instanceof Date ? v : ISO_WITH_ZONE.test(v.trim()) ? new Date(v.trim()) : null;
    if (!d || Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Kayıt sürümü eksik. Sayfayı yenileyin." });
      return z.NEVER;
    }
    return d;
  });

/** Media id or null (numeric strings accepted). Existence is checked by the service (ensureMediaExist). */
export const mediaIdInput = z
  .union([z.number(), z.string(), z.null()], { error: "Geçersiz görsel." })
  .optional()
  .transform((v, ctx): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) {
      ctx.addIssue({ code: "custom", message: "Geçersiz görsel." });
      return z.NEVER;
    }
    return n;
  });

/** List of media ids (deduplicated, order kept), at most `max`. */
export function mediaIdsInput(max = 100) {
  return z
    .array(mediaIdInput, { error: "Geçersiz görsel listesi." })
    .max(max, `En fazla ${max} görsel seçebilirsiniz.`)
    .transform((list) => [...new Set(list.filter((n): n is number => n !== null))]);
}

/** Media library folder label: lower-case a–z, 0–9, "-" and "_", up to 3 levels ("urunler/lavanta_latte"). */
export const FOLDER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}(?:\/[a-z0-9][a-z0-9_-]{0,39}){0,2}$/;
export const folderInput = z
  .string({ error: "Klasör adı girin." })
  .trim()
  .toLowerCase()
  .min(1, "Klasör adı girin.")
  .max(60, "Klasör adı en fazla 60 karakter olabilir.")
  .regex(FOLDER_PATTERN, "Klasör adı yalnızca küçük harf, rakam, tire ve alt çizgi içerebilir (alt klasör için /).");
