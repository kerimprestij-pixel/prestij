"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabItem = {
  value: string;
  label: React.ReactNode;
  icon?: LucideIcon;
  /** Small count or badge after the label. */
  badge?: React.ReactNode;
  /** Marks the tab (red dot) when a field inside has an error. */
  invalid?: boolean;
  disabled?: boolean;
  /** Panel content. Omit it to use Tabs as a pure tab bar and render the panel yourself. */
  content?: React.ReactNode;
};

export type TabsProps = {
  items: TabItem[];
  /** Controlled value. */
  value?: string;
  /** Uncontrolled initial value (default: first enabled tab). */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Accessible name of the tab list, e.g. "Ürün bölümleri". */
  ariaLabel: string;
  /** "underline" for page sections, "pills" for compact switches inside cards. */
  variant?: "underline" | "pills";
  /** Keep inactive panels mounted (hidden) so their state and DOM survive (default true). */
  keepMounted?: boolean;
  className?: string;
  listClassName?: string;
  panelClassName?: string;
};

/** WAI-ARIA tabs: arrow keys, Home/End, roving tabindex; scrolls sideways on narrow screens. */
export default function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  ariaLabel,
  variant = "underline",
  keepMounted = true,
  className,
  listClassName,
  panelClassName,
}: TabsProps) {
  const baseId = useId();
  const firstEnabled = items.find((i) => !i.disabled)?.value ?? items[0]?.value ?? "";
  const [internal, setInternal] = useState(defaultValue ?? firstEnabled);
  const current = value ?? internal;
  const active = items.some((i) => i.value === current && !i.disabled) ? current : firstEnabled;
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement>(null);

  // On narrow screens the strip scrolls sideways: keep the active tab (e.g. the one a failed save
  // jumped to, with its error dot) in view. Horizontal only, so the page itself never jumps.
  useEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current.get(active);
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const listBox = list.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    const margin = 24;
    if (tabBox.left < listBox.left) list.scrollBy({ left: tabBox.left - listBox.left - margin });
    else if (tabBox.right > listBox.right) list.scrollBy({ left: tabBox.right - listBox.right + margin });
  }, [active]);

  const select = (next: string) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const enabled = items.filter((i) => !i.disabled);
    const index = enabled.findIndex((i) => i.value === active);
    let next: TabItem | undefined;
    if (event.key === "ArrowRight") next = enabled[(index + 1) % enabled.length];
    else if (event.key === "ArrowLeft") next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    select(next.value);
    tabRefs.current.get(next.value)?.focus();
  };

  const hasPanels = items.some((i) => i.content !== undefined);
  const id = (kind: "tab" | "panel", v: string) => `${baseId}-${kind}-${v}`;

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className={cn(
          "flex max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          variant === "underline" ? "gap-1 border-b border-border" : "inline-flex gap-0.5 rounded-lg border border-border bg-surface-2/70 p-0.5",
          listClassName,
        )}
      >
        {items.map((item) => {
          const selected = item.value === active;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              ref={(el) => {
                if (el) tabRefs.current.set(item.value, el);
                else tabRefs.current.delete(item.value);
              }}
              type="button"
              role="tab"
              id={id("tab", item.value)}
              aria-selected={selected}
              aria-controls={hasPanels ? id("panel", item.value) : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.value)}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
                variant === "underline"
                  ? cn(
                      "-mb-px border-b-2 px-3 py-2.5",
                      selected ? "border-gold font-medium text-text" : "border-transparent text-text-muted hover:text-text",
                    )
                  : cn(
                      "rounded-md px-3 py-1.5",
                      selected ? "bg-surface font-medium text-text shadow-[0_1px_2px_rgb(3_38_95/0.08)]" : "text-text-muted hover:text-text",
                    ),
              )}
            >
              {Icon ? <Icon aria-hidden className={cn("size-4", selected ? "text-gold-text" : "text-text-muted")} strokeWidth={1.75} /> : null}
              {item.label}
              {item.badge != null ? (
                <span className="rounded-full bg-surface-2 px-1.5 text-[0.6875rem] font-medium tabular-nums text-text-muted">{item.badge}</span>
              ) : null}
              {item.invalid ? (
                <>
                  <span aria-hidden className="size-1.5 rounded-full bg-[#C2413A]" />
                  <span className="sr-only">(hatalı alan var)</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
      {hasPanels
        ? items.map((item) => {
            const selected = item.value === active;
            if (!selected && !keepMounted) return null;
            return (
              <div
                key={item.value}
                role="tabpanel"
                id={id("panel", item.value)}
                aria-labelledby={id("tab", item.value)}
                hidden={!selected}
                tabIndex={0}
                className={cn("pt-5 focus-visible:outline-none", panelClassName)}
              >
                {item.content}
              </div>
            );
          })
        : null}
    </div>
  );
}
