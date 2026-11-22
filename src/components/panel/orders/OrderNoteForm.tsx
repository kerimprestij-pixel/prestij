"use client";
import { useActionState, useId, useState } from "react";
import { CircleCheckBig, CircleExclamationPoint, LoaderCircle, StickyNote } from "lucide-react";
import { runOrderAction } from "@/app/panel/(dashboard)/siparisler/actions";
import { cn } from "@/lib/utils";
import { INITIAL_ORDER_ACTION_STATE, type OrderActionState } from "./action-state";
import { errorClass, fieldClass, hintClass, primaryButtonClass } from "./form-styles";

const MAX = 1000;

/** "Not ekle": an internal note in the order history (never shown to the customer). */
export default function OrderNoteForm({ orderId }: { orderId: number }) {
  const [note, setNote] = useState("");
  const id = useId();
  const [state, formAction, pending] = useActionState(async (prev: OrderActionState, formData: FormData) => {
    const next = await runOrderAction(prev, formData);
    if (next.status === "success") setNote("");
    return next;
  }, INITIAL_ORDER_ACTION_STATE);

  const error = state.status === "error" ? (state.fieldErrors.note ?? state.message) : null;
  const left = MAX - note.length;

  return (
    <form action={formAction} noValidate className="space-y-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="action" value="add_note" />
      <label htmlFor={`${id}-note`} className="sr-only">
        Sipariş notu
      </label>
      <textarea
        id={`${id}-note`}
        name="note"
        rows={2}
        maxLength={MAX}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Ekibiniz için bir not yazın (müşteri görmez)…"
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        className={cn(fieldClass, "min-h-16 py-2")}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id={`${id}-hint`} className={cn(hintClass, "mt-0")}>
          {left < 100 ? `${left} karakter kaldı` : "Notlar yalnızca panelde görünür."}
        </p>
        <button type="submit" disabled={pending || note.trim().length === 0} className={primaryButtonClass}>
          {pending ? (
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <StickyNote aria-hidden className="size-4" />
          )}
          {pending ? "Kaydediliyor…" : "Not ekle"}
        </button>
      </div>
      <div aria-live="polite" className="min-h-0">
        {error ? (
          <p id={`${id}-error`} className={cn(errorClass, "flex items-center gap-1.5")}>
            <CircleExclamationPoint aria-hidden className="size-3.5 shrink-0" />
            {error}
          </p>
        ) : state.status === "success" && state.message ? (
          <p key={state.seq} className="flex items-center gap-1.5 text-xs font-medium text-text">
            <CircleCheckBig aria-hidden className="size-3.5 shrink-0 text-[#2F8F5B]" />
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
