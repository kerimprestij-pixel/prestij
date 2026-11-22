"use client";
// Modal for the order-specific legal texts (pre-information form, distance sales agreement).
// Native <dialog> + showModal(): the page behind becomes inert, focus moves in, Escape closes and focus
// returns to the opener. The HTML is rendered and sanitized on the server (core legal-render).

import { X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { format } from "@/i18n/format";
import type { LegalText } from "@/lib/orders/legal-preview";
import { cn } from "@/lib/utils";
import type { CheckoutLabels, CommonLabels } from "./types";

export type LegalDocKey = "preInformation" | "distanceSales";

type LegalModalProps = {
  /** Which document is open, or null (closed). */
  open: LegalDocKey | null;
  /** The rendered text, null while loading. */
  text: LegalText | null;
  status: "idle" | "loading" | "error";
  /** Shown as the heading while the text loads. */
  fallbackTitle: string;
  labels: CheckoutLabels;
  common: CommonLabels;
  onClose: () => void;
  onRetry: () => void;
  /** "I have read it and accept": ticks the matching consent checkbox. */
  onAccept: () => void;
};

/** Legal text at 16 px or more (MSY m.6(1): at least 12 punto); each paragraph keeps its own direction. */
const legalHtmlClass = cn(
  "text-base leading-relaxed text-text-muted [&_li]:[unicode-bidi:plaintext] [&_p]:[unicode-bidi:plaintext]",
  "[&_a]:text-text [&_a]:underline [&_a]:decoration-gold [&_a]:underline-offset-4",
  "[&_h2]:mt-2 [&_h2]:mb-4 [&_h2]:font-heading [&_h2]:text-2xl [&_h2]:text-text",
  "[&_h3]:mt-7 [&_h3]:mb-2 [&_h3]:font-body [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-text",
  "[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:font-medium [&_h4]:text-text",
  "[&_hr]:my-8 [&_hr]:border-border [&_li]:mt-1.5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:ps-5",
  "[&_p]:mt-3 [&_strong]:font-semibold [&_strong]:text-text",
  "[&_aside]:my-4 [&_aside]:rounded-sm [&_aside]:border-s-4 [&_aside]:border-gold [&_aside]:bg-surface-2 [&_aside]:p-4",
);

export default function LegalModal({ open, text, status, fallbackTitle, labels, common, onClose, onRetry, onAccept }: LegalModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const m = labels.legalModal;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      bodyRef.current?.scrollTo({ top: 0 });
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Lock page scroll while open (a modal <dialog> does not do that by itself).
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  // Cache Components keep the page mounted (hidden) after navigating away: close the dialog then.
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop (outside the panel) closes the dialog.
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        "m-auto h-[min(92dvh,52rem)] w-[min(100vw_-_1.5rem,46rem)] max-w-none overflow-hidden rounded-lg border border-border bg-surface p-0 text-text shadow-2xl",
        "backdrop:bg-brand-950/55 backdrop:backdrop-blur-[2px]",
      )}
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-8 sm:py-5">
            <div className="min-w-0">
              <h2 id={titleId} className="font-heading text-2xl leading-tight text-text sm:text-3xl">
                {text?.title ?? fallbackTitle}
              </h2>
              {text && <p className="mt-1 text-xs text-text-muted">{format(m.version, { version: text.version }, "tr")}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-me-2 grid size-11 shrink-0 place-items-center rounded-full text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <X aria-hidden className="size-5" strokeWidth={1.5} />
              <span className="sr-only">{common.close}</span>
            </button>
          </header>

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8" tabIndex={0} aria-busy={status === "loading"}>
            {status === "loading" && (
              <div role="status" className="space-y-3" aria-live="polite">
                <span className="sr-only">{m.loading}</span>
                <div aria-hidden className="animate-pulse space-y-3 motion-reduce:animate-none">
                  <div className="h-6 w-2/3 rounded bg-surface-2" />
                  {Array.from({ length: 9 }, (_, i) => (
                    <div key={i} className={cn("h-3.5 rounded bg-surface-2", i % 3 === 2 ? "w-3/5" : "w-full")} />
                  ))}
                </div>
              </div>
            )}
            {status === "error" && (
              <div role="alert" className="space-y-4">
                <p className="text-sm text-text">{m.error}</p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="min-h-11 rounded-control border border-text/25 px-5 text-sm font-medium text-text hover:border-gold"
                >
                  {m.retry}
                </button>
              </div>
            )}
            {status === "idle" && text && (
              <>
                <p className="mb-6 rounded-sm bg-surface-2 px-4 py-3 text-sm leading-relaxed text-text-muted">{m.note}</p>
                <div className={legalHtmlClass} dangerouslySetInnerHTML={{ __html: text.html }} />
              </>
            )}
          </div>

          <footer className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-8">
            <button
              type="button"
              onClick={onClose}
              className="min-h-12 rounded-control border border-text/25 px-6 text-sm font-medium text-text transition-colors hover:border-gold"
            >
              {m.close}
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={status !== "idle" || !text}
              className="min-h-12 rounded-control bg-brand px-6 text-sm font-medium text-brand-contrast transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {m.accept}
            </button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
