"use client";
// /hesap/profil: personal details, password change (other sessions are signed out), commercial
// e-mail preference (newsletter double opt-in) and account deletion (anonymization, orders kept).

import { AlertTriangle, CircleCheck, LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { CheckboxField, SelectField, TextField } from "@/components/checkout/fields";
import { formatPhone } from "@/components/order/format";
import { buttonClass } from "@/components/sections/button-styles";
import { publishCartCount } from "@/components/store/cart-count";
import { useViewer } from "@/components/store/viewer/ViewerProvider";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { changePasswordAction, deleteAccountAction, setMarketingAction, updateProfileAction, type AccountFormState } from "@/lib/account/actions";
import type { MarketingState } from "@/lib/account/service";
import { cn } from "@/lib/utils";
import { panelClass, sectionTitleClass, textLinkClass, withLink } from "./styles";
import { FormAlert, PasswordField, SubmitButton, submitWithoutReset } from "./ui";

const INITIAL: AccountFormState = { status: "idle", attempt: 0 };

export type ProfileLabels = {
  page: Messages["account"]["profilePage"];
  auth: Messages["auth"];
  phone: string;
  name: string;
  optional: string;
  newTab: string;
  languages: { value: Locale; label: string }[];
};

type ProfileUser = { name: string; email: string; phone: string | null; locale: Locale };

function useFocusOnAnswer(state: AccountFormState) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status !== "idle") ref.current?.focus();
  }, [state]);
  return ref;
}

function Answer({ state, innerRef }: { state: AccountFormState; innerRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={innerRef} tabIndex={-1} aria-live="polite" className="focus:outline-none empty:hidden">
      {state.status === "error" && state.formError ? <FormAlert tone="error">{state.formError}</FormAlert> : null}
      {state.status === "success" && state.message ? <FormAlert tone="success">{state.message}</FormAlert> : null}
    </div>
  );
}

export function PersonalForm({ locale, user, labels }: { locale: Locale; user: ProfileUser; labels: ProfileLabels }) {
  const [state, formAction, pending] = useActionState(updateProfileAction, INITIAL);
  const ref = useFocusOnAnswer(state);
  const { refresh } = useViewer();
  // The header greeting shows the first name: reload the viewer after a saved change.
  useEffect(() => {
    if (state.status === "success") void refresh();
  }, [state, refresh]);
  const p = labels.page;
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const errors = state.fieldErrors ?? {};
  return (
    <section aria-labelledby="profile-personal" className={panelClass}>
      <h2 id="profile-personal" className={sectionTitleClass}>
        {p.personalTitle}
      </h2>
      <form action={formAction} onSubmit={submitWithoutReset(formAction)} noValidate className="mt-6 space-y-5" aria-busy={pending}>
        <input type="hidden" name="locale" value={locale} />
        <Answer state={state} innerRef={ref} />
        <div>
          <p className="mb-2 text-sm font-medium text-text">{p.emailLabel}</p>
          <p dir="ltr" className="flex min-h-12 items-center rounded-control border border-dashed border-border px-4 text-base text-text-muted rtl:justify-end">
            {user.email}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">{p.emailHint}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField name="name" label={labels.name} autoComplete="name" maxLength={100} required defaultValue={values.name ?? user.name} error={errors.name} />
          <TextField
            name="phone"
            label={labels.phone}
            optionalLabel={labels.optional}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            maxLength={20}
            placeholder="05xx xxx xx xx"
            defaultValue={values.phone ?? (user.phone ? formatPhone(user.phone) : "")}
            error={errors.phone}
          />
          <SelectField
            name="preferredLocale"
            label={p.preferredLocale}
            placeholder={p.preferredLocale}
            options={labels.languages}
            hint={p.preferredLocaleHint}
            required
            defaultValue={values.preferredLocale ?? user.locale}
            error={errors.preferredLocale}
          />
        </div>
        <div className="flex justify-end">
          <SubmitButton pending={pending} label={p.save} pendingLabel={p.saving} className="sm:w-auto" />
        </div>
      </form>
    </section>
  );
}

export function PasswordForm({ locale, email, labels }: { locale: Locale; email: string; labels: ProfileLabels }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, INITIAL);
  const ref = useFocusOnAnswer(state);
  const p = labels.page;
  const errors = state.fieldErrors ?? {};
  // A fresh form after a successful change (the controlled password inputs start empty again).
  const formKey = state.status === "success" ? `done-${state.attempt}` : "form";
  return (
    <section aria-labelledby="profile-password" className={panelClass}>
      <h2 id="profile-password" className={sectionTitleClass}>
        {p.passwordTitle}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">{p.passwordIntro}</p>
      <form key={formKey} action={formAction} onSubmit={submitWithoutReset(formAction)} noValidate className="mt-6 space-y-5" aria-busy={pending}>
        <input type="hidden" name="locale" value={locale} />
        {/* For password managers: which account this password belongs to. */}
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden tabIndex={-1} aria-hidden />
        <Answer state={state} innerRef={ref} />
        <PasswordField name="currentPassword" label={p.currentPassword} labels={labels.auth.password} autoComplete="current-password" error={errors.currentPassword} />
        <div className="grid gap-5 sm:grid-cols-2">
          <PasswordField name="newPassword" label={p.newPassword} labels={labels.auth.password} autoComplete="new-password" meter error={errors.newPassword} />
          <PasswordField name="confirm" label={p.confirmPassword} labels={labels.auth.password} autoComplete="new-password" error={errors.confirm} />
        </div>
        <div className="flex justify-end">
          <SubmitButton pending={pending} label={p.changePassword} pendingLabel={p.changingPassword} className="sm:w-auto" />
        </div>
      </form>
    </section>
  );
}

/**
 * Commercial e-mail preference. `newsletterOn` = settings.newsletter.enabled: while it is off (go-live
 * SR-1, until İYS) there is no subscribe / resend button and an "off" account reads "şu an kapalı";
 * withdrawing an existing consent always stays possible.
 */
export function MarketingPreference({ locale, initial, labels, newsletterOn }: { locale: Locale; initial: MarketingState; labels: ProfileLabels; newsletterOn: boolean }) {
  const p = labels.page;
  const [state, setState] = useState<MarketingState>(initial);
  const [answer, setAnswer] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: "subscribe" | "unsubscribe") =>
    startTransition(async () => {
      const r = await setMarketingAction({ locale, action });
      if (r.status === "success") {
        setState(r.marketing ?? state);
        setAnswer({ tone: "success", text: r.message ?? "" });
      } else setAnswer({ tone: "error", text: r.formError ?? "" });
    });
  const closedAndOff = !newsletterOn && state === "off";
  const text = state === "subscribed" ? p.marketingOn : state === "pending" ? p.marketingPending : closedAndOff ? p.marketingClosed : p.marketingOff;
  const canSubscribe = newsletterOn && state !== "subscribed";
  const canWithdraw = state !== "off";
  return (
    <section aria-labelledby="profile-marketing" className={panelClass}>
      <h2 id="profile-marketing" className={sectionTitleClass}>
        {p.marketingTitle}
      </h2>
      {closedAndOff ? null : <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">{p.marketingIntro}</p>}
      <div className="mt-6 flex flex-col gap-5 rounded-md bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <p className="flex items-start gap-3 text-sm leading-relaxed text-text">
          {state === "subscribed" ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" strokeWidth={1.75} /> : null}
          <span>{text}</span>
        </p>
        {canSubscribe || canWithdraw ? (
          <div className="flex shrink-0 flex-wrap gap-3">
            {canSubscribe ? (
              <button type="button" disabled={pending} onClick={() => run("subscribe")} className={buttonClass("primary", "min-h-11 px-5 rtl:tracking-normal")}>
                {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                {state === "pending" ? p.marketingResend : p.marketingSubscribe}
              </button>
            ) : null}
            {canWithdraw ? (
              <button type="button" disabled={pending} onClick={() => run("unsubscribe")} className={buttonClass("secondary", "min-h-11 px-5 rtl:tracking-normal")}>
                {p.marketingUnsubscribe}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className={cn("mt-3 text-sm empty:hidden", answer?.tone === "error" ? "text-red-700 dark:text-red-400" : "text-text-muted")}>
        {answer?.text ?? ""}
      </p>
    </section>
  );
}

export function DeleteAccount({ locale, email, labels, kvkkHref, homeHref }: { locale: Locale; email: string; labels: ProfileLabels; kvkkHref: string; homeHref: string }) {
  const p = labels.page;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(deleteAccountAction, INITIAL);
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const errors = state.fieldErrors ?? {};

  // No viewer refresh here: reading the (deleted) session would clear the cookie in a Server Action,
  // which re-renders this page and redirects to the sign-in form before the confirmation shows. The
  // confirmation is a full-screen modal dialog instead: the deleted person's profile, the account
  // navigation and the header greeting behind it are covered and inert (a shared device shows nothing
  // of them), and the "home" link does a full page load.
  useEffect(() => {
    if (state.status === "success") {
      publishCartCount(0);
      const dialog = dialogRef.current;
      if (dialog && !dialog.open) {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute("open", "");
        }
      }
      doneRef.current?.focus();
    } else if (state.status === "error") ref.current?.focus();
  }, [state]);

  if (state.status === "success") {
    return (
      <dialog
        ref={dialogRef}
        aria-labelledby="account-deleted-title"
        onCancel={(event) => event.preventDefault()}
        className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-bg p-0 text-text backdrop:bg-bg"
      >
        <div className="grid min-h-full place-items-center px-4 py-12">
      <section className={cn(panelClass, "w-full max-w-lg text-center")} role="status">
        <span aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-gold/12 text-gold-text">
          <CircleCheck className="size-6" strokeWidth={1.5} />
        </span>
        <h2 id="account-deleted-title" ref={doneRef} tabIndex={-1} className="mt-4 font-heading text-3xl text-text focus:outline-none">
          {p.deletedTitle}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-muted">{p.deletedText}</p>
        <a href={homeHref} className={buttonClass("primary", "mt-6 rtl:tracking-normal")}>
          {p.deletedHome}
        </a>
      </section>
        </div>
      </dialog>
    );
  }

  const items = [p.deleteItems.personal, p.deleteItems.addresses, p.deleteItems.subscriptions, p.deleteItems.sessions];
  return (
    <section aria-labelledby="profile-delete" className="rounded-md border border-red-700/25 bg-surface p-5 sm:p-7 dark:border-red-400/30">
      <h2 id="profile-delete" className={cn(sectionTitleClass, "flex items-center gap-3")}>
        <AlertTriangle aria-hidden className="size-5 shrink-0 text-red-700 dark:text-red-400" strokeWidth={1.75} />
        {p.deleteTitle}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{p.deleteIntro}</p>
      <div className="mt-5 text-sm leading-relaxed text-text">
        <p className="font-medium">{p.deleteWhat}</p>
        <ul className="mt-2 list-disc space-y-1.5 ps-5 text-text-muted">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-4 rounded-md bg-surface-2 px-4 py-3 text-text">{p.deleteItems.orders}</p>
        <p className="mt-3 text-xs text-text-muted">
          {withLink(
            p.deleteKvkk,
            <a href={kvkkHref} target="_blank" rel="noopener" className={textLinkClass}>
              {p.deleteKvkkLink}
              <span className="sr-only"> {labels.newTab}</span>
            </a>,
          )}
        </p>
      </div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls="profile-delete-form"
          className={buttonClass("secondary", "mt-6 border-red-700/40 text-red-800 hover:border-red-700 dark:border-red-400/40 dark:text-red-300 rtl:tracking-normal")}
        >
          {p.deleteOpen}
        </button>
      ) : (
        <form id="profile-delete-form" action={formAction} onSubmit={submitWithoutReset(formAction)} noValidate className="mt-6 space-y-5 border-t border-border pt-6" aria-busy={pending}>
          <input type="hidden" name="locale" value={locale} />
          <input type="text" name="username" autoComplete="username" value={email} readOnly hidden tabIndex={-1} aria-hidden />
          <div ref={ref} tabIndex={-1} aria-live="assertive" className="focus:outline-none empty:hidden">
            {state.status === "error" && state.formError ? <FormAlert tone="error">{state.formError}</FormAlert> : null}
          </div>
          <PasswordField name="password" label={p.deletePassword} labels={labels.auth.password} autoComplete="current-password" error={errors.password} />
          <CheckboxField name="confirmDeletion" label={p.deleteConfirm} error={errors.confirmDeletion} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary", "rtl:tracking-normal")}>
              {p.deleteCancel}
            </button>
            <button type="submit" disabled={pending} className={cn(buttonClass("primary", "rtl:tracking-normal"), "bg-red-700 hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-700")}>
              {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              {pending ? p.deleting : p.deleteButton}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
