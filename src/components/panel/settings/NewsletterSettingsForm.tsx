"use client";
import { saveNewsletterSettingsAction } from "@/app/panel/(dashboard)/ayarlar/actions";
import Field from "@/components/panel/form/Field";
import { LocalizedTextarea } from "@/components/panel/form/LocalizedInput";
import { NumberInput } from "@/components/panel/form/NumberInput";
import Switch from "@/components/panel/form/Switch";
import usePanelForm from "@/components/panel/form/usePanelForm";
import type { SettingsState } from "./settings-pages";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"newsletter">;

export default function NewsletterSettingsForm({ initial }: { initial: State }) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor, localizedError } = form;

  return (
    <SettingsForm form={form} action={saveNewsletterSettingsAction}>
      <SettingsCard
        title="Abonelik formu"
        description="Sitenin alt bilgisindeki e-bülten bandı."
        aside={<Switch checked={state.enabled} onChange={(v) => setField("enabled", v)} label={<span className="sr-only">E-bülten açık</span>} />}
      >
        <LocalizedTextarea
          label="Davet metni"
          name="incentive"
          value={state.incentive}
          onChange={(v) => setField("incentive", v)}
          error={localizedError("incentive")}
          maxLength={300}
          rows={2}
          help="Bandın başlığının altında görünür. Boş bırakılırsa arayüz metinlerindeki varsayılan cümle kullanılır."
        />
        {state.enabled ? (
          <Hint tone="storefront">Açık: abonelik bandı alt bilgide görünür ve yeni aboneler E-bülten listesine eklenir.</Hint>
        ) : (
          <Hint tone="warning">Kapalı: alt bilgideki band gizlenir ve abonelik formları yeni kayıt kabul etmez.</Hint>
        )}
      </SettingsCard>

      <SettingsCard title="Açılır pencere" description="Ziyaretçiye bir süre sonra gösterilecek abonelik penceresi.">
        <Hint tone="pending">Açılır pencere henüz sitede yok; ayar şimdi kaydedilir, pencere eklendiğinde kullanılır.</Hint>
        <Switch
          checked={state.popupEnabled}
          onChange={(v) => setField("popupEnabled", v)}
          label="Açılır pencereyi göster"
        />
        <FieldRow>
          <Field label="Bekleme süresi" name="popupDelaySeconds" error={errorFor("popupDelaySeconds")} help="Sayfa açıldıktan kaç saniye sonra gösterilir.">
            <NumberInput
              value={state.popupDelaySeconds}
              onChange={(v) => setField("popupDelaySeconds", v ?? 0)}
              min={0}
              max={600}
              suffix="saniye"
              disabled={!state.popupEnabled}
            />
          </Field>
        </FieldRow>
      </SettingsCard>
    </SettingsForm>
  );
}
