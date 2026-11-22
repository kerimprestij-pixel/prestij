// Cached storefront reads of approved reviews (tag `reviews:<productId>`, invalidated by every
// moderation change). Product pages stay static: these results are part of the prerendered page.
// Next registers every "use cache" function as a callable server reference, so the arguments are
// never trusted: only approved reviews come back, and offsets are clamped to whole pages.
import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import { TAGS } from "@/lib/cache-tags";
import type { Tx } from "@/lib/panel/tx";
import {
  EMPTY_SUMMARY,
  REVIEW_MAX_OFFSET,
  REVIEW_PAGE_SIZE,
  type ProductReviewsData,
  type PublicReview,
  type ReviewPage,
  type ReviewSummary,
} from "./types";

const r = schema.reviews;

const validId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;

/** Summary (count, average, distribution) and the newest approved reviews of a product. */
export async function getApprovedReviews(productId: number): Promise<ProductReviewsData> {
  "use cache";
  cacheLife("max");
  if (!validId(productId)) return { productId: 0, summary: EMPTY_SUMMARY, reviews: [], hasMore: false };
  cacheTag(TAGS.reviews(productId));

  const [summary, page] = await Promise.all([queryReviewSummary(productId), queryReviewPage(productId, 0)]);
  return { productId, summary, ...page };
}

/** One further page for "Daha fazla göster" (offset = reviews already shown, whole pages only). */
export async function getApprovedReviewPage(productId: number, offset: number): Promise<ReviewPage> {
  "use cache";
  cacheLife("max");
  if (!validId(productId)) return { reviews: [], hasMore: false };
  cacheTag(TAGS.reviews(productId));
  const start = Number.isSafeInteger(offset) ? Math.min(REVIEW_MAX_OFFSET, Math.max(0, offset - (offset % REVIEW_PAGE_SIZE))) : 0;
  return queryReviewPage(productId, start);
}

/** Uncached summary query (exported for DB tests). */
export async function queryReviewSummary(productId: number, executor: Tx = db): Promise<ReviewSummary> {
  const rows = await executor
    .select({ rating: r.rating, n: sql<number>`count(*)::int` })
    .from(r)
    .where(and(eq(r.productId, productId), eq(r.status, "approved")))
    .groupBy(r.rating);
  const distribution: ReviewSummary["distribution"] = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;
  for (const row of rows) {
    const stars = Number(row.rating);
    const n = Number(row.n);
    if (stars < 1 || stars > 5) continue;
    distribution[stars - 1] += n;
    count += n;
    sum += stars * n;
  }
  // Same rounding as recomputeProductRating (round(avg × 100)).
  const average = count > 0 ? Math.round((sum * 100) / count) : 0;
  return { count, average, distribution };
}

/** Uncached page query (exported for DB tests). */
export async function queryReviewPage(productId: number, offset: number, executor: Tx = db): Promise<ReviewPage> {
  const rows = await executor
    .select({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      authorName: r.authorName,
      locale: r.locale,
      verified: r.isVerifiedPurchase,
      createdAt: r.createdAt,
      reply: r.adminReply,
    })
    .from(r)
    .where(and(eq(r.productId, productId), eq(r.status, "approved")))
    .orderBy(desc(r.createdAt), desc(r.id))
    .limit(REVIEW_PAGE_SIZE + 1)
    .offset(offset);
  const reviews: PublicReview[] = rows.slice(0, REVIEW_PAGE_SIZE).map((row) => ({
    id: row.id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    authorName: row.authorName,
    locale: row.locale,
    verified: row.verified,
    createdAt: row.createdAt.toISOString(),
    reply: row.reply,
  }));
  return { reviews, hasMore: rows.length > REVIEW_PAGE_SIZE && offset + REVIEW_PAGE_SIZE <= REVIEW_MAX_OFFSET };
}
