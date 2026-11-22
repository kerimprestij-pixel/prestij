// reviews.request (daily): review request e-mails for delivered orders. Loaded by src/lib/cron/jobs.ts.
// Bounded batch per run (the next run continues); idempotent through orders.review_requested_at and
// the mail's dedupe key, so two concurrent runs never mail an order twice.
import "server-only";
import { db } from "@/db";
import { registerJob } from "@/lib/cron/registry";
import { sendDueReviewRequests } from "./requests";
import { REVIEW_REQUEST_BATCH } from "./types";

export const reviewsRequestJob = registerJob({
  key: "reviews.request",
  group: "daily",
  label: "Değerlendirme isteği e-postaları",
  run: async () => {
    const { queued, skipped, disabled } = await sendDueReviewRequests(db, { now: new Date(), limit: REVIEW_REQUEST_BATCH });
    return { queued, skipped, disabled };
  },
});
