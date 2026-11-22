"use client";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { useFieldControl, useInField } from "./Field";

export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label next to the switch. Inside <Field> leave it out (the Field label names it). */
  label?: React.ReactNode;
  /** Small line under the label. */
  description?: React.ReactNode;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  size?: "sm" | "md";
  className?: string;
};

/** On/off toggle (role="switch"). Space/Enter toggles. */
export default function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  invalid,
  id,
  size = "md",
  className,
}: SwitchProps) {
  const inField = useInField();
  const descriptionId = useId();
  const control = useFieldControl({ id, invalid, describedBy: description ? descriptionId : undefined });
  const labelId = `${control.id}-label`;

  const toggle = (
    <button
      type="button"
      role="switch"
      {...control}
      aria-checked={checked}
      aria-labelledby={label && !inField ? labelId : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        size === "sm" ? "h-5 w-9" : "h-6 w-11",
        checked ? "border-brand bg-brand" : "border-border-strong/50 bg-surface-2",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 -translate-y-1/2 rounded-full shadow-[0_1px_2px_rgb(3_38_95/0.3)] transition-[inset-inline-start,background-color] duration-200 motion-reduce:transition-none",
          size === "sm" ? "size-3.5" : "size-4.5",
          checked
            ? cn("bg-brand-contrast", size === "sm" ? "start-[1.125rem]" : "start-[1.375rem]")
            : "start-0.5 bg-surface",
        )}
      />
    </button>
  );

  if (!label) return <span className={className}>{toggle}</span>;

  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <span
          id={labelId}
          className={cn("block text-sm font-medium text-text", !disabled && "cursor-pointer")}
          onClick={() => !disabled && onChange(!checked)}
        >
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="mt-0.5 block text-xs leading-relaxed text-text-muted">
            {description}
          </span>
        ) : null}
      </div>
      {toggle}
    </div>
  );
}
