"use client";
import { saveLocaleSettingsAction } from "@/app/panel/(dashboard)/ayarlar/actions";
import Switch from "@/components/panel/form/Switch";
import usePanelForm from "@/components/panel/form/usePanelForm";
import Badge from "@/components/panel/ui/Badge";
import { LOCALES, type Locale } from "@/i18n/locales";
import type { SettingsState } from "./settings-pages";
import { Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"locales">;

const LANGUAGES: Record<Locale, { name: string; native: string; note: string }> = {
  tr: { name: "Türkçe", native: "Türkçe", note: "Sitenin ana dili; kapatılamaz. Yasal metinlerin bağlayıcı hâli Türkçedir." },
  en: { name: "İngilizce", native: "English", note: "Adresler İngilizce bölümlerle açılır (/en/products/…)." },
  ar: { name: "Arapça", native: "العربية", note: "Sayfalar sağdan sola gösterilir (/ar/products/…)." },
};

export default function LocaleSettingsForm({ initial }: { initial: State }) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor } = form;
  const toggle = (locale: Locale, on: boolean) =>
    setField(
      "enabled",
      LOCALES.filter((l) => (l === locale ? on : state.enabled.includes(l))),
    );
  const error = errorFor("enabled");

  return (
    <SettingsForm form={form} action={saveLocaleSettingsAction}>
      <SettingsCard title="Sunulan diller" description="Açık diller sitenin üstündeki dil seçicide ve site haritasında (sitemap.xml) yer alır.">
        <ul className="divide-y divide-border rounded-lg border border-border" data-field="enabled">
          {LOCALES.map((locale) => {
            const meta = LANGUAGES[locale];
            const on = state.enabled.includes(locale);
            return (
              <li key={locale} className="flex items-start gap-4 px-4 py-4">
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-surface-2/60 text-xs font-semibold uppercase tracking-wider text-text-muted"
                >
                  {locale}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                    {meta.name}
                    <span lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className="font-normal text-text-muted">
                      {meta.native}
                    </span>
                    {locale === "tr" ? (
                      <Badge tone="gold" variant="soft" size="sm">
                        Ana dil
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{meta.note}</p>
                </div>
                <Switch
                  checked={on}
                  onChange={(v) => toggle(locale, v)}
                  disabled={locale === "tr"}
                  label={<span className="sr-only">{meta.name} açık</span>}
                />
              </li>
            );
          })}
        </ul>
        {error ? <p className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{error}</p> : null}
        <Hint tone="storefront">
          Kapatılan dil dil seçicide ve site haritasında görünmez. O dildeki sayfalar doğrudan adresle açılmaya devam eder; paylaşılmış
          bağlantılar bozulmaz.
        </Hint>
        <Hint>Çeviriler ürün, sayfa ve arayüz metni ekranlarında her dil için ayrı girilir; boş bırakılan çeviride Türkçe metin gösterilir.</Hint>
      </SettingsCard>
    </SettingsForm>
  );
}
