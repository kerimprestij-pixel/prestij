// Zod schemas for the blog editor (pure: the editor may validate with them before sending, the
// Server Actions validate with them again). Messages are Turkish and land next to the fields.
import { z } from "zod";
import type { LocalizedText } from "@/db/schema/common";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import {
  dateTimeInput,
  idInput,
  localizedTextOf,
  mediaIdInput,
  optionalLocalizedTextOf,
  slugInput,
  textInput,
  updatedAtInput,
} from "@/lib/panel/schemas";
import { isBlankHtml, normalizeTags } from "./reading";

export const BLOG_LIMITS = {
  title: 160,
  excerpt: 400,
  /** Characters of sanitized HTML per language. */
  body: 150_000,
  author: 80,
  tags: 12,
  tagLength: 40,
  related: 8,
  seoTitle: 120,
  seoDescription: 320,
} as const;

const PUBLISH_NEEDS_BODY = "Yayınlamak için Türkçe metni yazın.";

/** One language of rich text: sanitized on the server and the client alike; blank editor output → "". */
const richHtml = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === "string" ? sanitizeHtml(v) : ""))
  .transform((v) => (isBlankHtml(v) ? "" : v))
  .pipe(z.string().max(BLOG_LIMITS.body, "Metin çok uzun. Yazıyı bölerek kaydedin."));

/** Localized rich text that may be empty (→ null); a translation without Turkish is refused. */
export const localizedRichInput = z
  .union([z.object({ tr: richHtml, en: richHtml, ar: richHtml }), z.null()])
  .optional()
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

const tagsInput = z
  .array(z.string({ error: "Geçersiz etiket." }), { error: "Geçersiz etiket listesi." })
  .max(50, "Çok fazla etiket.")
  .optional()
  .transform((list) => normalizeTags(list ?? [], { max: BLOG_LIMITS.tags, maxLength: BLOG_LIMITS.tagLength }));

const relatedInput = z
  .array(idInput, { error: "Geçersiz ürün listesi." })
  .max(BLOG_LIMITS.related, `En fazla ${BLOG_LIMITS.related} ürün seçebilirsiniz.`)
  .optional()
  .transform((list) => [...new Set(list ?? [])]);

export const blogSeoInput = z
  .object({
    title: optionalLocalizedTextOf({ max: BLOG_LIMITS.seoTitle }),
    description: optionalLocalizedTextOf({ max: BLOG_LIMITS.seoDescription }),
    ogImageId: mediaIdInput,
    noIndex: z.boolean().optional().default(false),
  })
  .optional()
  .transform((v) => v ?? { title: null, description: null, ogImageId: null, noIndex: false });

/** The whole post as the editor sends it. `id: null` creates a new post (then `updatedAt` is ignored). */
export const blogPostInput = z
  .object({
    id: z.union([idInput, z.null()]).optional().transform((v) => v ?? null),
    updatedAt: z.union([updatedAtInput, z.null()]).optional().transform((v) => v ?? null),
    title: localizedTextOf({ max: BLOG_LIMITS.title, requiredMessage: "Türkçe başlık gerekli." }),
    slug: slugInput,
    excerpt: optionalLocalizedTextOf({ max: BLOG_LIMITS.excerpt }),
    body: localizedRichInput,
    coverId: mediaIdInput,
    authorName: textInput({ required: false, max: BLOG_LIMITS.author }),
    tags: tagsInput,
    relatedProductIds: relatedInput,
    status: z.enum(["draft", "published"], { error: "Durum seçin." }),
    /** Empty + published = now. A future date schedules the post. */
    publishedAt: dateTimeInput,
    seo: blogSeoInput,
  })
  .superRefine((v, ctx) => {
    if (v.status === "published" && !v.body?.tr) ctx.addIssue({ code: "custom", message: PUBLISH_NEEDS_BODY, path: ["body", "tr"] });
  });

export type BlogPostInput = z.output<typeof blogPostInput>;

/** Delete sends the version the editor loaded: deleting from a stale view is a conflict. */
export const blogDeleteInput = z.object({ id: idInput, updatedAt: updatedAtInput });
