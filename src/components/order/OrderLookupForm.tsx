"use client";
// Order lookup (/siparis): order number + e-mail → the order's token link. Errors: format hints per
// field, otherwise one generic message (the server never says which of the two was wrong).

import { AlertCircle, ArrowRight, LoaderCircle } from "lucide-react";
import { useActionState, useId } from "react";
import { lookupOrderAction, type LookupState } from "@/app/[locale]/siparis/actions";
import { buttonClass } from "@/components/sections/button-styles";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { cn } from "@/lib/utils";

const inputClass = cn(
  "block min-h-12 w-full rounded-control border border-border bg-surface px-4 py-3 text-base text-text transition-[border-color,box-shadow] duration-200",
  "placeholder:text-text-muted/75 hover:border-border-strong/60 rtl:text-right",
  "focus:border-ring focus:outline-none focus:ring-3 focus:ring-ring/25",
  "aria-[invalid=true]:border-red-700 aria-[invalid=true]:focus:ring-red-700/20 dark:aria-[invalid=true]:border-red-400",
);
const errorClass = "mt-2 flex items-start gap-1.5 text-sm leading-snug text-red-700 dark:text-red-400";

const initialState: LookupState = { status: "idle" };

type OrderLookupFormProps = { locale: Locale; labels: Messages["order"]["lookup"] };

export default function OrderLookupForm({ locale, labels }: OrderLookupFormProps) {
  const [state, formAction, pending] = useActionState(lookupOrderAction, initialState);
  const id = useId();
  const numberId = `${id}-number`;
  const emailId = `${id}-email`;
  const numberError = state.fieldErrors?.orderNumber;
  const emailError = state.fieldErrors?.email;

  return (
    <form action={formAction} noValidate className="space-y-6">
      <input type="hidden" name="locale" value={locale} />
      {/* Honeypot: hidden from people and assistive tech. */}
      <div aria-hidden="true" className="sr-only">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div>
        <label htmlFor={numberId} className="mb-2 block text-sm font-medium text-text">
          {labels.orderNumber}
        </label>
        <input
          id={numberId}
          name="orderNumber"
          type="text"
          required
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          dir="ltr"
          placeholder={labels.orderNumberPlaceholder}
          defaultValue={state.values?.orderNumber ?? ""}
          aria-invalid={numberError ? true : undefined}
          aria-describedby={[numberError ? `${numberId}-error` : null, `${numberId}-hint`].filter(Boolean).join(" ")}
          className={cn(inputClass, "uppercase tracking-wide placeholder:normal-case")}
        />
        {numberError ? (
          <p id={`${numberId}-error`} className={errorClass}>
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            <span>{numberError}</span>
          </p>
        ) : null}
        <p id={`${numberId}-hint`} className="mt-2 text-xs leading-relaxed text-text-muted">
          {labels.orderNumberHint}
        </p>
      </div>

      <div>
        <label htmlFor={emailId} className="mb-2 block text-sm font-medium text-text">
          {labels.email}
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          required
          maxLength={254}
          autoComplete="email"
          spellCheck={false}
          dir="ltr"
          placeholder={labels.emailPlaceholder}
          defaultValue={state.values?.email ?? ""}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? `${emailId}-error` : undefined}
          className={inputClass}
        />
        {emailError ? (
          <p id={`${emailId}-error`} className={errorClass}>
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            <span>{emailError}</span>
          </p>
        ) : null}
      </div>

      <div role="alert" aria-live="assertive">
        {state.message ? (
          <p className="flex items-start gap-3 rounded-md border border-red-700/25 bg-red-700/5 px-4 py-3 text-sm leading-relaxed text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            <span>{state.message}</span>
          </p>
        ) : null}
      </div>

      <button type="submit" disabled={pending} className={buttonClass("primary", "w-full rtl:tracking-normal")}>
        {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} /> : null}
        <span>{pending ? labels.submitting : labels.submit}</span>
        {!pending && <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />}
      </button>
    </form>
  );
}
