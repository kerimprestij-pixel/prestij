"use client";
import { useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleExclamationPoint, LoaderCircle, RotateCcw, Save } from "lucide-react";
import Button from "@/components/panel/ui/Button";
import { cn } from "@/lib/utils";
import { clearDirty, LEAVE_MESSAGE, markDirty, markMaybeHidden } from "./dirty-registry";

export type SaveBarProps = {
  /** Unsaved changes exist. */
  dirty: boolean;
  /** A save is running. */
  pending: boolean;
  onSave: () => void;
  /** "Vazgeç": back to the saved state. Hidden when omitted. */
  onReset?: () => void;
  saveLabel?: string;
  pendingLabel?: string;
  resetLabel?: string;
  /** Number of fields with errors (shows "2 alan düzeltilmeli"). */
  errorCount?: number;
  /** Extra text shown when there is nothing to save, e.g. "Son kayıt: 9 Kas 2026 14:30". */
  savedNote?: React.ReactNode;
  /** Allow saving without changes (e.g. "Yayınla"). */
  allowCleanSave?: boolean;
  /** Warn before leaving with unsaved changes (tab close, reload, panel links). Default true. */
  guard?: boolean;
  className?: string;
};

/**
 * Sticky save bar at the bottom of an editor: dirty indicator, Vazgeç / Kaydet, Ctrl/⌘+S, and a guard
 * against leaving the page with unsaved changes. Use one per page.
 *
 * Leaving: a panel link asks first and, when the user agrees, resets the editor (the route stays
 * mounted in the background, so the discarded edits would otherwise come back). Back / swipe-back
 * cannot be intercepted: the draft stays in the hidden route and dirty-registry keeps guarding it
 * (reload/close warning, a toast leading back, palette and sign-out ask first).
 */
export default function SaveBar({
  dirty,
  pending,
  onSave,
  onReset,
  saveLabel = "Kaydet",
  pendingLabel = "Kaydediliyor…",
  resetLabel = "Vazgeç",
  errorCount = 0,
  savedNote,
  allowCleanSave = false,
  guard = true,
  className,
}: SaveBarProps) {
  const canSave = !pending && (dirty || allowCleanSave);
  const latest = useRef({ canSave, onSave, onReset, dirty, guard });
  const key = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    latest.current = { canSave, onSave, onReset, dirty, guard };
  });

  // Ctrl/⌘+S saves (the browser's "save page" never opens on an editor).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      // Not while a dialog is open: its own buttons decide.
      if (document.querySelector("dialog[open]")) return;
      if (latest.current.canSave) latest.current.onSave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Leaving with unsaved changes: tab close/reload (beforeunload) and in-app links (click capture).
  useEffect(() => {
    if (!dirty || !guard) {
      clearDirty(key);
      return;
    }
    markDirty(key, {
      path: window.location.pathname + window.location.search,
      node: rootRef.current,
      reset: () => latest.current.onReset?.(),
      navigate: (path) => router.push(path),
    });
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // Discard for real: the route stays mounted (Activity) and would show the edits again.
      clearDirty(key);
      latest.current.onReset?.();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      // Re-runs right away when `dirty` changed; otherwise the route was hidden (e.g. Back).
      markMaybeHidden(key);
    };
  }, [dirty, guard, key, router]);

  // Closed for good (not just hidden, where the element stays in the document): nothing left to guard.
  useEffect(() => {
    const node = rootRef.current;
    return () => {
      if (!node?.isConnected) clearDirty(key);
    };
  }, [key]);

  const status = pending ? (
    <>
      <LoaderCircle aria-hidden className="size-4 animate-spin text-text-muted motion-reduce:animate-none" />
      <span>{pendingLabel}</span>
    </>
  ) : errorCount > 0 ? (
    <>
      <CircleExclamationPoint aria-hidden className="size-4 text-[#B3261E] dark:text-[#F28B82]" />
      <span>{errorCount === 1 ? "1 alan düzeltilmeli" : `${errorCount} alan düzeltilmeli`}</span>
    </>
  ) : dirty ? (
    <>
      <span aria-hidden className="relative flex size-2.5 items-center justify-center">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-gold/50 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-gold" />
      </span>
      <span>Kaydedilmemiş değişiklikler</span>
    </>
  ) : (
    <>
      <CircleCheck aria-hidden className="size-4 text-[#2F8F5B] dark:text-[#5CC08A]" />
      <span>{savedNote ?? "Tüm değişiklikler kaydedildi"}</span>
    </>
  );

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Kaydetme"
      className={cn(
        "sticky bottom-3 z-20 mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border bg-surface/95 px-4 py-3 shadow-[0_18px_44px_-22px_rgb(3_38_95/0.45)] backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:bottom-4 sm:px-5",
        dirty ? "border-gold/50" : "border-border",
        className,
      )}
    >
      <p aria-live="polite" className="flex min-w-0 items-center gap-2 text-sm text-text">
        {status}
      </p>
      <div className="ms-auto flex items-center gap-2">
        {onReset ? (
          <Button icon={RotateCcw} onClick={onReset} disabled={!dirty || pending}>
            {resetLabel}
          </Button>
        ) : null}
        <Button variant="primary" icon={Save} onClick={onSave} disabled={!canSave} pending={pending} pendingLabel={pendingLabel} aria-keyshortcuts="Control+S Meta+S">
          {saveLabel}
          <kbd aria-hidden className="ms-1 hidden rounded border border-brand-contrast/25 px-1 font-sans text-[0.625rem] font-medium opacity-75 lg:inline">
            Ctrl/⌘ S
          </kbd>
        </Button>
      </div>
    </div>
  );
}
