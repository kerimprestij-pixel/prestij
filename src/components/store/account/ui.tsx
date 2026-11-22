"use client";
// Small building blocks shared by the auth and account forms. The inputs reuse the checkout's field
// styles (src/components/checkout/fields.tsx), so every storefront form looks the same.

import { AlertCircle, CircleCheck, Eye, EyeOff, Info, LoaderCircle } from "lucide-react";
import { startTransition, useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { FieldError, fieldId, inputClass } from "@/components/checkout/fields";
import { buttonClass } from "@/components/sections/button-styles";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { PASSWORD_MAX, PASSWORD_MIN, passwordStrength } from "@/lib/account/schemas";
import { cn } from "@/lib/utils";

/**
 * After a failed submit: the form-level alert when there is one, otherwise the first invalid field
 * (field errors only leave the alert empty and display:none, and focus would fall back to <body>).
 */
export function focusFormProblem(alert: HTMLElement | null, hasFormError: boolean): void {
  if (!alert) return;
  if (!hasFormError) {
    const field = alert.closest("form")?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (field) {
      field.focus();
      return;
    }
  }
  alert.focus();
}

/**
 * onSubmit for a useActionState form: dispatches the action ourselves, so React does not reset the
 * fields afterwards (a reset would put controlled radios back to their first value and empty what the
 * customer typed after an error). `action={formAction}` stays on the form for submits without JS.
 */
export function submitWithoutReset(formAction: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
}

export function FormAlert({ tone, children, id }: { tone: "error" | "success" | "info"; children: ReactNode; id?: string }) {
  const Icon = tone === "error" ? AlertCircle : tone === "success" ? CircleCheck : Info;
  return (
    <p
      id={id}
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-sm leading-relaxed",
        tone === "error" && "border-red-700/25 bg-red-700/5 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300",
        tone === "success" && "border-emerald-700/25 bg-emerald-700/5 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
        tone === "info" && "border-gold/40 bg-gold/8 text-text",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <span>{children}</span>
    </p>
  );
}

export function SubmitButton({ pending, label, pendingLabel, className, disabled }: { pending: boolean; label: string; pendingLabel: string; className?: string; disabled?: boolean }) {
  return (
    <button type="submit" disabled={pending || disabled} aria-disabled={pending || disabled} className={buttonClass("primary", cn("w-full rtl:tracking-normal", className))}>
      {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} /> : null}
      <span>{pending ? pendingLabel : label}</span>
    </button>
  );
}

type PasswordLabels = Messages["auth"]["password"];

const STRENGTH_KEYS = ["weak", "weak", "fair", "good", "strong"] as const;

/**
 * Password input with show/hide, a Caps Lock warning and (for new passwords) a strength meter. The
 * strength is a hint only: the server enforces the length rules.
 */
export function PasswordField({
  name,
  label,
  labels,
  error,
  autoComplete,
  meter = false,
  labelAside,
  defaultValue,
  required = true,
}: {
  name: string;
  label: string;
  labels: PasswordLabels;
  error?: string | null;
  autoComplete: "current-password" | "new-password";
  /** New password: strength meter and the length hint. */
  meter?: boolean;
  /** Next to the label (e.g. "Şifremi unuttum"). */
  labelAside?: ReactNode;
  defaultValue?: string;
  required?: boolean;
}) {
  const id = fieldId(name);
  const hintId = `${id}-hint`;
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState(defaultValue ?? "");
  const [caps, setCaps] = useState(false);
  const strength = meter ? passwordStrength(value) : 0;
  const level = labels[STRENGTH_KEYS[strength]];
  const meterId = useId();
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => setCaps(event.getModifierState?.("CapsLock") ?? false);
  const describedBy = [error ? `${id}-error` : null, meter ? hintId : null, meter && value ? meterId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="block text-sm font-medium text-text">
          {label}
        </label>
        {labelAside}
      </div>
      {/* Passwords stay left-to-right in every language: the toggle sits at the right edge. */}
      <div className="relative" dir="ltr">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          aria-required={required || undefined}
          minLength={meter ? PASSWORD_MIN : undefined}
          maxLength={PASSWORD_MAX}
          dir="ltr"
          spellCheck={false}
          autoCapitalize="off"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyUp={onKey}
          onKeyDown={onKey}
          onBlur={() => setCaps(false)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(inputClass, "pe-14")}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? labels.hide : labels.show}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 end-0 flex w-12 items-center justify-center rounded-e-control text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {visible ? <EyeOff aria-hidden className="size-4.5" strokeWidth={1.75} /> : <Eye aria-hidden className="size-4.5" strokeWidth={1.75} />}
        </button>
      </div>
      <FieldError id={id} error={error} />
      {caps ? (
        <p role="status" className="mt-2 text-xs font-medium text-gold-text">
          {labels.capsLock}
        </p>
      ) : null}
      {meter ? (
        <div className="mt-2.5">
          {value ? (
            <div id={meterId} className="flex items-center gap-3">
              <div aria-hidden className="grid flex-1 grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((step) => (
                  <span
                    key={step}
                    className={cn(
                      "h-1 rounded-full transition-colors duration-300 motion-reduce:transition-none",
                      strength >= step
                        ? strength <= 1
                          ? "bg-red-600 dark:bg-red-400"
                          : strength === 2
                            ? "bg-gold"
                            : "bg-emerald-600 dark:bg-emerald-400"
                        : "bg-border",
                    )}
                  />
                ))}
              </div>
              <span className="min-w-14 text-end text-xs text-text-muted" aria-live="polite">
                <span className="sr-only">{labels.strength}: </span>
                {level}
              </span>
            </div>
          ) : null}
          <p id={hintId} className="mt-2 text-xs leading-relaxed text-text-muted">
            {format(labels.hint, { min: PASSWORD_MIN })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

