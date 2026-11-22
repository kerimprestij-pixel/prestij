"use client";
import { saveSampleSettingsAction } from "@/app/panel/(dashboard)/ayarlar/actions";
import Field from "@/components/panel/form/Field";
import { MoneyInput, NumberInput } from "@/components/panel/form/NumberInput";
import Switch from "@/components/panel/form/Switch";
import usePanelForm from "@/components/panel/form/usePanelForm";
import { formatTryAmount } from "@/lib/panel/format";
import type { SettingsState } from "./settings-pages";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"samples">;

export default function SampleSettingsForm({ initial, sampleProducts }: { initial: State; sampleProducts: number }) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor } = form;

  return (
    <SettingsForm form={form} action={saveSampleSettingsAction}>
      <SettingsCard
        title="Sepette ücretsiz numune"
        description="Müşteri sepetinden ücretsiz numune seçebilir; numuneler siparişle birlikte gönderilir."
        aside={
          <Switch
            checked={state.cartSampleEnabled}
            onChange={(v) => setField("cartSampleEnabled", v)}
            label={<span className="sr-only">Sepette ücretsiz numune</span>}
          />
        }
      >
        <FieldRow>
          <Field label="Sipariş başına en fazla" name="maxPerOrder" error={errorFor("maxPerOrder")} help="Bir siparişe eklenebilecek farklı numune sayısı.">
            <NumberInput
              value={state.maxPerOrder}
              onChange={(v) => setField("maxPerOrder", v ?? 0)}
              min={0}
              max={10}
              suffix="numune"
              disabled={!state.cartSampleEnabled}
            />
          </Field>
          <Field
            label="En düşük sepet tutarı"
            name="minOrderTotal"
            error={errorFor("minOrderTotal")}
            help="Numune seçebilmek için gereken ürün tutarı. 0 = her sepette."
          >
            <MoneyInput value={state.minOrderTotal} onChange={(v) => setField("minOrderTotal", v ?? 0)} disabled={!state.cartSampleEnabled} />
          </Field>
        </FieldRow>
        {state.cartSampleEnabled ? (
          <Hint tone="storefront">
            Sepette ve sepet çekmecesinde numune listesi görünür
            {state.minOrderTotal > 0 ? `; ${formatTryAmount(state.minOrderTotal, { symbol: true })} altındaki sepetlerde kilitli kalır` : ""}.
            {sampleProducts === 0 ? " Şu an satışta numune ürünü yok; liste numune ürünü eklenince görünür." : ""}
          </Hint>
        ) : (
          <Hint>Kapalı: sepette numune listesi görünmez, daha önce eklenmiş numuneler siparişe dahil edilmez.</Hint>
        )}
      </SettingsCard>

      <SettingsCard
        title="Numune talep bağlantıları"
        description="İşletmeler için numune isteme sayfasına giden bağlantılar."
        aside={
          <Switch
            checked={state.requestFormEnabled}
            onChange={(v) => setField("requestFormEnabled", v)}
            label={<span className="sr-only">Numune talep bağlantıları</span>}
          />
        }
      >
        <Hint tone="storefront">
          {state.requestFormEnabled
            ? "Açık: ürün sayfalarında “Numune iste” bağlantısı ve sayfa altındaki numune bandı görünür."
            : "Kapalı: ürün sayfalarındaki “Numune iste” bağlantısı ve numune bandı gizlenir."}
        </Hint>
      </SettingsCard>
    </SettingsForm>
  );
}
