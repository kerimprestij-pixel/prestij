"use client";
import { ExternalLink } from "lucide-react";
import { saveWhatsappSettingsAction } from "@/app/panel/(dashboard)/ayarlar/actions";
import Field from "@/components/panel/form/Field";
import { LocalizedTextarea } from "@/components/panel/form/LocalizedInput";
import Switch from "@/components/panel/form/Switch";
import TextInput from "@/components/panel/form/TextInput";
import usePanelForm from "@/components/panel/form/usePanelForm";
import { buttonClass } from "@/components/panel/ui/styles";
import { normalizeWhatsappPhone } from "@/lib/panel/settings/schemas";
import type { SettingsState } from "./settings-pages";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"whatsapp">;

/** "905321234567" → "+90 532 123 45 67" (Turkish numbers), otherwise "+<digits>". */
function displayPhone(digits: string): string {
  const d = normalizeWhatsappPhone(digits);
  const m = d.match(/^90(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+90 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : d ? `+${d}` : "";
}

export default function WhatsappSettingsForm({ initial }: { initial: State }) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor, localizedError } = form;
  const digits = normalizeWhatsappPhone(state.phone);
  const valid = /^[1-9]\d{9,14}$/.test(digits);
  const testUrl = valid ? `https://wa.me/${digits}${state.message.tr ? `?text=${encodeURIComponent(state.message.tr)}` : ""}` : null;

  return (
    <SettingsForm form={form} action={saveWhatsappSettingsAction}>
      <SettingsCard
        title="WhatsApp düğmesi"
        description="Sitenin sağ alt köşesinde duran yeşil sohbet düğmesi; numara, sipariş sayfalarının yardım bölümündeki WhatsApp bağlantısında da kullanılır."
        aside={<Switch checked={state.enabled} onChange={(v) => setField("enabled", v)} label={<span className="sr-only">WhatsApp düğmesi açık</span>} />}
      >
        <FieldRow>
          <Field
            label="WhatsApp numarası"
            required={state.enabled}
            name="phone"
            error={errorFor("phone")}
            help={valid ? `Kaydedilecek biçim: ${displayPhone(digits)}` : "Ülke koduyla yazın; 0532… biçimi otomatik olarak +90 532… olur."}
          >
            <TextInput value={state.phone} onChange={(v) => setField("phone", v)} type="tel" inputMode="tel" placeholder="90 532 123 45 67" dir="ltr" />
          </Field>
        </FieldRow>
        <LocalizedTextarea
          label="Hazır mesaj"
          name="message"
          value={state.message}
          onChange={(v) => setField("message", v)}
          error={localizedError("message")}
          maxLength={500}
          rows={2}
          help="Ziyaretçi düğmeye bastığında WhatsApp'ta yazılı gelir; göndermeden önce değiştirebilir. Ziyaretçinin diline göre seçilir."
        />
        <div className="flex flex-wrap items-center gap-3">
          {testUrl ? (
            <a href={testUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
              <ExternalLink aria-hidden className="size-4" />
              WhatsApp&apos;ta dene
              <span className="sr-only"> (yeni sekmede açılır)</span>
            </a>
          ) : null}
          {state.enabled ? (
            <Hint tone="storefront">Açık: düğme tüm mağaza sayfalarında görünür.</Hint>
          ) : (
            <Hint>Kapalı: düğme ve sipariş sayfalarındaki WhatsApp bağlantısı gizlenir.</Hint>
          )}
        </div>
      </SettingsCard>
    </SettingsForm>
  );
}
