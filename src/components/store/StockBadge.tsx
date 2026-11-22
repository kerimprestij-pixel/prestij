import { cn } from "@/lib/utils";
import type { StockStatus } from "./format";

export type StockLabels = { inStock: string; lowStock: string; outOfStock: string };

export default function StockBadge({
  status,
  labels,
  className,
}: {
  status: StockStatus;
  labels: StockLabels;
  className?: string;
}) {
  const text = status === "out" ? labels.outOfStock : status === "low" ? labels.lowStock : labels.inStock;
  return (
    <p className={cn("inline-flex items-center gap-2 text-sm text-text-muted", className)}>
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          status === "in" && "bg-emerald-600 dark:bg-emerald-400",
          status === "low" && "bg-gold",
          status === "out" && "bg-text-muted/50",
        )}
      />
      <span className={cn(status === "out" && "text-text")}>{text}</span>
    </p>
  );
}
