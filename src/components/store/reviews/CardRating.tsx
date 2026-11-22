// Stars on a product card ("★★★★☆ 4,6 (12)"), shown when the product has approved reviews and reviews
// are switched on (the grid passes `labels` only then). Pure: no hooks, safe inside client trees.
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { formatAverage } from "@/lib/reviews/display";
import Stars from "./Stars";

export type CardRatingLabels = { rating: string; count: string };

export default function CardRating({
  average,
  count,
  locale,
  labels,
}: {
  /** products.rating_average (× 100). */
  average: number;
  count: number;
  locale: Locale;
  labels: CardRatingLabels;
}) {
  if (count <= 0) return null;
  const shown = formatAverage(average, locale);
  return (
    <p className="mt-2.5 flex items-center gap-2 text-xs text-text-muted">
      <Stars value={average / 100} size="xs" tone="gold" />
      <span aria-hidden className="tabular-nums text-text">
        {shown}
      </span>
      <span aria-hidden className="tabular-nums">
        ({count})
      </span>
      <span className="sr-only">
        {format(labels.rating, { rating: shown })}, {format(labels.count, { count }, locale)}
      </span>
    </p>
  );
}
