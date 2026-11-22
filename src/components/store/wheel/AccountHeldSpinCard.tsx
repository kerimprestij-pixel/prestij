"use client";
// The /hesap card for a gift wheel prize the signed-in account won but has not taken yet (lead decision
// D15): the prize name, its conditions and the claim-until date, and "Hediyemi al", which calls the
// existing claimWheel action (the server finds the spin by the account, so no wheel cookie is needed:
// another device works too). After the claim the card shows what the dialog's claimed view shows: the
// code, the real countdown to the coupon's end (role="timer") and whether it went onto the cart; a new
// cart view is published to the cart surfaces (header badge, drawer). Shown during the campaign and after
// its end, within the hold. Only the account page loads this chunk (the storefront launcher is untouched).
// Once the hold has passed (a page left open), the button goes and the card says the result expired; a
// final refusal hides the button and moves focus to the notice; "already claimed" (another tab or device)
// re-renders the overview, whose prize card then shows the code. The button stays focusable while the
// claim runs (aria-disabled, as the dialog's claim button), so keyboard focus is never dropped.
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { publishCartView } from "@/components/cart/cart-store";
import { buttonClass } from "@/components/sections/button-styles";
import { panelClass } from "@/components/store/account/styles";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { claimWheel } from "@/lib/wheel/actions";
import type { WheelClaimResult } from "@/lib/wheel/types";
import { cn } from "@/lib/utils";
import { formatWheelDate } from "./countdown";
import type { HeldSpinCardLabels, HeldSpinCardModel } from "./held-spin-card";
import { ACCOUNT_WHEEL_HEADING_ID, heldCardRefusal, heldHoldPassed } from "./held-spin-state";
import { clearCachedWheelData } from "./wheel-storage";
import WheelMark from "./WheelMark";
import { CopyCodeButton, WheelCountdownText } from "./WheelLive";

/** The longest delay setTimeout takes (about 24.8 days); a later hold end is caught by the minute tick. */
const MAX_TIMEOUT_MS = 2_147_483_647;

type Claimed = { code: string; label: string; summary: string; endsAt: string; applied: boolean; at: number };
/** A final refusal: its notice, and whether the offer itself is gone (claim_limit keeps the offer's lines). */
type Refusal = { message: string; offerGone: boolean };

export type AccountHeldSpinCardProps = {
  locale: Locale;
  model: HeldSpinCardModel;
  labels: HeldSpinCardLabels;
  cartHref: string;
};

export default function AccountHeldSpinCard({ locale, model, labels, cartHref }: AccountHeldSpinCardProps) {
  const router = useRouter();
  const titleId = useId();
  const [claiming, setClaiming] = useState(false);
  /** A refusal worth retrying (network, server, lost session): the button stays. */
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  /** The spin's frozen hold has passed while the page was open. */
  const [holdOver, setHoldOver] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [claimed, setClaimed] = useState<Claimed | null>(null);
  const [status, setStatus] = useState("");
  const claimedTitle = useRef<HTMLHeadingElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  /** The next time the button goes, focus moves to the notice (it had focus, or the user just pressed it). */
  const focusNotice = useRef(false);

  const offerGone = holdOver || refusal?.offerGone === true;
  const gone = holdOver || refusal !== null;
  const notice = refusal?.offerGone ? refusal.message : holdOver ? labels.expired : (refusal?.message ?? error);

  // The claimed view replaces the button that had focus: move focus to its heading.
  useEffect(() => {
    if (claimed) claimedTitle.current?.focus();
  }, [claimed]);

  // The button went (final refusal, or the hold ended while it had focus): focus the notice that says why.
  useEffect(() => {
    if (!gone || !focusNotice.current) return;
    focusNotice.current = false;
    noticeRef.current?.focus();
  }, [gone]);

  // The hold's end, exactly and on a minute tick (timers can be late after the computer slept).
  useEffect(() => {
    if (claimed) return;
    const end = Date.parse(model.holdUntil);
    if (!Number.isFinite(end)) return;
    const check = () => {
      if (!heldHoldPassed(model.holdUntil, Date.now())) return;
      if (button.current && document.activeElement === button.current) focusNotice.current = true;
      setHoldOver(true);
    };
    const exact = window.setTimeout(check, Math.min(Math.max(0, end - Date.now()), MAX_TIMEOUT_MS));
    const tick = window.setInterval(check, 60_000);
    return () => {
      window.clearTimeout(exact);
      window.clearInterval(tick);
    };
  }, [model.holdUntil, claimed]);

  // "Already claimed": the refreshed overview drops this card for the prize card; continue at its heading.
  useEffect(() => {
    if (!refreshing) return;
    return () => {
      window.requestAnimationFrame(() => document.getElementById(ACCOUNT_WHEEL_HEADING_ID)?.focus());
    };
  }, [refreshing]);

  const claim = async () => {
    if (claiming || gone || claimed) return;
    if (heldHoldPassed(model.holdUntil, Date.now())) {
      focusNotice.current = true;
      setHoldOver(true);
      return;
    }
    setClaiming(true);
    setError(null);
    setStatus(labels.claiming);
    let result: WheelClaimResult;
    try {
      result = await claimWheel({ locale });
    } catch {
      result = { ok: false, error: "network", message: labels.network };
    }
    setClaiming(false);
    if (!result.ok) {
      const message = result.message || labels.unavailable;
      setStatus("");
      const outcome = heldCardRefusal(result.error);
      if (!outcome.final) {
        setError(message);
        return;
      }
      focusNotice.current = true;
      setRefusal({ message: outcome.expired ? labels.expired : message, offerGone: outcome.offerGone });
      if (outcome.refresh) {
        setRefreshing(true);
        router.refresh();
      }
      return;
    }
    if (result.cart) publishCartView(result.cart);
    clearCachedWheelData(); // the launcher's per-tab answer still shows the spin as held
    setStatus(`${labels.claimedTitle}. ${result.applied ? labels.applied : labels.kept}`);
    setClaimed({
      code: result.prize.code,
      label: result.prize.label,
      summary: result.prize.summary,
      endsAt: result.prize.endsAt,
      applied: result.applied,
      at: Math.floor(Date.now() / 1000),
    });
  };

  return (
    <section aria-labelledby={titleId} data-wheel-held="" className={cn(panelClass, "mb-12 border-gold-300/60 bg-gold-50/40 dark:bg-gold-950/30")}>
      <div className="flex min-w-0 items-start gap-4">
        <WheelMark className="size-11 shrink-0" />
        <div className="min-w-0 flex-1">
          {claimed ? (
            <>
              <h2 id={titleId} ref={claimedTitle} tabIndex={-1} className="font-medium text-text focus:outline-none">
                {labels.claimedTitle}
              </h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-muted">
                <span className="font-medium text-text">{claimed.label}</span>
                {claimed.summary ? <> · {claimed.summary}</> : null}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="text-xs font-medium text-text-muted">{labels.code}</span>
                <bdi
                  dir="ltr"
                  data-wheel-code=""
                  className="rounded-sm border border-dashed border-gold-300/70 bg-surface px-3 py-1.5 font-mono text-base font-semibold tracking-[0.14em] text-text select-all"
                >
                  {claimed.code}
                </bdi>
                <CopyCodeButton code={claimed.code} copyLabel={labels.copy} copiedLabel={labels.copied} />
              </div>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text">
                <WheelCountdownText endsAt={claimed.endsAt} locale={locale} template={labels.timeLeft} labels={labels.countdown} serverSeconds={claimed.at} />
                <span className="text-text-muted">{format(labels.expiresAt, { date: formatWheelDate(claimed.endsAt, locale) })}</span>
              </p>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-text">{claimed.applied ? labels.applied : labels.kept}</p>
              <Link href={cartHref} className={buttonClass("secondary", "mt-5 rtl:tracking-normal")}>
                {labels.goToCart}
              </Link>
            </>
          ) : (
            <>
              <h2 id={titleId} className="font-medium text-text">
                {offerGone ? labels.goneTitle : model.title}
              </h2>
              {offerGone ? null : (
                <>
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-muted">{model.intro}</p>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-text">{model.conditions}</p>
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-muted">{model.claimUntil}</p>
                </>
              )}
              {notice ? (
                <p
                  ref={noticeRef}
                  role="alert"
                  tabIndex={-1}
                  data-wheel-held-notice=""
                  className="mt-4 max-w-xl rounded-md border border-red-700/25 bg-red-700/5 px-4 py-3 text-sm leading-relaxed text-red-800 focus:outline-none dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300"
                >
                  {notice}
                </p>
              ) : null}
              {gone ? null : (
                <button
                  ref={button}
                  type="button"
                  onClick={() => void claim()}
                  aria-disabled={claiming || undefined}
                  aria-busy={claiming || undefined}
                  className={buttonClass("primary", "mt-5 rtl:tracking-normal aria-disabled:cursor-progress aria-disabled:opacity-60")}
                >
                  {claiming ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} /> : null}
                  <span>{model.claimCta}</span>
                </button>
              )}
            </>
          )}
          <p aria-live="polite" className="sr-only">
            {status}
          </p>
        </div>
      </div>
    </section>
  );
}
