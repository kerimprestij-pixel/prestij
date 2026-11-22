// Zod schemas for the category actions (pure; the editor validates with the same schema first).
import { z } from "zod";
import type { LocalizedText } from "@/db/schema/common";
import { looksLikeHtml, sanitizeHtml } from "@/components/sections/sanitize-html";
import { isBlankHtml } from "@/lib/panel/blog/reading";
import {
  idInput,
  localizedTextOf,
  mediaIdInput,
  optionalHexColorInput,
  optionalLocalizedTextOf,
  slugInput,
  updatedAtInput,
} from "@/lib/panel/schemas";

/** Limits of the day-5 editorial fields (body: characters of sanitized HTML per language). */
export const CATEGORY_LIMITS = {
  body: 60_000,
  faqItems: 20,
  question: 200,
  answer: 2000,
} as const;

/** One question of the category page's FAQ (same shape as categories.faq). */
export type CategoryFaqState = { question: LocalizedText; answer: LocalizedText };

/** Editor state of one category (client and server). */
export type CategoryEditorState = {
  /** null for a new category. */
  id: number | null;
  /** ISO string; null for a new category. */
  updatedAt: string | null;
  slug: string;
  name: LocalizedText;
  description: LocalizedText | null;
  /** Editorial text below the product grid (sanitized HTML per language), null = none. */
  body: LocalizedText | null;
  /** Questions and answers shown on the category page (FAQ section + FAQPage structured data). */
  faq: CategoryFaqState[];
  imageId: number | null;
  accentColor: string;
  isVisible: boolean;
  seo: { title: LocalizedText | null; description: LocalizedText | null; ogImageId: number | null; noIndex: boolean };
};

const LOCALE_NAMES = { en: "İngilizce", ar: "Arapça" } as const;

/** One language of the body: sanitized like blog bodies; blank editor output ("<p><br></p>") → "". */
const bodyHtml = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === "string" ? sanitizeHtml(v) : ""))
  .transform((v) => (isBlankHtml(v) ? "" : v))
  .pipe(z.string().max(CATEGORY_LIMITS.body, "Metin çok uzun. Kısaltıp tekrar kaydedin."));

/**
 * The localized body: empty everywhere → null; a translation without Turkish is refused. (No z.union
 * here: a failing union option would hide the field path, e.g. "body.tr", behind "invalid_union".)
 */
export const categoryBodyInput = z
  .object({ tr: bodyHtml, en: bodyHtml, ar: bodyHtml }, { error: "Geçersiz metin." })
  .nullable()
  .transform((v, ctx): LocalizedText | null => {
    if (!v || (!v.tr && !v.en && !v.ar)) return null;
    if (!v.tr) {
      ctx.addIssue({ code: "custom", message: "Önce Türkçe metni yazın.", path: ["tr"] });
      return z.NEVER;
    }
    const out: LocalizedText = { tr: v.tr };
    if (v.en) out.en = v.en;
    if (v.ar) out.ar = v.ar;
    return out;
  });

/** Answers are plain text (blank line = new paragraph) or the Faq section's HTML subset, which is sanitized. */
function cleanAnswer(text: string): string {
  if (!looksLikeHtml(text)) return text;
  const html = sanitizeHtml(text);
  return isBlankHtml(html) ? "" : html;
}

export const categoryFaqItemInput = z
  .object({
    question: localizedTextOf({ max: CATEGORY_LIMITS.question, requiredMessage: "Soruyu Türkçe yazın." }),
    answer: localizedTextOf({ max: CATEGORY_LIMITS.answer, requiredMessage: "Cevabı Türkçe yazın." }).transform((v): LocalizedText => {
      const out: LocalizedText = { tr: cleanAnswer(v.tr) };
      for (const locale of ["en", "ar"] as const) {
        const text = v[locale] ? cleanAnswer(v[locale]) : "";
        if (text) out[locale] = text;
      }
      return out;
    }),
  })
  .superRefine((item, ctx) => {
    if (!item.answer.tr) ctx.addIssue({ code: "custom", message: "Cevabı Türkçe yazın.", path: ["answer", "tr"] });
    // A question without its answer (or the reverse) in one language would show a Turkish half on that page.
    for (const locale of ["en", "ar"] as const) {
      const name = LOCALE_NAMES[locale];
      const both = "İkisini birlikte yazın ya da ikisini de boş bırakın.";
      if (item.question[locale] && !item.answer[locale]) {
        ctx.addIssue({ code: "custom", message: `${name} soru var ama ${name} cevap yok. ${both}`, path: ["answer", locale] });
      } else if (!item.question[locale] && item.answer[locale]) {
        ctx.addIssue({ code: "custom", message: `${name} cevap var ama ${name} soru yok. ${both}`, path: ["question", locale] });
      }
    }
  });

export const categoryFaqInput = z
  .array(categoryFaqItemInput, { error: "Geçersiz soru listesi." })
  .max(CATEGORY_LIMITS.faqItems, `En fazla ${CATEGORY_LIMITS.faqItems} soru eklenebilir.`);

export const categorySaveSchema = z
  .object({
    id: z.union([z.null(), idInput]),
    updatedAt: z.union([z.null(), updatedAtInput]),
    slug: slugInput,
    name: localizedTextOf({ max: 80, requiredMessage: "Kategorinin Türkçe adını girin." }),
    description: optionalLocalizedTextOf({ max: 600 }),
    // Day 5. Left out of a payload (older callers) = keep what is stored.
    body: categoryBodyInput.optional(),
    faq: categoryFaqInput.optional(),
    imageId: mediaIdInput,
    accentColor: optionalHexColorInput,
    isVisible: z.boolean(),
    seo: z.object({
      title: optionalLocalizedTextOf({ max: 70 }),
      description: optionalLocalizedTextOf({ max: 170 }),
      ogImageId: mediaIdInput,
      noIndex: z.boolean(),
    }),
  })
  .superRefine((v, ctx) => {
    if (v.id !== null && v.updatedAt === null) ctx.addIssue({ code: "custom", message: "Kayıt sürümü eksik. Sayfayı yenileyin." });
  });

export type CategorySaveInput = z.output<typeof categorySaveSchema>;

export const categoryReorderSchema = z.object({ ids: z.array(idInput).min(1).max(500) });

export const categoryDeleteSchema = z.object({
  id: idInput,
  /** The version the user saw (list or editor): a delete based on a stale view is a conflict. */
  updatedAt: updatedAtInput,
  /** Where the category's products go first: another category id, "none" (no category) or absent (refuse when in use). */
  moveProductsTo: z.union([idInput, z.literal("none")]).optional(),
});

export type CategoryDeleteInput = z.output<typeof categoryDeleteSchema>;
