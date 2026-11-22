"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Copy, Plus, Trash2 } from "lucide-react";
import Button from "@/components/panel/ui/Button";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import SortableList, { moveItem } from "@/components/panel/ui/SortableList";
import { iconButtonClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";

export type RepeaterItemContext<T> = {
  index: number;
  /** Replace or update this item. */
  update: (next: T | ((prev: T) => T)) => void;
};

export type RepeaterProps<T> = {
  items: T[];
  onChange: (items: T[]) => void;
  /** A new, empty item. */
  createItem: () => T;
  /** The fields of one item. */
  renderItem: (item: T, ctx: RepeaterItemContext<T>) => React.ReactNode;
  /** Singular noun, e.g. "Koku" → "Koku 2", "Koku ekle". */
  noun: string;
  /** Header text after "Koku 2", e.g. the product name. */
  itemSummary?: (item: T, index: number) => string | null | undefined;
  /** Accessible name of the list, e.g. "Kokular". */
  ariaLabel: string;
  min?: number;
  max?: number;
  addLabel?: string;
  /** Collapsible items (default true); new items open expanded. */
  collapsible?: boolean;
  /** Start existing items collapsed (default: collapsed when there are more than 3). */
  defaultCollapsed?: boolean;
  /** Ask before removing an item (default true). */
  confirmRemove?: boolean;
  allowDuplicate?: boolean;
  /** Marks an item header when one of its fields has an error (opens it too). */
  itemHasError?: (index: number) => boolean;
  /** Shown when the list is empty. */
  emptyText?: React.ReactNode;
  disabled?: boolean;
  className?: string;
};

/** List editor: add, remove (with confirmation), duplicate, reorder (drag or ↑/↓) and collapse items. */
export default function Repeater<T>({
  items,
  onChange,
  createItem,
  renderItem,
  noun,
  itemSummary,
  ariaLabel,
  min = 0,
  max,
  addLabel,
  collapsible = true,
  defaultCollapsed,
  confirmRemove = true,
  allowDuplicate = true,
  itemHasError,
  emptyText,
  disabled = false,
  className,
}: RepeaterProps<T>) {
  // Stable per-item keys (the items themselves are replaced on every edit). Deterministic for SSR.
  const baseId = useId();
  const [keys, setKeys] = useState<string[]>(() => items.map((_, i) => `${baseId}-${i}`));
  const [generation, setGeneration] = useState(0);
  const keyCounter = useRef(0);
  const newKey = () => `${baseId}-n${++keyCounter.current}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    collapsible && (defaultCollapsed ?? items.length > 3) ? new Set(keys) : new Set(),
  );
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const { confirm, confirmDialog } = useConfirm();

  // Items replaced from outside (reset, server data) with a different length: realign the keys.
  let currentKeys = keys;
  if (keys.length !== items.length) {
    const next = generation + 1;
    currentKeys = items.map((_, i) => keys[i] ?? `${baseId}-g${next}-${i}`);
    setGeneration(next);
    setKeys(currentKeys);
  }

  useEffect(() => {
    if (!focusKey) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-repeater-key="${focusKey}"]`);
    const target = el?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]),textarea,select,[contenteditable="true"]');
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    (target ?? el?.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
  }, [focusKey]);

  const atMax = max !== undefined && items.length >= max;
  const atMin = items.length <= min;
  const label = (item: T, index: number) => {
    const summary = itemSummary?.(item, index)?.trim();
    return summary ? `${noun} ${index + 1} · ${summary}` : `${noun} ${index + 1}`;
  };

  const add = () => {
    if (atMax || disabled) return;
    const key = newKey();
    onChange([...items, createItem()]);
    setKeys([...currentKeys, key]);
    setFocusKey(key);
  };

  const remove = async (index: number) => {
    if (atMin || disabled) return;
    if (confirmRemove) {
      const ok = await confirm({
        title: `${label(items[index], index)} kaldırılsın mı?`,
        description: "Bu öğe listeden çıkarılır. Sayfayı kaydetmeden önce Vazgeç ile geri alabilirsiniz.",
        confirmLabel: "Kaldır",
      });
      if (!ok) return;
    }
    onChange(items.filter((_, i) => i !== index));
    setKeys(currentKeys.filter((_, i) => i !== index));
    const nextKey = currentKeys[index + 1] ?? currentKeys[index - 1];
    requestAnimationFrame(() => {
      const next = nextKey ? listRef.current?.querySelector<HTMLElement>(`[data-repeater-key="${nextKey}"] [data-repeater-title]`) : null;
      (next ?? addRef.current)?.focus();
    });
  };

  const duplicate = (index: number) => {
    if (atMax || disabled) return;
    const copy = structuredClone(items[index]);
    const key = newKey();
    onChange([...items.slice(0, index + 1), copy, ...items.slice(index + 1)]);
    setKeys([...currentKeys.slice(0, index + 1), key, ...currentKeys.slice(index + 1)]);
    setFocusKey(key);
  };

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div ref={listRef} className={cn("space-y-3", className)}>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
          {emptyText ?? `Henüz ${noun.toLocaleLowerCase("tr-TR")} eklenmedi.`}
        </div>
      ) : (
        <SortableList
          items={items}
          ariaLabel={ariaLabel}
          disabled={disabled}
          getKey={(_, index) => currentKeys[index] ?? `i${index}`}
          getItemLabel={label}
          onReorder={(next, { from, to }) => {
            onChange(next);
            setKeys(moveItem(currentKeys, from, to));
          }}
          renderItem={(item, ctx) => {
            const key = currentKeys[ctx.index] ?? `i${ctx.index}`;
            const invalid = itemHasError?.(ctx.index) ?? false;
            const isCollapsed = collapsible && collapsed.has(key) && !invalid;
            const bodyId = `repeater-${key}-body`;
            return (
              <div
                data-repeater-key={key}
                className={cn(
                  "overflow-hidden rounded-xl border bg-surface transition-shadow motion-reduce:transition-none",
                  invalid ? "border-[#C2413A]/50" : "border-border",
                )}
              >
                <div className={cn("flex items-center gap-1 py-1.5 ps-1.5 pe-1.5", !isCollapsed && "border-b border-border bg-surface-2/40")}>
                  {ctx.handle}
                  {collapsible ? (
                    <button
                      type="button"
                      data-repeater-title
                      onClick={() => toggle(key)}
                      aria-expanded={!isCollapsed}
                      aria-controls={bodyId}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-start text-sm font-medium text-text focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                    >
                      <ChevronDown
                        aria-hidden
                        className={cn("size-4 shrink-0 text-text-muted transition-transform motion-reduce:transition-none", isCollapsed && "-rotate-90")}
                      />
                      <span className="truncate">{label(item, ctx.index)}</span>
                      {invalid ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[#C2413A]" /> : null}
                      {invalid ? <span className="sr-only">(hatalı alan var)</span> : null}
                    </button>
                  ) : (
                    <span data-repeater-title tabIndex={-1} className="min-w-0 flex-1 truncate px-1.5 text-sm font-medium text-text">
                      {label(item, ctx.index)}
                    </span>
                  )}
                  <div className="flex shrink-0 items-center">
                    {ctx.moveButtons}
                    {allowDuplicate ? (
                      <button
                        type="button"
                        onClick={() => duplicate(ctx.index)}
                        disabled={disabled || atMax}
                        aria-label={`${label(item, ctx.index)}: çoğalt`}
                        title="Çoğalt"
                        className={cn(iconButtonClass("sm"), "max-[380px]:hidden")}
                      >
                        <Copy aria-hidden className="size-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => remove(ctx.index)}
                      disabled={disabled || atMin}
                      aria-label={`${label(item, ctx.index)}: kaldır`}
                      title={atMin ? `En az ${min} ${noun.toLocaleLowerCase("tr-TR")} gerekli` : "Kaldır"}
                      className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div id={bodyId} hidden={isCollapsed} className="space-y-5 p-4 sm:p-5">
                  {renderItem(item, {
                    index: ctx.index,
                    update: (next) =>
                      onChange(
                        items.map((current, i) =>
                          i === ctx.index ? (typeof next === "function" ? (next as (p: T) => T)(current) : next) : current,
                        ),
                      ),
                  })}
                </div>
              </div>
            );
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button ref={addRef} size="sm" icon={Plus} onClick={add} disabled={disabled || atMax}>
          {addLabel ?? `${noun} ekle`}
        </Button>
        {max !== undefined ? (
          <span className="text-xs text-text-muted tabular-nums">
            {items.length} / {max}
            {atMax ? " · en fazla sayıya ulaşıldı" : ""}
          </span>
        ) : null}
      </div>
      {confirmDialog}
    </div>
  );
}
