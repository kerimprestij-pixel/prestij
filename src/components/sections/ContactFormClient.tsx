"use client";

// Contact form (progressively enhanced: it posts to the Server Action without JS too). `?konu=` is read
// with useSearchParams inside <Suspense>, so the static page prerenders the form with the first subject
// and the browser preselects the requested one ("teklif" → quote, "numune" → sample).
import { AlertCircle, ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useEffect, useRef, useState } from "react";
import { sendContactMessage } from "@/app/[locale]/iletisim/actions";
import { fieldId, TextAreaField, TextField } from "@/components/checkout/fields";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { isContactSubject, subjectFromParam, type ContactSubject } from "@/lib/contact/subjects";
import {
  CONTACT_LIMITS,
  INITIAL_CONTACT_STATE,
  type ContactField,
  type ContactFieldError,
  type ContactFormState,
} from "@/lib/contact/types";
import { cn } from "@/lib/utils";
import { buttonClass } from "./button-styles";

export type ContactFormLabels = {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  submit: string;
  submitting: string;
  success: string;
  successTitle: string;
  sendAnother: string;
  namePlaceholder: string;
  emailPlaceholder: string;
  phonePlaceholder: string;
  phoneHint: string;
  placeholders: Record<ContactSubject, string>;
  errorSummary: string;
  invalidName: string;
  messageTooShort: string;
  tooLong: string;
  tooMany: string;
  error: string;
  privacy: string;
  privacyLink: string;
  optional: string;
  required: string;
  invalidEmail: string;
  invalidPhone: string;
};

type Props = {
  locale: Locale;
  subjects: { key: ContactSubject; label: string }[];
  labels: ContactFormLabels;
  /** Public URL of the KVKK notice. */
  privacyHref: string;
};

const FIELD_ORDER: ContactField[] = ["name", "email", "phone", "subject", "message"];
const MAX: Record<ContactField, number> = {
  name: CONTACT_LIMITS.name,
  email: CONTACT_LIMITS.email,
  phone: CONTACT_LIMITS.phone,
  subject: 40,
  message: CONTACT_LIMITS.message,
};

export default function ContactFormClient(props: Props) {
  const first = props.subjects[0]?.key ?? "general";
  return (
    <Suspense fallback={<ContactFormShell {...props} initialSubject={first} />}>
      <ContactFormFromParams {...props} />
    </Suspense>
  );
}

function ContactFormFromParams(props: Props) {
  const params = useSearchParams();
  const requested = subjectFromParam(params.get("konu"));
  const preselected = requested && props.subjects.some((s) => s.key === requested) ? requested : null;
  return <ContactFormShell {...props} initialSubject={preselected ?? props.subjects[0]?.key ?? "general"} scrollToForm={preselected !== null} />;
}

/** Holds the "write another message" reset: a new round remounts the form with a fresh action state. */
function ContactFormShell(props: Props & { initialSubject: ContactSubject; scrollToForm?: boolean }) {
  const [round, setRound] = useState(0);
  return <ContactFormBody key={round} {...props} onReset={() => setRound((r) => r + 1)} />;
}

function ContactFormBody({
  locale,
  subjects,
  labels,
  privacyHref,
  initialSubject,
  scrollToForm,
  onReset,
}: Props & { initialSubject: ContactSubject; scrollToForm?: boolean; onReset: () => void }) {
  const [state, formAction, pending] = useActionState<ContactFormState, FormData>(sendContactMessage, INITIAL_CONTACT_STATE);
  const [subject, setSubject] = useState<ContactSubject>(initialSubject);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  // Arriving from a "?konu=…" link (e.g. "Teklif isteyin"): bring the form into view.
  useEffect(() => {
    const form = formRef.current;
    if (!scrollToForm || !form) return;
    if (form.getBoundingClientRect().top < window.innerHeight * 0.55) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Phones: straight to the fields (the intro sits above them); wider screens: the whole section.
    const target = window.matchMedia("(min-width: 64rem)").matches ? (form.closest("section") ?? form) : form;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [scrollToForm]);

  // After each answer: focus the success message, the first invalid field or the error banner.
  useEffect(() => {
    if (state.attempt === 0) return;
    if (state.status === "success") {
      successRef.current?.focus();
      return;
    }
    const invalid = FIELD_ORDER.find((f) => state.fieldErrors?.[f]);
    if (invalid) document.getElementById(fieldId(invalid))?.focus();
    else alertRef.current?.focus();
  }, [state]);

  if (state.status === "success") {
    return (
      <div role="status" className="flex flex-col items-start py-4 sm:py-8">
        <span className="grid size-14 place-items-center rounded-full border border-gold/50 text-gold-text">
          <Check aria-hidden className="size-6" strokeWidth={1.5} />
        </span>
        <h3 ref={successRef} tabIndex={-1} className="mt-7 font-heading text-3xl text-text focus:outline-none md:text-4xl">
          {labels.successTitle}
        </h3>
        <p className="mt-4 max-w-md text-base leading-relaxed text-text-muted">{labels.success}</p>
        <button type="button" onClick={onReset} className={buttonClass("link", "mt-10")}>
          {labels.sendAnother}
        </button>
      </div>
    );
  }

  const errorFor = (field: ContactField): string | null => {
    const code: ContactFieldError | undefined = state.fieldErrors?.[field];
    if (!code) return null;
    switch (code) {
      case "required":
        return labels.required;
      case "invalid_name":
        return labels.invalidName;
      case "invalid_email":
        return labels.invalidEmail;
      case "invalid_phone":
        return labels.invalidPhone;
      case "too_short":
        return format(labels.messageTooShort, { min: CONTACT_LIMITS.messageMin }, locale);
      case "too_long":
        return format(labels.tooLong, { max: MAX[field] }, locale);
    }
  };

  const banner =
    state.status !== "error"
      ? null
      : state.error === "too_many"
        ? format(labels.tooMany, { minutes: state.retryMinutes ?? 60 }, locale)
        : state.error === "server"
          ? labels.error
          : labels.errorSummary;

  const [privacyBefore, privacyAfter = ""] = labels.privacy.split("{link}");
  const values = state.values;
  const echoedSubject = values && isContactSubject(values.subject) ? values.subject : null;

  return (
    <form ref={formRef} action={formAction} noValidate className="scroll-mt-36 space-y-7">
      <input type="hidden" name="locale" value={locale} />
      {/* Honeypot: hidden from people and assistive tech; bots fill it and their message is dropped. */}
      <div aria-hidden="true" className="sr-only">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div
        ref={alertRef}
        tabIndex={-1}
        aria-live="polite"
        className={cn(
          "focus:outline-none",
          banner && "flex items-start gap-3 rounded-md border border-red-700/30 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200",
        )}
      >
        {banner && (
          <>
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            <span>{banner}</span>
          </>
        )}
      </div>

      {/* Keyed by attempt: after an error the inputs remount with the echoed values. */}
      <div key={state.attempt} className="space-y-7">
        <div className="grid gap-7 sm:grid-cols-2 sm:gap-5">
          <TextField
            name="name"
            label={labels.name}
            autoComplete="name"
            placeholder={labels.namePlaceholder}
            maxLength={CONTACT_LIMITS.name}
            defaultValue={values?.name ?? ""}
            required
            error={errorFor("name")}
          />
          <TextField
            name="email"
            type="email"
            label={labels.email}
            autoComplete="email"
            inputMode="email"
            placeholder={labels.emailPlaceholder}
            maxLength={CONTACT_LIMITS.email}
            defaultValue={values?.email ?? ""}
            required
            dir="ltr"
            spellCheck={false}
            autoCapitalize="none"
            error={errorFor("email")}
          />
        </div>
        <TextField
          name="phone"
          type="tel"
          label={labels.phone}
          optionalLabel={labels.optional}
          autoComplete="tel"
          inputMode="tel"
          placeholder={labels.phonePlaceholder}
          maxLength={CONTACT_LIMITS.phone}
          defaultValue={values?.phone ?? ""}
          dir="ltr"
          hint={labels.phoneHint}
          error={errorFor("phone")}
          className="sm:max-w-[calc(50%-0.625rem)]"
        />

        {subjects.length > 1 ? (
          <fieldset>
            <legend className="mb-3 block text-sm font-medium text-text">{labels.subject}</legend>
            <div className="flex flex-wrap gap-2">
              {subjects.map((s) => (
                <label key={s.key} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="subject"
                    value={s.key}
                    checked={subject === s.key}
                    onChange={() => setSubject(s.key)}
                    className="peer absolute inset-0 size-full cursor-pointer appearance-none rounded-full opacity-0"
                  />
                  <span
                    className={cn(
                      "pointer-events-none inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-sm transition-colors duration-200 motion-reduce:transition-none",
                      "border-border text-text-muted peer-hover:border-gold peer-hover:text-text",
                      "peer-checked:border-brand peer-checked:bg-brand peer-checked:text-brand-contrast",
                      "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                    )}
                  >
                    {subject === s.key && <Check aria-hidden className="size-3.5" strokeWidth={2} />}
                    {s.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <input type="hidden" name="subject" value={subjects[0]?.key ?? echoedSubject ?? "general"} />
        )}

        <MessageField
          label={labels.message}
          placeholder={labels.placeholders[subject]}
          defaultValue={values?.message ?? ""}
          error={errorFor("message")}
          locale={locale}
        />
      </div>

      <div className="flex flex-col gap-6 border-t border-border pt-7 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-sm text-xs leading-relaxed text-text-muted">
          {privacyBefore}
          <Link
            href={privacyHref}
            className="text-text underline decoration-gold/60 underline-offset-4 hover:decoration-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {labels.privacyLink}
          </Link>
          {privacyAfter}
        </p>
        <button type="submit" disabled={pending} aria-disabled={pending || undefined} className={buttonClass("primary", "w-full shrink-0 sm:w-auto")}>
          <span>{pending ? labels.submitting : labels.submit}</span>
          <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
        </button>
      </div>
    </form>
  );
}

/** Message textarea with a live counter near the limit; the placeholder follows the chosen subject. */
function MessageField({
  label,
  placeholder,
  defaultValue,
  error,
  locale,
}: {
  label: string;
  placeholder: string;
  defaultValue: string;
  error: string | null;
  locale: Locale;
}) {
  const [length, setLength] = useState(defaultValue.length);
  const max = CONTACT_LIMITS.message;
  const counter = length > max * 0.8 ? `${length.toLocaleString(locale === "ar" ? "ar-u-nu-latn" : locale)}/${max.toLocaleString(locale === "ar" ? "ar-u-nu-latn" : locale)}` : undefined;
  return (
    <div onInput={(e) => setLength((e.target as HTMLTextAreaElement).value.length)}>
      <TextAreaField
        name="message"
        label={label}
        placeholder={placeholder}
        maxLength={max}
        rows={6}
        defaultValue={defaultValue}
        error={error}
        counter={counter}
      />
    </div>
  );
}
