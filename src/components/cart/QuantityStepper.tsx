"use client";

// − [qty] + stepper. Buttons change the value at once; typed values are committed on blur or Enter
// and clamped to [min, max]. Escape while typing reverts (and does not close a surrounding dialog).
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type QuantityStepperLabels = { quantity: string; decrease: string; increase: string };

type Props = {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  labels: QuantityStepperLabels;
  disabled?: boolean;
  size?: "sm" | "md";
  /** id of a hint (e.g. "max reached") read with the input. */
  describedBy?: string;
  className?: string;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export default function QuantityStepper({ value, min, max, onChange, labels, disabled = false, size = "sm", describedBy, className }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const upper = Math.max(min, max);

  const commit = (raw: string) => {
    setDraft(null);
    const n = Math.floor(Number(raw));
    if (!raw || !Number.isFinite(n)) return;
    const next = clamp(n, min, upper);
    if (next !== value) onChange(next);
  };

  const button = cn(
    "inline-flex shrink-0 items-center justify-center text-text transition-colors duration-200 hover:text-gold-text disabled:cursor-not-allowed disabled:text-text-muted/40 disabled:hover:text-text-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none dark:hover:text-gold",
    size === "md" ? "size-12" : "size-9",
  );

  return (
    <div
      role="group"
      aria-label={labels.quantity}
      className={cn(
        "inline-flex items-center rounded-control border border-border bg-surface",
        disabled && "opacity-60",
        className,
      )}
    >
      <button
        type="button"
        className={button}
        aria-label={labels.decrease}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1, min, upper))}
      >
        <Minus aria-hidden className="size-3.5" strokeWidth={1.5} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        enterKeyHint="done"
        aria-label={labels.quantity}
        aria-describedby={describedBy}
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
          } else if (event.key === "Escape" && draft !== null) {
            // preventDefault tells the drawer's Escape handler to leave the dialog open.
            event.preventDefault();
            setDraft(null);
          }
        }}
        className={cn(
          "min-w-0 bg-transparent text-center font-medium tabular-nums text-text outline-none focus-visible:rounded-xs focus-visible:outline-2 focus-visible:outline-ring",
          size === "md" ? "h-12 w-12 text-base" : "h-9 w-9 text-sm",
        )}
      />
      <button
        type="button"
        className={button}
        aria-label={labels.increase}
        disabled={disabled || value >= upper}
        onClick={() => onChange(clamp(value + 1, min, upper))}
      >
        <Plus aria-hidden className="size-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}
