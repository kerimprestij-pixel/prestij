"use client";
// Contents of a bundle (gift set): variants of other (non-bundle) products with a quantity each.
import { Plus, X } from "lucide-react";
import Field from "@/components/panel/form/Field";
import { NumberInput } from "@/components/panel/form/NumberInput";
import Select from "@/components/panel/form/Select";
import Button from "@/components/panel/ui/Button";
import SortableList, { SortableRow } from "@/components/panel/ui/SortableList";
import { iconButtonClass } from "@/components/panel/ui/styles";
import ProductThumb from "@/components/panel/ProductThumb";
import { newKey, type BundleItemState } from "@/lib/panel/products/types";
import { cn } from "@/lib/utils";
import { Section, Warning, type TabProps } from "./shared";

export default function BundleTab({ form, ctx }: TabProps) {
  const { state, setField, errorsUnder } = form;
  const items = state.bundleItems;
  const setItems = (next: BundleItemState[]) => setField("bundleItems", next);
  const update = (i: number, patch: Partial<BundleItemState>) => setItems(items.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const choices = ctx.bundleChoices;
  const options = [
    { value: 0, label: "Ürün seçin", disabled: true },
    ...choices.map((c) => ({
      value: c.id,
      label: `${c.label} · ${c.sku}${!c.isActive || c.productStatus !== "active" ? " (satışta değil)" : ""}`,
      group: c.productName,
    })),
  ];
  const listError = form.errors.bundleItems;

  return (
    <Section
      title="Set içeriği"
      description="Setin içindeki ürünler ve adetleri; ürün sayfasında “Sette neler var” olarak listelenir. Setin fiyatı ve stoğu Varyantlar sekmesindedir."
      actions={
        <Button size="sm" icon={Plus} onClick={() => setItems([...items, { key: newKey(), variantId: null, quantity: 1 }])} disabled={items.length >= 30}>
          Ürün ekle
        </Button>
      }
    >
      {state.type !== "bundle" ? <Warning>Ürün türü “Set” değil; bu içerik kayıtta silinir.</Warning> : null}
      {listError ? <p className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{listError}</p> : null}
      {items.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">Set henüz boş.</p> : null}
      {items.length > 0 ? (
        <SortableList
          items={items}
          ariaLabel="Set içeriği"
          getKey={(b) => b.key}
          getItemLabel={(b) => {
            const c = choices.find((x) => x.id === b.variantId);
            return c ? `${c.productName} ${c.label}` : "Seçilmemiş ürün";
          }}
          onReorder={setItems}
          renderItem={(b, ctxItem) => {
            const i = ctxItem.index;
            const errs = errorsUnder(`bundleItems.${i}`);
            const choice = choices.find((x) => x.id === b.variantId);
            return (
              <SortableRow
                ctx={ctxItem}
                className={Object.keys(errs).length ? "border-[#B3261E]/50" : undefined}
                actions={
                  <button
                    type="button"
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                    aria-label={`${choice ? choice.productName : "Satır"}: setten çıkar`}
                    className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                }
              >
                <div className="flex flex-wrap items-start gap-3 py-1 sm:flex-nowrap">
                  <ProductThumb media={choice?.thumb ?? null} size={40} className="hidden sm:block" />
                  <Field label="Ürün ve varyant" className="min-w-0 flex-1 basis-56" error={errs.variantId} name={`bundleItems.${i}.variantId`}>
                    <Select<number> size="sm" value={b.variantId ?? 0} onChange={(variantId) => update(i, { variantId: variantId || null })} options={options} />
                  </Field>
                  <Field label="Adet" className="w-28" error={errs.quantity} name={`bundleItems.${i}.quantity`}>
                    <NumberInput size="sm" value={b.quantity} onChange={(quantity) => update(i, { quantity })} min={1} max={99} />
                  </Field>
                </div>
              </SortableRow>
            );
          }}
        />
      ) : null}
    </Section>
  );
}
