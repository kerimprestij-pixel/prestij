import { Check, X } from "lucide-react";
import { formatDateTime } from "@/components/panel/labels";
import type { TimelineStep } from "@/lib/orders/status-machine";
import { cn } from "@/lib/utils";
import { TIMELINE_STEP_LABELS } from "./labels";

const STATE_LABEL: Record<TimelineStep["state"], string> = {
  done: "tamamlandı",
  current: "sıradaki adım",
  upcoming: "bekliyor",
  skipped: "gerçekleşmedi",
};

/**
 * Progress steps (placed → paid → processing → shipped → delivered, or the cancelled/refunded end).
 * Horizontal only when the card itself is wide enough (container query), vertical otherwise.
 */
export default function OrderProgress({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="@container">
      <ol className="grid gap-3 @lg:auto-cols-fr @lg:grid-flow-col @lg:gap-2">
        {steps.map((step, i) => {
          const terminal = step.key === "cancelled" || step.key === "refunded";
          const muted = step.state === "upcoming" || step.state === "skipped";
          return (
            <li key={`${step.key}-${i}`} className="flex items-start gap-3 @lg:flex-col @lg:gap-2">
              <span className="flex items-center gap-2 @lg:w-full">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border text-[0.6875rem] font-semibold",
                    step.state === "done" && !terminal && "border-brand bg-brand text-brand-contrast",
                    step.state === "done" && terminal && "border-[#B3261E] bg-[#B3261E] text-white",
                    step.state === "current" && "border-gold bg-gold/15 text-gold-text ring-4 ring-gold/15",
                    step.state === "upcoming" && "border-border bg-surface text-text-muted",
                    step.state === "skipped" && "border-dashed border-border bg-surface text-text-muted",
                  )}
                >
                  {step.state === "done" ? terminal ? <X className="size-3.5" /> : <Check className="size-3.5" /> : i + 1}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "hidden h-px flex-1 @lg:block",
                    i === steps.length - 1 ? "invisible" : step.state === "done" ? "bg-brand/40" : "bg-border",
                  )}
                />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-sm",
                    muted ? "text-text-muted" : "font-medium text-text",
                    step.state === "skipped" && "line-through decoration-text-muted/50",
                  )}
                >
                  {TIMELINE_STEP_LABELS[step.key] ?? step.key}
                  <span className="sr-only">: {STATE_LABEL[step.state]}</span>
                </span>
                {step.at ? (
                  <time dateTime={step.at} className="block text-xs text-text-muted">
                    {formatDateTime(step.at)}
                  </time>
                ) : step.state === "current" ? (
                  <span aria-hidden className="block text-xs text-gold-text">
                    Sıradaki adım
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
