"use client";

// Option buttons (native radios, so arrow keys work) + the selected variant's price, stock, SKU and
// barcode. Updates the shared selection; the gallery follows it.
import { cn } from "@/lib/utils";
import PriceTag from "./PriceTag";
import StockBadge, { type StockLabels } from "./StockBadge";
import { useVariantSelection } from "./VariantContext";
import { findVariant, type PickerOption, type PickerVariant } from "./variant-types";

export type VariantPickerLabels = StockLabels & {
  selectOption: string;
  sku: string;
  barcode: string;
  vatIncluded: string;
};

export default function VariantPicker({
  options,
  variants,
  labels,
  className,
}: {
  options: PickerOption[];
  variants: PickerVariant[];
  labels: VariantPickerLabels;
  className?: string;
}) {
  const { selectedId, select } = useVariantSelection();
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];
  if (!selected) return null;

  const chosenFor = (option: PickerOption) => option.values.find((val) => selected.optionValueIds.includes(val.id));

  const choose = (option: PickerOption, valueId: number) => {
    const others = options
      .filter((o) => o.id !== option.id)
      .map((o) => chosenFor(o)?.id)
      .filter((id): id is number => id != null);
    const next = findVariant(variants, [...others, valueId], valueId);
    if (next) select(next.id);
  };

  // Options with a single value carry no choice; skip them.
  const choosable = options.filter((o) => o.values.length > 1);

  return (
    <div className={cn("flex flex-col gap-7", className)}>
      <div className="flex flex-col gap-2">
        <PriceTag
          price={selected.priceLabel}
          compareAt={selected.compareAtLabel}
          compareAtSrLabel={selected.compareAtSrLabel}
          badge={selected.campaignBadge}
          perLiter={selected.perLiterLabel}
          size="lg"
        />
        <p className="text-xs text-text-muted">{labels.vatIncluded}</p>
      </div>

      {choosable.map((option) => {
        const chosen = chosenFor(option);
        return (
          <fieldset key={option.id} className="flex flex-col gap-3">
            <legend className="mb-3 flex items-baseline gap-2 text-xs uppercase tracking-[0.14em] text-text-muted">
              <span>{option.name}</span>
              <span aria-hidden>·</span>
              <span className="text-text">{chosen?.label ?? labels.selectOption}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {option.values.map((value) => {
                const others = choosable
                  .filter((o) => o.id !== option.id)
                  .map((o) => chosenFor(o)?.id)
                  .filter((id): id is number => id != null);
                const target = findVariant(variants, [...others, value.id]);
                const unavailable = !target || target.stock === "out";
                const swatch = option.display === "swatches" && value.swatchColor;
                return (
                  <label key={value.id} className="relative cursor-pointer">
                    <input
                      type="radio"
                      name={`option-${option.id}`}
                      value={value.id}
                      checked={chosen?.id === value.id}
                      onChange={() => choose(option, value.id)}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border px-4 text-sm transition-[border-color,background-color,color] duration-300",
                        "border-border text-text hover:border-text/40",
                        "peer-checked:border-product peer-checked:bg-product-soft peer-checked:text-text",
                        "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                        unavailable && "text-text-muted line-through decoration-text-muted/60",
                      )}
                    >
                      {swatch && (
                        <span aria-hidden className="size-4 rounded-full ring-1 ring-black/10" style={{ backgroundColor: value.swatchColor ?? undefined }} />
                      )}
                      {value.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <div className="flex flex-col gap-3">
        <StockBadge status={selected.stock} labels={labels} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-text-muted">
          <dt>{labels.sku}</dt>
          <dd className="font-mono tracking-wide text-text">{selected.sku}</dd>
          {selected.barcode && (
            <>
              <dt>{labels.barcode}</dt>
              <dd className="font-mono tracking-wide text-text">{selected.barcode}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
