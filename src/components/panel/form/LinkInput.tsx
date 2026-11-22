"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Link2, ListTree, LoaderCircle, Search, X } from "lucide-react";
import Button from "@/components/panel/ui/Button";
import Dialog from "@/components/panel/ui/Dialog";
import { controlGroupClass, errorClass, groupInputClass, iconButtonClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";
import { foldText } from "@/lib/panel/format";
import { hrefError, tidyHref, type LinkTarget, type LinkTargetGroup } from "./href";
import { findLinkTarget, loadLinkTargets } from "./picker-data";

/** Loads the shared link targets once; null while loading or after an error. */
export function useLinkTargets(enabled = true): { groups: LinkTargetGroup[] | null; error: boolean; reload: () => void } {
  const [groups, setGroups] = useState<LinkTargetGroup[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadLinkTargets(attempt > 0)
      .then((g) => {
        if (!alive) return;
        setGroups(g);
        setError(false);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [enabled, attempt]);
  return { groups, error, reload: () => setAttempt((n) => n + 1) };
}

export type LinkInputProps = {
  value: string | null | undefined;
  onChange: (href: string) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  /** Hide the "Sitede aç" shortcut. */
  hideOpen?: boolean;
  className?: string;
};

/**
 * Link field: pick an internal page (static routes, products, categories, pages, legal, blog) or type a
 * URL. Internal links are stored as canonical Turkish paths ("/urunler/lavanta"); the storefront
 * localizes them. Validated like the server's hrefInput.
 */
export default function LinkInput({ value, onChange, placeholder = "/urunler veya https://…", invalid, disabled, id, hideOpen, className }: LinkInputProps) {
  const href = value ?? "";
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const localError = touched ? hrefError(href) : null;
  // `undefined` (not false) when neither applies, so an error on the enclosing <Field> still marks the input.
  const control = useFieldControl({ id, invalid: invalid || Boolean(localError) || undefined });
  const { groups } = useLinkTargets(Boolean(href) || open);
  const match = findLinkTarget(groups, href);
  const errorId = `${control.id}-href-error`;
  const external = /^https:\/\//i.test(href);

  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className={controlGroupClass}>
        <span aria-hidden className="flex items-center ps-3 text-text-muted">
          <Link2 className="size-4" />
        </span>
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          {...control}
          aria-describedby={[control["aria-describedby"], localError ? errorId : null].filter(Boolean).join(" ") || undefined}
          disabled={disabled}
          value={href}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            setTouched(true);
            const tidy = tidyHref(href);
            if (tidy !== href) onChange(tidy);
          }}
          className={cn(groupInputClass, "h-10 ps-2")}
        />
        {href && !disabled ? (
          <button type="button" onClick={() => onChange("")} className={iconButtonClass("sm", "my-auto me-1 size-7")}>
            <X aria-hidden className="size-3.5" />
            <span className="sr-only">Bağlantıyı temizle</span>
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex shrink-0 items-center gap-1.5 border-s border-border bg-surface-2/70 px-3 text-xs font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ListTree aria-hidden className="size-3.5 text-text-muted" />
          Sayfa seç
        </button>
      </div>

      {match || (href && !localError && !disabled && !hideOpen) ? (
        <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          {match ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-px font-medium text-text">{match.group}</span>
              <span className="truncate">{match.label}</span>
            </span>
          ) : external ? (
            <span>Dış bağlantı yeni sekmede açılır.</span>
          ) : null}
          {href && !localError && !hideOpen && (href.startsWith("/") || external) ? (
            <a
              href={external ? href : `/tr${href === "/" ? "" : href}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ms-auto inline-flex items-center gap-1 rounded font-medium text-text-muted underline-offset-4 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sitede aç
              <ArrowUpRight aria-hidden className="size-3" />
            </a>
          ) : null}
        </div>
      ) : null}

      {localError && !invalid ? (
        <p id={errorId} className={errorClass}>
          {localError}
        </p>
      ) : null}

      <LinkPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        current={href}
        onSelect={(target) => {
          onChange(target.href);
          setTouched(true);
          setOpen(false);
        }}
      />
    </div>
  );
}

export type LinkPickerDialogProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (target: LinkTarget) => void;
  /** Highlights the current link. */
  current?: string;
};

/** Searchable list of internal pages grouped by kind. */
export function LinkPickerDialog({ open, onClose, onSelect, current }: LinkPickerDialogProps) {
  const [query, setQuery] = useState("");
  const { groups, error, reload } = useLinkTargets(open);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!groups) return null;
    const q = foldText(query.trim());
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => foldText(`${i.label} ${i.href}`).includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  const focusItem = (delta: 1 | -1) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-link-item]") ?? []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[Math.min(items.length - 1, Math.max(0, index + delta))]?.focus();
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        setQuery("");
        onClose();
      }}
      title="Bağlantı seç"
      description="Sitenizdeki bir sayfayı seçin. Bağlantı her dilde doğru adrese gider."
      size="md"
      bodyClassName="px-0 py-0 sm:px-0"
    >
      <div className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-3 sm:px-6">
        <div className={controlGroupClass}>
          <span aria-hidden className="flex items-center ps-3 text-text-muted">
            <Search className="size-4" />
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusItem(1);
              }
            }}
            placeholder="Sayfa, ürün veya kategori ara…"
            aria-label="Bağlantılarda ara"
            className={cn(groupInputClass, "h-10 ps-2")}
          />
        </div>
      </div>
      <div
        ref={listRef}
        className="px-3 py-3 sm:px-4"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            focusItem(event.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        {error ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-text-muted">
            Sayfa listesi yüklenemedi.
            <Button size="sm" onClick={reload}>
              Tekrar dene
            </Button>
          </div>
        ) : !filtered ? (
          <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-text-muted" role="status">
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Yükleniyor…
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-text-muted" role="status">
            “{query}” için sonuç yok. Dış bir adres için alana doğrudan https:// ile yazabilirsiniz.
          </p>
        ) : (
          filtered.map((group) => (
            <section key={group.label} className="mb-3 last:mb-0" aria-label={group.label}>
              <h3 className="px-2 pb-1 pt-2 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-text-muted">{group.label}</h3>
              <ul>
                {group.items.map((item) => {
                  const selected = item.href === current;
                  return (
                    <li key={`${group.label}-${item.href}`}>
                      <button
                        type="button"
                        data-link-item
                        onClick={() => onSelect(item)}
                        aria-current={selected ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-start text-sm transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                          selected && "bg-gold/10",
                        )}
                      >
                        <span className="min-w-0 truncate text-text">{item.label}</span>
                        <span className="shrink-0 truncate font-mono text-xs text-text-muted">{item.href}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </Dialog>
  );
}
