"use client";
import Link from "next/link";
import { saveSubscriptionSettingsAction } from "@/app/panel/(dashboard)/ayarlar/actions";
import Field from "@/components/panel/form/Field";
import { NumberInput } from "@/components/panel/form/NumberInput";
import Switch from "@/components/panel/form/Switch";
import usePanelForm from "@/components/panel/form/usePanelForm";
import { SUBSCRIPTION_PAYMENT_METHODS, type SubscriptionPaymentMethod } from "@/lib/settings/types";
import type { SettingsState } from "./settings-pages";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"subscriptions">;

const METHOD_LABELS: Record<SubscriptionPaymentMethod, { label: string; help: string }> = {
  card: { label: "Kredi / banka kartı", help: "Yenileme siparişi “ödeme bekleniyor” olarak oluşur; müşteriye ödeme bağlantısı gider." },
  bank_transfer: { label: "Havale / EFT", help: "Yenileme siparişi “havale bekleniyor” olarak oluşur; hesap bilgileri e-postayla gider." },
  cash_on_delivery: { label: "Kapıda ödeme", help: "Yenileme siparişi doğrudan “hazırlanıyor” olarak oluşur." },
};

/** Which methods the payment settings actually offer (a method switched off there cannot be used). */
export type MethodAvailability = Record<SubscriptionPaymentMethod, { available: boolean; reason: string | null }>;

export default function SubscriptionSettingsForm({ initial, availability, plans }: { initial: State; availability: MethodAvailability; plans: number }) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor } = form;
  const toggle = (method: SubscriptionPaymentMethod, on: boolean) =>
    setField(
      "allowedMethods",
      SUBSCRIPTION_PAYMENT_METHODS.filter((m) => (m === method ? on : state.allowedMethods.includes(m))),
    );
  const blocked = state.allowedMethods.filter((m) => !availability[m].available);

  return (
    <SettingsForm form={form} action={saveSubscriptionSettingsAction}>
      <SettingsCard
        title="Abone ol ve kazan"
        description="Aboneliğe açık ürünlerde (ürün düzenleme › Abonelik) “Tek seferlik / Abone ol” seçeneği gösterilir; müşteri seçtiği sıklıkta otomatik sipariş alır."
        aside={<Switch checked={state.enabled} onChange={(v) => setField("enabled", v)} label={<span className="sr-only">Abone ol ve kazan</span>} />}
      >
        {state.enabled ? (
          <Hint tone="storefront">
            Açık: ürün sayfalarında abonelik seçeneği ve sepette abone fiyatı görünür.{" "}
            {plans === 0 ? "Şu an sunulan plan yok; seçenek bir plan eklenince görünür. " : null}
            <Link href="/panel/abonelikler/planlar" className="font-medium text-text underline underline-offset-4">
              Planları yönet
            </Link>
          </Hint>
        ) : (
          <Hint>Kapalı: yeni abonelik başlatılamaz; sepetteki abonelikli ürünler tek seferlik satın alınır. Mevcut abonelikler yenilenmeye devam eder (durdurmak için Abonelikler sayfasından iptal edin).</Hint>
        )}
      </SettingsCard>

      <SettingsCard title="Hatırlatma ve ödeme" description="Yenileme siparişinden önce giden e-posta ve kartla ödenen yenilemelerin bekleme süresi.">
        <FieldRow>
          <Field
            label="Hatırlatma"
            name="reminderDaysBefore"
            error={errorFor("reminderDaysBefore")}
            help="Yenilemeden kaç gün önce “teslimatı atla / aboneliği yönet” e-postası gönderilsin."
          >
            <NumberInput value={state.reminderDaysBefore} onChange={(v) => setField("reminderDaysBefore", v ?? 1)} min={1} max={14} suffix="gün önce" nullable={false} />
          </Field>
          <Field
            label="Kartla ödeme süresi"
            name="cardPaymentWindowHours"
            error={errorFor("cardPaymentWindowHours")}
            help="Kartlı yenileme siparişi bu süre içinde ödenmezse otomatik iptal edilir ve stok geri döner."
          >
            <NumberInput value={state.cardPaymentWindowHours} onChange={(v) => setField("cardPaymentWindowHours", v ?? 72)} min={1} max={336} suffix="saat" nullable={false} />
          </Field>
        </FieldRow>
      </SettingsCard>

      <SettingsCard title="Ödeme yöntemleri" description="Abonelikli bir siparişte ödeme adımında yalnızca bu yöntemler seçilebilir; yenilemeler aynı yöntemle oluşur.">
        <fieldset className="space-y-3" aria-describedby="subscription-methods-error">
          <legend className="sr-only">İzin verilen ödeme yöntemleri</legend>
          {SUBSCRIPTION_PAYMENT_METHODS.map((method) => (
            <label key={method} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-4 py-3 hover:border-text/30">
              <input
                type="checkbox"
                checked={state.allowedMethods.includes(method)}
                onChange={(e) => toggle(method, e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{METHOD_LABELS[method].label}</span>
                <span className="mt-0.5 block text-xs text-text-muted">{METHOD_LABELS[method].help}</span>
                {!availability[method].available ? <span className="mt-1 block text-xs text-[#B5730C] dark:text-[#E9B45C]">{availability[method].reason}</span> : null}
              </span>
            </label>
          ))}
        </fieldset>
        {errorFor("allowedMethods") ? (
          <p id="subscription-methods-error" className="text-sm text-[#C2413A]">
            {errorFor("allowedMethods")}
          </p>
        ) : null}
        {blocked.length > 0 ? (
          <Hint tone="warning">
            Seçili {blocked.map((m) => METHOD_LABELS[m].label).join(", ")} ödeme ayarlarında kullanılamıyor; müşteriler bu yöntemi göremez.{" "}
            <Link href="/panel/ayarlar/odeme" className="font-medium underline underline-offset-4">
              Ödeme yöntemleri
            </Link>
          </Hint>
        ) : null}
      </SettingsCard>
    </SettingsForm>
  );
}
