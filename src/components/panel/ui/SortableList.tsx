"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { iconButtonClass } from "./styles";

export type SortableItemContext = {
  index: number;
  count: number;
  /** Ready-made drag handle: pointer drag, plus ↑/↓ keys while focused. */
  handle: React.ReactNode;
  /** Ready-made "move up" / "move down" buttons. */
  moveButtons: React.ReactNode;
  moveUp: () => void;
  moveDown: () => void;
  isDragging: boolean;
};

export type SortableListProps<T> = {
  items: T[];
  /** Stable key per item (an id; never the index unless the list is fixed). */
  getKey: (item: T, index: number) => string | number;
  /** Short name of an item for button labels and announcements, e.g. the product name. */
  getItemLabel: (item: T, index: number) => string;
  /** Every move; `dragging` is true for live swaps during a pointer drag (the drop follows as onDragEnd). */
  onReorder: (next: T[], move: { from: number; to: number; dragging?: boolean }) => void;
  /** A pointer drag that moved the item ended (save here when saving per drag, not per swap). */
  onDragEnd?: () => void;
  renderItem: (item: T, ctx: SortableItemContext) => React.ReactNode;
  /** Accessible name of the list. */
  ariaLabel: string;
  disabled?: boolean;
  as?: "ul" | "ol";
  className?: string;
  itemClassName?: string;
};

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

type DragState = {
  key: string | number;
  pointerId: number;
  /** Pointer offset from the item's top edge when the drag started. */
  grab: number;
  lastY: number;
  /** Current translateY of the dragged element. */
  shift: number;
  /** A reorder was requested and the DOM has not caught up yet. */
  waiting: boolean;
  /** At least one swap happened during this drag. */
  moved: boolean;
};

type Control = "handle" | "up" | "down";

/** Keeps the dragged element under the pointer: translateY from its current natural position. */
function pinDragged(elements: Map<string | number, HTMLElement>, state: DragState) {
  const el = elements.get(state.key);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const naturalTop = rect.top - state.shift;
  state.shift = state.lastY - state.grab - naturalTop;
  el.style.transform = `translate3d(0, ${state.shift}px, 0)`;
}

/**
 * Reorderable list: drag the handle (mouse, pen or touch) or use the ↑/↓ buttons and arrow keys.
 * The list reorders live while dragging; every move is announced to screen readers.
 */
export default function SortableList<T>({
  items,
  getKey,
  getItemLabel,
  onReorder,
  onDragEnd,
  renderItem,
  ariaLabel,
  disabled = false,
  as = "ul",
  className,
  itemClassName,
}: SortableListProps<T>) {
  const [draggingKey, setDraggingKey] = useState<string | number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const elements = useRef(new Map<string | number, HTMLElement>());
  const drag = useRef<DragState | null>(null);
  const latest = useRef({ items, getKey, onReorder, onDragEnd });
  /** Keyboard/button move: the control to focus again once the item sits at its new place. */
  const [refocus, setRefocus] = useState<{ key: string | number; control: Control } | null>(null);

  useLayoutEffect(() => {
    latest.current = { items, getKey, onReorder, onDragEnd };
    // After a live reorder the dragged element sits at a new natural position: re-pin it under the pointer.
    const state = drag.current;
    if (state) {
      state.waiting = false;
      pinDragged(elements.current, state);
    }
  });

  // Moving a focused element in the DOM drops focus to <body>: put it back on the same control (or the
  // drag handle when that control is now disabled or hidden, e.g. "up" at the top). Runs once per move.
  useLayoutEffect(() => {
    if (!refocus) return;
    const li = elements.current.get(refocus.key);
    const usable = (el: Element | null | undefined): el is HTMLElement =>
      el instanceof HTMLElement && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0;
    const wanted = li?.querySelector(`[data-sortable-control="${refocus.control}"]`);
    const handle = li?.querySelector('[data-sortable-control="handle"]');
    const el = usable(wanted) ? wanted : usable(handle) ? handle : null;
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [refocus]);

  const indexOfKey = (key: string | number) => latest.current.items.findIndex((item, i) => latest.current.getKey(item, i) === key);

  function announce(item: T, to: number, count: number, dropped = false) {
    const label = getItemLabel(item, to);
    setAnnouncement(`${label}: ${to + 1}. sıra (toplam ${count})${dropped ? ", bırakıldı" : ""}.`);
  }

  /** Button/keyboard moves (current props). */
  function move(from: number, to: number, control: Control) {
    if (to < 0 || to >= items.length || from === to) return;
    setRefocus({ key: getKey(items[from], from), control });
    onReorder(moveItem(items, from, to), { from, to });
    announce(items[from], to, items.length);
  }

  /** Drag moves (latest props: the list may have re-rendered since the drag started). */
  function moveLatest(from: number, to: number) {
    const list = latest.current.items;
    if (to < 0 || to >= list.length || from === to) return;
    if (drag.current) drag.current.moved = true;
    latest.current.onReorder(moveItem(list, from, to), { from, to, dragging: true });
    announce(list[from], to, list.length);
  }

  function maybeSwap(state: DragState) {
    if (state.waiting) return;
    const list = latest.current.items;
    const index = indexOfKey(state.key);
    const el = elements.current.get(state.key);
    if (index < 0 || !el) return;
    const center = state.lastY - state.grab + el.offsetHeight / 2;
    const neighbor = (i: number) => {
      const item = list[i];
      return item === undefined ? null : elements.current.get(latest.current.getKey(item, i)) ?? null;
    };
    const next = neighbor(index + 1);
    const prev = neighbor(index - 1);
    if (next) {
      const r = next.getBoundingClientRect();
      if (center > r.top + r.height / 2) {
        state.waiting = true;
        moveLatest(index, index + 1);
        return;
      }
    }
    if (prev) {
      const r = prev.getBoundingClientRect();
      if (center < r.top + r.height / 2) {
        state.waiting = true;
        moveLatest(index, index - 1);
      }
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>, key: string | number) {
    if (disabled || event.button !== 0) return;
    const el = elements.current.get(key);
    if (!el) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = {
      key,
      pointerId: event.pointerId,
      grab: event.clientY - el.getBoundingClientRect().top,
      lastY: event.clientY,
      shift: 0,
      waiting: false,
      moved: false,
    };
    setDraggingKey(key);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    state.lastY = event.clientY;
    // Gentle auto-scroll near the viewport edges.
    const edge = 56;
    if (event.clientY < edge) window.scrollBy(0, -12);
    else if (event.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
    pinDragged(elements.current, state);
    maybeSwap(state);
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const el = elements.current.get(state.key);
    if (el) el.style.transform = "";
    drag.current = null;
    setDraggingKey(null);
    const index = indexOfKey(state.key);
    if (index >= 0) announce(latest.current.items[index], index, latest.current.items.length, true);
    if (state.moved) latest.current.onDragEnd?.();
  }

  const List = as;

  return (
    <>
      <List aria-label={ariaLabel} className={cn("space-y-2", className)}>
        {items.map((item, index) => {
          const key = getKey(item, index);
          const label = getItemLabel(item, index);
          const isDragging = draggingKey === key;
          const count = items.length;
          const moveUp = () => move(index, index - 1, "up");
          const moveDown = () => move(index, index + 1, "down");

          const handle = (
            <button
              type="button"
              disabled={disabled || count < 2}
              onPointerDown={(event) => onPointerDown(event, key)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" && index > 0) {
                  event.preventDefault();
                  move(index, index - 1, "handle");
                } else if (event.key === "ArrowDown" && index < count - 1) {
                  event.preventDefault();
                  move(index, index + 1, "handle");
                }
              }}
              data-sortable-control="handle"
              aria-roledescription="sürükleme tutamacı"
              aria-label={`${label}: sırayı değiştir (yukarı/aşağı ok tuşları)`}
              className={cn(
                iconButtonClass("sm"),
                "touch-none",
                isDragging ? "cursor-grabbing bg-surface-2 text-text" : "cursor-grab",
              )}
            >
              <GripVertical aria-hidden className="size-4" />
            </button>
          );

          const moveButtons = (
            <span className="inline-flex items-center">
              <button
                type="button"
                onClick={moveUp}
                disabled={disabled || index === 0}
                data-sortable-control="up"
                aria-label={`${label}: yukarı taşı`}
                className={iconButtonClass("sm")}
              >
                <ChevronUp aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                onClick={moveDown}
                disabled={disabled || index === count - 1}
                data-sortable-control="down"
                aria-label={`${label}: aşağı taşı`}
                className={iconButtonClass("sm")}
              >
                <ChevronDown aria-hidden className="size-4" />
              </button>
            </span>
          );

          return (
            <li
              key={key}
              ref={(el) => {
                if (el) elements.current.set(key, el);
                else elements.current.delete(key);
              }}
              className={cn(
                "relative",
                isDragging && "z-10 [&>*]:shadow-[0_18px_40px_-18px_rgb(3_38_95/0.45)] [&>*]:ring-1 [&>*]:ring-gold/40",
                itemClassName,
              )}
            >
              {renderItem(item, { index, count, handle, moveButtons, moveUp, moveDown, isDragging })}
            </li>
          );
        })}
      </List>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

/** A plain bordered row with handle, content and up/down buttons; handy inside renderItem. */
export function SortableRow({
  ctx,
  children,
  actions,
  className,
}: {
  ctx: SortableItemContext;
  children: React.ReactNode;
  /** Extra buttons at the end (e.g. remove). */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border border-border bg-surface py-2 ps-1.5 pe-2 transition-shadow motion-reduce:transition-none",
        className,
      )}
    >
      {ctx.handle}
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 items-center gap-0.5">
        {ctx.moveButtons}
        {actions}
      </div>
    </div>
  );
}
