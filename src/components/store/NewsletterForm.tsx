"use client";

import { ArrowRight, Check } from "lucide-react";
import { useActionState, useId } from "react";
import { subscribeNewsletterAction, type NewsletterState } from "@/app/[locale]/actions/newsletter";
import { intlLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/get-messages";
import { cn } from "@/lib/utils";

const initialState: NewsletterState = { status: "idle" };

type NewsletterFormProps = {
  locale: Locale;
  /** messages.newsletter (pass the whole group; DB overrides are already applied). */
  labels: Messages["newsletter"];
  /** Where the sign-up happened (stored on the subscriber). */
  source?: "footer" | "section" | "popup" | "checkout";
  /** "inverse" on dark/navy surfaces, "default" on light ones. */
  tone?: "default" | "inverse";
  className?: string;
};

/** E-mail sign-up with explicit İYS/KVKK consent (double opt-in: success = "check your inbox"). Footer and page sections. */
export default function NewsletterForm({ locale, labels, source = "footer", tone = "default", className }: NewsletterFormProps) {
  const [state, formAction, pending] = useActionState(subscribeNewsletterAction, initialState);
  const id = useId();
  const emailId = `${id}-email`;
  const consentId = `${id}-consent`;
  const messageId = `${id}-message`;
  const inverse = tone === "inverse";

  if (state.status === "success") {
    return (
      <p role="status" className={cn("flex items-start gap-3 text-sm leading-relaxed", className)}>
        <span
          className={cn(
            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
            inverse ? "bg-gold text-gold-contrast" : "bg-brand text-brand-contrast",
          )}
        >
          <Check aria-hidden className="size-3.5" strokeWidth={2} />
        </span>
        <span>{labels.success}</span>
      </p>
    );
  }

  const emailError = state.error === "invalid_email";
  const consentError = state.error === "consent_required";
  const message =
    state.status !== "error"
      ? ""
      : emailError
        ? labels.invalidEmail
        : consentError
          ? labels.consentRequired
          : state.error === "rate_limited"
            ? format(labels.rateLimited, { minutes: state.minutes ?? 1 }, intlLocale(locale))
            : labels.error;

  return (
    <form action={formAction} noValidate className={cn("space-y-4", className)}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="source" value={source} />
      {/* Honeypot: hidden from people and assistive tech, irresistible to bots. */}
      <div aria-hidden="true" className="sr-only">
        <label>
          Company
          <input type="text" name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div
        className={cn(
          "flex items-stretch overflow-hidden rounded-control border transition-colors focus-within:ring-2",
          inverse
            ? "border-brand-contrast/25 focus-within:border-gold focus-within:ring-gold/30"
            : "border-border bg-surface focus-within:border-gold focus-within:ring-gold/25",
          emailError && (inverse ? "border-gold" : "border-red-600 dark:border-red-400"),
        )}
      >
        <label htmlFor={emailId} className="sr-only">
          {labels.emailLabel}
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder={labels.placeholder}
          defaultValue={state.email ?? ""}
          aria-invalid={emailError || undefined}
          aria-describedby={message ? messageId : undefined}
          dir="ltr"
          className={cn(
            "w-0 min-w-0 flex-1 bg-transparent px-5 py-3 text-sm outline-none rtl:text-right",
            inverse ? "text-brand-contrast placeholder:text-brand-contrast/50" : "text-text placeholder:text-text-muted",
          )}
        />
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "m-1 inline-flex shrink-0 items-center gap-2 rounded-control px-5 text-xs font-semibold uppercase tracking-[0.14em] transition-colors disabled:opacity-60 rtl:tracking-normal",
            "focus-visible:outline-2 focus-visible:outline-offset-2",
            inverse
              ? "bg-gold text-gold-contrast hover:bg-gold-300 focus-visible:outline-gold"
              : "bg-brand text-brand-contrast hover:bg-brand-800 focus-visible:outline-ring",
          )}
        >
          <span>{pending ? labels.submitting : labels.submit}</span>
          <ArrowRight aria-hidden className="size-3.5 rtl:rotate-180" strokeWidth={2} />
        </button>
      </div>

      <div className="flex items-start gap-3">
        <input
          id={consentId}
          name="consent"
          type="checkbox"
          value="on"
          required
          defaultChecked={state.consent ?? false}
          aria-invalid={consentError || undefined}
          aria-describedby={consentError ? messageId : undefined}
          className={cn(
            "mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm",
            inverse ? "accent-gold" : "accent-brand",
          )}
        />
        <label
          htmlFor={consentId}
          className={cn("cursor-pointer text-xs leading-relaxed", inverse ? "text-brand-contrast/75" : "text-text-muted")}
        >
          {labels.consent}
        </label>
      </div>

      <p
        id={messageId}
        aria-live="polite"
        className={cn(
          "min-h-5 text-xs",
          message ? (inverse ? "text-gold" : "text-red-700 dark:text-red-400") : "",
          !message && (inverse ? "text-brand-contrast/55" : "text-text-muted"),
        )}
      >
        {message || labels.unsubscribeNote}
      </p>
    </form>
  );
}
