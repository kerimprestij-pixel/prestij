// What static storefront pages need about reviews, from cached reads only (settings, tag `settings`;
// approved reviews, tag `reviews:<id>`; messages, tag `ui-strings`), so the pages stay ○.
import "server-only";
import type { CardRatingLabels } from "@/components/store/reviews/CardRating";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { getSettings } from "@/lib/settings/get-settings";
import { getApprovedReviews } from "./data";
import type { ProductReviewsData } from "./types";

export type ProductReviewBlock = {
  enabled: boolean;
  allowGuestLinks: boolean;
  minLength: number;
  /** null when reviews are switched off. */
  data: ProductReviewsData | null;
};

export async function loadProductReviewBlock(productId: number): Promise<ProductReviewBlock> {
  const settings = await getSettings("reviews");
  if (!settings.enabled) return { enabled: false, allowGuestLinks: settings.allowGuestLinks, minLength: settings.minLength, data: null };
  return { enabled: true, allowGuestLinks: settings.allowGuestLinks, minLength: settings.minLength, data: await getApprovedReviews(productId) };
}

/** Screen-reader texts of the stars on product cards; null when reviews are off (cards show no stars). */
export async function cardRatingLabels(locale: Locale): Promise<CardRatingLabels | null> {
  const [settings, messages] = await Promise.all([getSettings("reviews"), getMessages(locale)]);
  return settings.enabled ? { rating: messages.product.rating, count: messages.product.reviewCount } : null;
}
