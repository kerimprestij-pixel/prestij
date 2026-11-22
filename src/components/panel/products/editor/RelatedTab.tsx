"use client";
import Field from "@/components/panel/form/Field";
import ProductPicker from "@/components/panel/form/ProductPicker";
import { Section, type TabProps } from "./shared";

export default function RelatedTab({ form, ctx }: TabProps) {
  const { state, setField, errorFor } = form;
  return (
    <Section
      title="İlişkili ürünler"
      description="Ürün sayfasının altındaki “Bunları da beğenebilirsiniz” bölümünde ilk dördü gösterilir. Boş bırakılırsa aynı kategoriden ürünler seçilir."
    >
      <Field label="Ürünler" hideLabel error={errorFor("relatedIds")} name="relatedIds">
        <ProductPicker
          multiple
          value={state.relatedIds}
          onChange={(ids) => setField("relatedIds", ids.filter((id) => id !== state.id))}
          items={ctx.relatedItems}
          max={12}
          dialogTitle="İlişkili ürün seç"
        />
      </Field>
      <p className="text-xs text-text-muted">Taslak, arşivdeki ve yalnızca kurumsal ürünler mağazada gösterilmez.</p>
    </Section>
  );
}
