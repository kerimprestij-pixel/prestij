"use client";
// Optimistic list order that is saved once per gesture, for lists that save on reorder (products,
// categories). SortableList reports every swap; saving each one meant one server action, audit row
// and storefront invalidation per row passed, and disabling the list while saving dropped keyboard
// focus. Here a drag saves once at the drop and keyboard/button moves are coalesced (debounced);
// saves never overlap (the latest order is sent after a running save), and the list stays usable.
import { useCallback, useEffect, useRef, useState } from "react";

/** Wait after the last keyboard/button move before saving. */
export const REORDER_SAVE_DELAY_MS = 700;

export type ReorderSaver<T> = {
  /** The order to render (local while changes are pending). */
  order: T[];
  /** Local changes not saved yet (queued or being saved). */
  saving: boolean;
  /** SortableList onReorder: `dragging` moves wait for the drop. */
  reorder: (next: T[], move?: { dragging?: boolean }) => void;
  /** SortableList onDragEnd: save the dropped order now. */
  commit: () => void;
};

/**
 * `save` returns true on success; on failure the list goes back to the last saved order (the caller
 * shows the error). Server rows that arrive while changes are pending do not overwrite the local order.
 */
export function useReorderSaver<T>(rows: T[], save: (next: T[]) => Promise<boolean>): ReorderSaver<T> {
  const [seen, setSeen] = useState(rows);
  const [order, setOrder] = useState(rows);
  const [saving, setSaving] = useState(false);
  if (seen !== rows) {
    setSeen(rows);
    if (!saving) setOrder(rows);
  }

  const saveRef = useRef(save);
  const queued = useRef<T[] | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A pointer drag is in progress: its swaps wait for the drop. */
  const holding = useRef(false);
  const confirmed = useRef(rows);

  useEffect(() => {
    saveRef.current = save;
  });
  // The last order the server confirmed (rows only change after a save or a refresh).
  useEffect(() => {
    if (!saving) confirmed.current = rows;
  }, [rows, saving]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Loops (instead of calling itself) so the latest queued order is sent after a running save.
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) return; // the running save sends the latest order when it finishes
    inFlight.current = true;
    try {
      while (queued.current && !holding.current) {
        const next = queued.current;
        queued.current = null;
        let ok = false;
        try {
          ok = await saveRef.current(next);
        } catch {
          ok = false;
        }
        if (!ok) {
          queued.current = null;
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          setOrder(confirmed.current);
          setSaving(false);
          return;
        }
        confirmed.current = next;
        if (timer.current) return; // more keyboard moves are settling; their timer saves them
      }
      if (!holding.current) setSaving(false);
    } finally {
      inFlight.current = false;
    }
  }, []);

  const reorder = useCallback(
    (next: T[], move?: { dragging?: boolean }) => {
      setOrder(next);
      setSaving(true);
      queued.current = next;
      holding.current = Boolean(move?.dragging);
      if (timer.current) clearTimeout(timer.current);
      timer.current = move?.dragging ? null : setTimeout(() => void flush(), REORDER_SAVE_DELAY_MS);
    },
    [flush],
  );

  const commit = useCallback(() => {
    holding.current = false;
    if (queued.current) void flush();
  }, [flush]);

  return { order, saving, reorder, commit };
}
