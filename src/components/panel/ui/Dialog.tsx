"use client";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { iconButtonClass } from "./styles";

export type DialogSize = "sm" | "md" | "lg" | "xl";

export type DialogProps = {
  /** Controlled: the dialog is shown (modal) while true. Content mounts only while open. */
  open: boolean;
  /** Called on Escape, backdrop click and the close button (only while `dismissible`). */
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: DialogSize;
  /** "top" suits search dialogs (command palette); "center" everything else. */
  placement?: "center" | "top";
  /** Sticky footer, usually the action buttons (end-aligned). */
  footer?: React.ReactNode;
  /** Element to focus when the dialog opens. Default: the first [autofocus] or form control, else the close button. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Set false while an action is pending so Escape/backdrop cannot close it. */
  dismissible?: boolean;
  hideCloseButton?: boolean;
  /** "alertdialog" for confirmations. */
  role?: "dialog" | "alertdialog";
  /** Hide the visual header (the title stays as the accessible name). */
  hideHeader?: boolean;
  /** id of an element in the body that describes the dialog (when not using `description`). */
  describedBy?: string;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
};

const SIZES: Record<DialogSize, string> = {
  sm: "w-[min(28rem,calc(100vw-1.5rem))]",
  md: "w-[min(36rem,calc(100vw-1.5rem))]",
  lg: "w-[min(48rem,calc(100vw-1.5rem))]",
  xl: "w-[min(68rem,calc(100vw-1.5rem))]",
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[contenteditable="true"],[tabindex]:not([tabindex="-1"])';

// Page scroll is locked while at least one panel dialog is open (dialogs can stack).
let openDialogs = 0;
let previousOverflow = "";
function lockScroll() {
  if (openDialogs++ === 0) {
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }
}
function unlockScroll() {
  if (--openDialogs <= 0) {
    openDialogs = 0;
    document.documentElement.style.overflow = previousOverflow;
  }
}

function visibleFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[hidden],[inert]") && el.getClientRects().length > 0,
  );
}

/**
 * Modal dialog on the native <dialog> element: the rest of the page is inert, Tab stays inside,
 * Escape closes, and focus returns to the element that opened it.
 */
export default function Dialog({
  open,
  onClose,
  title,
  description,
  size = "md",
  placement = "center",
  footer,
  initialFocusRef,
  dismissible = true,
  hideCloseButton = false,
  role = "dialog",
  hideHeader = false,
  describedBy,
  className,
  bodyClassName,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointerDownOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    lockScroll();

    const target =
      initialFocusRef?.current ??
      dialog.querySelector<HTMLElement>("[autofocus],[data-autofocus]") ??
      dialog.querySelector<HTMLElement>(
        '[data-dialog-body] input:not([disabled]):not([type="hidden"]),[data-dialog-body] textarea:not([disabled]),[data-dialog-body] select:not([disabled])',
      ) ??
      closeRef.current ??
      visibleFocusables(dialog)[0];
    target?.focus({ preventScroll: true });

    const onCancel = (event: Event) => {
      // Escape: keep the element open and let the owner decide (the owner flips `open`).
      event.preventDefault();
      if (dismissibleRef.current) onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = visibleFocusables(dialog);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    // Browsers may force-close a dialog whose cancel was prevented (repeated Escape): resync.
    const onNativeClose = () => {
      if (dismissibleRef.current) onCloseRef.current();
      else if (!dialog.open) dialog.showModal();
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("keydown", onKeyDown);
    dialog.addEventListener("close", onNativeClose);

    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("keydown", onKeyDown);
      dialog.removeEventListener("close", onNativeClose);
      if (dialog.open) dialog.close();
      unlockScroll();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, initialFocusRef]);

  return (
    <dialog
      ref={ref}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : describedBy}
      onPointerDown={(event) => {
        pointerDownOnBackdrop.current = event.target === event.currentTarget;
      }}
      onKeyDown={(event) => {
        // A dialog rendered inside the page's <form>: Enter in its inputs must not submit that form.
        const target = event.target;
        if (event.key === "Enter" && target instanceof HTMLInputElement && target.form && !event.currentTarget.contains(target.form)) {
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> element itself (the content fills the box).
        if (event.target === event.currentTarget && pointerDownOnBackdrop.current && dismissible) onClose();
        pointerDownOnBackdrop.current = false;
      }}
      className={cn(
        "max-h-[min(88dvh,60rem)] overflow-hidden rounded-2xl border border-border bg-surface p-0 text-text shadow-[0_24px_64px_-24px_rgb(3_38_95/0.45)] backdrop:bg-[#03265F]/40 backdrop:backdrop-blur-[2px] open:flex open:flex-col",
        "transition-[opacity,translate] duration-200 ease-out starting:open:translate-y-2 starting:open:opacity-0 motion-reduce:transition-none",
        placement === "top" ? "mx-auto mb-auto mt-[min(12vh,7rem)]" : "m-auto",
        SIZES[size],
        className,
      )}
    >
      {open ? (
        <>
          <header
            className={cn(
              "flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6",
              hideHeader && "sr-only",
            )}
          >
            <div className="min-w-0">
              <h2 id={titleId} className="font-heading text-xl leading-snug text-text">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm text-text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {hideCloseButton || hideHeader ? null : (
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                disabled={!dismissible}
                className={iconButtonClass("md", "-me-2 -mt-1")}
              >
                <X aria-hidden className="size-5" />
                <span className="sr-only">Kapat</span>
              </button>
            )}
          </header>
          <div
            data-dialog-body
            className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6", bodyClassName)}
          >
            {children}
          </div>
          {footer ? (
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2/40 px-5 py-3.5 sm:px-6">
              {footer}
            </footer>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
