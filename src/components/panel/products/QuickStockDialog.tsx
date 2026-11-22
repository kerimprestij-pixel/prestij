"use client";
// Quick stock edit for one product's variants (staff+). Each changed variant is sent with the stock
// the user saw; the server refuses the save when an order changed it meanwhile and the dialog then
// shows the current value next to the field.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import type { PanelProductRow } from "@/app/panel/_lib/products";
import { quickStockAction } from "@/app/panel/(dashboard)/urunler/actions";
import Field from "@/components/panel/form/Field";
import { NumberInput } from "@/components/panel/form/NumberInput";
import { formatNumber } from "@/components/panel/labels";
import Button from "@/components/panel/ui/Button";
import Dialog from "@/components/panel/ui/Dialog";
import { toast } from "@/components/panel/ui/toast-store";
import { toPayloadFormData } from "@/lib/panel/action-types";

type Props = { product: PanelProductRow; open: boolean; onClose: () => void };

export default function QuickStockDialog({ product, open, onClose }: Props) {
  const router = useRouter();
  const [seen, setSeen] = useState<Record<number, number>>(() => Object.fromEntries(product.variants.map((v) => [v.id, v.stock])));
  const [values, setValues] = useState<Record<number, number | null>>(() => Object.fromEntries(product.variants.map((v) => [v.id, v.stock])));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [pending, setPending] = useState(false);

  const fresh = new Map(product.variants.map((v) => [v.id, v.stock]));
  const changed = product.variants.filter((v) => values[v.id] !== null && values[v.id] !== seen[v.id]);
  const stale = product.variants.some((v) => fresh.get(v.id) !== seen[v.id]);
  const invalid = product.variants.some((v) => values[v.id] === null);

  async function save() {
    if (changed.length === 0) return onClose();
    const items = changed.map((v) => ({ variantId: v.id, seenStock: seen[v.id], stock: values[v.id] as number }));
    setPending(true);
    const result = await quickStockAction(null, toPayloadFormData({ productId: product.id, items }));
    setPending(false);
    if (result.ok) {
      toast.success(result.message ?? "Stok güncellendi.");
      onClose();
      return;
    }
    const next: Record<number, string> = {};
    for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
      const m = /^items\.(\d+)\.stock$/.exec(path);
      if (m) next[items[Number(m[1])].variantId] = message;
    }
    setErrors(next);
    toast.error(result.error);
    // Fetch the current stock so the dialog can show it.
    if (result.code === "conflict") router.refresh();
  }

  function adoptCurrent() {
    setSeen(Object.fromEntries(product.variants.map((v) => [v.id, v.stock])));
    setErrors({});
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Stoğu düzenle"
      description={`${product.name} · varyant başına eldeki adet`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" onClick={save} pending={pending} pendingLabel="Kaydediliyor…" disabled={invalid || (stale && Object.keys(errors).length > 0)}>
            {changed.length ? `${changed.length} değişikliği kaydet` : "Kapat"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {stale && Object.keys(errors).length > 0 ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#D68A12]/40 bg-[#D68A12]/10 px-3 py-2 text-sm text-text">
            <span>Siz düzenlerken stok değişti. Güncel değerleri gördükten sonra yeniden kaydedin.</span>
            <Button size="sm" icon={RefreshCw} onClick={adoptCurrent}>
              Güncel stokla devam et
            </Button>
          </div>
        ) : null}
        {product.variants.length === 0 ? <p className="text-sm text-text-muted">Bu ürünün varyantı yok.</p> : null}
        {product.variants.map((v) => {
          const now = fresh.get(v.id)!;
          const label = [v.title || v.sku, v.isActive ? null : "pasif"].filter(Boolean).join(" · ");
          return (
            <Field
              key={v.id}
              label={label}
              help={
                <>
                  <span className="font-mono">{v.sku}</span>
                  {!v.trackStock ? " · stok takibi kapalı" : ` · düşük stok eşiği ${formatNumber(v.lowStockThreshold)}`}
                  {now !== seen[v.id] ? <strong className="ms-1 font-medium text-text">· şu an {formatNumber(now)}</strong> : null}
                </>
              }
              error={errors[v.id] ?? (values[v.id] === null ? "Stok girin." : null)}
              name={`stock-${v.id}`}
            >
              <NumberInput
                value={values[v.id]}
                onChange={(n) => {
                  setValues((prev) => ({ ...prev, [v.id]: n }));
                  setErrors((prev) => {
                    const { [v.id]: _drop, ...rest } = prev;
                    return rest;
                  });
                }}
                min={0}
                max={1_000_000}
                suffix="adet"
              />
            </Field>
          );
        })}
      </div>
    </Dialog>
  );
}
