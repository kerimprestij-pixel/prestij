"use client";

// Side-by-side comparison of a product's packagings (pump bottle / 5 L / 20 L): volume, price and
// price per liter. Choosing a card selects that variant and scrolls the picker into view.
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVariantSelection } from "./VariantContext";
import type { PickerVariant } from "./variant-types";

export default function PackagingExplainer({
  title,
  variants,
  targetId,
  className,
}: {
  title: string;
  variants: PickerVariant[];
  /** id of the element to scroll to after choosing (the purchase panel). */
  targetId?: string;
  className?: string;
}) {
  const { selectedId, select } = useVariantSelection();
  if (variants.length < 2) return null;

  const choose = (id: number) => {
    select(id);
    const target = targetId ? document.getElementById(targetId) : null;
    if (target && target.getBoundingClientRect().top < 0) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  };

  return (
    <section aria-labelledby="packaging-title" className={cn("flex flex-col gap-8", className)}>
      <h2 id="packaging-title" className="font-heading text-3xl text-text md:text-4xl">
        {title}
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {variants.map((v) => {
          const active = v.id === selectedId;
          return (
            <li key={v.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => choose(v.id)}
                className={cn(
                  "flex h-full w-full flex-col items-start gap-4 rounded-md border p-6 text-start transition-[border-color,background-color] duration-500",
                  active ? "border-product bg-product-soft" : "border-border bg-surface hover:border-text/30",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <span className="flex w-full items-start justify-between gap-3">
                  <span className="font-heading text-2xl text-text">{v.optionLabels.join(" · ") || v.volumeLabel || v.sku}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full border transition-colors",
                      active ? "border-product bg-product text-product-contrast" : "border-border text-transparent",
                    )}
                  >
                    <Check className="size-3.5" strokeWidth={2} />
                  </span>
                </span>
                {v.volumeLabel && !v.optionLabels.join(" ").includes(v.volumeLabel) && (
                  <span className="text-xs uppercase tracking-[0.14em] text-text-muted">{v.volumeLabel}</span>
                )}
                <span className="mt-auto flex flex-col gap-1">
                  <span className="text-lg tabular-nums text-text">{v.priceLabel}</span>
                  {v.perLiterLabel && <span className="text-xs tabular-nums text-text-muted">{v.perLiterLabel}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
