"use client";
// Copies a value (order number, IBAN, tracking number) to the clipboard with visible and announced
// feedback. Falls back to a hidden textarea where the async Clipboard API is unavailable.

import { Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type CopyButtonProps = {
  value: string;
  /** Accessible name, e.g. "IBAN numarasını kopyala". */
  label: string;
  /** Visible text before copying ("Kopyala"). */
  text: string;
  copiedText: string;
  failedText: string;
  className?: string;
};

function legacyCopy(value: string): boolean {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export default function CopyButton({ value, label, text, copiedText, failedText, className }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  async function copy() {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        ok = true;
      } else {
        ok = legacyCopy(value);
      }
    } catch {
      ok = legacyCopy(value);
    }
    setState(ok ? "copied" : "failed");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2400);
  }

  const Icon = state === "copied" ? Check : state === "failed" ? X : Copy;
  const shown = state === "copied" ? copiedText : state === "failed" ? failedText : text;

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        data-state={state}
        className={cn(
          "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-control border border-border bg-surface px-3 text-xs font-medium text-text transition-colors duration-200",
          "hover:border-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none print:hidden",
          "data-[state=copied]:border-gold data-[state=copied]:text-gold-text data-[state=failed]:border-red-600/60",
          className,
        )}
      >
        <Icon aria-hidden className="size-3.5" strokeWidth={1.75} />
        <span aria-hidden>{shown}</span>
      </button>
      {/* Announced after each click (the button's own name stays the action label). */}
      <span className="sr-only" role="status" aria-live="polite">
        {state === "idle" ? "" : shown}
      </span>
    </>
  );
}
