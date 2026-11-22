// Free samples on offer for this cart. Compact two-column chips in the drawer, roomier cards with
// the sample image on the cart page. Availability (canAdd, limits, messages) comes from the view.
// A chip keeps its height when it is picked (the drawer shows the state with the check badge and the
// gold border, not with an extra text line), so the chips never move under the pointer.
import { Check, FlaskConical, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { CartView } from "@/lib/cart/view";
import Img from "@/lib/media/Img";
import { cn } from "@/lib/utils";
import { AccentDot } from "./CartLineItem";
import type { CartUiLabels } from "./labels";

type Props = {
  view: CartView;
  locale: Locale;
  labels: CartUiLabels;
  variant: "drawer" | "page";
  onAdd: (variantId: number) => void;
  className?: string;
  /** Rendered at the end of the section (the drawer lists the samples already in the cart here). */
  children?: ReactNode;
};

/** True when the picker renders for this view (samples enabled and offered, a paid product in the cart). */
export function samplePickerShown(view: Pick<CartView, "samples" | "availableSamples" | "paidItemCount">): boolean {
  return view.samples.enabled && view.availableSamples.length > 0 && view.paidItemCount > 0;
}

export default function SamplePicker({ view, locale, labels, variant, onAdd, className, children }: Props) {
  const { samples, availableSamples } = view;
  if (!samplePickerShown(view)) return null;
  const page = variant === "page";
  // Optimistically added samples count before the server confirms them.
  const used = Math.max(samples.used, availableSamples.filter((s) => s.inCart).length);
  const note = samples.unavailableMessage ?? samples.hint;

  return (
    <section aria-labelledby={`samples-${variant}`} className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`samples-${variant}`} className={cn("flex items-center gap-2 text-text", page ? "font-heading text-2xl" : "font-body text-sm font-medium tracking-normal")}>
          {!page ? <FlaskConical aria-hidden className="size-4 text-gold-text dark:text-gold" strokeWidth={1.5} /> : null}
          {labels.samplesTitle}
        </h2>
        {samples.max > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-text-muted">
            {format(labels.samplesSelected, { used: Math.min(used, samples.max), max: samples.max }, locale)}
          </span>
        ) : null}
      </div>
      {note ? <p className={cn("text-xs leading-relaxed text-text-muted", page ? "mt-2" : "mt-1")}>{note}</p> : null}

      <ul className={cn("grid gap-2", page ? "mt-5 grid-cols-1 sm:grid-cols-2" : "mt-3 grid-cols-2")}>
        {availableSamples.map((sample) => {
          const label = sample.inCart
            ? `${sample.name}: ${labels.sampleInCart}`
            : !sample.inStock
              ? `${sample.name}: ${labels.sampleOutOfStock}`
              : format(labels.addSampleFor, { name: sample.name });
          return (
            <li key={sample.variantId}>
              <button
                type="button"
                onClick={() => onAdd(sample.variantId)}
                disabled={!sample.canAdd}
                aria-label={label}
                className={cn(
                  "group flex h-full w-full items-center gap-2.5 rounded-control border bg-surface text-start text-text transition-[border-color,background-color,opacity] duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
                  page ? "px-3 py-3" : "px-3 py-2.5",
                  sample.inCart ? "border-gold/70 bg-gold-50/60 dark:bg-gold-950/30" : "border-border",
                  sample.canAdd ? "hover:border-gold" : "cursor-not-allowed",
                  !sample.canAdd && !sample.inCart && "opacity-55",
                )}
              >
                {page && sample.image ? (
                  <span className="relative size-11 shrink-0 overflow-hidden rounded-full bg-surface-2">
                    <Img media={sample.image} alt="" locale={locale} sizes="44px" fill />
                  </span>
                ) : (
                  <AccentDot color={sample.accentColor} className={page ? "size-3" : undefined} />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("line-clamp-2 leading-tight", page ? "text-sm font-medium" : "text-[0.8125rem]")}>{sample.name}</span>
                  {page || !sample.inStock ? (
                    <span className="mt-0.5 text-[0.6875rem] text-text-muted">
                      {sample.inCart ? labels.sampleInCart : !sample.inStock ? labels.sampleOutOfStock : sample.subtitle}
                    </span>
                  ) : null}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border transition-colors duration-300",
                    sample.inCart ? "border-gold bg-gold text-gold-contrast" : "border-border text-text-muted group-enabled:group-hover:border-gold group-enabled:group-hover:text-text",
                  )}
                >
                  {sample.inCart ? <Check className="size-3.5" strokeWidth={2} /> : <Plus className="size-3.5" strokeWidth={1.5} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {children}
    </section>
  );
}
