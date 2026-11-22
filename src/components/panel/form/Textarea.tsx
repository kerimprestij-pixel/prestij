"use client";
import { useLayoutEffect, useRef } from "react";
import { controlClass, helpClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";

export type TextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string | null | undefined;
  onChange: (value: string) => void;
  invalid?: boolean;
  /** Grow with the content up to `maxRows` (default true). */
  autoGrow?: boolean;
  maxRows?: number;
  /** Show "120 / 500" under the field when maxLength is set (default true). */
  showCount?: boolean;
  ref?: React.Ref<HTMLTextAreaElement>;
};

/** Multi-line text input that grows with its content. `onChange` receives the string. */
export default function Textarea({
  value,
  onChange,
  invalid,
  autoGrow = true,
  maxRows = 16,
  showCount = true,
  rows = 3,
  maxLength,
  className,
  id,
  required,
  ref,
  "aria-describedby": describedBy,
  ...rest
}: TextareaProps) {
  const control = useFieldControl({ id, invalid, describedBy, required });
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const text = value ?? "";

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || !autoGrow) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = line * maxRows + 20;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? "auto" : "hidden";
  }, [text, autoGrow, maxRows]);

  return (
    <div className="min-w-0">
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        rows={rows}
        maxLength={maxLength}
        {...rest}
        {...control}
        required={required}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        className={cn(controlClass, "block min-h-20 resize-y px-3 py-2.5 leading-relaxed", className)}
      />
      {showCount && maxLength ? (
        <p aria-hidden className={cn(helpClass, "mt-1 text-end tabular-nums")}>
          {text.length} / {maxLength}
        </p>
      ) : null}
    </div>
  );
}
