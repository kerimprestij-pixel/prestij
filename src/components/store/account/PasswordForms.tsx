"use client";
// /hesap/sifremi-unuttum (request a reset link) and /hesap/sifre-sifirla (set the new password).
// The forgot form always answers the same, whether or not the address has an account.

import { KeyRound, MailCheck } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { TextField } from "@/components/checkout/fields";
import { buttonClass } from "@/components/sections/button-styles";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { forgotPasswordAction, resetPasswordAction, type AuthFormState } from "@/lib/account/auth-actions";
import { AuthHeading } from "./AuthShell";
import { focusFormProblem, FormAlert, PasswordField, SubmitButton, submitWithoutReset } from "./ui";

const INITIAL: AuthFormState = { status: "idle", attempt: 0 };

function SuccessPanel({ icon: Icon, eyebrow, title, text, action }: { icon: typeof MailCheck; eyebrow: string; title: string; text: string; action: { href: string; label: string } }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="text-center" role="status">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-gold/12 text-gold-text">
        <Icon aria-hidden className="size-7" strokeWidth={1.5} />
      </span>
      <p className="eyebrow mt-6">{eyebrow}</p>
      <h1 ref={ref} tabIndex={-1} className="mt-3 font-heading text-4xl leading-tight text-balance text-text focus:outline-none">
        {title}
      </h1>
      <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-pretty text-text-muted">{text}</p>
      <Link href={action.href} className={buttonClass("secondary", "mt-8 rtl:tracking-normal")}>
        {action.label}
      </Link>
    </div>
  );
}

export function ForgotPasswordForm({ locale, labels, signInHref }: { locale: Locale; labels: Messages["auth"]; signInHref: string }) {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, INITIAL);
  const alertRef = useRef<HTMLDivElement>(null);
  const m = labels.forgot;
  useEffect(() => {
    if (state.status === "error") focusFormProblem(alertRef.current, Boolean(state.formError));
  }, [state]);

  if (state.status === "success") {
    return <SuccessPanel icon={MailCheck} eyebrow={m.eyebrow} title={m.successTitle} text={m.successText} action={{ href: signInHref, label: m.back }} />;
  }
  return (
    <>
      <AuthHeading eyebrow={m.eyebrow} heading={m.heading} intro={m.intro} />
      <form action={formAction} onSubmit={submitWithoutReset(formAction)} noValidate className="space-y-6" aria-busy={pending}>
        <input type="hidden" name="locale" value={locale} />
        <div ref={alertRef} tabIndex={-1} aria-live="assertive" className="focus:outline-none empty:hidden">
          {state.status === "error" && state.formError ? <FormAlert tone="error">{state.formError}</FormAlert> : null}
        </div>
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
          defaultValue={state.values?.email}
          error={state.fieldErrors?.email}
        />
        <SubmitButton pending={pending} label={m.submit} pendingLabel={m.submitting} />
        <p className="text-center text-sm">
          <Link href={signInHref} className="text-text-muted underline decoration-border underline-offset-4 hover:text-text hover:decoration-gold">
            {m.back}
          </Link>
        </p>
      </form>
    </>
  );
}

export function ResetPasswordForm({ locale, token, labels, forgotHref }: { locale: Locale; token: string; labels: Messages["auth"]; forgotHref: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL);
  const alertRef = useRef<HTMLDivElement>(null);
  const m = labels.reset;
  const done = state.status === "success" && state.redirectTo;
  useEffect(() => {
    if (state.status === "success" && state.redirectTo) window.location.assign(state.redirectTo);
    else if (state.status === "error") focusFormProblem(alertRef.current, Boolean(state.formError));
  }, [state]);

  if (state.status === "error" && state.errorCode === "invalidToken") {
    return <SuccessPanel icon={KeyRound} eyebrow={m.eyebrow} title={m.missingHeading} text={state.formError ?? m.missingText} action={{ href: forgotHref, label: m.requestNew }} />;
  }
  return (
    <>
      <AuthHeading eyebrow={m.eyebrow} heading={m.heading} intro={m.intro} />
      <form action={formAction} onSubmit={submitWithoutReset(formAction)} noValidate className="space-y-6" aria-busy={pending || Boolean(done)}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="token" value={token} />
        <div ref={alertRef} tabIndex={-1} aria-live="assertive" className="focus:outline-none empty:hidden">
          {state.status === "error" && state.formError ? <FormAlert tone="error">{state.formError}</FormAlert> : null}
          {done ? <FormAlert tone="success">{labels.signIn.resetDone}</FormAlert> : null}
        </div>
        <PasswordField name="password" label={m.password} labels={labels.password} autoComplete="new-password" meter error={state.fieldErrors?.password} />
        <PasswordField name="confirm" label={m.confirm} labels={labels.password} autoComplete="new-password" error={state.fieldErrors?.confirm} />
        <SubmitButton pending={pending || Boolean(done)} label={m.submit} pendingLabel={m.submitting} />
      </form>
    </>
  );
}
