"use client";
import { useId } from "react";
import { cn } from "@/lib/utils";
import Field from "./Field";
import LinkInput from "./LinkInput";
import { LocalizedInput } from "./LocalizedInput";
import type { LocalizedErrors, LocalizedText } from "./localized";
import Switch from "./Switch";

export type CtaValue = { label: LocalizedText; href: string };

export type CtaInputProps = {
  label: React.ReactNode;
  value: CtaValue | null | undefined;
  /** undefined = button switched off (only when `optional`). */
  onChange: (value: CtaValue | undefined) => void;
  /** The button can be switched off. */
  optional?: boolean;
  help?: React.ReactNode;
  /** Errors below this field, keyed relative to it: { "label.tr": "…", href: "…" } (usePanelForm.errorsUnder). */
  errors?: Record<string, string>;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  className?: string;
};

function labelErrors(errors: Record<string, string> | undefined): LocalizedErrors {
  if (!errors) return undefined;
  if (errors.label) return errors.label;
  const out: Partial<Record<"tr" | "en" | "ar", string>> = {};
  for (const locale of ["tr", "en", "ar"] as const) if (errors[`label.${locale}`]) out[locale] = errors[`label.${locale}`];
  return Object.keys(out).length ? out : undefined;
}

/** Button: localized label + link. Optional buttons have an on/off switch. */
export default function CtaInput({
  label,
  value,
  onChange,
  optional = false,
  help,
  errors,
  required = false,
  disabled = false,
  name,
  className,
}: CtaInputProps) {
  const id = useId();
  const enabled = Boolean(value) || !optional;
  const current: CtaValue = value ?? { label: { tr: "" }, href: "" };
  const general = errors?.[""];

  return (
    <fieldset className={cn("min-w-0 rounded-xl border border-border bg-surface-2/30", className)} data-field={name}>
      <legend className="sr-only">{label}</legend>
      <div className={cn("flex items-start justify-between gap-4 px-4 py-3", enabled && "border-b border-border")}>
        <div className="min-w-0">
          <p id={`${id}-title`} className="text-sm font-medium text-text">
            {label}
            {required ? (
              <span aria-hidden className="ms-0.5 text-[#B3261E] dark:text-[#F28B82]">
                *
              </span>
            ) : null}
          </p>
          {help ? <p className="mt-0.5 text-xs text-text-muted">{help}</p> : null}
          {!enabled ? <p className="mt-0.5 text-xs text-text-muted">Buton gösterilmiyor.</p> : null}
        </div>
        {optional ? (
          <Switch
            checked={enabled}
            disabled={disabled}
            onChange={(on) => onChange(on ? current : undefined)}
            size="sm"
            id={`${id}-switch`}
          />
        ) : null}
      </div>
      {optional ? (
        <label htmlFor={`${id}-switch`} className="sr-only">
          {label}: göster
        </label>
      ) : null}
      {enabled ? (
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <LocalizedInput
            label="Buton yazısı"
            value={current.label}
            onChange={(next) => onChange({ ...current, label: next })}
            error={labelErrors(errors)}
            required
            maxLength={40}
            disabled={disabled}
          />
          <Field label="Bağlantı" error={errors?.href} required>
            <LinkInput value={current.href} onChange={(href) => onChange({ ...current, href })} disabled={disabled} />
          </Field>
          {general ? <p className="text-xs font-medium text-[#B3261E] sm:col-span-2 dark:text-[#F28B82]">{general}</p> : null}
        </div>
      ) : null}
    </fieldset>
  );
}
