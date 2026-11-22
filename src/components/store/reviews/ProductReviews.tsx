// The reviews section of the product page (server component; static, from cached reads). Calm and
// editorial: the average in display type, a quiet distribution, the newest reviews with the shop's
// replies. With no approved review yet, the section is an invitation to write the first one.
// Personal parts (the form, the visitor's own review) are client islands loaded after hydration.
import { Star } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/get-messages";
import { formatAverage, toReviewViews } from "@/lib/reviews/display";
import type { ProductReviewBlock } from "@/lib/reviews/page-data";
import { REVIEWS_ANCHOR, type ReviewSummary } from "@/lib/reviews/types";
import { ReviewCta, ReviewFormPanel, ReviewFormProvider } from "./ReviewForm";
import ReviewList from "./ReviewList";
import Stars from "./Stars";

type Props = {
  block: ProductReviewBlock;
  productId: number;
  slug: string;
  locale: Locale;
  messages: Messages;
  siteName: string;
};

export default function ProductReviews({ block, productId, slug, locale, messages, siteName }: Props) {
  if (!block.enabled || !block.data) return null;
  const m = messages.review;
  const { summary, reviews, hasMore } = block.data;
  const empty = summary.count === 0;

  return (
    <section id={REVIEWS_ANCHOR} aria-labelledby="reviews-title" className="scroll-mt-24 border-t border-border">
      <ReviewFormProvider
        productId={productId}
        locale={locale}
        slug={slug}
        minLength={block.minLength}
        allowGuestLinks={block.allowGuestLinks}
        labels={m}
      >
        {empty ? (
          <div className="container-x flex flex-col items-center py-20 text-center md:py-28">
            <p className="eyebrow text-product-strong">{m.eyebrow}</p>
            <h2 id="reviews-title" className="mt-5 max-w-2xl font-heading text-4xl leading-tight text-balance text-text md:text-5xl">
              {m.emptyTitle}
            </h2>
            <span aria-hidden className="mt-7 opacity-70">
              <Stars value={0} size="lg" />
            </span>
            <p className="mt-7 max-w-lg text-base leading-relaxed text-pretty text-text-muted md:text-lg">{m.emptyText}</p>
            <div className="mt-10 w-full sm:w-auto">
              <ReviewCta align="center" />
            </div>
            <ReviewFormPanel className="mt-12 w-full max-w-2xl text-start" />
          </div>
        ) : (
          <div className="container-x grid grid-cols-1 gap-12 py-16 md:py-24 lg:grid-cols-12 lg:gap-16">
            <div className="min-w-0 lg:col-span-4">
              <div className="lg:sticky lg:top-28">
                <p className="eyebrow text-product-strong">{m.eyebrow}</p>
                <h2 id="reviews-title" className="mt-4 font-heading text-4xl leading-tight text-text md:text-5xl">
                  {m.title}
                </h2>
                <Summary summary={summary} locale={locale} messages={messages} />
                <div className="mt-10">
                  <ReviewCta />
                </div>
              </div>
            </div>
            <div className="min-w-0 lg:col-span-8">
              <ReviewFormPanel className="mb-12" />
              <ReviewList
                productId={productId}
                locale={locale}
                initial={toReviewViews(reviews, locale)}
                hasMore={hasMore}
                labels={m}
                replyLabel={format(m.reply, { siteName })}
              />
            </div>
          </div>
        )}
      </ReviewFormProvider>
    </section>
  );
}

function Summary({ summary, locale, messages }: { summary: ReviewSummary; locale: Locale; messages: Messages }) {
  const m = messages.review;
  const average = formatAverage(summary.average, locale);
  const total = Math.max(1, summary.count);
  return (
    <div className="mt-10">
      <div className="flex items-end gap-5">
        <p className="font-heading text-7xl leading-[0.85] tracking-tight text-text tabular-nums md:text-8xl">
          <span aria-hidden>{average}</span>
          <span className="sr-only">
            {m.average}: {format(m.outOf, { rating: average })}
          </span>
        </p>
        <div className="pb-1">
          <Stars value={summary.average / 100} size="md" />
          <p className="mt-2 text-sm text-text-muted">{format(m.basedOn, { count: summary.count }, locale)}</p>
        </div>
      </div>
      <ul aria-label={m.distribution} className="mt-9 max-w-xs space-y-2.5">
        {[5, 4, 3, 2, 1].map((stars) => {
          const n = summary.distribution[stars - 1];
          return (
            <li key={stars} className="flex items-center gap-3 text-xs text-text-muted">
              <span aria-hidden className="flex w-7 shrink-0 items-center justify-end gap-1 tabular-nums">
                {stars}
                <Star className="size-2.5 fill-current" strokeWidth={1.25} />
              </span>
              <span aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-border/80">
                <span className="block h-full rounded-full bg-product-strong" style={{ width: `${Math.round((n / total) * 100)}%` }} />
              </span>
              <span aria-hidden className="w-6 tabular-nums">
                {n}
              </span>
              <span className="sr-only">{format(m.distributionRow, { stars, count: n }, locale)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The stars under the product name: a link to the reviews section (only when there are reviews). */
export function RatingLink({ summary, locale, messages }: { summary: ReviewSummary; locale: Locale; messages: Messages }) {
  if (summary.count === 0) return null;
  const average = formatAverage(summary.average, locale);
  return (
    <a
      href={`#${REVIEWS_ANCHOR}`}
      className="group/rating mt-4 inline-flex items-center gap-3 rounded-sm text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <Stars value={summary.average / 100} size="md" />
      <span aria-hidden className="tabular-nums text-text">
        {average}
      </span>
      <span className="sr-only">{format(messages.product.rating, { rating: average })}</span>
      <span className="underline decoration-border underline-offset-4 group-hover/rating:decoration-current">
        {format(messages.product.reviewCount, { count: summary.count }, locale)}
      </span>
    </a>
  );
}
