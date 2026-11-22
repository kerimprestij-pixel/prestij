"use client";
import { helpClass, labelClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";
import { LocalizedInput } from "./LocalizedInput";
import type { LocalizedErrors, LocalizedText } from "./localized";
import Repeater from "./Repeater";

export type LocalizedListInputProps = {
  label: React.ReactNode;
  value: LocalizedText[] | null | undefined;
  onChange: (value: LocalizedText[]) => void;
  help?: React.ReactNode;
  /** Singular noun for one entry (default "Madde"). */
  itemLabel?: string;
  max?: number;
  /** Errors below this field, keyed relative to it: { "0.tr": "…" } (usePanelForm.errorsUnder). */
  errors?: Record<string, string>;
  maxLength?: number;
  disabled?: boolean;
  name?: string;
  className?: string;
};

function itemErrors(errors: Record<string, string> | undefined, index: number): LocalizedErrors {
  if (!errors) return undefined;
  if (errors[String(index)]) return errors[String(index)];
  const out: Partial<Record<"tr" | "en" | "ar", string>> = {};
  for (const locale of ["tr", "en", "ar"] as const) if (errors[`${index}.${locale}`]) out[locale] = errors[`${index}.${locale}`];
  return Object.keys(out).length ? out : undefined;
}

/** A short list of localized lines (e.g. bullet points): add, remove, reorder. */
export default function LocalizedListInput({
  label,
  value,
  onChange,
  help,
  itemLabel = "Madde",
  max,
  errors,
  maxLength = 120,
  disabled,
  name,
  className,
}: LocalizedListInputProps) {
  const items = value ?? [];
  return (
    <fieldset className={cn("min-w-0 space-y-2", className)} data-field={name}>
      <legend className={cn(labelClass, "mb-1")}>{label}</legend>
      {help ? <p className={cn(helpClass, "-mt-1")}>{help}</p> : null}
      <Repeater
        items={items}
        onChange={onChange}
        createItem={() => ({ tr: "" })}
        noun={itemLabel}
        itemSummary={(item) => item.tr}
        ariaLabel={typeof label === "string" ? label : itemLabel}
        max={max}
        collapsible={false}
        confirmRemove={false}
        allowDuplicate={false}
        disabled={disabled}
        itemHasError={(index) => Boolean(itemErrors(errors, index))}
        renderItem={(item, { index, update }) => (
          <LocalizedInput
            label={`${itemLabel} ${index + 1}`}
            hideLabel
            value={item}
            onChange={update}
            error={itemErrors(errors, index)}
            maxLength={maxLength}
            disabled={disabled}
          />
        )}
      />
      {errors?.[""] ? <p className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{errors[""]}</p> : null}
    </fieldset>
  );
}
