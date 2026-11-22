// Accessible form primitives for the checkout (label, hint, error wired with aria-describedby).
// Hook-free: render them inside the client checkout form.
import type { HTMLAttributes, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** DOM id for a field path: "shippingAddress.city" → "co-shippingAddress-city" (error summary links use it). */
export const fieldId = (name: string) => `co-${name.replace(/[^a-zA-Z0-9]/g, "-")}`;

export const inputClass = cn(
  "block min-h-12 w-full rounded-control border border-border bg-surface px-4 py-3 text-base text-text shadow-none transition-[border-color,box-shadow] duration-200",
  "placeholder:text-text-muted/75 hover:border-border-strong/60",
  "focus:border-ring focus:outline-none focus:ring-3 focus:ring-ring/25 focus-visible:outline-none",
  "aria-[invalid=true]:border-red-700 aria-[invalid=true]:focus:ring-red-700/20 dark:aria-[invalid=true]:border-red-400",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

export const errorTextClass = "text-sm leading-snug text-red-700 dark:text-red-400";

type BaseProps = {
  name: string;
  label: string;
  /** Shown as "(isteğe bağlı)" next to the label. */
  optionalLabel?: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
};

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export function FieldError({ id, error }: { id: string; error?: string | null }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} className={cn(errorTextClass, "mt-2 flex items-start gap-1.5")}>
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <span>{error}</span>
    </p>
  );
}

function Label({ id, label, optionalLabel }: { id: string; label: string; optionalLabel?: string }) {
  return (
    <label htmlFor={id} className="mb-2 block text-sm font-medium text-text">
      {label}
      {optionalLabel && <span className="ms-1.5 text-xs font-normal text-text-muted">({optionalLabel})</span>}
    </label>
  );
}

function Hint({ id, hint }: { id: string; hint?: ReactNode }) {
  if (!hint) return null;
  return (
    <p id={`${id}-hint`} className="mt-2 text-xs leading-relaxed text-text-muted">
      {hint}
    </p>
  );
}

type TextFieldProps = BaseProps & {
  type?: "text" | "email" | "tel";
  autoComplete?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  defaultValue?: string;
  required?: boolean;
  /** "ltr" for e-mail, phone and number fields (stay left-to-right in Arabic). */
  dir?: "ltr" | "rtl";
  spellCheck?: boolean;
  autoCapitalize?: string;
  /** ACCOUNTS: the signed-in customer's e-mail at checkout (the server uses the account's anyway). */
  readOnly?: boolean;
};

export function TextField({
  name,
  label,
  optionalLabel,
  hint,
  error,
  className,
  type = "text",
  dir,
  required,
  ...input
}: TextFieldProps) {
  const id = fieldId(name);
  return (
    <div className={className}>
      <Label id={id} label={label} optionalLabel={optionalLabel} />
      <input
        id={id}
        name={name}
        type={type}
        dir={dir}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(inputClass, dir === "ltr" && "rtl:text-right", input.readOnly && "cursor-default border-dashed bg-surface-2/60 text-text-muted focus:ring-0")}
        {...input}
      />
      <FieldError id={id} error={error} />
      <Hint id={id} hint={hint} />
    </div>
  );
}

type SelectFieldProps = BaseProps & {
  options: { value: string; label: string }[];
  placeholder: string;
  autoComplete?: string;
  defaultValue?: string;
  required?: boolean;
};

export function SelectField({ name, label, optionalLabel, hint, error, className, options, placeholder, required, ...select }: SelectFieldProps) {
  const id = fieldId(name);
  return (
    <div className={className}>
      <Label id={id} label={label} optionalLabel={optionalLabel} />
      <div className="relative">
        <select
          id={id}
          name={name}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(inputClass, "cursor-pointer appearance-none pe-11")}
          {...select}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <FieldError id={id} error={error} />
      <Hint id={id} hint={hint} />
    </div>
  );
}

type TextAreaFieldProps = BaseProps & {
  placeholder?: string;
  maxLength: number;
  rows?: number;
  defaultValue?: string;
  /** Live character counter, e.g. "12/500". */
  counter?: string;
};

export function TextAreaField({ name, label, optionalLabel, hint, error, className, counter, ...area }: TextAreaFieldProps) {
  const id = fieldId(name);
  return (
    <div className={className}>
      <Label id={id} label={label} optionalLabel={optionalLabel} />
      <textarea
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint || counter, error)}
        className={cn(inputClass, "min-h-28 resize-y leading-relaxed")}
        {...area}
      />
      <FieldError id={id} error={error} />
      {(hint || counter) && (
        <p id={`${id}-hint`} className="mt-2 flex justify-between gap-4 text-xs text-text-muted">
          <span>{hint}</span>
          {counter && <span className="tabular-nums" dir="ltr">{counter}</span>}
        </p>
      )}
    </div>
  );
}

type CheckboxFieldProps = {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /**
   * Plain-text name for assistive tech when `label` contains a button: browsers leave a nested
   * button's text out of the checkbox's name ("I have read and accept the .").
   */
  accessibleName?: string;
  className?: string;
};

export function CheckboxField({ name, label, hint, error, checked, defaultChecked, onCheckedChange, accessibleName, className }: CheckboxFieldProps) {
  const id = fieldId(name);
  return (
    <div className={className}>
      <div className="flex items-start gap-3">
        {/* 24px box inside a 44px hit area (the label extends it). */}
        <input
          id={id}
          name={name}
          type="checkbox"
          value="on"
          checked={checked}
          defaultChecked={defaultChecked}
          onChange={onCheckedChange ? (e) => onCheckedChange(e.currentTarget.checked) : undefined}
          aria-label={accessibleName}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded-sm accent-brand dark:accent-gold"
        />
        <label htmlFor={id} className="min-h-6 flex-1 cursor-pointer text-sm leading-relaxed text-text">
          {label}
        </label>
      </div>
      <div className="ps-8">
        <FieldError id={id} error={error} />
        <Hint id={id} hint={hint} />
      </div>
    </div>
  );
}
