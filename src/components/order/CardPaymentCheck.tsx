"use client";
// ?payment=checking: the iyzico callback could not confirm the card result (iyzico unreachable, 3-D
// Secure still finishing); or the latest PayTR attempt is inside its window without a result. Instead of a
// retry button (a second charge), this asks the server a few times (checkCardPaymentAction →
// reconcileCardOrder: iyzico retrieve, PayTR Durum Sorgu) and moves on to the paid order, the declined
// banner or the plain retry panel. If the answer stays open, it shows the slow text and `fallback`
// (iyzico: the retry form, which refuses while iyzico cannot be reached; PayTR: nothing).
import { useEffect, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { checkCardPaymentAction } from "@/app/[locale]/siparis/actions";
import type { Locale } from "@/i18n/config";

const FIRST_MS = 1500;
const INTERVAL_MS = 5000;
const MAX_WAIT_MS = 120_000;

type Props = {
  locale: Locale;
  orderNumber: string;
  token: string;
  labels: { checkingText: string; slowText: string };
  /** Shown once waiting gives up (the retry form). */
  fallback: ReactNode;
};

export default function CardPaymentCheck({ locale, orderNumber, token, labels, fallback }: Props) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      try {
        const res = await checkCardPaymentAction({ locale, orderNumber, token });
        if (stop) return;
        if (res.redirectTo && res.state !== "waiting") {
          window.location.replace(res.redirectTo);
          return;
        }
        if (res.state === "invalid") {
          setSlow(true);
          return;
        }
      } catch {
        // A network hiccup: ask again on the next tick.
      }
      if (Date.now() - started > MAX_WAIT_MS) {
        setSlow(true);
        return;
      }
      timer = setTimeout(tick, INTERVAL_MS);
    };
    timer = setTimeout(tick, FIRST_MS);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [locale, orderNumber, token]);

  if (slow) {
    return (
      <>
        <p className="text-sm leading-relaxed text-text">{labels.slowText}</p>
        {fallback}
      </>
    );
  }
  return (
    <p aria-live="polite" className="flex items-start gap-3 text-sm leading-relaxed text-text-muted">
      <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-gold motion-reduce:animate-none" strokeWidth={1.75} />
      <span>{labels.checkingText}</span>
    </p>
  );
}
