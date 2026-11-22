"use client";
// The approved reviews of a product: the first page comes prerendered with the (static) page, "Daha
// fazla göster" loads the next pages through a Server Action (cached reads) and moves focus to the
// first new review.
import { BadgeCheck } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/get-messages";
import { buttonClass } from "@/components/sections/button-styles";
import { loadMoreReviews } from "@/lib/reviews/actions";
import { reviewLang } from "@/lib/reviews/display";
import type { ReviewView } from "@/lib/reviews/types";
import Stars from "./Stars";

type Props = {
  productId: number;
  locale: Locale;
  initial: ReviewView[];
  hasMore: boolean;
  labels: Messages["review"];
  /** "PRESTİJ yanıtı" (review.reply with the site name filled in). */
  replyLabel: string;
};

export default function ReviewList({ productId, locale, initial, hasMore, labels, replyLabel }: Props) {
  const [items, setItems] = useState(initial);
  const [more, setMore] = useState(hasMore);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [focusTarget, setFocusTarget] = useState<number | null>(null);

  // After "show more": move focus to the first new review (screen readers continue reading there).
  useEffect(() => {
    if (focusTarget !== null) document.getElementById(`review-${focusTarget}`)?.focus();
  }, [focusTarget]);

  const loadMore = () => {
    setFailed(false);
    startTransition(async () => {
      try {
        const page = await loadMoreReviews({ productId, offset: items.length, locale });
        const known = new Set(items.map((r) => r.id));
        const fresh = page.reviews.filter((r) => !known.has(r.id));
        setFocusTarget(fresh[0]?.id ?? null);
        setItems((prev) => [...prev, ...fresh]);
        setMore(page.hasMore && fresh.length > 0);
      } catch {
        setFailed(true);
      }
    });
  };

  return (
    <div>
      <ol className="divide-y divide-border border-y border-border">
        {items.map((review) => (
          <li key={review.id}>
            <ReviewItem review={review} labels={labels} replyLabel={replyLabel} />
          </li>
        ))}
      </ol>
      <div aria-live="polite" className="mt-10 flex flex-col items-center gap-4">
        {failed && <p className="text-sm text-red-700 dark:text-red-400">{labels.loadError}</p>}
        {more && (
          <button type="button" onClick={loadMore} disabled={pending} aria-disabled={pending || undefined} className={buttonClass("secondary")}>
            {pending ? labels.loading : labels.showMore}
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewItem({ review, labels, replyLabel }: { review: ReviewView; labels: Messages["review"]; replyLabel: string }) {
  const lang = reviewLang(review.locale);
  return (
    <article
      id={`review-${review.id}`}
      tabIndex={-1}
      className="py-9 focus:outline-none md:py-11"
    >
      <div className="flex items-center gap-3">
        <Stars value={review.rating} size="md" />
        <span className="sr-only">{format(labels.outOf, { rating: review.rating })}</span>
      </div>
      {review.title && (
        <h3 lang={lang} dir="auto" className="mt-4 font-heading text-2xl leading-snug text-text md:text-[1.7rem]">
          {review.title}
        </h3>
      )}
      {review.body && (
        <p lang={lang} dir="auto" className="mt-3 whitespace-pre-line text-base leading-relaxed text-pretty text-text-muted">
          {review.body}
        </p>
      )}
      <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs uppercase tracking-[0.14em] text-text-muted">
        <span dir="auto" className="font-medium text-text">
          {review.authorName}
        </span>
        {review.verified && (
          <span className="inline-flex items-center gap-1.5 text-product-strong">
            <BadgeCheck aria-hidden className="size-3.5" strokeWidth={1.75} />
            {labels.verified}
          </span>
        )}
        <time dateTime={review.createdAt} className="tabular-nums">
          {review.dateLabel}
        </time>
      </p>
      {review.reply && (
        <div className="mt-7 border-s border-product-strong/50 ps-5 md:ms-1">
          <p className="eyebrow text-product-strong">{replyLabel}</p>
          <p dir="auto" className="mt-2.5 whitespace-pre-line text-sm leading-relaxed text-text-muted">
            {review.reply}
          </p>
        </div>
      )}
    </article>
  );
}
