"use client";
import CategoryPicker from "@/components/panel/form/CategoryPicker";
import Field from "@/components/panel/form/Field";
import { LocalizedInput, LocalizedTextarea } from "@/components/panel/form/LocalizedInput";
import LocalizedRichText from "@/components/panel/form/LocalizedRichText";
import Select from "@/components/panel/form/Select";
import Switch from "@/components/panel/form/Switch";
import type { ProductStatus, ProductType } from "@/db/schema/catalog";
import { PRODUCT_STATUS_OPTIONS, PRODUCT_TYPE_OPTIONS } from "@/lib/panel/products/types";
import { Section, Warning, type TabProps } from "./shared";

export default function GeneralTab({ form, ctx }: TabProps) {
  const { state, setField, errorFor, localizedError } = form;
  const usedInBundles = ctx.usedInBundles.length > 0;
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="min-w-0 space-y-6 xl:col-span-2">
        <Section title="Ad ve metinler" description="Türkçe zorunlu; İngilizce ve Arapça boş kalırsa mağaza Türkçesini gösterir.">
          <LocalizedInput label="Ürün adı" required value={state.name} onChange={(v) => setField("name", v)} error={localizedError("name")} name="name" maxLength={120} />
          <LocalizedInput
            label="Alt başlık"
            value={state.subtitle}
            onChange={(v) => setField("subtitle", v)}
            error={localizedError("subtitle")}
            name="subtitle"
            maxLength={120}
            help="Adın altında görünür, ör. “Sıvı El Sabunu”."
          />
          <LocalizedTextarea
            label="Kısa açıklama"
            value={state.shortDescription}
            onChange={(v) => setField("shortDescription", v)}
            error={localizedError("shortDescription")}
            name="shortDescription"
            maxLength={300}
            rows={2}
            help="Ürün sayfasında fiyatın üstünde ve arama sonuçlarında (SEO açıklaması boşsa) kullanılır."
          />
          <LocalizedRichText
            label="Açıklama"
            value={state.description}
            onChange={(v) => setField("description", v)}
            error={localizedError("description")}
            name="description"
            help="Ürün sayfasındaki “Açıklama” bölümü. Kaydederken güvenli biçime temizlenir."
          />
        </Section>
      </div>
      <div className="min-w-0 space-y-6">
        <Section title="Yayın">
          <Field label="Durum" error={errorFor("status")} name="status" help="Yalnızca “Yayında” ürünler mağazada görünür.">
            <Select<ProductStatus> value={state.status} onChange={(v) => setField("status", v)} options={PRODUCT_STATUS_OPTIONS} />
          </Field>
          <Field
            label="Tür"
            error={errorFor("type")}
            name="type"
            help={PRODUCT_TYPE_OPTIONS.find((t) => t.value === state.type)?.help}
          >
            <Select<ProductType> value={state.type} onChange={(v) => setField("type", v)} options={PRODUCT_TYPE_OPTIONS} />
          </Field>
          {state.type === "bundle" && usedInBundles ? <Warning>Bu ürün başka bir sette kullanıldığı için set olamaz.</Warning> : null}
          {form.saved.type === "bundle" && state.type !== "bundle" && state.bundleItems.length ? (
            <Warning>Tür değişince set içeriği kayıtta silinir.</Warning>
          ) : null}
          <Field label="Kategori" error={errorFor("categoryId")} name="categoryId" help="Ürün bu kategorinin sayfasında listelenir.">
            <CategoryPicker value={state.categoryId} onChange={(id) => setField("categoryId", id)} categories={ctx.categories} placeholder="Kategorisiz" />
          </Field>
        </Section>
        <Section title="Görünürlük">
          <Switch
            checked={state.isFeatured}
            onChange={(v) => setField("isFeatured", v)}
            label="Öne çıkan"
            description="Ana sayfadaki öne çıkan ürünler bölümünde gösterilir."
          />
          <Switch
            checked={state.businessOnly}
            onChange={(v) => setField("businessOnly", v)}
            label="Yalnızca kurumsal müşteriler"
            description="Perakende listelerinde görünmez; onaylı işletme hesapları içindir."
          />
          <Switch
            checked={state.allowSubscription}
            onChange={(v) => setField("allowSubscription", v)}
            label="Abonelikle satılabilir"
            description="Düzenli teslimat aboneliği mağazaya eklendiğinde bu ürün için açılır."
          />
        </Section>
      </div>
    </div>
  );
}
