"use client";
// The review form island of the (static) product page. Three parts share one state:
// - <ReviewFormProvider> wraps the reviews section; on mount it reads ?degerlendir=<token> (the link
//   of the review request e-mail) and, when present, loads the form state and opens the form;
// - <ReviewCta> is the "Değerlendirme yaz" button (signed in or with a link) or the sign-in link
//   (signed out), plus status lines (pending, already reviewed, link problems);
// - <ReviewFormPanel> renders the form where the section places it, then the thank-you note.
// Nothing personal is rendered on the server: the session is read by Server Actions after hydration.
import { AlertCircle, ArrowRight, BadgeCheck, Check, PenLine, Star } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { errorTextClass, inputClass } from "@/components/checkout/fields";
import { buttonClass } from "@/components/sections/button-styles";
import { useViewer } from "@/components/store/viewer/ViewerProvider";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/get-messages";
import { href, signInHref } from "@/i18n/paths";
import { loadReviewForm, submitReviewAction } from "@/lib/reviews/actions";
import { textLength } from "@/lib/reviews/text";
import {
  REVIEW_LIMITS,
  REVIEW_TOKEN_PARAM,
  REVIEWS_ANCHOR,
  type ReviewField,
  type ReviewFieldError,
  type ReviewFormState,
  type ReviewSubmitError,
} from "@/lib/reviews/types";
import { cn } from "@/lib/utils";

type Labels = Messages["review"];

type ReviewFormContextValue = {
  productId: number;
  locale: Locale;
  slug: string;
  minLength: number;
  allowGuestLinks: boolean;
  labels: Labels;
  token: string | null;
  state: ReviewFormState | null;
  loading: boolean;
  loadFailed: boolean;
  open: boolean;
  done: { updated: boolean } | null;
  start: () => void;
  close: () => void;
  finish: (updated: boolean) => void;
};

const ReviewFormContext = createContext<ReviewFormContextValue | null>(null);

function useReviewForm(): ReviewFormContextValue {
  const ctx = useContext(ReviewFormContext);
  if (!ctx) throw new Error("ReviewFormContext is missing");
  return ctx;
}

/** Jumps (no animation: the page may still be settling) to the reviews section. */
function scrollToSection() {
  document.getElementById(REVIEWS_ANCHOR)?.scrollIntoView({ behavior: "auto", block: "start" });
}

export function ReviewFormProvider({
  productId,
  locale,
  slug,
  minLength,
  allowGuestLinks,
  labels,
  children,
}: {
  productId: number;
  locale: Locale;
  slug: string;
  minLength: number;
  allowGuestLinks: boolean;
  labels: Labels;
  children: React.ReactNode;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<ReviewFormState | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ updated: boolean } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, startLoading] = useTransition();

  const load = useCallback(
    (withToken: string | null, openWhenReady: boolean) => {
      setLoadFailed(false);
      startLoading(async () => {
        try {
          const next = await loadReviewForm({ productId, token: withToken });
          setState(next);
          if (openWhenReady && next.status === "ready") setOpen(true);
          // From the e-mail link: show the link's status (the open form scrolls itself into view).
          else if (withToken) requestAnimationFrame(scrollToSection);
        } catch {
          setLoadFailed(true);
        }
      });
    },
    [productId],
  );

  // Arriving from the review request e-mail: check the link and open the form.
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get(REVIEW_TOKEN_PARAM);
    if (!value) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the token exists only in the browser URL (the page is static)
    setToken(value);
    load(value, true);
    scrollToSection();
  }, [load]);

  const value = useMemo<ReviewFormContextValue>(
    () => ({
      productId,
      locale,
      slug,
      minLength,
      allowGuestLinks,
      labels,
      token,
      state,
      loading,
      loadFailed,
      open,
      done,
      start: () => {
        if (state?.status === "ready") setOpen(true);
        else load(token, true);
      },
      close: () => setOpen(false),
      finish: (updated: boolean) => {
        setDone({ updated });
        setOpen(false);
        if (token) {
          // The link is used up: drop it from the address bar so a reload does not show it again.
          const url = new URL(window.location.href);
          url.searchParams.delete(REVIEW_TOKEN_PARAM);
          // Next.js syncs its router with native replaceState calls that pass `null` as the state.
          window.history.replaceState(null, "", url.pathname + url.search + url.hash);
          setToken(null);
        }
      },
    }),
    [productId, locale, slug, minLength, allowGuestLinks, labels, token, state, loading, loadFailed, open, done, load],
  );

  return <ReviewFormContext.Provider value={value}>{children}</ReviewFormContext.Provider>;
}

// ---------------------------------------------------------------------------------------------

function linkErrorText(labels: Labels, reason: "invalid" | "expired" | "used" | "not_eligible"): string {
  switch (reason) {
    case "expired":
      return labels.errors.linkExpired;
    case "used":
      return labels.errors.linkUsed;
    case "not_eligible":
      return labels.errors.notEligible;
    default:
      return labels.errors.linkInvalid;
  }
}

/** "Değerlendirme yaz" / sign-in link, with the visitor's status underneath. */
export function ReviewCta({ align = "start" }: { align?: "start" | "center" }) {
  const ctx = useReviewForm();
  const viewer = useViewer();
  const { labels, state, done, open, loading, token } = ctx;
  const signedIn = viewer.ready && viewer.signedIn;
  const returnTo = `${href(ctx.locale, "product", { slug: ctx.slug })}#${REVIEWS_ANCHOR}`;
  const center = align === "center";

  if (done || state?.status === "disabled") return null;

  let note: React.ReactNode = null;
  let action: React.ReactNode = null;
  const writeButton = (label: string, icon = true) => (
    <button
      type="button"
      onClick={ctx.start}
      disabled={loading}
      aria-disabled={loading || undefined}
      aria-expanded={open}
      className={buttonClass("secondary", "w-full sm:w-auto")}
    >
      {icon && <PenLine aria-hidden className="size-4" strokeWidth={1.5} />}
      <span>{loading ? labels.loading : label}</span>
    </button>
  );
  const signInLink = (
    <Link href={signInHref(ctx.locale, returnTo)} className={buttonClass("secondary", "w-full sm:w-auto")}>
      <span>{labels.signIn}</span>
      <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
    </Link>
  );

  if (state?.status === "reviewed") {
    note = state.reviewStatus === "approved" ? labels.approved : labels.rejected;
  } else if (state?.status === "link_error") {
    note = linkErrorText(labels, state.reason);
    action = signedIn ? writeButton(labels.write) : state.reason === "used" ? null : signInLink;
  } else if (state?.status === "ready") {
    if (state.existing) {
      note = labels.pending;
      action = open ? null : writeButton(labels.edit);
    } else {
      action = open ? null : writeButton(labels.write);
    }
  } else if (state?.status === "signed_out" || (!signedIn && !token)) {
    action = signInLink;
    if (ctx.allowGuestLinks) note = <span className="text-xs">{labels.guestHint}</span>;
  } else {
    action = writeButton(labels.write);
  }

  return (
    <div className={cn("flex flex-col gap-4", center ? "items-center text-center" : "items-start")}>
      {action}
      <div aria-live="polite" className={cn("max-w-sm text-sm leading-relaxed text-text-muted", !note && !ctx.loadFailed && "sr-only")}>
        {ctx.loadFailed ? <span className={errorTextClass}>{labels.errors.generic}</span> : note}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

type Values = { rating: number; title: string; body: string; displayName: string };
type FieldErrors = Partial<Record<ReviewField, ReviewFieldError>>;

/** The form (when open) or the thank-you note (after sending). */
export function ReviewFormPanel({ className }: { className?: string }) {
  const ctx = useReviewForm();
  const { labels, state, open, done } = ctx;
  const successRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (done) successRef.current?.focus();
  }, [done]);

  if (done) {
    return (
      <div role="status" className={cn("rounded-[calc(var(--radius)*1.5)] border border-border bg-surface px-6 py-10 sm:px-10", className)}>
        <span className="grid size-12 place-items-center rounded-full border border-product-strong/40 text-product-strong">
          <Check aria-hidden className="size-5" strokeWidth={1.5} />
        </span>
        <h3 ref={successRef} tabIndex={-1} className="mt-6 font-heading text-3xl text-text focus:outline-none">
          {labels.successTitle}
        </h3>
        <p className="mt-3 max-w-md text-base leading-relaxed text-text-muted">{done.updated ? labels.updated : labels.success}</p>
      </div>
    );
  }
  if (!open || state?.status !== "ready") return null;
  return <ReviewFormBody key={state.existing ? "edit" : "new"} state={state} className={className} />;
}

function ReviewFormBody({ state, className }: { state: Extract<ReviewFormState, { status: "ready" }>; className?: string }) {
  const ctx = useReviewForm();
  const { labels, locale, minLength } = ctx;
  const [values, setValues] = useState<Values>(() => ({
    rating: state.existing?.rating ?? 0,
    title: state.existing?.title ?? "",
    body: state.existing?.body ?? "",
    displayName: state.existing?.displayName ?? state.defaultName,
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);

  // Opened from the e-mail link: jump to the form; opened by the button: bring it gently into view.
  const fromLink = Boolean(ctx.token);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = requestAnimationFrame(() =>
      formRef.current?.scrollIntoView(fromLink ? { behavior: "auto", block: "start" } : { behavior: reduce ? "auto" : "smooth", block: "nearest" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [fromLink]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = (v: Values): FieldErrors => {
    const out: FieldErrors = {};
    if (!(v.rating >= 1 && v.rating <= 5)) out.rating = "required";
    if (textLength(v.title.trim()) > REVIEW_LIMITS.title) out.title = "too_long";
    const body = v.body.trim();
    if (textLength(body) > REVIEW_LIMITS.body) out.body = "too_long";
    else if (minLength > 0 && body.length === 0) out.body = "required";
    else if (minLength > 0 && textLength(body) < minLength) out.body = "too_short";
    if (textLength(v.displayName.trim()) > REVIEW_LIMITS.displayName) out.displayName = "too_long";
    return out;
  };

  const focusFirst = (e: FieldErrors) => {
    const order: ReviewField[] = ["rating", "title", "body", "displayName"];
    const first = order.find((f) => e[f]);
    if (first) document.getElementById(first === "rating" ? "rv-rating-1" : `rv-${first}`)?.focus();
  };

  const submitError = (error: ReviewSubmitError, minutes?: number): string => {
    switch (error) {
      case "rate_limited":
        return format(labels.errors.rateLimited, { minutes: minutes ?? 60 }, locale);
      case "signed_out":
        return labels.errors.signedOut;
      case "already_reviewed":
        return labels.errors.alreadyReviewed;
      case "link_invalid":
        return labels.errors.linkInvalid;
      case "link_expired":
        return labels.errors.linkExpired;
      case "not_eligible":
        return labels.errors.notEligible;
      case "disabled":
        return labels.errors.disabled;
      default:
        return labels.errors.generic;
    }
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    const local = validate(values);
    if (Object.keys(local).length > 0) {
      setErrors(local);
      focusFirst(local);
      return;
    }
    startTransition(async () => {
      try {
        const result = await submitReviewAction({
          productId: ctx.productId,
          locale,
          rating: values.rating,
          title: values.title,
          body: values.body,
          displayName: values.displayName,
          token: ctx.token,
          website: honeypotRef.current?.value ?? "",
        });
        if (result.ok) {
          ctx.finish(result.updated);
          return;
        }
        if (result.error === "invalid" && result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
          setErrors(result.fieldErrors);
          focusFirst(result.fieldErrors);
          return;
        }
        setFormError(submitError(result.error, result.retryAfterMinutes));
      } catch {
        setFormError(labels.errors.generic);
      }
    });
  };

  const errorText = (field: ReviewField): string | null => {
    const code = errors[field];
    if (!code) return null;
    if (field === "rating") return labels.errors.rating;
    if (code === "too_long") {
      const max = field === "title" ? REVIEW_LIMITS.title : field === "body" ? REVIEW_LIMITS.body : REVIEW_LIMITS.displayName;
      return format(labels.errors.tooLong, { max }, locale);
    }
    if (code === "too_short") return format(labels.errors.tooShort, { min: minLength }, locale);
    return labels.errors.required;
  };

  const bodyLength = textLength(values.body.trim());
  const ratingWords = [labels.rating1, labels.rating2, labels.rating3, labels.rating4, labels.rating5];

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="rv-heading"
      className={cn("scroll-mt-28 rounded-[calc(var(--radius)*1.5)] border border-border bg-surface px-5 py-8 sm:px-10 sm:py-10", className)}
    >
      <h3 id="rv-heading" ref={headingRef} tabIndex={-1} className="font-heading text-3xl text-text focus:outline-none md:text-4xl">
        {state.existing ? labels.formEditTitle : labels.formTitle}
      </h3>
      {state.verified && (
        <p className="mt-3 inline-flex items-start gap-2 text-sm text-product-strong">
          <BadgeCheck aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          {labels.verifiedNote}
        </p>
      )}

      {/* Honeypot: hidden from people and assistive tech. */}
      <div aria-hidden="true" className="sr-only">
        <label>
          Website
          <input ref={honeypotRef} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div className="mt-9 space-y-8">
        <RatingInput
          value={values.rating}
          onChange={(n) => set("rating", n)}
          legend={labels.rating}
          optionLabel={(n) => format(labels.ratingOption, { stars: n }, locale)}
          words={ratingWords}
          error={errorText("rating")}
        />

        <TextInput
          id="rv-title"
          label={labels.headline}
          optional={labels.optional}
          value={values.title}
          onChange={(v) => set("title", v)}
          placeholder={labels.headlinePlaceholder}
          maxLength={REVIEW_LIMITS.title}
          error={errorText("title")}
        />

        <div>
          <label htmlFor="rv-body" className="mb-2 block text-sm font-medium text-text">
            {labels.body}
            {minLength === 0 && <span className="ms-1.5 text-xs font-normal text-text-muted">({labels.optional})</span>}
          </label>
          <textarea
            id="rv-body"
            name="body"
            rows={6}
            value={values.body}
            onChange={(e) => set("body", e.target.value)}
            placeholder={labels.bodyPlaceholder}
            maxLength={REVIEW_LIMITS.body}
            dir="auto"
            aria-invalid={errors.body ? true : undefined}
            aria-describedby={cn(errors.body && "rv-body-error", "rv-body-hint") || undefined}
            className={cn(inputClass, "min-h-36 resize-y leading-relaxed")}
          />
          <FieldErrorText id="rv-body-error" text={errorText("body")} />
          <p id="rv-body-hint" className="mt-2 flex justify-between gap-4 text-xs text-text-muted">
            <span>{minLength > 0 ? format(labels.bodyMin, { min: minLength }, locale) : null}</span>
            <span className="tabular-nums" dir="ltr">
              {bodyLength}/{REVIEW_LIMITS.body}
            </span>
          </p>
        </div>

        <TextInput
          id="rv-displayName"
          label={labels.displayName}
          value={values.displayName}
          onChange={(v) => set("displayName", v)}
          maxLength={REVIEW_LIMITS.displayName}
          hint={labels.displayNameHint}
          error={errorText("displayName")}
          className="sm:max-w-sm"
        />
      </div>

      <div
        aria-live="polite"
        className={cn(
          "focus:outline-none",
          formError &&
            "mt-8 flex items-start gap-3 rounded-md border border-red-700/30 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200",
        )}
      >
        {formError && (
          <>
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            <span>{formError}</span>
          </>
        )}
      </div>

      <div className="mt-9 flex flex-col gap-6 border-t border-border pt-7 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xs text-xs leading-relaxed text-text-muted">{labels.moderation}</p>
        <div className="flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center">
          <button type="button" onClick={ctx.close} className={buttonClass("link", "self-center")}>
            {labels.cancel}
          </button>
          <button type="submit" disabled={pending} aria-disabled={pending || undefined} className={buttonClass("primary")}>
            <span>{pending ? labels.submitting : state.existing ? labels.update : labels.submit}</span>
            <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
          </button>
        </div>
      </div>
    </form>
  );
}

function FieldErrorText({ id, text }: { id: string; text: string | null }) {
  if (!text) return null;
  return (
    <p id={id} className={cn(errorTextClass, "mt-2 flex items-start gap-1.5")}>
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <span>{text}</span>
    </p>
  );
}

function TextInput({
  id,
  label,
  optional,
  value,
  onChange,
  placeholder,
  maxLength,
  hint,
  error,
  className,
}: {
  id: string;
  label: string;
  optional?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength: number;
  hint?: string;
  error: string | null;
  className?: string;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-text">
        {label}
        {optional && <span className="ms-1.5 text-xs font-normal text-text-muted">({optional})</span>}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        dir="auto"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClass}
      />
      <FieldErrorText id={`${id}-error`} text={error} />
      {hint && (
        <p id={`${id}-hint`} className="mt-2 text-xs leading-relaxed text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Five large stars as native radio buttons (arrow keys work), with a word for the chosen value. */
function RatingInput({
  value,
  onChange,
  legend,
  optionLabel,
  words,
  error,
}: {
  value: number;
  onChange: (value: number) => void;
  legend: string;
  optionLabel: (n: number) => string;
  words: string[];
  error: string | null;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <fieldset aria-describedby={error ? "rv-rating-error" : undefined}>
      <legend className="mb-3 block text-sm font-medium text-text">{legend}</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="relative cursor-pointer p-1" onMouseEnter={() => setHover(n)}>
              <input
                id={`rv-rating-${n}`}
                type="radio"
                name="rating"
                value={n}
                checked={value === n}
                onChange={() => onChange(n)}
                className="peer absolute inset-0 size-full cursor-pointer appearance-none rounded-full opacity-0"
              />
              <Star
                aria-hidden
                strokeWidth={1.25}
                className={cn(
                  "size-9 rounded-full transition-[color,fill,transform] duration-200 motion-reduce:transition-none peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                  shown >= n ? "fill-product-strong text-product-strong" : "text-border-strong",
                  hover === n && "scale-110 motion-reduce:scale-100",
                )}
              />
              <span className="sr-only">{optionLabel(n)}</span>
            </label>
          ))}
        </div>
        <span aria-hidden className="min-h-5 text-sm text-text-muted">
          {shown ? words[shown - 1] : ""}
        </span>
      </div>
      <FieldErrorText id="rv-rating-error" text={error} />
    </fieldset>
  );
}
