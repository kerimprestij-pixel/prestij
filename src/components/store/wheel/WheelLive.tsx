"use client";
// Small client pieces of the account prize card: the live countdown (hydration-safe: the server's
// render time is the first snapshot, then it ticks once per second while the tab is visible) and the
// copy button for the code.
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import { formatCountdown, type CountdownLabels } from "./countdown";
import { useNowSeconds } from "./use-countdown";

/** "Kalan süre: 2g 03:14", counting down to `endsAt` (the coupon's real end). */
export function WheelCountdownText({
  endsAt,
  locale,
  template,
  labels,
  serverSeconds,
  className,
}: {
  endsAt: string;
  locale: Locale;
  /** A template with {time}, e.g. wheel.account.timeLeft. */
  template: string;
  labels: CountdownLabels;
  /** The server's render time (epoch seconds): the first snapshot, so hydration matches. */
  serverSeconds: number;
  className?: string;
}) {
  const nowSec = useNowSeconds(serverSeconds) ?? serverSeconds;
  const remaining = Date.parse(endsAt) - nowSec * 1000;
  const time = formatCountdown(remaining, locale, labels);
  if (remaining <= 0) return <span className={className}>{labels.expired}</span>;
  const [before, after = ""] = template.split("{time}");
  return (
    <span className={className}>
      {before}
      {/* role="timer" (like the cart countdowns): read when reached, never announced every second. */}
      <bdi role="timer" className="font-semibold tabular-nums">
        {time}
      </bdi>
      {after}
    </span>
  );
}

/** Copies the prize code; says "Kod kopyalandı." for a moment (announced politely). */
export function CopyCodeButton({ code, copyLabel, copiedLabel }: { code: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // No clipboard permission: the code is selectable (select-all) on the card.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex min-h-10 items-center gap-2 rounded-control border border-border px-3.5 text-sm text-text transition-colors hover:border-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {copied ? <Check aria-hidden className="size-4 text-gold-text" /> : <Copy aria-hidden className="size-4" />}
      <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
    </button>
  );
}
