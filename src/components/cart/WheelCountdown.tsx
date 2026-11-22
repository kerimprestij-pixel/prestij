"use client";

// Live countdown to a gift wheel prize's real expiry. Only this element re-renders every second (the
// shared clock in ./countdown-clock), and only while it is on screen and the tab is visible. Server
// render and hydration show `fallback`, the value the server formatted into the CartView.
import { useEffect, useRef } from "react";
import type { Locale } from "@/i18n/config";
import { formatCountdown, msUntil, type CountdownTexts } from "@/lib/cart/countdown";
import { cn } from "@/lib/utils";
import { useInViewport, useNowSeconds } from "./countdown-clock";

type Props = {
  /** ISO end of validity. */
  endsAt: string;
  /** The server-formatted value ("2g 03:14"), shown until the live clock runs. */
  fallback: string;
  texts: CountdownTexts;
  locale: Locale;
  /** Called once when the live countdown reaches the end (e.g. reload the cart). */
  onExpire?: () => void;
  className?: string;
};

export default function WheelCountdown({ endsAt, fallback, texts, locale, onExpire, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const now = useNowSeconds(useInViewport(ref));
  const left = now == null ? null : msUntil(endsAt, now * 1000);
  const expired = left != null && left < 1000;
  const label = left == null ? fallback : formatCountdown(left, texts, locale);

  const expireRef = useRef(onExpire);
  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);
  const fired = useRef(false);
  useEffect(() => {
    if (!expired || fired.current) return;
    fired.current = true;
    expireRef.current?.();
  }, [expired]);

  // role="timer" is not a live region: the value is read when reached, never announced every second.
  return (
    <span ref={ref} role="timer" className={cn("tabular-nums [unicode-bidi:isolate]", className)}>
      {label}
    </span>
  );
}
