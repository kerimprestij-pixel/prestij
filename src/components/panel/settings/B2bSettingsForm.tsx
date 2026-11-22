"use client";
import { saveB2bSettingsAction } from "@/app/panel/(dashboard)/ayarlar/actions";
import Field from "@/components/panel/form/Field";
import { MoneyInput } from "@/components/panel/form/NumberInput";
import Select from "@/components/panel/form/Select";
import Switch from "@/components/panel/form/Switch";
import usePanelForm from "@/components/panel/form/usePanelForm";
import type { SettingsState } from "./settings-pages";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"b2b">;
export type CustomerGroupOption = { slug: string; name: string; isBusiness: boolean };

export default function B2bSettingsForm({ initial, groups }: { initial: State; groups: CustomerGroupOption[] }) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor } = form;
  const options = groups.map((g) => ({ value: g.slug, label: g.isBusiness ? `${g.name} (işletme)` : g.name }));
  if (state.defaultGroupSlug && !options.some((o) => o.value === state.defaultGroupSlug)) {
    options.unshift({ value: state.defaultGroupSlug, label: `${state.defaultGroupSlug} (bulunamadı)` });
  }

  return (
    <SettingsForm form={form} action={saveB2bSettingsAction}>
      <SettingsCard
        title="Kurumsal satış"
        description="Otel, spa, ofis ve restoranlar için işletme fiyatları."
        aside={<Switch checked={state.enabled} onChange={(v) => setField("enabled", v)} label={<span className="sr-only">Kurumsal satış açık</span>} />}
      >
        {state.enabled ? (
          <Hint tone="storefront">
            Açık: müşteri gruplarının indirimleri ve grup fiyatları sepette uygulanır; ürün sayfalarında “Kurumsal fiyat” satırı ve kurumsal
            sayfa bağlantısı görünür.
          </Hint>
        ) : (
          <Hint tone="warning">Kapalı: hiçbir müşteriye grup fiyatı uygulanmaz ve ürün sayfalarındaki “Kurumsal fiyat” satırı gizlenir.</Hint>
        )}
        <Switch
          checked={state.requireApproval}
          onChange={(v) => setField("requireApproval", v)}
          disabled={!state.enabled}
          label="Hesap onayı gerekli"
          description="Açıkken kurumsal grup fiyatları yalnızca firması panelden onaylanmış müşterilere uygulanır. Kapatırsanız gruba atanan herkes indirimi hemen görür."
        />
      </SettingsCard>

      <SettingsCard title="Kurumsal hesaplar" description="Başvurusu onaylanan firmaların grubu ve ileride devreye girecek iki ayar.">
        <Hint tone="pending">
          “Onaylanan firmaların grubu” başvuru onayında kullanılır. “İşletme fiyatlarını ziyaretçilere göster” ve “Kurumsal en düşük sipariş
          tutarı” şimdilik yalnızca kaydedilir; sitede henüz uygulanmaz.
        </Hint>
        <Switch
          checked={state.showPricesToGuests}
          onChange={(v) => setField("showPricesToGuests", v)}
          label="İşletme fiyatlarını ziyaretçilere göster"
          description="Giriş yapmamış ziyaretçiler de işletme fiyatlarını görebilir. Genellikle kapalı tutulur."
        />
        <FieldRow>
          <Field
            label="Kurumsal en düşük sipariş tutarı"
            name="minOrderTotal"
            error={errorFor("minOrderTotal")}
            help="Kurumsal siparişler için alt sınır. 0 = sınır yok."
          >
            <MoneyInput value={state.minOrderTotal} onChange={(v) => setField("minOrderTotal", v ?? 0)} />
          </Field>
          <Field
            label="Onaylanan firmaların grubu"
            name="defaultGroupSlug"
            error={errorFor("defaultGroupSlug")}
            help="Başvurusu onaylanan firmalar bu müşteri grubuna atanır."
          >
            <Select value={state.defaultGroupSlug} onChange={(v) => setField("defaultGroupSlug", v)} options={options} />
          </Field>
        </FieldRow>
      </SettingsCard>
    </SettingsForm>
  );
}
