"use client";
import Field from "@/components/panel/form/Field";
import { LocalizedInput, LocalizedTextarea } from "@/components/panel/form/LocalizedInput";
import Repeater from "@/components/panel/form/Repeater";
import Textarea from "@/components/panel/form/Textarea";
import { focusRingClass } from "@/components/panel/ui/styles";
import { CLAIM_OPTIONS, type SpecState } from "@/lib/panel/products/types";
import { cn } from "@/lib/utils";
import { Section, TriLingualRow, type TabProps } from "./shared";

export default function ContentTab({ form }: TabProps) {
  const { state, setField, errorFor, localizedError, errorsUnder } = form;
  const unknownClaims = state.claims.filter((c) => !CLAIM_OPTIONS.some((o) => o.key === c));
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <Section title="Koku notaları" description="Ürün sayfasında koku piramidi olarak görünür. Boş bırakılan notalar gösterilmez.">
          <LocalizedInput label="Üst nota" value={state.scentTop} onChange={(v) => setField("scentTop", v)} error={localizedError("scentTop")} name="scentTop" maxLength={200} placeholder="ör. Bergamot, limon" />
          <LocalizedInput label="Orta nota" value={state.scentHeart} onChange={(v) => setField("scentHeart", v)} error={localizedError("scentHeart")} name="scentHeart" maxLength={200} placeholder="ör. Lavanta" />
          <LocalizedInput label="Alt nota" value={state.scentBase} onChange={(v) => setField("scentBase", v)} error={localizedError("scentBase")} name="scentBase" maxLength={200} placeholder="ör. Vanilya, misk" />
        </Section>
        <Section title="Kullanım ve uyarılar" description="Etiketteki metinlerle aynı tutun.">
          <LocalizedTextarea label="Kullanım" value={state.usage} onChange={(v) => setField("usage", v)} error={localizedError("usage")} name="usage" maxLength={4000} rows={3} />
          <LocalizedTextarea label="Uyarılar" value={state.warnings} onChange={(v) => setField("warnings", v)} error={localizedError("warnings")} name="warnings" maxLength={4000} rows={3} />
        </Section>
      </div>
      <div className="min-w-0 space-y-6">
        <Section title="İçindekiler (INCI)" description="Etiketteki gibi, çevrilmeden yazın; her dilde aynı görünür.">
          <Field label="İçindekiler" hideLabel error={errorFor("ingredients")} name="ingredients">
            <Textarea value={state.ingredients} onChange={(v) => setField("ingredients", v)} maxLength={4000} rows={4} placeholder="Aqua, Sodium Laureth Sulfate, Glycerin, …" />
          </Field>
        </Section>
        <Section title="Rozetler" description="Ürün sayfasında simgeli rozet olarak görünür. Etiketleri Arayüz Metinleri’nden değiştirebilirsiniz.">
          <fieldset>
            <legend className="sr-only">Rozetler</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CLAIM_OPTIONS.map((c) => {
                const checked = state.claims.includes(c.key);
                return (
                  <label
                    key={c.key}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                      checked ? "border-gold bg-gold/[0.06] text-text" : "border-border text-text-muted hover:bg-surface-2",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setField("claims", checked ? state.claims.filter((k) => k !== c.key) : [...state.claims, c.key])}
                      className={cn("size-4 accent-[var(--brand)]", focusRingClass)}
                    />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          {unknownClaims.length ? <p className="text-xs text-text-muted">Mağazada karşılığı olmayan rozetler korunur: {unknownClaims.join(", ")}.</p> : null}
        </Section>
        <Section title="Özellikler" description="Ürün sayfasındaki teknik bilgiler tablosu (ör. Menşei: Türkiye).">
          <Repeater<SpecState>
            items={state.specs}
            onChange={(v) => setField("specs", v)}
            createItem={() => ({ label: { tr: "" }, value: { tr: "" } })}
            noun="Özellik"
            ariaLabel="Özellikler"
            max={20}
            addLabel="Özellik ekle"
            emptyText="Henüz özellik yok."
            itemSummary={(s) => [s.label.tr, s.value.tr].filter(Boolean).join(": ")}
            itemHasError={(i) => form.hasErrors(`specs.${i}`)}
            renderItem={(spec, { index, update }) => {
              const errs = errorsUnder(`specs.${index}`);
              return (
                <div className="space-y-3">
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-text-muted">Başlık</p>
                    <TriLingualRow
                      label="Başlık"
                      value={spec.label}
                      onChange={(label) => update({ ...spec, label })}
                      errors={{ tr: errs["label.tr"] ?? errs.label, en: errs["label.en"], ar: errs["label.ar"] }}
                      namePrefix={`specs.${index}.label`}
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-text-muted">Değer</p>
                    <TriLingualRow
                      label="Değer"
                      value={spec.value}
                      onChange={(value) => update({ ...spec, value })}
                      errors={{ tr: errs["value.tr"] ?? errs.value, en: errs["value.en"], ar: errs["value.ar"] }}
                      maxLength={300}
                      namePrefix={`specs.${index}.value`}
                    />
                  </div>
                </div>
              );
            }}
          />
        </Section>
      </div>
    </div>
  );
}
