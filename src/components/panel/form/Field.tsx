"use client";
import { createContext, useContext, useId } from "react";
import { CircleExclamationPoint } from "lucide-react";
import { errorClass, helpClass, labelClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
};

type FieldContextValue = {
  controlId: string;
  labelId: string;
  helpId: string;
  errorId: string;
  hasHelp: boolean;
  invalid: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Wiring for a control inside <Field>: id, aria-describedby (help + error), aria-invalid, aria-required.
 * Explicit props win, so a control also works on its own.
 */
export function useFieldControl(own: { id?: string; invalid?: boolean; describedBy?: string; required?: boolean } = {}): FieldControlProps {
  const field = useContext(FieldContext);
  const fallbackId = useId();
  const invalid = own.invalid ?? field?.invalid ?? false;
  const describedBy = [own.describedBy, field?.hasHelp ? field.helpId : null, field?.invalid ? field.errorId : null]
    .filter(Boolean)
    .join(" ");
  return {
    id: own.id ?? field?.controlId ?? fallbackId,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": invalid ? true : undefined,
    "aria-required": (own.required ?? field?.required) ? true : undefined,
  };
}

/** id of the enclosing Field's <label> (for controls a <label for> cannot name, e.g. contenteditable). */
export function useFieldLabelId(): string | undefined {
  return useContext(FieldContext)?.labelId;
}

/** True inside a <Field> (controls use it to skip their own labels). */
export function useInField(): boolean {
  return useContext(FieldContext) !== null;
}

export type FieldProps = {
  label: React.ReactNode;
  /** Short explanation under the control (what the setting changes). */
  help?: React.ReactNode;
  /** Error under the control (Turkish); marks the control invalid. */
  error?: string | null;
  required?: boolean;
  /** "İsteğe bağlı" next to the label. */
  optional?: boolean;
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
  /** Content at the end of the label row (e.g. a counter, tabs or a small link). */
  labelAside?: React.ReactNode;
  /** Use a fixed id for the control (otherwise generated). */
  id?: string;
  /** The form path (e.g. "variants.2.price"); used to focus the first invalid field after a failed save. */
  name?: string;
  className?: string;
  children: React.ReactNode;
};

/** Label + control + help + error. Controls inside pick up the ids and aria attributes automatically. */
export default function Field({
  label,
  help,
  error,
  required = false,
  optional = false,
  hideLabel = false,
  labelAside,
  id,
  name,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? `${generated}-control`;
  const value: FieldContextValue = {
    controlId,
    labelId: `${generated}-label`,
    helpId: `${generated}-help`,
    errorId: `${generated}-error`,
    hasHelp: Boolean(help),
    invalid: Boolean(error),
    required,
  };

  return (
    <FieldContext.Provider value={value}>
      <div className={cn("min-w-0 space-y-1.5", className)} data-field={name}>
        <div className={cn("flex min-h-5 items-end justify-between gap-3", hideLabel && !labelAside && "sr-only")}>
          <label id={value.labelId} htmlFor={controlId} className={cn(labelClass, hideLabel && "sr-only")}>
            {label}
            {required ? (
              <span aria-hidden className="ms-0.5 text-[#B3261E] dark:text-[#F28B82]">
                *
              </span>
            ) : null}
            {optional ? <span className="ms-1.5 text-xs font-normal text-text-muted">İsteğe bağlı</span> : null}
          </label>
          {labelAside ? <div className="flex shrink-0 items-center gap-2 text-xs text-text-muted">{labelAside}</div> : null}
        </div>
        {children}
        {error ? (
          <p id={value.errorId} className={cn(errorClass, "flex items-start gap-1.5")}>
            <CircleExclamationPoint aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
        {help ? (
          <p id={value.helpId} className={helpClass}>
            {help}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/** Group of related fields with a small heading (inside a Card or a dialog). */
export function FieldGroup({
  title,
  description,
  children,
  className,
  columns = 1,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** 2 = two columns from sm up. */
  columns?: 1 | 2 | 3;
}) {
  return (
    <fieldset className={cn("min-w-0 space-y-4", className)}>
      {title ? (
        <legend className="mb-1 w-full">
          <span className="block text-sm font-semibold text-text">{title}</span>
          {description ? <span className="mt-0.5 block text-xs text-text-muted">{description}</span> : null}
        </legend>
      ) : null}
      <div
        className={cn(
          "grid gap-x-5 gap-y-5",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {children}
      </div>
    </fieldset>
  );
}
