"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type CopyButtonProps = {
  /** Text to copy. A value starting with "/" and `absolute` set is prefixed with the page origin. */
  text: string;
  label: string;
  /** Accessible name when the visible label is short (e.g. "Kopyala"). */
  srLabel?: string;
  absolute?: boolean;
  className?: string;
};

async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Older browsers / insecure origins: fall back to a hidden textarea.
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
}

/** Small "copy to clipboard" button with a polite confirmation. */
export default function CopyButton({ text, label, srLabel, absolute = false, className }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function onClick() {
    const value = absolute && text.startsWith("/") ? `${window.location.origin}${text}` : text;
    const ok = await writeClipboard(value);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
      >
        {state === "copied" ? (
          <Check aria-hidden className="size-3.5 text-[#2F8F5B]" />
        ) : (
          <Copy aria-hidden className="size-3.5 text-text-muted" />
        )}
        <span aria-hidden={srLabel ? true : undefined}>{state === "copied" ? "Kopyalandı" : state === "failed" ? "Kopyalanamadı" : label}</span>
        {srLabel ? <span className="sr-only">{srLabel}</span> : null}
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? "Panoya kopyalandı" : state === "failed" ? "Kopyalanamadı" : ""}
      </span>
    </>
  );
}
