"use client";
// Category list with drag reorder (the storefront shows categories in this order) and delete.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, EyeOff, FolderTree, Trash2 } from "lucide-react";
import { reorderCategoriesAction } from "@/app/panel/(dashboard)/kategoriler/actions";
import EmptyState from "@/components/panel/EmptyState";
import { formatNumber } from "@/components/panel/labels";
import ProductThumb from "@/components/panel/ProductThumb";
import StatusBadge from "@/components/panel/StatusBadge";
import SortableList from "@/components/panel/ui/SortableList";
import { useReorderSaver } from "@/components/panel/ui/use-reorder-saver";
import { focusRingClass, iconButtonClass } from "@/components/panel/ui/styles";
import { toast } from "@/components/panel/ui/toast-store";
import { toPayloadFormData } from "@/lib/panel/action-types";
import type { PanelCategoryRow } from "@/lib/panel/categories/service";
import { cn } from "@/lib/utils";
import DeleteCategoryDialog from "./DeleteCategoryDialog";

export default function CategoryList({ rows }: { rows: PanelCategoryRow[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<PanelCategoryRow | null>(null);

  async function saveOrder(next: PanelCategoryRow[]): Promise<boolean> {
    const result = await reorderCategoriesAction(null, toPayloadFormData({ ids: next.map((c) => c.id) }));
    if (!result.ok) {
      toast.error(result.error, result.code === "conflict" ? { action: { label: "Yenile", onClick: () => router.refresh() } } : undefined);
    }
    return result.ok;
  }
  // Saved once per drag (and after keyboard moves settle), never per swap; the list stays usable.
  const { order, saving, reorder, commit } = useReorderSaver(rows, saveOrder);

  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-surface">
        <EmptyState
          icon={FolderTree}
          title="Henüz kategori yok"
          description="Ürünleri gruplamak için ilk kategoriyi ekleyin (ör. El Sabunu, Duş Jeli)."
          action={
            <Link href="/panel/kategoriler/yeni" className="text-sm font-medium text-text underline underline-offset-4">
              Yeni kategori
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section aria-label="Kategoriler" className="space-y-3">
      <p className="text-xs text-text-muted" aria-live="polite">
        {saving ? "Sıralama kaydediliyor…" : "Sürükleyerek mağazadaki sırayı değiştirin."}
      </p>
      <SortableList
        items={order}
        ariaLabel="Kategoriler (sürükleyerek sıralayın)"
        getKey={(c) => c.id}
        getItemLabel={(c) => c.name}
        onReorder={(next, move) => reorder(next, move)}
        onDragEnd={commit}
        renderItem={(c, ctx) => (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-2 py-2.5 sm:flex-nowrap">
            <div className="flex min-w-0 flex-1 basis-[calc(100%-1rem)] items-center gap-3 sm:basis-auto">
              {ctx.handle}
              <ProductThumb media={c.image} accentColor={c.accentColor} size={44} />
              <div className="min-w-0">
                <Link href={`/panel/kategoriler/${c.id}`} className={cn("block truncate rounded font-medium text-text hover:underline", focusRingClass)}>
                  {c.name}
                </Link>
                <p className="truncate text-xs text-text-muted">/kategori/{c.slug}</p>
              </div>
            </div>
            <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
              {c.isVisible ? (
                <StatusBadge tone="success">Görünür</StatusBadge>
              ) : (
                <StatusBadge>
                  <EyeOff aria-hidden className="size-3" />
                  Gizli
                </StatusBadge>
              )}
              <span className="w-28 text-end text-sm tabular-nums text-text">
                {formatNumber(c.productCount)} ürün
                <span className="block text-xs text-text-muted">{formatNumber(c.activeCount)} yayında</span>
              </span>
              <span className="flex items-center">
                <span className="hidden sm:inline-flex">{ctx.moveButtons}</span>
                <button
                  type="button"
                  onClick={() => setDeleting(c)}
                  aria-label={`${c.name}: sil`}
                  className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
                <Link href={`/panel/kategoriler/${c.id}`} className={iconButtonClass("sm")} aria-label={`${c.name}: düzenle`}>
                  <ChevronRight aria-hidden className="size-4 rtl:rotate-180" />
                </Link>
              </span>
            </div>
          </div>
        )}
      />
      {deleting ? (
        <DeleteCategoryDialog
          key={deleting.id}
          category={deleting}
          others={order.filter((c) => c.id !== deleting.id).map((c) => ({ id: c.id, name: c.name }))}
          open
          onClose={() => setDeleting(null)}
          onDeleted={() => setDeleting(null)}
        />
      ) : null}
    </section>
  );
}
