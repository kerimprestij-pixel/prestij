"use client";
// The confirm button of /hesap/dogrula. Verification needs a click on purpose: mail link scanners
// (corporate filters, Outlook Safe Links) open links automatically and would otherwise use up the
// sign-in that comes with a successful verification. After success: a full page load to the return
// path, so the storefront (header, viewer state) starts over as the signed-in customer.

import { AlertCircle, ArrowRight, CircleCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect } from "react";
import { verifyEmailAction, type VerifyEmailState } from "@/app/[locale]/hesap/dogrula/actions";
import { buttonClass } from "@/components/sections/button-styles";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";

const initialState: VerifyEmailState = { status: "idle" };

type VerifyEmailFormProps = {
  locale: Locale;
  token: string;
  sonra: string | null;
  signInHref: string;
  labels: Messages["auth"]["verify"];
};

export default function VerifyEmailForm({ locale, token, sonra, signInHref, labels }: VerifyEmailFormProps) {
  const [state, formAction, pending] = useActionState(verifyEmailAction, initialState);
  const failed = state.status === "error";
  const verified = state.status === "verified" && state.redirectTo;

  useEffect(() => {
    if (state.status === "verified" && state.redirectTo) window.location.replace(state.redirectTo);
  }, [state]);

  if (verified) {
    return (
      <div className="space-y-6">
        <p role="status" className="flex items-start gap-3 rounded-md border border-emerald-700/25 bg-emerald-700/5 px-4 py-3 text-sm leading-relaxed text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span>{state.message}</span>
        </p>
        <a href={state.redirectTo} className={buttonClass("primary", "w-full rtl:tracking-normal")}>
          <span>{labels.continue}</span>
          <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      {sonra ? <input type="hidden" name="sonra" value={sonra} /> : null}

      <div role="alert" aria-live="assertive">
        {failed && state.message ? (
          <p className="flex items-start gap-3 rounded-md border border-red-700/25 bg-red-700/5 px-4 py-3 text-sm leading-relaxed text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            <span>{state.message}</span>
          </p>
        ) : null}
      </div>

      {failed && state.code !== "failed" ? (
        <Link href={signInHref} className={buttonClass("primary", "w-full rtl:tracking-normal")}>
          <span>{labels.goToSignIn}</span>
          <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
        </Link>
      ) : (
        <button type="submit" disabled={pending} className={buttonClass("primary", "w-full rtl:tracking-normal")}>
          {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} /> : null}
          <span>{pending ? labels.submitting : labels.submit}</span>
          {!pending && <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />}
        </button>
      )}

      <p className="text-center text-xs leading-relaxed text-text-muted">{labels.help}</p>
    </form>
  );
}
