// Price display. Takes pre-formatted strings so server and client render identical text.
import { cn } from "@/lib/utils";

export default function PriceTag({
  price,
  compareAt,
  compareAtSrLabel,
  badge,
  perLiter,
  prefix,
  size = "md",
  className,
}: {
  price: string;
  compareAt?: string | null;
  /** Read by screen readers before the struck-through price, e.g. "Normal fiyat". */
  compareAtSrLabel?: string | null;
  /** Campaign badge shown next to the price, e.g. "Bahar İndirimi" or "−%15". */
  badge?: string | null;
  /** Already formatted, e.g. "179,98 ₺ litre başına". */
  perLiter?: string | null;
  /** Small label before the price, e.g. "Başlangıç fiyatı". */
  prefix?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {badge && (
        <p className="mb-1">
          <span className="inline-flex max-w-full items-center rounded-full bg-product px-3 py-1 text-[0.6875rem] font-medium uppercase leading-tight tracking-[0.12em] text-product-contrast">
            <span className="truncate">{badge}</span>
          </span>
        </p>
      )}
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {prefix && <span className="text-xs uppercase tracking-[0.14em] text-text-muted">{prefix}</span>}
        <span
          className={cn(
            "font-medium tabular-nums text-text",
            size === "sm" && "text-sm",
            size === "md" && "text-lg",
            size === "lg" && "font-heading text-3xl md:text-4xl",
          )}
        >
          {price}
        </span>
        {compareAt && (
          <s className={cn("tabular-nums text-text-muted", size === "lg" ? "text-lg" : "text-sm")}>
            {compareAtSrLabel && <span className="sr-only">{compareAtSrLabel}: </span>}
            {compareAt}
          </s>
        )}
      </p>
      {perLiter && <p className="text-xs tabular-nums text-text-muted">{perLiter}</p>}
    </div>
  );
}
