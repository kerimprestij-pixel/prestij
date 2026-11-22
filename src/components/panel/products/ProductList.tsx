"use client";
// Product list: drag reorder (full list only), bulk status change, inline quick stock edit per variant.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, PackageSearch, Pencil } from "lucide-react";
import type { PanelProductRow } from "@/app/panel/_lib/products";
import { reorderProductsAction, setProductStatusAction } from "@/app/panel/(dashboard)/urunler/actions";
import EmptyState from "@/components/panel/EmptyState";
import { formatNumber, PRODUCT_STATUS, PRODUCT_TYPE } from "@/components/panel/labels";
import ProductThumb from "@/components/panel/ProductThumb";
import StatusBadge from "@/components/panel/StatusBadge";
import Button from "@/components/panel/ui/Button";
import SortableList from "@/components/panel/ui/SortableList";
import { useReorderSaver } from "@/components/panel/ui/use-reorder-saver";
import { focusRingClass, iconButtonClass } from "@/components/panel/ui/styles";
import { toast } from "@/components/panel/ui/toast-store";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import { toPayloadFormData } from "@/lib/panel/action-types";
import type { ProductStatus } from "@/db/schema/catalog";
import { formatPriceRange } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";
import QuickStockDialog from "./QuickStockDialog";

type Props = {
  rows: PanelProductRow[];
  canEdit: boolean;
  reorderable: boolean;
  filtered: boolean;
  clearHref: string;
};

const BULK_OPTIONS: { value: ProductStatus; label: string }[] = [
  { value: "active", label: "Yayına al" },
  { value: "draft", label: "Taslağa al" },
  { value: "archived", label: "Arşivle" },
];

export default function ProductList({ rows, canEdit, reorderable, filtered, clearHref }: Props) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  // Local order for optimistic reorder (saved once per drag / after keyboard moves settle); follows
  // the server rows when nothing is pending.
  const { order, saving: reordering, reorder, commit } = useReorderSaver(rows, saveOrder);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState<ProductStatus>("active");
  const [stockFor, setStockFor] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const visibleIds = order.map((r) => r.id);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const allSelected = selectedVisible.length > 0 && selectedVisible.length === visibleIds.length;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function applyBulk() {
    const ids = selectedVisible;
    if (ids.length === 0) return;
    const label = BULK_OPTIONS.find((o) => o.value === bulkStatus)!.label.toLocaleLowerCase("tr-TR");
    if (bulkStatus !== "active") {
      const ok = await confirm({
        title: `${ids.length} ürün ${bulkStatus === "archived" ? "arşivlensin mi" : "taslağa alınsın mı"}?`,
        description: "Bu ürünler mağazadan kalkar; ürün sayfaları açılmaz. Daha sonra tekrar yayına alabilirsiniz.",
        confirmLabel: bulkStatus === "archived" ? "Arşivle" : "Taslağa al",
        tone: "default",
      });
      if (!ok) return;
    }
    startTransition(async () => {
      const result = await setProductStatusAction(null, toPayloadFormData({ ids, status: bulkStatus }));
      if (result.ok) {
        const skipped = result.data?.skipped.length ?? 0;
        (skipped ? toast.warning : toast.success)(result.message ?? `Seçilen ürünler: ${label}.`);
        setSelected(new Set());
      } else {
        toast.error(result.error);
      }
    });
  }

  async function saveOrder(next: PanelProductRow[]): Promise<boolean> {
    const result = await reorderProductsAction(null, toPayloadFormData({ ids: next.map((r) => r.id) }));
    if (!result.ok) {
      toast.error(result.error, result.code === "conflict" ? { action: { label: "Yenile", onClick: () => router.refresh() } } : undefined);
    }
    return result.ok;
  }

  const stockProduct = stockFor !== null ? (rows.find((r) => r.id === stockFor) ?? null) : null;

  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-surface">
        <EmptyState
          icon={PackageSearch}
          title={filtered ? "Bu filtrede ürün yok" : "Henüz ürün yok"}
          description={filtered ? "Aramayı veya filtreleri değiştirin." : "İlk ürününüzü ekleyin; taslak olarak başlar, hazır olunca yayına alırsınız."}
          action={
            filtered ? (
              <Link href={clearHref} className="text-sm font-medium text-text underline underline-offset-4">
                Tüm ürünler
              </Link>
            ) : canEdit ? (
              <Link href="/panel/urunler/yeni" className="text-sm font-medium text-text underline underline-offset-4">
                Yeni ürün ekle
              </Link>
            ) : null
          }
        />
      </section>
    );
  }

  const renderRow = (p: PanelProductRow, extra?: { handle?: React.ReactNode; moveButtons?: React.ReactNode }) => {
    const status = PRODUCT_STATUS[p.status];
    const checked = selected.has(p.id);
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-surface px-3 py-2.5 transition-colors lg:flex-nowrap",
          checked ? "border-gold/60 bg-gold/[0.04]" : "border-border",
        )}
      >
        <div className="flex min-w-0 flex-1 basis-[calc(100%-1rem)] items-center gap-3 lg:basis-auto">
          {canEdit ? (
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(p.id)}
              aria-label={`${p.name}: seç`}
              className={cn("size-4 shrink-0 accent-[var(--brand)]", focusRingClass)}
            />
          ) : null}
          {extra?.handle}
          <ProductThumb media={p.thumbnail} accentColor={p.accentColor} size={44} />
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium text-text">
              {canEdit ? (
                <Link href={`/panel/urunler/${p.id}`} className={cn("truncate rounded hover:underline", focusRingClass)}>
                  {p.name}
                </Link>
              ) : (
                <span className="truncate">{p.name}</span>
              )}
              {p.type !== "standard" ? (
                <span className="shrink-0 rounded border border-border px-1.5 py-px text-[0.625rem] font-medium uppercase tracking-wider text-text-muted">
                  {PRODUCT_TYPE[p.type]}
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-text-muted">
              {[p.subtitle, p.categoryName ?? "Kategorisiz"].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 sm:gap-3 lg:w-auto lg:justify-end">
          <span className="shrink-0 lg:w-24 lg:text-end">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </span>
          <span className="ms-auto min-w-0 text-end text-sm tabular-nums lg:ms-0 lg:w-36 lg:shrink-0">
            <span className="block text-text lg:whitespace-nowrap">
              {p.minPrice != null && p.maxPrice != null ? formatPriceRange(p.minPrice, p.maxPrice, "tr") : "—"}
            </span>
            <span className="block text-xs text-text-muted">{formatNumber(p.variantCount)} varyant</span>
          </span>
          <button
            type="button"
            onClick={() => setStockFor(p.id)}
            className={cn("shrink-0 rounded-lg px-2 py-1 text-end text-sm tabular-nums transition-colors hover:bg-surface-2 lg:w-24", focusRingClass)}
            aria-label={`${p.name}: stok ${formatNumber(p.totalStock)}${p.lowStockVariants ? `, ${p.lowStockVariants} varyantta düşük` : ""}. Stoğu düzenle`}
          >
            <span className="flex items-center justify-end gap-1 text-text">
              {formatNumber(p.totalStock)}
              <Pencil aria-hidden className="size-3 text-text-muted" />
            </span>
            {p.lowStockVariants > 0 ? (
              <span className="mt-0.5 flex items-center justify-end gap-1 text-xs text-text-muted">
                <span aria-hidden className="size-1.5 rounded-full bg-[#D68A12]" />
                {formatNumber(p.lowStockVariants)} düşük
              </span>
            ) : (
              <span className="block text-xs text-text-muted">stok</span>
            )}
          </button>
          <span className="flex shrink-0 items-center">
            {extra?.moveButtons}
            {canEdit ? (
              <Link href={`/panel/urunler/${p.id}`} className={iconButtonClass("sm")} aria-label={`${p.name}: düzenle`}>
                <ChevronRight aria-hidden className="size-4 rtl:rotate-180" />
              </Link>
            ) : null}
          </span>
        </div>
      </div>
    );
  };

  return (
    <section aria-label="Ürün listesi" className="space-y-3">
      <div className="flex min-h-10 flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
        {canEdit ? (
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selectedVisible.length > 0 && !allSelected;
              }}
              onChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))}
              className={cn("size-4 accent-[var(--brand)]", focusRingClass)}
            />
            {selectedVisible.length ? `${formatNumber(selectedVisible.length)} ürün seçildi` : `${formatNumber(order.length)} ürün`}
          </label>
        ) : (
          <p className="text-sm text-text">{formatNumber(order.length)} ürün</p>
        )}
        {canEdit && selectedVisible.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="bulk-status" className="sr-only">
              Seçilenlere uygulanacak durum
            </label>
            <select
              id="bulk-status"
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value as ProductStatus)}
              className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-text"
            >
              {BULK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Button size="sm" variant="primary" onClick={applyBulk} pending={pending} pendingLabel="Uygulanıyor…">
              Uygula
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Seçimi temizle
            </Button>
          </div>
        ) : null}
        <p className="ms-auto text-xs text-text-muted" aria-live="polite">
          {reordering ? "Sıralama kaydediliyor…" : reorderable ? "Sürükleyerek mağazadaki sırayı değiştirin." : canEdit && filtered ? "Sıralamak için filtreleri temizleyin." : null}
        </p>
      </div>

      {reorderable ? (
        <SortableList
          items={order}
          ariaLabel="Ürünler (sürükleyerek sıralayın)"
          getKey={(p) => p.id}
          getItemLabel={(p) => p.name}
          onReorder={(next, move) => reorder(next, move)}
          onDragEnd={commit}
          renderItem={(p, ctx) => renderRow(p, { handle: ctx.handle, moveButtons: <span className="hidden sm:inline-flex">{ctx.moveButtons}</span> })}
        />
      ) : (
        <ul className="space-y-2">
          {order.map((p) => (
            <li key={p.id}>{renderRow(p)}</li>
          ))}
        </ul>
      )}

      {stockProduct ? <QuickStockDialog product={stockProduct} open onClose={() => setStockFor(null)} /> : null}
      {confirmDialog}
    </section>
  );
}
