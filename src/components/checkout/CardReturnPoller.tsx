"use client";
// PayTR sends the buyer back (merchant_ok_url / merchant_fail_url) before or after its server-to-server
// notification reaches us. This waits briefly for the order to change, then moves on to the order page.
// When PayTR opened the return URL inside our iframe, it first moves the whole tab to that URL.
// If the result is still missing while the latest attempt is inside its window (the payment may still be
// confirmed), the slow screen says "Ödemeniz doğrulanıyor" (never a retry) and keeps asking for a while, now
// also asking PayTR (Durum Sorgu) through the server action.
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { checkCardReturnAction } from "@/app/[locale]/odeme/kart/actions";
import { buttonClass } from "@/components/sections/button-styles";

type Labels = {
  checkingTitle: string;
  checkingText: string;
  slowTitle: string;
  slowText: string;
  /** Slow screen while the payment may still be confirmed (no new payment). */
  verifyingTitle: string;
  verifyingText: string;
  /** The same after a merchant_fail_url return (sonuc=hata): never "do not pay again" (PayTR-fix R-UX6). */
  verifyingFailedText: string;
  viewOrder: string;
  /** A tampered or expired return link: no order can be named. */
  invalidTitle: string;
  invalidText: string;
  orderLookup: string;
};

const INTERVAL_MS = 1500;
const MAX_WAIT_MS = 45_000;
/** The "verifying" slow screen keeps asking at this pace, for at most VERIFY_MAX_MS since the page opened. */
const VERIFY_INTERVAL_MS = 5000;
const VERIFY_MAX_MS = 4 * 60_000;

export default function CardReturnPoller({ r, failed, lookupHref, labels }: { r: string; failed: boolean; lookupHref: string; labels: Labels }) {
  const [slow, setSlow] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const started = useRef(0);

  useEffect(() => {
    if (window.top && window.top !== window.self) {
      try {
        window.top.location.href = window.location.href;
        return;
      } catch {
        // A foreign parent: carry on inside the frame.
      }
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRedirect: string | undefined;
    // The last answer's "verifying" (kept across a network hiccup).
    let stillVerifying = false;
    started.current = Date.now();
    const tick = async (inquire = false) => {
      try {
        const res = await checkCardReturnAction(r, inquire);
        lastRedirect = res.redirectTo ?? lastRedirect;
        stillVerifying = res.state === "waiting" && res.verifying === true;
        if (stop) return;
        if (res.state === "invalid") {
          setInvalid(true);
          return;
        }
        if (res.state === "paid" || res.state === "failed" || res.state === "closed") {
          window.location.replace(res.redirectTo!);
          return;
        }
      } catch {
        // Network hiccup: try again on the next tick.
      }
      // A failure redirect (merchant_fail_url) rarely gets a paid notification later: wait less.
      const limit = failed ? MAX_WAIT_MS / 3 : MAX_WAIT_MS;
      const elapsed = Date.now() - started.current;
      if (elapsed > limit) {
        if (stop) return;
        setSlow(lastRedirect ?? "");
        setVerifying(stillVerifying);
        if (stillVerifying && elapsed < VERIFY_MAX_MS) timer = setTimeout(() => void tick(true), VERIFY_INTERVAL_MS);
        return;
      }
      timer = setTimeout(() => void tick(), INTERVAL_MS);
    };
    timer = setTimeout(() => void tick(), 400);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [r, failed]);

  if (invalid) {
    return (
      <div className="text-center">
        <h1 className="font-heading text-3xl leading-tight text-text sm:text-4xl">{labels.invalidTitle}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-muted">{labels.invalidText}</p>
        <a href={lookupHref} className={buttonClass("primary", "mt-8")}>
          {labels.orderLookup}
        </a>
      </div>
    );
  }

  if (slow !== null) {
    return (
      <div className="text-center" aria-live="polite">
        <h1 className="font-heading text-3xl leading-tight text-text sm:text-4xl">{verifying ? labels.verifyingTitle : labels.slowTitle}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-muted">
          {verifying ? (failed ? labels.verifyingFailedText : labels.verifyingText) : labels.slowText}
        </p>
        <a href={slow || lookupHref} className={buttonClass("primary", "mt-8")}>
          {slow ? labels.viewOrder : labels.orderLookup}
        </a>
      </div>
    );
  }

  return (
    <div className="text-center" aria-live="polite">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full border border-border bg-surface-2">
        <LoaderCircle aria-hidden className="size-6 animate-spin text-gold motion-reduce:animate-none" strokeWidth={1.5} />
      </span>
      <h1 className="mt-6 font-heading text-3xl leading-tight text-text sm:text-4xl">{labels.checkingTitle}</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-muted">{labels.checkingText}</p>
      <p className="mt-6 inline-flex items-center gap-2 text-xs text-text-muted">
        <ShieldCheck aria-hidden className="size-4 text-gold" strokeWidth={1.75} />
        3-D Secure
      </p>
    </div>
  );
}
