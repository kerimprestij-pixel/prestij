"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CircleCheckBig, CircleExclamationPoint, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  dismissToast,
  getServerToasts,
  getToasts,
  subscribeToasts,
  toast,
  type ToastItem,
  type ToastTone,
} from "./toast-store";

const ICONS: Record<ToastTone, typeof Info> = {
  success: CircleCheckBig,
  error: CircleExclamationPoint,
  warning: TriangleAlert,
  info: Info,
};

const ICON_COLOR: Record<ToastTone, string> = {
  success: "text-[#2F8F5B] dark:text-[#5CC08A]",
  error: "text-[#B3261E] dark:text-[#F28B82]",
  warning: "text-[#B5730C] dark:text-[#E9A944]",
  info: "text-gold-text",
};

const ACCENT: Record<ToastTone, string> = {
  success: "bg-[#2F8F5B]",
  error: "bg-[#C2413A]",
  warning: "bg-[#D68A12]",
  info: "bg-gold",
};

function supportsPopover(el: HTMLElement | null): el is HTMLElement & { showPopover(): void; hidePopover(): void } {
  return !!el && typeof (el as HTMLElement & { showPopover?: unknown }).showPopover === "function";
}

/**
 * Toast region for the panel (mounted once in the shell). Announced politely; errors as alerts.
 * Lives in the top layer (popover) so toasts stay visible above open dialogs.
 */
export default function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);
  const ref = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!supportsPopover(el)) return;
    const grew = items.length > lastCount.current;
    lastCount.current = items.length;
    try {
      if (items.length === 0) {
        if (el.matches(":popover-open")) el.hidePopover();
        return;
      }
      // Re-raise above a modal dialog that opened after the region was shown.
      if (grew && el.matches(":popover-open") && document.querySelector("dialog[open]")) el.hidePopover();
      if (!el.matches(":popover-open")) el.showPopover();
    } catch {
      // Popover API quirks must never break the page; the fixed position still shows the toasts.
    }
  }, [items]);

  return (
    <div
      ref={ref}
      popover="manual"
      aria-label="Bildirimler"
      role="region"
      className={cn(
        // Reset UA popover styles; fixed at the top so toasts never cover the save bar.
        "pointer-events-none fixed inset-x-3 top-3 bottom-auto z-[80] m-0 flex h-auto w-auto flex-col items-stretch gap-2 overflow-visible border-0 bg-transparent p-0 text-text",
        "sm:inset-x-auto sm:end-5 sm:start-auto sm:top-20 sm:w-[24rem]",
        "[&:not(:popover-open)]:flex",
      )}
    >
      <ol aria-live="polite" aria-relevant="additions" className="flex flex-col gap-2">
        {items.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </ol>
    </div>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const Icon = ICONS[item.tone];

  useEffect(() => {
    remaining.current = item.duration;
  }, [item]);

  useEffect(() => {
    if (paused || item.duration <= 0) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissToast(item.id), Math.max(remaining.current, 800));
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, item]);

  return (
    <li
      role={item.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border border-border bg-surface py-3 ps-4 pe-2 text-sm shadow-[0_16px_40px_-18px_rgb(3_38_95/0.4)] animate-fade-up motion-reduce:animate-none"
    >
      <span aria-hidden className={cn("absolute inset-y-0 start-0 w-0.5", ACCENT[item.tone])} />
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", ICON_COLOR[item.tone])} />
      <div className="min-w-0 flex-1 py-px">
        <p className="font-medium leading-snug text-text">{item.message}</p>
        {item.description ? <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{item.description}</p> : null}
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              dismissToast(item.id);
            }}
            className="mt-2 rounded text-xs font-semibold text-text underline underline-offset-4 hover:text-gold-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        className="grid size-7 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
      >
        <X aria-hidden className="size-4" />
        <span className="sr-only">Bildirimi kapat</span>
      </button>
    </li>
  );
}

/** Stable toast helpers for components: `const { success, error } = useToast();`. */
export function useToast() {
  return useMemo(
    () => ({
      toast,
      success: toast.success,
      error: toast.error,
      info: toast.info,
      warning: toast.warning,
      dismiss: toast.dismiss,
    }),
    [],
  );
}
