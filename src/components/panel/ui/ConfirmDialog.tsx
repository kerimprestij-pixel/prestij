"use client";
import { useCallback, useId, useRef, useState } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import Button from "./Button";
import Dialog from "./Dialog";

export type ConfirmTone = "danger" | "default";

export type ConfirmDialogProps = {
  open: boolean;
  /** Cancel, Escape or backdrop (ignored while pending). */
  onClose: () => void;
  /** Runs on confirm. A returned promise keeps the dialog pending until it settles; the owner then closes it. */
  onConfirm: () => void | Promise<unknown>;
  title: string;
  description?: React.ReactNode;
  /** Extra content under the description (e.g. the list of places that use a record). */
  children?: React.ReactNode;
  /** Default: "Sil" for danger, "Onayla" otherwise. */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** External pending state (e.g. from a transition). */
  pending?: boolean;
  /** Disable the confirm button (e.g. until a checkbox is ticked). */
  confirmDisabled?: boolean;
};

/** Confirmation for destructive or irreversible actions. Focus starts on the safe choice (Vazgeç). */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Vazgeç",
  tone = "danger",
  pending: externalPending = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const [running, setRunning] = useState(false);
  const pending = externalPending || running;
  const Icon = tone === "danger" ? TriangleAlert : CircleAlert;

  async function confirm() {
    const result = onConfirm();
    if (result && typeof (result as Promise<unknown>).then === "function") {
      setRunning(true);
      try {
        await result;
      } finally {
        setRunning(false);
      }
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      role="alertdialog"
      size="sm"
      title={title}
      hideCloseButton
      dismissible={!pending}
      initialFocusRef={cancelRef}
      describedBy={description ? descriptionId : undefined}
      footer={
        <>
          <Button ref={cancelRef} onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={confirm}
            pending={pending}
            disabled={confirmDisabled}
          >
            {confirmLabel ?? (tone === "danger" ? "Sil" : "Onayla")}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full border",
            tone === "danger"
              ? "border-[#C2413A]/25 bg-[#C2413A]/10 text-[#B3261E] dark:text-[#F28B82]"
              : "border-gold/30 bg-gold/10 text-gold-text",
          )}
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1 pt-1.5 text-sm text-text">
          {description ? (
            <div id={descriptionId} className="leading-relaxed text-text-muted">
              {description}
            </div>
          ) : null}
          {children ? <div className={description ? "mt-3" : undefined}>{children}</div> : null}
        </div>
      </div>
    </Dialog>
  );
}

export type ConfirmOptions = Omit<ConfirmDialogProps, "open" | "onClose" | "onConfirm" | "pending">;

/**
 * Promise-based confirmation: `const { confirm, confirmDialog } = useConfirm();` render `{confirmDialog}`
 * once, then `if (await confirm({ title: "Ürün silinsin mi?" })) …`.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; confirmDialog: React.ReactNode } {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOptions(next);
      }),
    [],
  );

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  const confirmDialog = options ? (
    <ConfirmDialog {...options} open onClose={() => settle(false)} onConfirm={() => settle(true)} />
  ) : null;

  return { confirm, confirmDialog };
}
