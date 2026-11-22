"use client";
// /hesap/kayit form: name, e-mail, optional mobile, password (strength hint), the required membership
// agreement, the KVKK notice and an optional, unticked commercial e-mail consent (newsletter double
// opt-in; only while the newsletter is on, go-live SR-1). Success replaces the form with "check your
// inbox" (the same answer whether or not the address already had an account); the newsletter line only
// when the server says a confirmation was requested and accepted (state.marketing).

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { CheckboxField, TextField, fieldId } from "@/components/checkout/fields";
import { buttonClass } from "@/components/sections/button-styles";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { registerAction, type AuthFormState } from "@/lib/account/auth-actions";
import { AuthHeading } from "./AuthShell";
import { textLinkClass, withLink } from "./styles";
import { focusFormProblem, FormAlert, PasswordField, SubmitButton, submitWithoutReset } from "./ui";

const INITIAL: AuthFormState = { status: "idle", attempt: 0 };

import { REGISTER_EMAIL_KEY } from "./storage-keys";

type Props = {
  locale: Locale;
  sonra: string | null;
  labels: Messages["auth"];
  membershipHref: string;
  kvkkHref: string;
  signInHref: string;
  newTabHint: string;
  optionalLabel: string;
  /** settings.newsletter.enabled: false hides the commercial e-mail box (the server ignores the field then). */
  newsletterOptIn: boolean;
};

export default function RegisterForm({ locale, sonra, labels, membershipHref, kvkkHref, signInHref, newTabHint, optionalLabel, newsletterOptIn }: Props) {
  const [state, formAction, pending] = useActionState(registerAction, INITIAL);
  const alertRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const m = labels.register;
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};

  // E-mail handed over by the guest order page (after hydration, so server and client HTML match).
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(REGISTER_EMAIL_KEY) ?? "";
      const input = document.getElementById(fieldId("email"));
      if (input instanceof HTMLInputElement && !input.value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stored)) input.value = stored.slice(0, 254);
    } catch {
      // storage unavailable
    }
  }, []);

  useEffect(() => {
    if (state.status === "error") focusFormProblem(alertRef.current, Boolean(state.formError));
    if (state.status === "success") {
      successRef.current?.focus();
      try {
        window.sessionStorage.removeItem(REGISTER_EMAIL_KEY);
      } catch {
        // storage unavailable
      }
    }
  }, [state]);

  if (state.status === "success") {
    return (
      <div className="text-center" role="status">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-gold/12 text-gold-text">
          <MailCheck aria-hidden className="size-7" strokeWidth={1.5} />
        </span>
        <p className="eyebrow mt-6">{m.successEyebrow}</p>
        <h1 ref={successRef} tabIndex={-1} className="mt-3 font-heading text-4xl leading-tight text-balance text-text focus:outline-none">
          {m.successTitle}
        </h1>
        <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-pretty text-text">
          {withLink(format(m.successText, { email: "{link}" }), <bdi dir="ltr" className="font-medium break-all">{state.email ?? ""}</bdi>)}
        </p>
        {state.marketing ? <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-muted">{m.successMarketing}</p> : null}
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-muted">{m.successHint}</p>
        <Link href={signInHref} className={buttonClass("secondary", "mt-8 rtl:tracking-normal")}>
          {m.backToSignIn}
        </Link>
      </div>
    );
  }

  return (
    <>
    <AuthHeading eyebrow={m.eyebrow} heading={m.heading} intro={m.intro} />
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} noValidate className="space-y-6" aria-busy={pending}>
      <input type="hidden" name="locale" value={locale} />
      {sonra ? <input type="hidden" name="sonra" value={sonra} /> : null}
      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden className="sr-only">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div ref={alertRef} tabIndex={-1} aria-live="assertive" className="focus:outline-none empty:hidden">
        {state.status === "error" && state.formError ? <FormAlert tone="error">{state.formError}</FormAlert> : null}
      </div>

      <TextField name="name" label={m.name} autoComplete="name" maxLength={100} required defaultValue={values.name} error={errors.name} />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          name="email"
          label={m.email}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          dir="ltr"
          maxLength={254}
          required
          defaultValue={values.email}
          error={errors.email}
        />
        <TextField
          name="phone"
          label={m.phone}
          optionalLabel={optionalLabel}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          maxLength={20}
          placeholder="05xx xxx xx xx"
          hint={m.phoneHint}
          defaultValue={values.phone}
          error={errors.phone}
        />
      </div>
      <PasswordField name="password" label={m.password} labels={labels.password} autoComplete="new-password" meter error={errors.password} />

      <div className="space-y-4 border-t border-border pt-6">
        <CheckboxField
          name="terms"
          defaultChecked={values.terms === "on"}
          error={errors.terms}
          accessibleName={m.terms.replace("{link}", m.termsLink)}
          label={withLink(
            m.terms,
            <a href={membershipHref} target="_blank" rel="noopener" className={textLinkClass}>
              {m.termsLink}
              <span className="sr-only"> {newTabHint}</span>
            </a>,
          )}
        />
        <p className="ps-8 text-xs leading-relaxed text-text-muted">
          {withLink(
            m.kvkk,
            <a href={kvkkHref} target="_blank" rel="noopener" className={textLinkClass}>
              {m.kvkkLink}
              <span className="sr-only"> {newTabHint}</span>
            </a>,
          )}
        </p>
        {newsletterOptIn ? <CheckboxField name="marketing" defaultChecked={values.marketing === "on"} label={m.marketing} hint={m.marketingHint} /> : null}
      </div>

      <SubmitButton pending={pending} label={m.submit} pendingLabel={m.submitting} />
      <p className="sr-only" aria-live="polite">
        {pending ? m.submitting : ""}
      </p>
    </form>
    </>
  );
}
