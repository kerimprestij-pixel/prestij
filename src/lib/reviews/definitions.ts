// Schemas + run functions of the review moderation actions (editor+), without Next APIs:
// src/app/panel/(dashboard)/yorumlar/actions.ts wraps them in panelAction (session, role, audit,
// updateTag) and DB tests run them with executePanelAction.
import "server-only";
import { z } from "zod";
import type { PanelActionContext, PanelRunResult } from "@/lib/panel/action-core";
import { idInput, textInput, updatedAtInput } from "@/lib/panel/schemas";
import { deleteReview, replyToReview, setReviewStatus } from "./service";
import { REVIEW_LIMITS } from "./types";

const count = (n: number) => n.toLocaleString("tr-TR");

/** A review as the moderator saw it: a customer may still edit a pending review, so every decision names the version it was taken on. */
const reviewVersion = z.object({ id: idInput, updatedAt: updatedAtInput });

/** Approve one or many (bulk) reviews: they appear on the product page. */
export const approveReviewsSchema = z.object({
  reviews: z.array(reviewVersion).min(1, "Onaylanacak yorumu seçin.").max(100, "Bir seferde en fazla 100 yorum onaylanabilir."),
});

export async function runApproveReviews(
  input: z.output<typeof approveReviewsSchema>,
  { tx }: PanelActionContext,
): Promise<PanelRunResult<{ changed: number }>> {
  const ids = input.reviews.map((r) => r.id);
  const result = await setReviewStatus(tx, { ids, status: "approved", expected: new Map(input.reviews.map((r) => [r.id, r.updatedAt])) });
  const message =
    result.changed === 0
      ? ids.length > 1
        ? "Seçilen yorumlar zaten yayında."
        : "Bu yorum zaten yayında."
      : result.changed > 1
        ? `${count(result.changed)} yorum onaylandı ve ürün sayfalarında yayında.`
        : "Yorum onaylandı ve ürün sayfasında yayında.";
  return { data: { changed: result.changed }, message, tags: result.tags, audit: result.audit };
}

/** Reject: the review stays in the panel (Reddedilen) and disappears from the product page. */
export const rejectReviewSchema = z.object({ id: idInput, updatedAt: updatedAtInput });

export async function runRejectReview(
  input: z.output<typeof rejectReviewSchema>,
  { tx }: PanelActionContext,
): Promise<PanelRunResult<{ changed: number }>> {
  const result = await setReviewStatus(tx, { ids: [input.id], status: "rejected", expected: new Map([[input.id, input.updatedAt]]) });
  return {
    data: { changed: result.changed },
    message: result.changed ? "Yorum reddedildi; ürün sayfasında görünmez." : "Bu yorum zaten reddedilmiş.",
    tags: result.tags,
    audit: result.audit,
  };
}

/** Delete for good (confirmed in the UI). */
export const deleteReviewSchema = z.object({ id: idInput });

export async function runDeleteReview(
  input: z.output<typeof deleteReviewSchema>,
  { tx }: PanelActionContext,
): Promise<PanelRunResult<{ id: number }>> {
  const result = await deleteReview(tx, input);
  return { data: { id: input.id }, message: "Yorum silindi.", tags: result.tags, audit: result.audit };
}

/** Public reply under the review (empty removes it). */
export const replyReviewSchema = z.object({
  id: idInput,
  reply: textInput({ required: false, max: REVIEW_LIMITS.reply }),
  updatedAt: updatedAtInput,
});

export async function runReplyReview(
  input: z.output<typeof replyReviewSchema>,
  { tx }: PanelActionContext,
): Promise<PanelRunResult<{ updatedAt: string; reply: string | null }>> {
  const result = await replyToReview(tx, input);
  const message = result.changed === 0 ? "Değişiklik yok." : result.reply ? "Yanıt kaydedildi." : "Yanıt kaldırıldı.";
  return {
    data: { updatedAt: result.updatedAt.toISOString(), reply: result.reply },
    message,
    tags: result.tags,
    audit: result.audit,
  };
}
