// Signed review links (purpose "review", payload { orderId, productId }, valid 90 days). The link
// proves the holder received the review request e-mail of that order; the order and product are
// re-read from the DB on use, and one review per (product, order) is enforced by a unique index, so a
// link works once. Server code only (it signs with BETTER_AUTH_SECRET).
import { href } from "@/i18n/paths";
import type { Locale } from "@/i18n/locales";
import { signToken, verifyToken } from "@/lib/signed-token";
import { REVIEW_LINK_TTL_SECONDS, REVIEW_TOKEN_PARAM, REVIEW_TOKEN_PURPOSE, REVIEWS_ANCHOR } from "./types";

export type ReviewTokenResult =
  | { ok: true; orderId: number; productId: number }
  | { ok: false; reason: "malformed" | "invalid" | "expired" };

const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

export function createReviewToken(orderId: number, productId: number, ttlSeconds: number = REVIEW_LINK_TTL_SECONDS): string {
  if (!isId(orderId) || !isId(productId)) throw new Error("createReviewToken: invalid ids");
  return signToken(REVIEW_TOKEN_PURPOSE, { orderId, productId }, ttlSeconds);
}

/** Verifies the signature and expiry and checks the payload shape (ids are re-read by the caller). */
export function readReviewToken(token: unknown): ReviewTokenResult {
  const result = verifyToken<{ orderId?: unknown; productId?: unknown }>(REVIEW_TOKEN_PURPOSE, token);
  if (!result.ok) return { ok: false, reason: result.reason };
  const { orderId, productId } = result.payload;
  if (!isId(orderId) || !isId(productId)) return { ok: false, reason: "malformed" };
  return { ok: true, orderId, productId };
}

/** Site path of the product page that opens the review form: /tr/urunler/lavanta?degerlendir=…#degerlendirmeler */
export function reviewLinkPath(locale: Locale, slug: string, token: string): string {
  return `${href(locale, "product", { slug })}?${REVIEW_TOKEN_PARAM}=${encodeURIComponent(token)}#${REVIEWS_ANCHOR}`;
}

/** Product page path that jumps to the reviews section (links without a token). */
export function reviewsSectionPath(locale: Locale, slug: string): string {
  return `${href(locale, "product", { slug })}#${REVIEWS_ANCHOR}`;
}
