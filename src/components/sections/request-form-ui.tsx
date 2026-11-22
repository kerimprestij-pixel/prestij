"use client";

// Shared pieces of the quote and sample request forms (client): accessible fields with ids scoped to
// the form (two forms on one page never clash), numbered steps, the error banner, the success panel,
// the honeypot and the signed-in prefill. Styling follows the checkout and contact forms.
import { AlertCircle, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { errorTextClass, inputClass } from "@/components/checkout/fields";
import { useViewer } from "@/components/store/viewer/ViewerProvider";
import type { Messages } from "@/i18n/get-messages";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { loadRequestPrefill } from "@/lib/requests/actions";
import { REQUEST_LIMITS, type RequestFieldError, type RequestFormState, type RequestPrefill } from "@/lib/requests/types";
import { cn } from "@/lib/utils";
import { buttonClass } from "./button-styles";

export type RequestLabels = Messages["requests"];

/** DOM id of a field: "quote" + "lines.2.quantity" → "rq-quote-lines-2-quantity". */
export const requestFieldId = (form: string, name: string) => `rq-${form}-${name.replace(/[^a-zA-Z0-9]/g, "-")}`;

const MAX_FOR: Record<string, number> = {
  companyName: REQUEST_LIMITS.company,
  contactName: REQUEST_LIMITS.name,
  email: REQUEST_LIMITS.email,
  phone: REQUEST_LIMITS.phone,
  message: REQUEST_LIMITS.message,
  district: REQUEST_LIMITS.district,
  line1: REQUEST_LIMITS.line1,
  label: REQUEST_LIMITS.lineLabel,
};

/** The visitor-facing text of an error code at `path`. */
export function requestErrorText(code: RequestFieldError | undefined, path: string, labels: RequestLabels, locale: Locale): string | null {
  if (!code) return null;
  const e = labels.errors;
  const field = path.split(".").at(-1) ?? path;
  switch (code) {
    case "required":
      return e.required;
    case "invalid_name":
      return e.invalidName;
    case "invalid_company":
      return e.invalidCompany;
    case "invalid_email":
      return e.invalidEmail;
    case "invalid_phone":
      return e.invalidPhone;
    case "too_short":
      return e.tooShort;
    case "too_long":
      return format(e.tooLong, { max: MAX_FOR[field] ?? 200 }, locale);
    case "invalid_quantity":
      return format(e.invalidQuantity, { max: REQUEST_LIMITS.quantityMax.toLocaleString(locale === "ar" ? "ar-u-nu-latn" : locale) }, locale);
    case "invalid_product":
      return e.invalidProduct;
    case "no_lines":
      return e.noLines;
    case "too_many_lines":
      return format(e.tooManyLines, { max: REQUEST_LIMITS.maxLines }, locale);
    case "consent":
      return e.consent;
    case "invalid_city":
      return e.invalidCity;
    case "no_products":
      return e.noProducts;
    case "too_many_products":
      return format(e.tooManyProducts, { max: REQUEST_LIMITS.maxSampleProducts }, locale);
    case "invalid_number":
      return e.invalidNumber;
  }
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export function FieldMessage({ id, error }: { id: string; error?: string | null }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} className={cn(errorTextClass, "mt-2 flex items-start gap-1.5")}>
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <span>{error}</span>
    </p>
  );
}

function FieldHint({ id, hint }: { id: string; hint?: ReactNode }) {
  if (!hint) return null;
  return (
    <p id={`${id}-hint`} className="mt-2 text-xs leading-relaxed text-text-muted">
      {hint}
    </p>
  );
}

function FieldLabel({ id, label, optional }: { id: string; label: string; optional?: string }) {
  return (
    <label htmlFor={id} className="mb-2 block text-sm font-medium text-text">
      {label}
      {optional && <span className="ms-1.5 text-xs font-normal text-text-muted">({optional})</span>}
    </label>
  );
}

type CommonProps = {
  form: string;
  name: string;
  label: string;
  optional?: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
};

export function RequestInput({
  form,
  name,
  label,
  optional,
  hint,
  error,
  className,
  dir,
  suffix,
  required,
  ...input
}: CommonProps & {
  type?: "text" | "email" | "tel";
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel" | "numeric" | "decimal";
  placeholder?: string;
  maxLength?: number;
  defaultValue?: string;
  required?: boolean;
  dir?: "ltr" | "rtl";
  spellCheck?: boolean;
  autoCapitalize?: string;
  /** Unit shown inside the field's end edge (e.g. "litre"). */
  suffix?: string;
}) {
  const id = requestFieldId(form, name);
  return (
    <div className={className}>
      <FieldLabel id={id} label={label} optional={optional} />
      <div className="relative">
        <input
          id={id}
          name={name}
          type={input.type ?? "text"}
          dir={dir}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(inputClass, dir === "ltr" && "rtl:text-right", suffix && "pe-16")}
          {...input}
        />
        {suffix && (
          <span aria-hidden className="pointer-events-none absolute end-4 top-1/2 -translate-y-1/2 text-sm text-text-muted">
            {suffix}
          </span>
        )}
      </div>
      <FieldMessage id={id} error={error} />
      <FieldHint id={id} hint={hint} />
    </div>
  );
}

export function SelectChevron() {
  return (
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
  );
}

export function RequestSelect({
  form,
  name,
  label,
  optional,
  hint,
  error,
  className,
  options,
  placeholder,
  required,
  defaultValue,
  autoComplete,
}: CommonProps & {
  options: { value: string; label: string }[];
  placeholder: string;
  required?: boolean;
  defaultValue?: string;
  autoComplete?: string;
}) {
  const id = requestFieldId(form, name);
  return (
    <div className={className}>
      <FieldLabel id={id} label={label} optional={optional} />
      <div className="relative">
        <select
          id={id}
          name={name}
          required={required}
          defaultValue={defaultValue ?? ""}
          autoComplete={autoComplete}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(inputClass, "cursor-pointer appearance-none pe-11")}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <SelectChevron />
      </div>
      <FieldMessage id={id} error={error} />
      <FieldHint id={id} hint={hint} />
    </div>
  );
}

export function RequestTextarea({
  form,
  name,
  label,
  optional,
  hint,
  error,
  className,
  placeholder,
  defaultValue,
  maxLength,
  rows = 4,
}: CommonProps & { placeholder?: string; defaultValue?: string; maxLength: number; rows?: number }) {
  const id = requestFieldId(form, name);
  return (
    <div className={className}>
      <FieldLabel id={id} label={label} optional={optional} />
      <textarea
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(inputClass, "min-h-28 resize-y leading-relaxed")}
      />
      <FieldMessage id={id} error={error} />
      <FieldHint id={id} hint={hint} />
    </div>
  );
}

/** The KVKK consent box; the link opens the notice in a new tab so the form keeps its values. */
export function ConsentField({
  form,
  labels,
  privacyHref,
  error,
  defaultChecked,
}: {
  form: string;
  labels: RequestLabels;
  privacyHref: string;
  error?: string | null;
  defaultChecked?: boolean;
}) {
  const id = requestFieldId(form, "consent");
  const [before, after = ""] = labels.consent.split("{link}");
  return (
    <div>
      <div className="flex items-start gap-3">
        <input
          id={id}
          name="consent"
          type="checkbox"
          value="on"
          defaultChecked={defaultChecked}
          required
          aria-required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded-sm accent-brand dark:accent-gold"
        />
        <label htmlFor={id} className="min-h-6 flex-1 cursor-pointer text-sm leading-relaxed text-text-muted">
          {before}
          <Link
            href={privacyHref}
            target="_blank"
            rel="noopener"
            className="text-text underline decoration-gold/60 underline-offset-4 hover:decoration-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {labels.consentLink}
          </Link>
          {after}
        </label>
      </div>
      <div className="ps-8">
        <FieldMessage id={id} error={error} />
      </div>
    </div>
  );
}

/** A numbered step of the form ("01  Contact details"). */
export function FormStep({ index, title, hint, children, id }: { index: number; title: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <fieldset className="min-w-0 space-y-6" id={id}>
      <legend className="mb-6 flex w-full items-baseline gap-3 border-b border-border pb-3">
        <span aria-hidden className="font-heading text-sm text-gold-text tabular-nums" dir="ltr">
          {String(index).padStart(2, "0")}
        </span>
        <span className="font-heading text-xl leading-tight text-text md:text-2xl">{title}</span>
      </legend>
      {hint && <p className="-mt-3 text-sm leading-relaxed text-text-muted">{hint}</p>}
      {children}
    </fieldset>
  );
}

/** Hidden from people and assistive tech; bots fill it and their request is dropped. */
export function Honeypot() {
  return (
    <div aria-hidden="true" className="sr-only">
      <label>
        Website
        <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}

export function ErrorBanner({ text, alertRef }: { text: string | null; alertRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={alertRef}
      tabIndex={-1}
      aria-live="polite"
      className={cn(
        "focus:outline-none",
        text &&
          "flex items-start gap-3 rounded-md border border-red-700/30 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200",
      )}
    >
      {text && (
        <>
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span>{text}</span>
        </>
      )}
    </div>
  );
}

export function bannerText(state: RequestFormState, labels: RequestLabels, locale: Locale): string | null {
  if (state.status !== "error") return null;
  if (state.error === "too_many") return format(labels.tooMany, { minutes: state.retryMinutes ?? 60 }, locale);
  if (state.error === "server") return labels.error;
  if (state.error === "closed") return labels.sample.closed;
  return labels.errorSummary;
}

export function SuccessPanel({
  title,
  text,
  reference,
  referenceLabel,
  againLabel,
  onAgain,
  headingRef,
}: {
  title: string;
  text: string;
  reference: string | null | undefined;
  referenceLabel: string;
  againLabel: string;
  onAgain: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div role="status" className="flex flex-col items-start py-4 sm:py-8">
      <span className="grid size-14 place-items-center rounded-full border border-gold/50 text-gold-text">
        <Check aria-hidden className="size-6" strokeWidth={1.5} />
      </span>
      <h3 ref={headingRef} tabIndex={-1} className="mt-7 font-heading text-3xl text-text focus:outline-none md:text-4xl">
        {title}
      </h3>
      <p className="mt-4 max-w-md text-base leading-relaxed whitespace-pre-line text-text-muted">{text}</p>
      {reference && (
        <p className="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-5 text-sm text-text-muted">
          <span className="eyebrow">{referenceLabel}</span>
          <span className="font-heading text-xl tracking-wide text-text" dir="ltr">
            {reference}
          </span>
        </p>
      )}
      <button type="button" onClick={onAgain} className={buttonClass("link", "mt-10")}>
        {againLabel}
      </button>
    </div>
  );
}

/**
 * Prefill for signed-in visitors: once the viewer is known to be signed in, asks the server for the
 * account's contact data and writes it into still-empty fields (the inputs stay uncontrolled).
 * Returns true when anything was filled in.
 */
export function useRequestPrefill(formRef: RefObject<HTMLFormElement | null>, fields: (keyof RequestPrefill)[]): boolean {
  const viewer = useViewer();
  const [filled, setFilled] = useState(false);
  const signedIn = viewer.ready && viewer.signedIn;
  const key = fields.join(",");
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    loadRequestPrefill().then((prefill) => {
      const form = formRef.current;
      if (cancelled || !prefill || !form) return;
      let any = false;
      for (const name of key.split(",") as (keyof RequestPrefill)[]) {
        const value = prefill[name];
        const el = form.elements.namedItem(name);
        if (!value || !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) continue;
        if (el.value.trim() !== "") continue;
        el.value = value;
        any = true;
      }
      if (any) setFilled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, formRef, key]);
  return filled;
}

/** A thin gold check list (the "what happens next" points beside the forms). */
export function PointList({ points }: { points: string[] }) {
  if (points.length === 0) return null;
  return (
    <ul className="mt-10 max-w-md space-y-4">
      {points.map((point, i) => (
        <li key={i} className="flex items-start gap-3 border-t border-border pt-4 text-[0.95rem] leading-relaxed text-text">
          <Check aria-hidden className="mt-1 size-4 shrink-0 text-gold" strokeWidth={1.75} />
          <span>{point}</span>
        </li>
      ))}
    </ul>
  );
}
