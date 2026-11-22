"use client";
// Options + the variants table. Every column of product_variants is editable (main fields in the row,
// the rest under "Ayrıntılar"). Inline checks run while typing (SKU format and duplicates, EAN-13,
// price, compare-at price, shipping weight); the server repeats them and checks SKUs/barcodes against
// the whole catalog. Variants that orders, carts or bundles reference can only be deactivated.
import { useState } from "react";
import { ChevronDown, Plus, Sparkles, Trash2 } from "lucide-react";
import Field from "@/components/panel/form/Field";
import { MoneyInput, NumberInput } from "@/components/panel/form/NumberInput";
import Select from "@/components/panel/form/Select";
import Switch from "@/components/panel/form/Switch";
import TextInput from "@/components/panel/form/TextInput";
import { formatNumber } from "@/components/panel/labels";
import Button from "@/components/panel/ui/Button";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import { focusRingClass, iconButtonClass } from "@/components/panel/ui/styles";
import { toast } from "@/components/panel/ui/toast-store";
import { currentVariantStocks } from "@/app/panel/(dashboard)/urunler/actions";
import Img from "@/lib/media/Img";
import { isVideoMedia } from "@/lib/media/types";
import { isValidEan13, slugify } from "@/lib/panel/format";
import { MAX_VARIANTS } from "@/lib/panel/products/schema";
import { comboId, newKey, optionCombinations, VAT_RATES, variantTitle, type VariantState } from "@/lib/panel/products/types";
import { cn } from "@/lib/utils";
import OptionsEditor from "./OptionsEditor";
import { Section, Warning, type TabProps } from "./shared";

const REFERENCED_NOTE = "Bu varyant siparişlerde, sepetlerde veya setlerde geçtiği için silinemez. Satıştan kaldırmak için “Aktif” anahtarını kapatın.";

const SKU_RE = /^[A-Z0-9][A-Z0-9._-]*$/i;

function blankVariant(from: VariantState | undefined, sku: string, optionValueKeys: string[]): VariantState {
  return {
    key: newKey(),
    id: null,
    sku,
    barcode: "",
    price: from?.price ?? null,
    compareAtPrice: null,
    costPrice: null,
    vatRate: from?.vatRate ?? 20,
    stock: 0,
    stockSeen: null,
    trackStock: from?.trackStock ?? true,
    allowBackorder: false,
    lowStockThreshold: from?.lowStockThreshold ?? 5,
    volumeMl: null,
    weightGrams: null,
    desi: null,
    minQuantity: 1,
    maxQuantity: null,
    imageId: null,
    isDefault: false,
    isActive: true,
    optionValueKeys,
  };
}

/** SKU root for suggestions: "PR-LVL-500" → "PR-LVL". */
function skuRoot(variants: VariantState[], slug: string): string {
  const base = (variants.find((v) => v.isDefault) ?? variants[0])?.sku ?? "";
  const parts = base.split("-").filter(Boolean);
  if (parts.length >= 3) return parts.slice(0, -1).join("-");
  return base || `PR-${slug.toUpperCase()}`.slice(0, 30);
}

function uniqueSku(wanted: string, taken: Set<string>): string {
  const root = wanted.toUpperCase().replace(/[^A-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "PR";
  let sku = root;
  for (let n = 2; taken.has(sku); n++) sku = `${root}-${n}`;
  taken.add(sku);
  return sku;
}

export default function VariantsTab(props: TabProps) {
  const { form, ctx, media } = props;
  const { state, setState, setField, errorsUnder } = form;
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const variants = state.variants;
  const referenced = new Set(ctx.referencedVariantIds);
  const isSample = state.type === "sample";

  const skuCounts = new Map<string, number>();
  for (const v of variants) skuCounts.set(v.sku.trim().toUpperCase(), (skuCounts.get(v.sku.trim().toUpperCase()) ?? 0) + 1);

  const existingCombos = new Set(variants.map((v) => comboId(v.optionValueKeys)));
  const missing = optionCombinations(state.options).filter((c) => !existingCombos.has(comboId(c)));

  const setVariants = (next: VariantState[]) => setField("variants", next);
  const update = (index: number, patch: Partial<VariantState>) => {
    let next = variants.map((v, i) => (i === index ? { ...v, ...patch } : v));
    // Keep exactly one default: deactivating the default moves it to the first active variant.
    if (patch.isActive === false && variants[index].isDefault) {
      const target = next.findIndex((v, i) => i !== index && v.isActive);
      if (target >= 0) next = next.map((v, i) => ({ ...v, isDefault: i === target }));
    }
    setVariants(next);
  };
  const makeDefault = (index: number) => setVariants(variants.map((v, i) => ({ ...v, isDefault: i === index })));
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  function addVariant() {
    const taken = new Set(variants.map((v) => v.sku.toUpperCase()));
    const sku = uniqueSku(`${skuRoot(variants, state.slug)}-${variants.length + 1}`, taken);
    const fresh = blankVariant(variants.find((v) => v.isDefault), sku, []);
    if (variants.length === 0) fresh.isDefault = true;
    setVariants([...variants, fresh]);
    setOpen((prev) => new Set(prev).add(fresh.key));
  }

  function generate() {
    const taken = new Set(variants.map((v) => v.sku.toUpperCase()));
    const root = skuRoot(variants, state.slug);
    const from = variants.find((v) => v.isDefault);
    const created = missing.slice(0, Math.max(0, MAX_VARIANTS - variants.length)).map((combo) => {
      const parts = combo.map((key) => {
        const value = state.options.flatMap((o) => o.values).find((v) => v.key === key);
        return slugify(value?.value.tr ?? "", 12).toUpperCase();
      });
      return blankVariant(from, uniqueSku([root, ...parts].filter(Boolean).join("-"), taken), combo);
    });
    if (created.length === 0) return;
    const next = [...variants, ...created];
    if (!next.some((v) => v.isDefault)) next[0] = { ...next[0], isDefault: true };
    setVariants(next);
    toast.info(`${created.length} varyant eklendi. Fiyat, stok ve barkodu kontrol edip kaydedin.`);
  }

  /** After a stock conflict: take the current stock as the "seen" value; the typed values stay. */
  async function adoptCurrentStock() {
    try {
      const rows = await currentVariantStocks(state.id);
      const byId = new Map(rows.map((r) => [r.variantId, r.stock]));
      setVariants(
        variants.map((v) => {
          if (v.id === null || !byId.has(v.id)) return v;
          const current = byId.get(v.id)!;
          // Untouched fields follow the database; edited ones keep the typed value.
          return v.stock === v.stockSeen ? { ...v, stock: current, stockSeen: current } : { ...v, stockSeen: current };
        }),
      );
      toast.info("Güncel stok alındı. Değerleri kontrol edip yeniden kaydedin.");
    } catch {
      toast.error("Güncel stok alınamadı. Sayfayı yenileyin.");
    }
  }

  async function remove(index: number) {
    const v = variants[index];
    const title = variantTitle(v, state.options) || v.sku;
    if (v.id !== null) {
      const ok = await confirm({
        title: `“${title}” silinsin mi?`,
        description: "Varyant, fiyatları ve stoğuyla birlikte kayıtta silinir.",
        confirmLabel: "Sil",
      });
      if (!ok) return;
    }
    let next = variants.filter((_, i) => i !== index);
    if (v.isDefault && next.length) {
      const target = Math.max(0, next.findIndex((x) => x.isActive));
      next = next.map((x, i) => ({ ...x, isDefault: i === target }));
    }
    // Rows that pointed to the removed variant fall back to "every variant".
    setState((s) => ({
      ...s,
      variants: next,
      media: s.media.map((m) => (m.variantKey === v.key ? { ...m, variantKey: null } : m)),
      tiers: s.tiers.filter((t) => t.variantKey !== v.key),
      groupPrices: s.groupPrices.filter((g) => g.variantKey !== v.key),
    }));
  }

  const rootError = form.errors.variants;
  // Day 6: a variant image is always an image, never one of the product's videos.
  const imageChoices = [
    { value: 0, label: "Görsel yok" },
    ...state.media
      .filter((m) => !isVideoMedia(media.get(m.mediaId)))
      .map((m, i) => ({ value: m.mediaId, label: media.get(m.mediaId)?.alt?.tr || `Ürün görseli ${i + 1}` })),
  ];

  return (
    <div className="space-y-6">
      <OptionsEditor {...props} />
      <Section
        title="Varyantlar"
        description="Satılan her seçenek birleşimi: kendi SKU’su, fiyatı, stoğu ve barkodu vardır. Varsayılan varyant ürün kartında ve sayfa açılışında seçili gelir."
        actions={
          <>
            {missing.length > 0 ? (
              <Button size="sm" icon={Sparkles} onClick={generate}>
                Eksik birleşimleri oluştur ({missing.length})
              </Button>
            ) : null}
            <Button size="sm" icon={Plus} onClick={addVariant} disabled={variants.length >= MAX_VARIANTS || (state.options.length === 0 && variants.length >= 1)}>
              Varyant ekle
            </Button>
          </>
        }
      >
        {rootError ? (
          <p role="alert" className="rounded-lg border border-[#B3261E]/40 bg-[#B3261E]/[0.05] px-3 py-2 text-sm font-medium text-[#B3261E] dark:text-[#F28B82]">
            {rootError}
          </p>
        ) : null}
        {state.options.length === 0 && variants.length >= 1 ? (
          <p className="text-xs text-text-muted">Birden fazla varyant için önce yukarıdan bir seçenek ekleyin.</p>
        ) : null}

        <div className="hidden grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_8.5rem_6.5rem_4.5rem_4.5rem] items-center gap-3 px-3 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-text-muted lg:grid">
          <span>Vars.</span>
          <span>Seçenekler</span>
          <span>SKU</span>
          <span>Fiyat</span>
          <span>Stok</span>
          <span>Aktif</span>
          <span className="sr-only">İşlemler</span>
        </div>

        <ol className="space-y-2" aria-label="Varyantlar">
          {variants.map((v, i) => {
            const errs = errorsUnder(`variants.${i}`);
            const hasErrors = Object.keys(errs).length > 0;
            const expanded = open.has(v.key) || Object.keys(errs).some((k) => !["sku", "price", "stock", "optionValueKeys", "isDefault"].includes(k));
            const title = variantTitle(v, state.options);
            const label = title || v.sku || `Varyant ${i + 1}`;
            const isReferenced = v.id !== null && referenced.has(v.id);

            // Inline checks (server errors win).
            const sku = v.sku.trim();
            const skuError = errs.sku ?? (!sku ? "SKU girin." : !SKU_RE.test(sku) ? "Yalnızca harf, rakam, nokta, tire ve alt çizgi." : (skuCounts.get(sku.toUpperCase()) ?? 0) > 1 ? "Bu SKU başka bir varyantta da var." : undefined);
            const barcode = v.barcode.replace(/\s+/g, "");
            const barcodeError = errs.barcode ?? (barcode && !isValidEan13(barcode) ? "Geçerli bir EAN-13 değil (13 hane, son hane kontrol hanesi)." : undefined);
            const priceError = errs.price ?? (v.price === null ? "Fiyat girin." : !isSample && v.price <= 0 ? "Fiyat sıfırdan büyük olmalı." : undefined);
            const compareWarn = v.compareAtPrice !== null && v.price !== null && v.compareAtPrice <= v.price ? "İndirimsiz fiyat satış fiyatından yüksek olmalı; aksi halde üstü çizili gösterilmez." : null;
            const weightWarn = !isSample && v.isActive && !v.weightGrams ? "Kargo ücreti için ağırlık girin." : null;
            const stockChanged = v.id !== null && v.stock !== v.stockSeen;

            return (
              <li key={v.key} className={cn("rounded-xl border bg-surface", hasErrors ? "border-[#B3261E]/50" : v.isActive ? "border-border" : "border-dashed border-border bg-surface-2/40")}>
                <div className="grid grid-cols-2 items-start gap-3 p-3 lg:grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_8.5rem_6.5rem_4.5rem_4.5rem]">
                  <div className="col-span-2 flex items-center gap-2 lg:col-span-1 lg:justify-center lg:pt-2">
                    <input
                      type="radio"
                      name="default-variant"
                      checked={v.isDefault}
                      disabled={!v.isActive}
                      onChange={() => makeDefault(i)}
                      aria-label={`${label}: varsayılan varyant`}
                      aria-describedby={errs.isDefault ? `v-${v.key}-default-error` : undefined}
                      className={cn("size-4 accent-[var(--brand)]", focusRingClass)}
                    />
                    <span className="text-xs text-text-muted lg:hidden">{v.isDefault ? "Varsayılan" : "Varsayılan yap"}</span>
                    {!v.isActive ? <span className="ms-auto rounded-full bg-surface-2 px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-wider text-text-muted lg:hidden">Pasif</span> : null}
                  </div>

                  <div className="col-span-2 min-w-0 space-y-2 lg:col-span-1">
                    {state.options.length === 0 ? (
                      <p className="pt-2 text-sm text-text">{v.volumeMl ? `${formatNumber(v.volumeMl)} ml` : "Tek varyant"}</p>
                    ) : (
                      state.options.map((o) => {
                        const current = o.values.find((val) => v.optionValueKeys.includes(val.key));
                        return (
                          <div key={o.key}>
                            <label className="sr-only" htmlFor={`v-${v.key}-${o.key}`}>
                              {label}: {o.name.tr}
                            </label>
                            <select
                              id={`v-${v.key}-${o.key}`}
                              name={`variants.${i}.optionValueKeys`}
                              value={current?.key ?? ""}
                              aria-invalid={errs.optionValueKeys ? true : undefined}
                              onChange={(e) => {
                                const others = v.optionValueKeys.filter((k) => !o.values.some((val) => val.key === k));
                                update(i, { optionValueKeys: e.target.value ? [...others, e.target.value] : others });
                              }}
                              className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 aria-[invalid=true]:border-[#B3261E]"
                            >
                              <option value="">{o.name.tr || "Seçenek"}: seçin</option>
                              {o.values.map((val) => (
                                <option key={val.key} value={val.key}>
                                  {val.value.tr || "(adsız değer)"}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })
                    )}
                    {errs.optionValueKeys ? <p className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{errs.optionValueKeys}</p> : null}
                    {errs.isDefault ? (
                      <p id={`v-${v.key}-default-error`} className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">
                        {errs.isDefault}
                      </p>
                    ) : null}
                  </div>

                  <Field label="SKU" className="col-span-2 sm:col-span-1 lg:[&>div:first-child]:sr-only" error={skuError} name={`variants.${i}.sku`}>
                    <TextInput size="sm" value={v.sku} onChange={(sku) => update(i, { sku: sku.toUpperCase() })} maxLength={40} spellCheck={false} className="font-mono" />
                  </Field>
                  <Field label="Fiyat" className="lg:[&>div:first-child]:sr-only" error={priceError} name={`variants.${i}.price`}>
                    <MoneyInput size="sm" value={v.price} onChange={(price) => update(i, { price })} />
                  </Field>
                  <Field
                    label="Stok"
                    className="lg:[&>div:first-child]:sr-only"
                    error={errs.stock}
                    name={`variants.${i}.stock`}
                    help={
                      errs.stock && v.id !== null ? (
                        <button type="button" onClick={() => void adoptCurrentStock()} className={cn("rounded font-medium text-text underline underline-offset-4", focusRingClass)}>
                          Güncel stoğu al
                        </button>
                      ) : stockChanged ? (
                        `Kayıtlı: ${formatNumber(v.stockSeen ?? 0)}`
                      ) : undefined
                    }
                  >
                    <NumberInput size="sm" value={v.stock} onChange={(stock) => update(i, { stock })} min={v.stockSeen !== null && v.stockSeen < 0 ? v.stockSeen : 0} max={1_000_000} />
                  </Field>
                  <div className="flex items-center gap-2 lg:justify-center lg:pt-1.5">
                    <Switch checked={v.isActive} onChange={(isActive) => update(i, { isActive })} size="sm" label={<><span className="lg:sr-only">Aktif</span><span className="sr-only"> ({label})</span></>} />
                  </div>
                  <div className="flex items-center justify-end gap-0.5 lg:pt-0.5">
                    <button
                      type="button"
                      onClick={() => toggle(v.key)}
                      aria-expanded={expanded}
                      aria-controls={`v-details-${v.key}`}
                      aria-label={`${label}: ayrıntılar`}
                      className={iconButtonClass("sm")}
                    >
                      <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
                    </button>
                    {isReferenced ? (
                      // One control for "active" (the switch); delete is explained instead of offered.
                      <button
                        type="button"
                        aria-disabled="true"
                        onClick={() => toast.info(REFERENCED_NOTE)}
                        aria-label={`${label}: silinemez (siparişlerde, sepetlerde veya setlerde geçiyor)`}
                        title={REFERENCED_NOTE}
                        className={cn(iconButtonClass("sm"), "cursor-not-allowed opacity-40")}
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void remove(i)}
                        disabled={variants.length <= 1}
                        aria-label={`${label}: sil`}
                        className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    )}
                  </div>
                </div>

                {compareWarn || weightWarn ? (
                  <div className="space-y-1 px-3 pb-2">
                    {compareWarn ? <Warning>{compareWarn}</Warning> : null}
                    {weightWarn ? <Warning>{weightWarn}</Warning> : null}
                  </div>
                ) : null}

                <div id={`v-details-${v.key}`} hidden={!expanded} className="border-t border-border bg-surface-2/30 p-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Barkod (EAN-13)" error={barcodeError} name={`variants.${i}.barcode`} optional>
                      <TextInput size="sm" value={v.barcode} onChange={(barcode) => update(i, { barcode })} inputMode="numeric" maxLength={16} spellCheck={false} className="font-mono" />
                    </Field>
                    <Field label="İndirimsiz fiyat" error={errs.compareAtPrice} name={`variants.${i}.compareAtPrice`} optional help="Üstü çizili gösterilir.">
                      <MoneyInput size="sm" value={v.compareAtPrice} onChange={(compareAtPrice) => update(i, { compareAtPrice })} />
                    </Field>
                    <Field label="Maliyet" error={errs.costPrice} name={`variants.${i}.costPrice`} optional help="Yalnızca panelde görünür.">
                      <MoneyInput size="sm" value={v.costPrice} onChange={(costPrice) => update(i, { costPrice })} />
                    </Field>
                    <Field label="KDV" error={errs.vatRate} name={`variants.${i}.vatRate`}>
                      <Select<number> size="sm" value={v.vatRate} onChange={(vatRate) => update(i, { vatRate })} options={VAT_RATES.map((r) => ({ value: r, label: `%${r}` }))} />
                    </Field>
                    <Field label="Düşük stok eşiği" error={errs.lowStockThreshold} name={`variants.${i}.lowStockThreshold`} help="Bu adede inince uyarı verilir.">
                      <NumberInput size="sm" value={v.lowStockThreshold} onChange={(lowStockThreshold) => update(i, { lowStockThreshold })} min={0} max={100_000} suffix="adet" />
                    </Field>
                    <Field label="Hacim" error={errs.volumeMl} name={`variants.${i}.volumeMl`} optional help="Litre fiyatı için.">
                      <NumberInput size="sm" value={v.volumeMl} onChange={(volumeMl) => update(i, { volumeMl })} min={1} max={1_000_000} suffix="ml" />
                    </Field>
                    <Field label="Ağırlık (ambalajlı)" error={errs.weightGrams} name={`variants.${i}.weightGrams`} optional help="Kargo ücreti hesabında kullanılır.">
                      <NumberInput size="sm" value={v.weightGrams} onChange={(weightGrams) => update(i, { weightGrams })} min={1} max={1_000_000} suffix="g" />
                    </Field>
                    <Field label="Desi" error={errs.desi} name={`variants.${i}.desi`} optional>
                      <NumberInput
                        size="sm"
                        value={v.desi === null ? null : v.desi / 10}
                        onChange={(n) => update(i, { desi: n === null ? null : Math.round(n * 10) })}
                        decimals={1}
                        step={0.5}
                        min={0}
                        max={10_000}
                      />
                    </Field>
                    <Field label="En az adet" error={errs.minQuantity} name={`variants.${i}.minQuantity`}>
                      <NumberInput size="sm" value={v.minQuantity} onChange={(minQuantity) => update(i, { minQuantity })} min={1} max={10_000} suffix="adet" />
                    </Field>
                    <Field label="En çok adet" error={errs.maxQuantity} name={`variants.${i}.maxQuantity`} optional help="Boş: sınırsız.">
                      <NumberInput size="sm" value={v.maxQuantity} onChange={(maxQuantity) => update(i, { maxQuantity })} min={1} max={100_000} suffix="adet" />
                    </Field>
                    <Field label="Varyant görseli" error={errs.imageId} name={`variants.${i}.imageId`} optional help="Bu varyant seçilince gösterilir.">
                      <div className="flex items-center gap-2">
                        {v.imageId && media.get(v.imageId) ? (
                          <span className="relative block size-9 shrink-0 overflow-hidden rounded-md border border-border">
                            <Img media={media.get(v.imageId)!} alt="" sizes="36px" fill />
                          </span>
                        ) : null}
                        <Select<number>
                          size="sm"
                          value={v.imageId ?? 0}
                          onChange={(id) => update(i, { imageId: id || null })}
                          options={
                            v.imageId && !imageChoices.some((c) => c.value === v.imageId)
                              ? [...imageChoices, { value: v.imageId, label: "Mevcut görsel (galeride değil)" }]
                              : imageChoices
                          }
                        />
                      </div>
                    </Field>
                    <div className="space-y-3 sm:col-span-2 lg:col-span-1">
                      <Switch checked={v.trackStock} onChange={(trackStock) => update(i, { trackStock })} size="sm" label="Stok takibi" description="Kapalıysa stok düşmez." />
                      <Switch checked={v.allowBackorder} onChange={(allowBackorder) => update(i, { allowBackorder })} size="sm" label="Stok bitince de sat" />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </Section>
      {confirmDialog}
    </div>
  );
}
