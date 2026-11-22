// Five stars filled to a fractional value (4.6 → four and a bit). Decorative: always pair it with the
// value as text (sr-only or visible). Pure, no hooks: renders on the server and inside client trees.
// The fill grows from the inline start, so it reads correctly in RTL too.
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
} as const;

const TONES = {
  /** The product's own accent (product pages, inside .product-scope). */
  product: "text-product-strong",
  /** Brand gold (product cards outside a product scope). */
  gold: "text-gold",
} as const;

export default function Stars({
  value,
  size = "sm",
  tone = "product",
  className,
}: {
  /** 0–5, fractions allowed. */
  value: number;
  size?: keyof typeof SIZES;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const icon = SIZES[size];
  return (
    <span aria-hidden className={cn("relative inline-flex shrink-0 align-middle", className)}>
      <span className="flex gap-0.5 text-border-strong/70">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={icon} strokeWidth={1.25} />
        ))}
      </span>
      <span className="absolute inset-y-0 start-0 overflow-hidden" style={{ width: `${pct}%` }}>
        <span className={cn("flex w-max gap-0.5", TONES[tone])}>
          {Array.from({ length: 5 }, (_, i) => (
            // fill on the svg itself: lucide sets fill="none" as an attribute, which beats an inherited fill.
            <Star key={i} className={cn(icon, "fill-current")} strokeWidth={1.25} />
          ))}
        </span>
      </span>
    </span>
  );
}
