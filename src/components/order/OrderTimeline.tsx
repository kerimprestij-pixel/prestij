// Vertical status timeline (steps and states come from the core buildTimeline()).
import { Check, RotateCcw, X } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import type { TimelineStep } from "@/lib/orders/status-machine";
import { cn } from "@/lib/utils";
import { formatOrderDate } from "./format";
import { cardClass, cardTitleClass } from "./ui";

type OrderTimelineProps = { steps: TimelineStep[]; locale: Locale; labels: Messages["order"]["timeline"] };

function Marker({ step }: { step: TimelineStep }) {
  if (step.key === "cancelled" && step.state === "done") {
    return (
      <span className="grid size-6 place-items-center rounded-full bg-red-700 text-white dark:bg-red-400 dark:text-red-950">
        <X aria-hidden className="size-3.5" strokeWidth={2.25} />
      </span>
    );
  }
  if (step.key === "refunded" && step.state === "done") {
    return (
      <span className="grid size-6 place-items-center rounded-full bg-text-muted text-surface">
        <RotateCcw aria-hidden className="size-3.5" strokeWidth={2} />
      </span>
    );
  }
  switch (step.state) {
    case "done":
      return (
        <span className="grid size-6 place-items-center rounded-full bg-gold text-gold-contrast print:border print:border-text">
          <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
        </span>
      );
    case "current":
      return (
        <span className="grid size-6 place-items-center rounded-full border-2 border-gold bg-surface">
          <span className="size-2 rounded-full bg-gold motion-safe:animate-pulse" />
        </span>
      );
    case "skipped":
      return <span className="block size-6 rounded-full border border-dashed border-border-strong/50 bg-surface" />;
    default:
      return <span className="block size-6 rounded-full border border-border-strong/40 bg-surface" />;
  }
}

export default function OrderTimeline({ steps, locale, labels }: OrderTimelineProps) {
  return (
    <section aria-labelledby="order-timeline-title" className={cardClass}>
      <h2 id="order-timeline-title" className={cardTitleClass}>
        {labels.title}
      </h2>
      <ol className="mt-7">
        {steps.map((step, index) => {
          const next = steps[index + 1];
          const reached = step.state === "done";
          const stateLabel = labels[step.state];
          return (
            <li
              key={`${step.key}-${index}`}
              aria-current={step.state === "current" ? "step" : undefined}
              className="relative flex gap-4 pb-7 last:pb-0"
            >
              {next && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute start-[0.6875rem] top-7 -bottom-0.5 w-0.5 rounded-full",
                    reached && next.state === "done" ? "bg-gold" : "bg-border",
                  )}
                />
              )}
              <span className="relative z-10 mt-0.5 shrink-0">
                <Marker step={step} />
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "font-medium leading-snug",
                    step.state === "upcoming" || step.state === "skipped" ? "text-text-muted" : "text-text",
                    step.state === "skipped" && "line-through decoration-border-strong/60",
                  )}
                >
                  {step.state !== "current" && <span className="sr-only">{stateLabel}: </span>}
                  {labels[step.key]}
                </p>
                <p className="mt-0.5 text-sm text-text-muted">
                  {step.at ? (
                    <time dateTime={step.at}>{formatOrderDate(step.at, locale)}</time>
                  ) : step.state === "current" ? (
                    <span className="font-medium text-gold-text">{stateLabel}</span>
                  ) : (
                    <span aria-hidden>{step.state === "done" ? stateLabel : "—"}</span>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
