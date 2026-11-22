"use client";
// /hesap/giris form. Signs in through signInAction (Better Auth in-process, durable limits); on
// success the header badge gets the merged cart count and the page does a full load to `sonra`, so
// the header and every viewer island start over as the signed-in customer.

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { TextField } from "@/components/checkout/fields";
import { publishCartCount } from "@/components/store/cart-count";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { signInAction, type AuthFormState } from "@/lib/account/auth-actions";
import { focusFormProblem, FormAlert, PasswordField, SubmitButton, submitWithoutReset } from "./ui";

const INITIAL: AuthFormState = { status: "idle", attempt: 0 };

type Props = {
  locale: Locale;
  sonra: string | null;
  labels: Messages["auth"];
  forgotHref: string;
  /** Shown above the form (e.g. after a password reset). */
  notice?: string | null;
  /**
   * The request already has a session: right after this form's own sign-in (the session cookie
   * re-renders the page in the action response) or for a visitor who is signed in. Go on to
   * `continueTo` with a full page load.
   */
  signedIn: boolean;
  continueTo: string;
};

export default function SignInForm({ locale, sonra, labels, forgotHref, notice, signedIn, continueTo }: Props) {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL);
  const alertRef = useRef<HTMLDivElement>(null);
  const m = labels.signIn;
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  const done = (state.status === "success" && Boolean(state.redirectTo)) || signedIn;

  useEffect(() => {
    if (state.status === "success" && state.redirectTo) {
      publishCartCount(state.cartCount ?? 0);
      window.location.assign(state.redirectTo);
    } else if (signedIn) {
      window.location.assign(continueTo);
    } else if (state.status === "error") {
      focusFormProblem(alertRef.current, Boolean(state.formError));
    }
  }, [state, signedIn, continueTo]);

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} noValidate className="space-y-6" aria-busy={pending || done}>
      <input type="hidden" name="locale" value={locale} />
      {sonra ? <input type="hidden" name="sonra" value={sonra} /> : null}

      <div ref={alertRef} tabIndex={-1} aria-live="assertive" className="space-y-3 focus:outline-none empty:hidden">
        {state.status === "error" && state.formError ? <FormAlert tone="error">{state.formError}</FormAlert> : null}
        {done ? <FormAlert tone="success">{m.signedIn}</FormAlert> : null}
        {!done && state.status === "idle" && notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
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
        defaultValue={values.email}
        error={errors.email}
      />
      <PasswordField
        name="password"
        label={m.password}
        labels={labels.password}
        autoComplete="current-password"
        error={errors.password}
        labelAside={
          <Link href={forgotHref} className="text-sm text-text-muted underline decoration-border underline-offset-4 hover:text-text hover:decoration-gold">
            {m.forgot}
          </Link>
        }
      />
      <SubmitButton pending={pending || done} label={m.submit} pendingLabel={m.submitting} />
      <p className="sr-only" aria-live="polite">
        {pending ? m.submitting : ""}
      </p>
    </form>
  );
}
