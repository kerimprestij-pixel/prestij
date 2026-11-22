"use client";
// "Yeni ürün": Turkish name, type and category → a draft with a slug and one default variant, then
// the editor opens.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { createProductAction } from "@/app/panel/(dashboard)/urunler/actions";
import CategoryPicker from "@/components/panel/form/CategoryPicker";
import Field from "@/components/panel/form/Field";
import TextInput from "@/components/panel/form/TextInput";
import usePanelForm from "@/components/panel/form/usePanelForm";
import Button from "@/components/panel/ui/Button";
import type { ProductType } from "@/db/schema/catalog";
import { slugify } from "@/lib/panel/format";
import type { PickerCategory } from "@/lib/panel/pickers";
import { productCreateSchema } from "@/lib/panel/products/schema";
import { PRODUCT_TYPE_OPTIONS } from "@/lib/panel/products/types";
import { cn } from "@/lib/utils";

type State = { name: string; type: ProductType; categoryId: number | null };

export default function NewProductForm({ categories }: { categories: PickerCategory[] }) {
  const router = useRouter();
  const form = usePanelForm<State>({ name: "", type: "standard", categoryId: categories[0]?.id ?? null });
  const { state, setField, errorFor, formRef } = form;
  const [opening, setOpening] = useState(false);
  const slug = slugify(state.name);

  async function create() {
    const result = await form.submit(createProductAction, { validate: productCreateSchema });
    if (result.ok && result.data) {
      setOpening(true);
      router.push(`/panel/urunler/${result.data.id}`);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
      className="max-w-2xl space-y-6 rounded-xl border border-border bg-surface p-5 sm:p-6"
      noValidate
    >
      <Field
        label="Ürün adı (Türkçe)"
        required
        error={errorFor("name")}
        name="name"
        help={slug ? `Adres: /urunler/${slug} (kayıttan sonra değiştirebilirsiniz)` : "Diğer dilleri düzenleme sayfasında eklersiniz."}
      >
        <TextInput value={state.name} onChange={(v) => setField("name", v)} maxLength={120} autoFocus placeholder="ör. Lavanta Latte" />
      </Field>

      <fieldset>
        <legend className="text-sm font-medium text-text">Tür</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {PRODUCT_TYPE_OPTIONS.map((t) => (
            <label
              key={t.value}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                state.type === t.value ? "border-gold bg-gold/[0.06]" : "border-border hover:bg-surface-2",
              )}
            >
              <span className="flex items-center gap-2 font-medium text-text">
                <input
                  type="radio"
                  name="type"
                  value={t.value}
                  checked={state.type === t.value}
                  onChange={() => setField("type", t.value)}
                  className="accent-[var(--brand)]"
                />
                {t.label}
              </span>
              <span className="text-xs text-text-muted">{t.help}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Kategori" error={errorFor("categoryId")} name="categoryId" help="Ürün mağazada bu kategorinin sayfasında listelenir.">
        <CategoryPicker value={state.categoryId} onChange={(id) => setField("categoryId", id)} categories={categories} placeholder="Kategorisiz" />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <p className="text-xs text-text-muted">Ürün taslak olarak oluşturulur; mağazada görünmez.</p>
        <Button type="submit" variant="primary" icon={ArrowRight} pending={form.pending || opening} pendingLabel={opening ? "Açılıyor…" : "Oluşturuluyor…"}>
          Oluştur ve düzenle
        </Button>
      </div>
    </form>
  );
}
