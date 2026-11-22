// Server-side validation of the storefront review form (pure, zod for the shape). The client checks
// the same rules first for instant feedback; this is the one that counts.
import { z } from "zod";
import { isLocale, type Locale } from "@/i18n/config";
import { cleanLine, cleanMultiline, textLength } from "./text";
import { REVIEW_LIMITS, type ReviewField, type ReviewFieldError } from "./types";

/** Same cap as signed-token's MAX_TOKEN_LENGTH (kept local so this module stays client-safe). */
const MAX_TOKEN_LENGTH = 2048;

export type ParsedReview = {
  productId: number;
  locale: Locale;
  rating: number;
  title: string | null;
  body: string | null;
  displayName: string | null;
  token: string | null;
  honeypot: boolean;
};

export type ReviewParseResult =
  | { ok: true; data: ParsedReview }
  | { ok: false; fieldErrors: Partial<Record<ReviewField, ReviewFieldError>>; productId: number | null };

const shape = z.object({
  productId: z.coerce.number().int().positive().max(2_147_483_647),
  locale: z.string().max(5).optional(),
  rating: z.unknown(),
  title: z.string().max(4000).optional().nullable(),
  body: z.string().max(20_000).optional().nullable(),
  displayName: z.string().max(1000).optional().nullable(),
  token: z.string().max(MAX_TOKEN_LENGTH).optional().nullable(),
  website: z.string().max(1000).optional().nullable(),
});

/** Validates and cleans one submission. `minLength` comes from settings.reviews.minLength. */
export function parseReviewSubmission(raw: unknown, minLength: number): ReviewParseResult {
  const parsed = shape.safeParse(raw);
  if (!parsed.success) {
    const pid = Number((raw as { productId?: unknown } | null)?.productId);
    return { ok: false, fieldErrors: {}, productId: Number.isSafeInteger(pid) && pid > 0 ? pid : null };
  }
  const input = parsed.data;
  const fieldErrors: Partial<Record<ReviewField, ReviewFieldError>> = {};

  const rating = typeof input.rating === "string" ? Number(input.rating) : input.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) fieldErrors.rating = "required";

  const title = cleanLine(input.title ?? "");
  if (textLength(title) > REVIEW_LIMITS.title) fieldErrors.title = "too_long";

  const body = cleanMultiline(input.body ?? "");
  const min = Math.max(0, Math.min(500, Math.trunc(minLength)));
  if (textLength(body) > REVIEW_LIMITS.body) fieldErrors.body = "too_long";
  else if (min > 0 && body.length === 0) fieldErrors.body = "required";
  else if (min > 0 && textLength(body) < min) fieldErrors.body = "too_short";

  const displayName = cleanLine(input.displayName ?? "");
  if (textLength(displayName) > REVIEW_LIMITS.displayName) fieldErrors.displayName = "too_long";

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, productId: input.productId };

  const token = typeof input.token === "string" && input.token.trim() ? input.token.trim() : null;
  return {
    ok: true,
    data: {
      productId: input.productId,
      locale: isLocale(input.locale) ? input.locale : "tr",
      rating: rating as number,
      title: title || null,
      body: body || null,
      displayName: displayName || null,
      token,
      honeypot: typeof input.website === "string" && input.website.trim() !== "",
    },
  };
}
