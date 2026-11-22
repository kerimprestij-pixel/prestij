"use client";
import { useState } from "react";
import { affixClass, controlClass, controlGroupClass, groupInputClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";
import { formatTryAmount, parseTryAmount } from "@/lib/panel/format";
import { formatTrNumber, parseTrNumber } from "./number-format";

type BaseProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "prefix" | "size" | "type" | "min" | "max" | "step" | "defaultValue"
> & {
  invalid?: boolean;
  /** Text inside the start edge. */
  prefix?: React.ReactNode;
  /** Unit inside the end edge, e.g. "adet", "g", "%", "₺". */
  suffix?: React.ReactNode;
  /** Allow clearing the field (value null). Default true. */
  nullable?: boolean;
  size?: "sm" | "md";
  ref?: React.Ref<HTMLInputElement>;
};

type NumericProps = BaseProps & {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  parse: (text: string) => number | null;
  format: (value: number | null | undefined) => string;
  normalize: (value: number) => number;
  min?: number;
  max?: number;
  step: number;
  inputMode: "numeric" | "decimal";
};

/** Text-based numeric input: Turkish formatting, lenient parsing, ↑/↓ steps, clamped on blur. */
function NumericInput({
  value,
  onChange,
  parse,
  format,
  normalize,
  min,
  max,
  step,
  inputMode,
  invalid,
  prefix,
  suffix,
  nullable = true,
  size = "md",
  className,
  id,
  required,
  ref,
  onBlur,
  onFocus,
  onKeyDown,
  "aria-describedby": describedBy,
  ...rest
}: NumericProps) {
  const control = useFieldControl({ id, invalid, describedBy, required });
  const current = value ?? null;
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => format(current));
  const [seen, setSeen] = useState<number | null>(current);

  // Value changed from outside (reset, server data) while not editing: show it.
  if (!focused && current !== seen) {
    setSeen(current);
    setDraft(format(current));
  }

  const clamp = (n: number) => normalize(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));

  const commit = (next: number | null) => {
    setSeen(next);
    if (next !== current) onChange(next);
  };

  const height = size === "sm" ? "h-9" : "h-10";
  const input = (
    <input
      ref={ref}
      type="text"
      inputMode={inputMode}
      autoComplete="off"
      {...rest}
      {...control}
      required={required}
      value={draft}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        if (text.trim() === "") {
          if (nullable) commit(null);
          return;
        }
        const n = parse(text);
        if (n !== null) commit(normalize(n));
      }}
      onBlur={(event) => {
        setFocused(false);
        const n = draft.trim() === "" ? null : parse(draft);
        if (n === null) {
          const fallback = nullable && draft.trim() === "" ? null : current;
          commit(fallback);
          setDraft(format(fallback));
        } else {
          const clamped = clamp(n);
          commit(clamped);
          setDraft(format(clamped));
        }
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        const base = parse(draft) ?? current ?? min ?? 0;
        const next = clamp(base + (event.key === "ArrowUp" ? step : -step) * (event.shiftKey ? 10 : 1));
        commit(next);
        setDraft(format(next));
      }}
      className={
        prefix || suffix
          ? cn(groupInputClass, height, "tabular-nums")
          : cn(controlClass, height, "px-3 tabular-nums", className)
      }
    />
  );

  if (!prefix && !suffix) return input;
  return (
    <div className={cn(controlGroupClass, className)}>
      {prefix ? <span className={cn(affixClass, "border-e border-border")}>{prefix}</span> : null}
      {input}
      {suffix ? <span className={cn(affixClass, "border-s border-border")}>{suffix}</span> : null}
    </div>
  );
}

export type NumberInputProps = BaseProps & {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** ↑/↓ step (Shift = ×10). Default 1. */
  step?: number;
  /** Fraction digits allowed (default 0 = integers). */
  decimals?: number;
};

/** Number with Turkish formatting ("1.250", "12,5"). */
export function NumberInput({ decimals = 0, step = 1, ...props }: NumberInputProps) {
  const factor = 10 ** decimals;
  return (
    <NumericInput
      {...props}
      step={step}
      inputMode={decimals > 0 ? "decimal" : "numeric"}
      parse={parseTrNumber}
      format={(v) => formatTrNumber(v, decimals)}
      normalize={(n) => Math.round(n * factor) / factor}
    />
  );
}

export type MoneyInputProps = BaseProps & {
  /** Amount in kuruş (14990 = 149,90 ₺). */
  value: number | null | undefined;
  onChange: (kurus: number | null) => void;
  /** Minimum in kuruş (default 0). */
  min?: number;
  /** Maximum in kuruş. */
  max?: number;
};

/** Money in Turkish format ("1.499,90 ₺"); the value is integer kuruş. */
export function MoneyInput({ min = 0, max, suffix = "₺", placeholder = "0,00", ...props }: MoneyInputProps) {
  return (
    <NumericInput
      {...props}
      min={min}
      max={max}
      step={100}
      suffix={suffix}
      placeholder={placeholder}
      inputMode="decimal"
      parse={parseTryAmount}
      format={(v) => formatTryAmount(v)}
      normalize={(n) => Math.round(n)}
    />
  );
}

export type PercentInputProps = BaseProps & {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  /** Default 0. */
  min?: number;
  /** Default 100. */
  max?: number;
  /** Fraction digits (default 0). */
  decimals?: number;
};

/** Percentage (0–100 by default) with a "%" suffix. */
export function PercentInput({ min = 0, max = 100, decimals = 0, suffix = "%", ...props }: PercentInputProps) {
  const factor = 10 ** decimals;
  return (
    <NumericInput
      {...props}
      min={min}
      max={max}
      step={1}
      suffix={suffix}
      inputMode={decimals > 0 ? "decimal" : "numeric"}
      parse={parseTrNumber}
      format={(v) => formatTrNumber(v, decimals)}
      normalize={(n) => Math.round(n * factor) / factor}
    />
  );
}

export default NumberInput;
