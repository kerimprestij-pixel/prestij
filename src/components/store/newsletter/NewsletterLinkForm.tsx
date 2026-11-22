"use client";
// The button of /bulten/onay (confirm) and /bulten/ayril (unsubscribe). A click on purpose: corporate
// mail filters and link scanners open e-mail links by themselves, which must neither confirm a
// subscription (no real consent) nor unsubscribe a reader.

import { AlertCircle, ArrowRight, CircleCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { confirmNewsletterAction, unsubscribeNewsletterAction, type NewsletterLinkState } from "@/app/[locale]/actions/newsletter";
import { buttonClass } from "@/components/sections/button-styles";

const initialState: NewsletterLinkState = { status: "idle" };

type Labels = {
  title: string;
  text: string;
  submit: string;
  submitting: string;
  successTitle: string;
  successText: string;
  invalidTitle: string;
  invalidText: string;
  error: string;
};

type NewsletterLinkFormProps = {
  kind: "confirm" | "unsubscribe";
  token: string;
  labels: Labels;
  /** Links shown after the action (e.g. products, home). */
  links: { href: string; label: string; primary?: boolean }[];
};

export default function NewsletterLinkForm({ kind, token, labels, links }: NewsletterLinkFormProps) {
  const [state, formAction, pending] = useActionState(kind === "confirm" ? confirmNewsletterAction : unsubscribeNewsletterAction, initialState);

  if (state.status === "done" || state.status === "invalid") {
    const done = state.status === "done";
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-3xl leading-tight text-balance text-text md:text-4xl">{done ? labels.successTitle : labels.invalidTitle}</h1>
        <p
          role="status"
          className={
            done
              ? "flex items-start gap-3 rounded-md border border-emerald-700/25 bg-emerald-700/5 px-4 py-3 text-start text-sm leading-relaxed text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"
              : "flex items-start gap-3 rounded-md border border-border bg-surface-2 px-4 py-3 text-start text-sm leading-relaxed text-text"
          }
        >
          {done ? (
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          ) : (
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-text-muted" strokeWidth={1.75} />
          )}
          <span>{done ? labels.successText : labels.invalidText}</span>
        </p>
        <LinkRow links={links} />
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <h1 className="font-heading text-3xl leading-tight text-balance text-text md:text-4xl">{labels.title}</h1>
      <p className="mx-auto max-w-md text-base leading-relaxed text-pretty text-text-muted">{labels.text}</p>
      <input type="hidden" name="token" value={token} />
      <div role="alert" aria-live="assertive">
        {state.status === "error" ? (
          <p className="flex items-start gap-3 rounded-md border border-red-700/25 bg-red-700/5 px-4 py-3 text-start text-sm leading-relaxed text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            <span>{labels.error}</span>
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass(kind === "confirm" ? "primary" : "secondary", "w-full rtl:tracking-normal")}
      >
        {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} /> : null}
        <span>{pending ? labels.submitting : labels.submit}</span>
        {!pending && kind === "confirm" ? <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} /> : null}
      </button>
    </form>
  );
}

export function LinkRow({ links }: { links: NewsletterLinkFormProps["links"] }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={buttonClass(l.primary ? "primary" : "secondary", "rtl:tracking-normal")}>
          {l.label}
        </Link>
      ))}
    </div>
  );
}
