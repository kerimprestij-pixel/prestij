// Formatting for the reviews UI and the product JSON-LD (pure; server and client).
import { intlLocale, isLocale, type Locale } from "@/i18n/config";
import type { ProductReviewsData, PublicReview, ReviewView } from "./types";

const TIME_ZONE = "Europe/Istanbul";
const dateFormats = new Map<Locale, Intl.DateTimeFormat>();

/** "12 Kasım 2026" / "November 12, 2026" / "١٢ نوفمبر ٢٠٢٦" with Latin digits (Istanbul time). */
export function formatReviewDate(iso: string, locale: Locale): string {
  let fmt = dateFormats.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", year: "numeric", timeZone: TIME_ZONE });
    dateFormats.set(locale, fmt);
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : fmt.format(date);
}

export function toReviewViews(reviews: PublicReview[], locale: Locale): ReviewView[] {
  return reviews.map((review) => ({ ...review, dateLabel: formatReviewDate(review.createdAt, locale) }));
}

/** The average (× 100) as the page shows it: one decimal, locale digits ("4,7" / "4.7"). */
export function formatAverage(averageX100: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(averageX100 / 100);
}

/** BCP 47 tag for a review's lang attribute (stored locale, falling back to Turkish). */
export function reviewLang(locale: string): Locale {
  return isLocale(locale) ? locale : "tr";
}

function istanbulDate(iso: string): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE }).format(date);
}

/**
 * Adds `aggregateRating` and `review` to a schema.org Product object when at least one review is
 * approved (and drops any aggregate when reviews are switched off or there are none), so the
 * structured data always matches what the page shows.
 */
export function withReviewJsonLd<T extends Record<string, unknown>>(product: T, reviews: ProductReviewsData | null): T {
  const { aggregateRating: _drop, review: _dropReviews, ...rest } = product as T & { aggregateRating?: unknown; review?: unknown };
  void _drop;
  void _dropReviews;
  if (!reviews || reviews.summary.count === 0) return rest as unknown as T;
  return {
    ...rest,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: (reviews.summary.average / 100).toFixed(1),
      reviewCount: reviews.summary.count,
      ratingCount: reviews.summary.count,
      bestRating: 5,
      worstRating: 1,
    },
    review: reviews.reviews.map((review) => ({
      "@type": "Review",
      author: { "@type": "Person", name: review.authorName },
      datePublished: istanbulDate(review.createdAt),
      inLanguage: reviewLang(review.locale),
      ...(review.title ? { name: review.title } : {}),
      ...(review.body ? { reviewBody: review.body } : {}),
      reviewRating: { "@type": "Rating", ratingValue: review.rating, bestRating: 5, worstRating: 1 },
    })),
  } as unknown as T;
}
