"use client";

// The signed-in buyer's gift wheel prize in the cart (day 6): a slim row under the drawer header and a
// card in the /sepet coupon box. Everything it says comes from CartView.wheelPrize (localized on the
// server); the countdown is the only live part. "ready" (the prize works but is not on the cart, e.g.
// the buyer took it off) offers to apply it; the other waiting states explain why it is kept.
import { Check, Gift, LoaderCircle, Timer } from "lucide-react";
import { useId, useState } from "react";
import type { Locale } from "@/i18n/config";
import type { CartActionResult } from "@/lib/cart/action-types";
import { splitTemplate } from "@/lib/cart/countdown";
import type { CartWheelPrizeView } from "@/lib/cart/view";
import { cn } from "@/lib/utils";
import WheelCountdown from "./WheelCountdown";

type Props = {
  prize: CartWheelPrizeView;
  locale: Locale;
  variant: "page" | "drawer";
  /** "Uygula" / "Uygulanıyor…" (cart.applyCoupon / cart.couponApplying). */
  applyLabel: string;
  applyingLabel: string;
  /** Puts the prize code on the cart (the cart controller's applyCoupon). */
  onApply: (code: string, onResult: (result: CartActionResult) => void) => void;
  /** The live countdown reached the end: reload the cart (the server takes the prize away). */
  onExpire?: () => void;
  /** A cart action is running: the apply button waits. */
  pending?: boolean;
  className?: string;
};

export default function WheelPrizeNote({ prize, locale, variant, applyLabel, applyingLabel, onApply, onExpire, pending = false, className }: Props) {
  const [applying, setApplying] = useState(false);
  const labelId = useId();
  const applied = prize.status === "applied";
  const ready = prize.status === "ready";

  const apply = () => {
    if (applying || pending) return;
    setApplying(true);
    onApply(prize.code, () => setApplying(false));
  };

  const countdown = (template: string) => {
    const [before, after] = splitTemplate(template, "time");
    return (
      <>
        {before}
        <WheelCountdown endsAt={prize.endsAt} fallback={prize.timeLeft} texts={prize.text.countdown} locale={locale} onExpire={onExpire} />
        {after}
      </>
    );
  };

  const applyButton = ready ? (
    <button
      type="button"
      onClick={apply}
      disabled={applying || pending}
      aria-describedby={labelId}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control border border-text/25 font-medium uppercase tracking-[0.14em] text-text transition-colors hover:border-gold disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        variant === "drawer" ? "h-8 px-3 text-[0.6875rem]" : "h-9 px-4 text-xs",
      )}
    >
      {applying ? <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" strokeWidth={1.5} /> : null}
      {applying ? applyingLabel : applyLabel}
    </button>
  ) : null;

  if (variant === "drawer") {
    return (
      <div data-wheel-prize={prize.status} className={cn("flex items-center gap-3 text-sm", className)}>
        <Gift aria-hidden className="size-4 shrink-0 text-gold-text dark:text-gold" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-text">
            {countdown(prize.text.drawer)}
            <span className="sr-only"> ({prize.expiresAt})</span>
          </p>
          <p id={labelId} className="flex min-w-0 items-center gap-1 text-xs text-text-muted">
            {applied ? <Check aria-hidden className="size-3.5 shrink-0 text-gold-text dark:text-gold" strokeWidth={1.75} /> : null}
            <span className={cn("min-w-0", applied || ready ? "truncate" : "line-clamp-2 [@media(max-height:640px)]:line-clamp-1")}>
              {applied || ready || !prize.message ? prize.label : prize.message}
            </span>
          </p>
        </div>
        {applyButton}
      </div>
    );
  }

  return (
    <div
      data-wheel-prize={prize.status}
      className={cn("rounded-control border border-gold/60 bg-gold-50/50 px-4 py-3 dark:border-gold/40 dark:bg-gold-950/30", className)}
    >
      <div className="flex items-start gap-3">
        <Gift aria-hidden className="mt-0.5 size-5 shrink-0 text-gold-text dark:text-gold" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted">{prize.text.title}</p>
          <p id={labelId} className="mt-0.5 text-sm font-medium text-text">
            {prize.label}
          </p>
          {prize.message && !applied ? <p className="mt-1 text-xs leading-relaxed text-text-muted">{prize.message}</p> : null}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1.5 text-gold-text dark:text-gold">
              <Timer aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span>{countdown(prize.text.timeLeft)}</span>
            </span>
            <span className="text-text-muted">{prize.expiresAt}</span>
          </p>
        </div>
        {applyButton}
      </div>
    </div>
  );
}
