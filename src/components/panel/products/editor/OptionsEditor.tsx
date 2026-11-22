"use client";
// Option axes (e.g. "Ambalaj") and their values (500 ml, 5 L, 20 L). Variants point to values by key;
// removing a value or an axis also clears it from the variants, adding the first value of a new axis
// assigns it to every variant that has none for that axis yet.
import { useState } from "react";
import { ChevronDown, ChevronUp, ImagePlus, Plus, Trash2, X } from "lucide-react";
import ColorInput from "@/components/panel/form/ColorInput";
import Field from "@/components/panel/form/Field";
import MediaPickerDialog from "@/components/panel/form/MediaPickerDialog";
import Select from "@/components/panel/form/Select";
import Button from "@/components/panel/ui/Button";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import { iconButtonClass } from "@/components/panel/ui/styles";
import Img from "@/lib/media/Img";
import { MAX_OPTION_VALUES, MAX_OPTIONS } from "@/lib/panel/products/schema";
import { newKey, OPTION_DISPLAY_OPTIONS, type OptionDisplay, type OptionState, type OptionValueState } from "@/lib/panel/products/types";
import { cn } from "@/lib/utils";
import { Section, TriLingualRow, type TabProps } from "./shared";

export default function OptionsEditor({ form, media }: TabProps) {
  const { state, setState, errorsUnder } = form;
  const { confirm, confirmDialog } = useConfirm();
  const [swatchFor, setSwatchFor] = useState<{ option: number; value: number } | null>(null);
  const options = state.options;

  const setOptions = (next: OptionState[], variants = state.variants) => setState((s) => ({ ...s, options: next, variants }));
  const updateOption = (oi: number, patch: Partial<OptionState>) => setOptions(options.map((o, i) => (i === oi ? { ...o, ...patch } : o)));
  const updateValue = (oi: number, vi: number, patch: Partial<OptionValueState>) =>
    updateOption(oi, { values: options[oi].values.map((v, i) => (i === vi ? { ...v, ...patch } : v)) });

  const usage = (keys: string[]) => state.variants.filter((v) => v.optionValueKeys.some((k) => keys.includes(k))).length;

  async function removeOption(oi: number) {
    const keys = options[oi].values.map((v) => v.key);
    const used = usage(keys);
    if (used) {
      const ok = await confirm({
        title: `“${options[oi].name.tr || "Seçenek"}” kaldırılsın mı?`,
        description: `${used} varyant bu seçeneği kullanıyor; varyantlardan da kaldırılır. Aynı birleşime düşen varyantları kayıttan önce düzeltmeniz gerekir.`,
        confirmLabel: "Kaldır",
      });
      if (!ok) return;
    }
    setOptions(
      options.filter((_, i) => i !== oi),
      state.variants.map((v) => ({ ...v, optionValueKeys: v.optionValueKeys.filter((k) => !keys.includes(k)) })),
    );
  }

  async function removeValue(oi: number, vi: number) {
    const value = options[oi].values[vi];
    const used = usage([value.key]);
    if (used) {
      const ok = await confirm({
        title: `“${value.value.tr || "Değer"}” kaldırılsın mı?`,
        description: `${used} varyant bu değeri kullanıyor. Kaydetmeden önce bu varyantlara yeni bir değer seçin veya onları kaldırın.`,
        confirmLabel: "Kaldır",
      });
      if (!ok) return;
    }
    setOptions(
      options.map((o, i) => (i === oi ? { ...o, values: o.values.filter((_, j) => j !== vi) } : o)),
      state.variants.map((v) => ({ ...v, optionValueKeys: v.optionValueKeys.filter((k) => k !== value.key) })),
    );
  }

  function addValue(oi: number) {
    const option = options[oi];
    const value: OptionValueState = { key: newKey(), id: null, value: { tr: "" }, swatchColor: "", swatchMediaId: null };
    const optionKeys = option.values.map((v) => v.key);
    // Variants with no value on this axis yet (e.g. a freshly added axis) get the new value.
    const variants = state.variants.map((v) => (v.optionValueKeys.some((k) => optionKeys.includes(k)) ? v : { ...v, optionValueKeys: [...v.optionValueKeys, value.key] }));
    setOptions(
      options.map((o, i) => (i === oi ? { ...o, values: [...o.values, value] } : o)),
      variants,
    );
  }

  function moveValue(oi: number, from: number, to: number) {
    const values = [...options[oi].values];
    const [item] = values.splice(from, 1);
    values.splice(to, 0, item);
    updateOption(oi, { values });
  }

  function moveOption(from: number, to: number) {
    const next = [...options];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOptions(next);
  }

  const swatchValue = swatchFor ? options[swatchFor.option]?.values[swatchFor.value] : null;

  return (
    <Section
      title="Seçenekler"
      description="Müşterinin seçtiği özellikler, ör. Ambalaj: Pompalı şişe 500 ml / 5 L bidon / 20 L bidon. Her varyant her seçenekten bir değer alır."
      actions={
        <Button
          size="sm"
          icon={Plus}
          disabled={options.length >= MAX_OPTIONS}
          onClick={() => setOptions([...options, { key: newKey(), id: null, name: { tr: "" }, display: "buttons", values: [] }])}
        >
          Seçenek ekle
        </Button>
      }
    >
      {options.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-text-muted">
          Tek varyantlı ürünlerde seçenek gerekmez. Birden fazla boy veya ambalaj için bir seçenek ekleyin.
        </p>
      ) : null}
      {options.map((option, oi) => {
        const errs = errorsUnder(`options.${oi}`);
        return (
          <div key={option.key} className={cn("rounded-xl border p-3 sm:p-4", Object.keys(errs).length ? "border-[#B3261E]/50" : "border-border")}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1 basis-72">
                <p className="mb-1.5 text-xs font-medium text-text">Seçenek adı</p>
                <TriLingualRow
                  label="Seçenek adı"
                  value={option.name}
                  onChange={(name) => updateOption(oi, { name })}
                  errors={{ tr: errs["name.tr"] ?? errs.name, en: errs["name.en"], ar: errs["name.ar"] }}
                  maxLength={60}
                  namePrefix={`options.${oi}.name`}
                />
              </div>
              <Field label="Görünüm" className="w-full sm:w-52" name={`options.${oi}.display`} error={errs.display}>
                <Select<OptionDisplay> size="sm" value={option.display} onChange={(display) => updateOption(oi, { display })} options={OPTION_DISPLAY_OPTIONS} />
              </Field>
              <div className="flex items-center">
                <button type="button" className={iconButtonClass("sm")} disabled={oi === 0} onClick={() => moveOption(oi, oi - 1)} aria-label={`${option.name.tr || "Seçenek"}: yukarı taşı`}>
                  <ChevronUp aria-hidden className="size-4" />
                </button>
                <button type="button" className={iconButtonClass("sm")} disabled={oi === options.length - 1} onClick={() => moveOption(oi, oi + 1)} aria-label={`${option.name.tr || "Seçenek"}: aşağı taşı`}>
                  <ChevronDown aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}
                  onClick={() => void removeOption(oi)}
                  aria-label={`${option.name.tr || "Seçenek"}: kaldır`}
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-text">Değerler</p>
              {errs.values ? <p className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{errs.values}</p> : null}
              {option.values.map((value, vi) => {
                const verrs = errorsUnder(`options.${oi}.values.${vi}`);
                const swatch = media.get(value.swatchMediaId);
                return (
                  <div key={value.key} className="flex flex-wrap items-start gap-2 rounded-lg bg-surface-2/50 p-2 sm:flex-nowrap">
                    <div className="min-w-0 flex-1 basis-64">
                      <TriLingualRow
                        label="Değer"
                        value={value.value}
                        onChange={(v) => updateValue(oi, vi, { value: v })}
                        errors={{ tr: verrs["value.tr"] ?? verrs.value, en: verrs["value.en"], ar: verrs["value.ar"] }}
                        namePrefix={`options.${oi}.values.${vi}.value`}
                      />
                      {option.display === "swatches" ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <div className="w-full max-w-60">
                            <ColorInput value={value.swatchColor} onChange={(hex) => updateValue(oi, vi, { swatchColor: hex })} allowEmpty placeholder="Renk" invalid={Boolean(verrs.swatchColor)} />
                          </div>
                          {swatch ? (
                            <span className="relative block size-9 overflow-hidden rounded-md border border-border">
                              <Img media={swatch} alt="" sizes="36px" fill />
                            </span>
                          ) : null}
                          <Button size="sm" variant="ghost" icon={ImagePlus} onClick={() => setSwatchFor({ option: oi, value: vi })}>
                            {value.swatchMediaId ? "Görseli değiştir" : "Kutucuk görseli"}
                          </Button>
                          {value.swatchMediaId ? (
                            <Button size="sm" variant="ghost" icon={X} onClick={() => updateValue(oi, vi, { swatchMediaId: null })}>
                              Kaldır
                            </Button>
                          ) : null}
                          {verrs.swatchColor || verrs.swatchMediaId ? (
                            <p className="w-full text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{verrs.swatchColor ?? verrs.swatchMediaId}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center">
                      <button type="button" className={iconButtonClass("sm")} disabled={vi === 0} onClick={() => moveValue(oi, vi, vi - 1)} aria-label={`${value.value.tr || "Değer"}: yukarı taşı`}>
                        <ChevronUp aria-hidden className="size-4" />
                      </button>
                      <button
                        type="button"
                        className={iconButtonClass("sm")}
                        disabled={vi === option.values.length - 1}
                        onClick={() => moveValue(oi, vi, vi + 1)}
                        aria-label={`${value.value.tr || "Değer"}: aşağı taşı`}
                      >
                        <ChevronDown aria-hidden className="size-4" />
                      </button>
                      <button
                        type="button"
                        className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}
                        onClick={() => void removeValue(oi, vi)}
                        aria-label={`${value.value.tr || "Değer"}: kaldır`}
                      >
                        <X aria-hidden className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => addValue(oi)} disabled={option.values.length >= MAX_OPTION_VALUES}>
                Değer ekle
              </Button>
            </div>
          </div>
        );
      })}
      <MediaPickerDialog
        open={swatchFor !== null}
        onClose={() => setSwatchFor(null)}
        currentId={swatchValue?.swatchMediaId ?? null}
        folder="urunler"
        title="Kutucuk görseli seç"
        onSelect={([item]) => {
          const target = swatchFor;
          setSwatchFor(null);
          if (item && target) {
            media.add([item]);
            updateValue(target.option, target.value, { swatchMediaId: item.id });
          }
        }}
      />
      {confirmDialog}
    </Section>
  );
}
