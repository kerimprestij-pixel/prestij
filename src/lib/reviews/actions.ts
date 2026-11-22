"use server";
// Storefront Server Actions of the reviews block on (static) product pages, called by client islands
// after hydration: the next page of reviews, the visitor's form state, and submitting a review.
// Every call re-reads the session and settings; ids from the client are re-checked in the service.
// Submissions: zod-checked, honeypot, durable limits (10 per hour per IP, 20 per day per account).
// Logs carry ids and error classes only.

import { db } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { safeErrorInfo } from "@/lib/db-errors";
import type { LimitEntry } from "@/lib/rate-limit";
import { consumeLimits } from "@/lib/rate-limit-store";
import { clientIp } from "@/lib/request-ip";
import { getSession } from "@/lib/session";
import { getSettings } from "@/lib/settings/get-settings";
import { getApprovedReviewPage } from "./data";
import { toReviewViews } from "./display";
import { parseReviewSubmission } from "./schema";
import { loadReviewSettings, reviewFormState, submitReview, type ReviewViewer } from "./service";
import { REVIEW_RATE_RULES, type ReviewFormState, type ReviewSubmitInput, type ReviewSubmitResult, type ReviewView } from "./types";

const asId = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
};

const asLocale = (value: unknown): Locale => (isLocale(value) ? value : "tr");

async function currentViewer(): Promise<ReviewViewer> {
  const session = await getSession();
  const user = session?.user;
  if (!user?.id || user.banned) return null;
  return { userId: user.id, name: user.name ?? null };
}

/** "Daha fazla göster": the next page of approved reviews, dates formatted for `locale`. */
export async function loadMoreReviews(input: { productId: number; offset: number; locale: string }): Promise<{ reviews: ReviewView[]; hasMore: boolean }> {
  const productId = asId(input?.productId);
  const offset = Number(input?.offset);
  if (!productId || !Number.isSafeInteger(offset) || offset < 0) return { reviews: [], hasMore: false };
  const settings = await getSettings("reviews");
  if (!settings.enabled) return { reviews: [], hasMore: false };
  const page = await getApprovedReviewPage(productId, offset);
  return { reviews: toReviewViews(page.reviews, asLocale(input?.locale)), hasMore: page.hasMore };
}

/** What the review form should show for this visitor (signed in, review link, already reviewed …). */
export async function loadReviewForm(input: { productId: number; token?: string | null }): Promise<ReviewFormState> {
  const productId = asId(input?.productId);
  if (!productId) return { status: "disabled" };
  const token = typeof input?.token === "string" && input.token.length > 0 && input.token.length <= 2048 ? input.token : null;
  const [viewer, settings] = await Promise.all([currentViewer(), loadReviewSettings(db)]);
  return reviewFormState(db, { productId, token }, viewer, settings);
}

/** Stores the review (pending moderation) or updates the visitor's pending review. */
export async function submitReviewAction(input: ReviewSubmitInput): Promise<ReviewSubmitResult> {
  try {
    const settings = await loadReviewSettings(db);
    if (!settings.enabled) return { ok: false, error: "disabled" };
    const parsed = parseReviewSubmission(input, settings.minLength);
    if (!parsed.ok) return { ok: false, error: "invalid", fieldErrors: parsed.fieldErrors };
    const data = parsed.data;

    const [ip, viewer] = await Promise.all([clientIp(), currentViewer()]);
    const keys: LimitEntry[] = [[`review:ip:${ip}`, REVIEW_RATE_RULES.ip]];
    if (viewer) keys.push([`review:user:${viewer.userId}`, REVIEW_RATE_RULES.user]);
    const decision = await consumeLimits(keys);
    if (!decision.allowed) return { ok: false, error: "rate_limited", retryAfterMinutes: decision.retryAfterMinutes };
    // Honeypot: answer like a success, store nothing (the hit still counted above).
    if (data.honeypot) return { ok: true, updated: false };

    const messages = await getMessages(data.locale);
    const outcome = await db.transaction((tx) => submitReview(tx, data, viewer, settings, { anonymousName: messages.review.anonymous }));
    if (!outcome.ok) return { ok: false, error: outcome.error };
    return { ok: true, updated: outcome.updated };
  } catch (error) {
    console.error("[reviews] submit failed", safeErrorInfo(error));
    return { ok: false, error: "server" };
  }
}
