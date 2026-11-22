"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, LoaderCircle, Package, Plus, RefreshCw, Search, X } from "lucide-react";
import { PRODUCT_STATUS } from "@/components/panel/labels";
import Badge from "@/components/panel/ui/Badge";
import Button from "@/components/panel/ui/Button";
import Dialog from "@/components/panel/ui/Dialog";
import SortableList, { SortableRow } from "@/components/panel/ui/SortableList";
import { controlClass, controlGroupClass, groupInputClass, iconButtonClass } from "@/components/panel/ui/styles";
import Img from "@/lib/media/Img";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";
import { rememberProducts, searchProducts, useProductLookup, type PickerProduct } from "./picker-data";

type Common = {
  /** Products for the current value, preloaded by the page (optional). */
  items?: readonly PickerProduct[];
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  dialogTitle?: string;
  className?: string;
};

export type ProductPickerSingleProps = Common & {
  multiple?: false;
  value: number | null | undefined;
  onChange: (id: number | null, product: PickerProduct | null) => void;
};

export type ProductPickerMultipleProps = Common & {
  multiple: true;
  value: readonly number[] | null | undefined;
  onChange: (ids: number[], products: PickerProduct[]) => void;
  max?: number;
};

export type ProductPickerProps = ProductPickerSingleProps | ProductPickerMultipleProps;

/** Product field: search by name, SKU or barcode; single choice or an ordered, reorderable list. */
export default function ProductPicker(props: ProductPickerProps) {
  return props.multiple ? <MultipleProducts {...props} /> : <SingleProduct {...props} />;
}

function Thumb({ product, size = 36 }: { product: PickerProduct | undefined; size?: number }) {
  return (
    <span className="relative block shrink-0 overflow-hidden rounded-md border border-border bg-surface-2" style={{ width: size, height: size }}>
      {product?.thumb ? (
        <Img media={product.thumb} alt="" sizes={`${size}px`} fill />
      ) : (
        <Package aria-hidden className="absolute inset-0 m-auto size-1/2 text-text-muted" strokeWidth={1.25} />
      )}
    </span>
  );
}

function ProductLine({ product, id }: { product: PickerProduct | undefined; id: number }) {
  if (!product) return <span className="truncate text-sm text-text-muted">Ürün #{id}</span>;
  const status = PRODUCT_STATUS[product.status];
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-text">{product.name}</span>
        {product.status !== "active" ? (
          <Badge tone={status.tone} size="sm">
            {status.label}
          </Badge>
        ) : null}
      </span>
      <span className="truncate text-xs text-text-muted">{[product.subtitle, product.sku].filter(Boolean).join(" · ")}</span>
    </span>
  );
}

function SingleProduct({ value, onChange, items, invalid, disabled, id, placeholder = "Ürün seçin", dialogTitle, className }: SingleProductProps) {
  const [open, setOpen] = useState(false);
  const control = useFieldControl({ id, invalid });
  const current = value ?? null;
  const lookup = useProductLookup(current ? [current] : [], items);
  const product = current ? lookup(current) : undefined;

  return (
    <div className={cn("relative min-w-0", className)}>
      <button
        type="button"
        {...control}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(controlClass, "flex min-h-12 items-center gap-3 py-1.5 ps-1.5 text-start", current ? "pe-12" : "pe-10")}
      >
        {current ? (
          <>
            <Thumb product={product} />
            <ProductLine product={product} id={current} />
          </>
        ) : (
          <span className="ps-1.5 text-sm text-text-muted">{placeholder}</span>
        )}
        <ChevronsUpDown aria-hidden className={cn("absolute top-1/2 size-4 -translate-y-1/2 text-text-muted", current ? "end-10" : "end-3")} />
      </button>
      {current && !disabled ? (
        <button
          type="button"
          onClick={() => onChange(null, null)}
          className={iconButtonClass("sm", "absolute end-1.5 top-1/2 size-7 -translate-y-1/2")}
        >
          <X aria-hidden className="size-3.5" />
          <span className="sr-only">Ürün seçimini kaldır</span>
        </button>
      ) : null}
      <ProductPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        title={dialogTitle}
        selectedIds={current ? [current] : []}
        onSelect={([p]) => {
          setOpen(false);
          if (p) onChange(p.id, p);
        }}
      />
    </div>
  );
}

type SingleProductProps = ProductPickerSingleProps;

function MultipleProducts({ value, onChange, items, invalid, disabled, id, dialogTitle, max, className }: ProductPickerMultipleProps) {
  const [open, setOpen] = useState(false);
  const control = useFieldControl({ id, invalid });
  const ids = (value ?? []) as number[];
  const lookup = useProductLookup(ids, items);
  const atMax = max !== undefined && ids.length >= max;
  const emit = (next: number[]) => onChange(next, next.map((i) => lookup(i)).filter((p): p is PickerProduct => Boolean(p)));

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      {ids.length > 0 ? (
        <SortableList
          items={ids}
          ariaLabel="Seçili ürünler"
          disabled={disabled}
          getKey={(item) => item}
          getItemLabel={(item) => lookup(item)?.name ?? `Ürün ${item}`}
          onReorder={emit}
          renderItem={(item, ctx) => (
            <SortableRow
              ctx={ctx}
              actions={
                <button
                  type="button"
                  onClick={() => emit(ids.filter((x) => x !== item))}
                  disabled={disabled}
                  aria-label={`${lookup(item)?.name ?? `Ürün ${item}`}: kaldır`}
                  className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}
                >
                  <X aria-hidden className="size-4" />
                </button>
              }
            >
              <span className="flex min-w-0 items-center gap-3">
                <Thumb product={lookup(item)} />
                <ProductLine product={lookup(item)} id={item} />
              </span>
            </SortableRow>
          )}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">Henüz ürün seçilmedi.</div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button {...control} size="sm" icon={Plus} onClick={() => setOpen(true)} disabled={disabled || atMax} aria-haspopup="dialog">
          Ürün ekle
        </Button>
        {max !== undefined ? (
          <span className="text-xs tabular-nums text-text-muted">
            {ids.length} / {max}
          </span>
        ) : null}
      </div>
      <ProductPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        multiple
        title={dialogTitle}
        excludeIds={ids}
        max={max !== undefined ? Math.max(0, max - ids.length) : undefined}
        onSelect={(chosen) => {
          setOpen(false);
          emit([...ids, ...chosen.map((p) => p.id).filter((i) => !ids.includes(i))]);
        }}
      />
    </div>
  );
}

export type ProductPickerDialogProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (products: PickerProduct[]) => void;
  multiple?: boolean;
  max?: number;
  /** Current choice (single mode). */
  selectedIds?: readonly number[];
  /** Already chosen (multiple mode): shown as "Eklendi". */
  excludeIds?: readonly number[];
  title?: string;
};

/** Product search dialog (name, SKU or barcode). */
export function ProductPickerDialog({ open, onClose, title, ...rest }: ProductPickerDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title ?? (rest.multiple ? "Ürün ekle" : "Ürün seç")} size="md" bodyClassName="p-0 sm:p-0">
      {open ? <ProductSearch onClose={onClose} {...rest} /> : null}
    </Dialog>
  );
}

function ProductSearch({ onClose, onSelect, multiple = false, max, selectedIds, excludeIds }: Omit<ProductPickerDialogProps, "open" | "title">) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerProduct[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [chosen, setChosen] = useState<PickerProduct[]>([]);
  const [single, setSingle] = useState<number | null>(selectedIds?.[0] ?? null);
  const listRef = useRef<HTMLUListElement>(null);
  const excluded = new Set(excludeIds ?? []);
  const limit = max ?? Infinity;

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      searchProducts(query)
        .then((list) => {
          if (!alive) return;
          setResults(list);
          setError(false);
        })
        .catch(() => alive && setError(true));
    }, query ? 250 : 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, retry]);

  const toggle = (p: PickerProduct) => {
    if (excluded.has(p.id)) return;
    if (!multiple) {
      setSingle(p.id);
      return;
    }
    setChosen((prev) => (prev.some((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : prev.length >= limit ? prev : [...prev, p]));
  };

  const confirm = (list?: PickerProduct[]) => {
    const picked = list ?? (multiple ? chosen : (results ?? []).filter((p) => p.id === single));
    if (!multiple && picked.length === 0 && single !== null) {
      onClose();
      return;
    }
    if (picked.length === 0) return;
    rememberProducts(picked);
    onSelect(picked);
  };

  const move = (delta: 1 | -1) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-product]") ?? []);
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[Math.min(buttons.length - 1, Math.max(0, index + delta))]?.focus();
  };

  return (
    <div className="flex flex-col">
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
                move(1);
              }
            }}
            placeholder="Ürün adı, SKU veya barkod…"
            aria-label="Ürün ara"
            className={cn(groupInputClass, "h-10 ps-2")}
          />
        </div>
      </div>
      <div className="min-h-[16rem] px-3 py-3 sm:px-4">
        {error ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-text-muted">
            Ürünler yüklenemedi.
            <Button size="sm" icon={RefreshCw} onClick={() => setRetry((n) => n + 1)}>
              Tekrar dene
            </Button>
          </div>
        ) : results === null ? (
          <p role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-text-muted">
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Yükleniyor…
          </p>
        ) : results.length === 0 ? (
          <p role="status" className="py-12 text-center text-sm text-text-muted">
            {query ? `“${query}” ile eşleşen ürün yok.` : "Henüz ürün yok."}
          </p>
        ) : (
          <ul
            ref={listRef}
            aria-label="Ürünler"
            className="space-y-0.5"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                move(event.key === "ArrowDown" ? 1 : -1);
              }
            }}
          >
            {results.map((p) => {
              const isExcluded = excluded.has(p.id);
              const selected = multiple ? chosen.some((x) => x.id === p.id) : single === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    data-product
                    aria-pressed={selected}
                    aria-disabled={isExcluded || undefined}
                    onClick={() => toggle(p)}
                    onDoubleClick={() => !multiple && !isExcluded && confirm([p])}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                      selected && "bg-gold/10 hover:bg-gold/15",
                      isExcluded && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <Thumb product={p} size={40} />
                    <ProductLine product={p} id={p.id} />
                    <span
                      aria-hidden
                      className={cn(
                        "ms-auto grid size-5 shrink-0 place-items-center border",
                        multiple ? "rounded-md" : "rounded-full",
                        selected ? "border-gold bg-gold text-gold-contrast" : "border-border-strong/40",
                      )}
                    >
                      {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
                    </span>
                    {isExcluded ? <span className="text-[0.6875rem] text-text-muted">Eklendi</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3.5 sm:px-6">
        <p aria-live="polite" className="text-sm text-text-muted">
          {multiple ? (chosen.length ? `${chosen.length} ürün seçildi` : "Eklenecek ürünleri seçin.") : single ? "1 ürün seçili" : "Bir ürün seçin."}
        </p>
        <div className="ms-auto flex items-center gap-2">
          <Button onClick={onClose}>Vazgeç</Button>
          <Button variant="primary" onClick={() => confirm()} disabled={multiple ? chosen.length === 0 : single === null}>
            {multiple && chosen.length > 1 ? `${chosen.length} ürünü ekle` : "Seç"}
          </Button>
        </div>
      </div>
    </div>
  );
}
