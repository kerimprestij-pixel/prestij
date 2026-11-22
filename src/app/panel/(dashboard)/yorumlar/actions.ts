"use server";
// Review moderation (editor+). Each change returns the tags reviews:<productId> and product:<slug>
// (plus `products` when a rating changed, for the product cards); panelAction writes the audit rows
// and calls updateTag after commit. Schemas and run functions: src/lib/reviews/definitions.ts.
import { panelAction } from "@/lib/panel/action";
import {
  approveReviewsSchema,
  deleteReviewSchema,
  rejectReviewSchema,
  replyReviewSchema,
  runApproveReviews,
  runDeleteReview,
  runRejectReview,
  runReplyReview,
} from "@/lib/reviews/definitions";

export const approveReviewsAction = panelAction({ minRole: "editor", schema: approveReviewsSchema, run: runApproveReviews });

export const rejectReviewAction = panelAction({ minRole: "editor", schema: rejectReviewSchema, run: runRejectReview });

export const deleteReviewAction = panelAction({ minRole: "editor", schema: deleteReviewSchema, run: runDeleteReview });

export const replyReviewAction = panelAction({ minRole: "editor", schema: replyReviewSchema, run: runReplyReview });
