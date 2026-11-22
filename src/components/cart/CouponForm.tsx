"use client";

// Discount code: apply (validated on the server against this cart) or remove. Errors come back as
// localized strings from the action and are shown under the field.
// Day 6: a gift wheel prize on the cart shows its label and a live countdown to its real expiry; a prize
// kept for later (or ready to apply) shows as a card above the field or under another code.
import { LoaderCircle, TicketPercent, Timer, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import type { Locale } from "@/i18n/config";
import type { CartActionResult } from "@/lib/cart/action-types";
import { splitTemplate } from "@/lib/cart/countdown";
import type { CartView } from "@/lib/cart/view";
import { cn } from "@/lib/utils";
import type { CartUiLabels } from "./labels";
import WheelCountdown from "./WheelCountdown";
import WheelPrizeNote from "./WheelPrizeNote";

type Props = {
  coupon: CartView["coupon"];
  /** The signed-in buyer's gift wheel prize (view.wheelPrize), or null. */
  wheelPrize?: CartView["wheelPrize"];
  locale: Locale;
  /** "-120,00 ₺" from the summary row, when the coupon reduces the subtotal. */
  discountLabel: string | null;
  labels: CartUiLabels["coupon"];
  onApply: (code: string, onResult: (result: CartActionResult) => void) => void;
  onRemove: () => void;
  /** The prize's live countdown reached its end (reload the cart). */
  onPrizeExpire?: () => void;
  /** A cart action is running. */
  pending?: boolean;
  className?: string;
};

export default function CouponForm({ coupon, wheelPrize = null, locale, discountLabel, labels, onApply, onRemove, onPrizeExpire, pending, className }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputId = useId();
  const errorId = useId();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    onApply(code.trim(), (result) => {
      setSubmitting(false);
      if (result.ok) setCode("");
      else setError(result.error);
    });
  };

  // The code on the cart is the prize itself: its row carries the countdown, no separate card.
  const prizeOnCart = coupon != null && wheelPrize?.status === "applied" && wheelPrize.code === coupon.code ? wheelPrize : null;
  const prizeNote =
    wheelPrize && !prizeOnCart ? (
      <WheelPrizeNote
        prize={wheelPrize}
        locale={locale}
        variant="page"
        applyLabel={labels.apply}
        applyingLabel={labels.applying}
        onApply={onApply}
        onExpire={onPrizeExpire}
        pending={pending}
      />
    ) : null;

  if (coupon) {
    const invalid = coupon.status === "invalid";
    const [before, after] = prizeOnCart ? splitTemplate(prizeOnCart.text.timeLeft, "time") : ["", ""];
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-control border border-dashed px-4 py-3",
            invalid ? "border-rose-300 dark:border-rose-800" : "border-gold/70 bg-gold-50/50 dark:bg-gold-950/30",
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <TicketPercent aria-hidden className={cn("size-5 shrink-0", invalid ? "text-rose-700 dark:text-rose-300" : "text-gold-text dark:text-gold")} strokeWidth={1.5} />
            <div className="min-w-0">
              {/* Never cut the code ("CARK-94G8…"): it wraps instead, with tighter tracking so it usually fits on one line. */}
              <p className={cn("text-sm font-medium uppercase tracking-[0.06em] text-text [overflow-wrap:anywhere]", invalid && "line-through decoration-rose-400")}>
                {coupon.code}
              </p>
              {prizeOnCart ? (
                <>
                  <p className="text-xs text-text-muted">
                    {prizeOnCart.text.title} · {prizeOnCart.label}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gold-text dark:text-gold">
                    <Timer aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
                    <span>
                      {before}
                      <WheelCountdown
                        endsAt={prizeOnCart.endsAt}
                        fallback={prizeOnCart.timeLeft}
                        texts={prizeOnCart.text.countdown}
                        locale={locale}
                        onExpire={onPrizeExpire}
                      />
                      {after}
                    </span>
                    <span className="sr-only"> ({prizeOnCart.expiresAt})</span>
                  </p>
                </>
              ) : (
                <p className={cn("text-xs", invalid ? "text-rose-800 dark:text-rose-200" : "text-text-muted")}>{coupon.message}</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!invalid && discountLabel ? <span className="text-sm tabular-nums text-text">{discountLabel}</span> : null}
            <button
              type="button"
              onClick={onRemove}
              aria-label={labels.remove}
              title={labels.remove}
              className="inline-flex size-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X aria-hidden className="size-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
        {prizeNote}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {prizeNote}
      <form onSubmit={submit} noValidate>
        <label htmlFor={inputId} className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted">
          {labels.label}
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id={inputId}
            name="code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              if (error) setError(null);
            }}
            placeholder={labels.placeholder}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={64}
            enterKeyHint="go"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              "h-11 min-w-0 flex-1 rounded-control border bg-surface px-3.5 text-sm uppercase tracking-[0.08em] text-text placeholder:normal-case placeholder:tracking-normal placeholder:text-text-muted/80 focus-visible:border-gold focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40",
              error ? "border-rose-400 dark:border-rose-700" : "border-border",
            )}
          />
          <button
            type="submit"
            disabled={submitting || code.trim() === ""}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-control border border-text/25 px-5 text-xs font-medium uppercase tracking-[0.14em] text-text transition-colors hover:border-gold disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {submitting ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.5} /> : null}
            {submitting ? labels.applying : labels.apply}
          </button>
        </div>
        {error ? (
          <p id={errorId} className="mt-2 text-xs text-rose-800 dark:text-rose-200">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
