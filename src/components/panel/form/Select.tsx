"use client";
import { ChevronDown } from "lucide-react";
import { controlClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";

export type SelectOption<V extends string | number = string> = {
  value: V;
  label: string;
  disabled?: boolean;
  /** Optional <optgroup> label. */
  group?: string;
};

export type SelectProps<V extends string | number> = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "onChange" | "size" | "multiple" | "children"
> & {
  value: V | null | undefined;
  onChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  /** Shown first while nothing is selected (not selectable once a value is set unless `allowEmpty`). */
  placeholder?: string;
  /** Keeps the placeholder selectable so the user can go back to "nothing selected" (calls `onClear`). */
  allowEmpty?: boolean;
  /** Called when the empty placeholder option is chosen (with `allowEmpty`). */
  onClear?: () => void;
  invalid?: boolean;
  size?: "sm" | "md";
  ref?: React.Ref<HTMLSelectElement>;
};

/** Native select with the panel look. Number values come back as numbers. */
export default function Select<V extends string | number>({
  value,
  onChange,
  options,
  placeholder,
  allowEmpty = false,
  onClear,
  invalid,
  size = "md",
  className,
  id,
  required,
  ref,
  "aria-describedby": describedBy,
  ...rest
}: SelectProps<V>) {
  const control = useFieldControl({ id, invalid, describedBy, required });
  const selected = value == null ? "" : String(value);
  const hasEmptyOption = options.some((o) => String(o.value) === "");
  const groups = new Map<string, SelectOption<V>[]>();
  for (const option of options) {
    const key = option.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }
  const renderOption = (o: SelectOption<V>) => (
    <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
      {o.label}
    </option>
  );

  return (
    <div className={cn("relative min-w-0", className)}>
      <select
        ref={ref}
        {...rest}
        {...control}
        required={required}
        value={selected}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "" && !hasEmptyOption) {
            onClear?.();
            return;
          }
          const match = options.find((o) => String(o.value) === raw);
          if (match) onChange(match.value);
        }}
        className={cn(controlClass, size === "sm" ? "h-9" : "h-10", "appearance-none truncate ps-3 pe-9", !selected && !hasEmptyOption && "text-text-muted")}
      >
        {!hasEmptyOption && (placeholder !== undefined || selected === "") ? (
          <option value="" disabled={!allowEmpty}>
            {placeholder ?? "Seçin…"}
          </option>
        ) : null}
        {[...groups.entries()].map(([group, list]) =>
          group ? (
            <optgroup key={group} label={group}>
              {list.map(renderOption)}
            </optgroup>
          ) : (
            list.map(renderOption)
          ),
        )}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
    </div>
  );
}
