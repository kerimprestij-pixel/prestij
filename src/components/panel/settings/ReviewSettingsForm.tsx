"use client";
import Link from "next/link";
import { saveReviewSettingsAction } from "@/app/panel/(dashboard)/ayarlar/actions";
import Field from "@/components/panel/form/Field";
import { NumberInput } from "@/components/panel/form/NumberInput";
import Switch from "@/components/panel/form/Switch";
import usePanelForm from "@/components/panel/form/usePanelForm";
import { formatNumber } from "@/components/panel/labels";
import { REVIEW_LINK_TTL_DAYS } from "@/lib/reviews/types";
import type { SettingsState } from "./settings-pages";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"reviews">;

const linkClass = "font-medium text-text underline underline-offset-4 hover:decoration-gold";

export default function ReviewSettingsForm({ initial, pending }: { initial: State; pending: number }) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor } = form;

  return (
    <SettingsForm form={form} action={saveReviewSettingsAction}>
      <SettingsCard
        title="Ürün değerlendirmeleri"
        description="Ürün sayfalarındaki puanlar, yorumlar ve değerlendirme formu. Her yorum yayınlanmadan önce Yorumlar sayfasında onayınızdan geçer."
        aside={
          <Switch checked={state.enabled} onChange={(v) => setField("enabled", v)} label={<span className="sr-only">Ürün değerlendirmeleri</span>} />
        }
      >
        {state.enabled ? (
          <Hint tone="storefront">
            Açık: ürün sayfalarında puan ortalaması, onaylı yorumlar ve “Değerlendirme yaz” formu; ürün kartlarında yıldızlar görünür.
            {pending > 0 ? (
              <>
                {" "}
                Şu an{" "}
                <Link href="/panel/yorumlar" className={linkClass}>
                  {formatNumber(pending)} yorum onay bekliyor
                </Link>
                .
              </>
            ) : null}
          </Hint>
        ) : (
          <Hint tone="warning">
            Kapalı: ürün sayfalarında ve kartlarda puan ya da yorum görünmez, yeni yorum alınmaz, değerlendirme isteği e-postası gönderilmez.
            Mevcut yorumlar silinmez; açtığınızda yeniden görünür.
          </Hint>
        )}
        <Field
          label="En az yorum uzunluğu"
          name="minLength"
          error={errorFor("minLength")}
          help="Yorum metni için gereken en az karakter sayısı. 0 = yalnızca puan vermek de yeterli."
          className="sm:max-w-xs"
        >
          <NumberInput value={state.minLength} onChange={(v) => setField("minLength", v ?? 0)} min={0} max={500} suffix="karakter" disabled={!state.enabled} />
        </Field>
      </SettingsCard>

      <SettingsCard
        title="Değerlendirme isteği e-postası"
        description="Teslim edilen siparişlerde müşteriye, aldığı ürünleri değerlendirmesi için sipariş başına bir kez e-posta gönderilir."
      >
        <FieldRow>
          <Field
            label="Teslimattan kaç gün sonra"
            name="requestDaysAfterDelivery"
            error={errorFor("requestDaysAfterDelivery")}
            help="Müşterinin ürünü deneyebilmesi için birkaç gün beklemek iyi olur."
          >
            <NumberInput
              value={state.requestDaysAfterDelivery}
              onChange={(v) => setField("requestDaysAfterDelivery", v ?? 1)}
              min={1}
              max={60}
              suffix="gün"
              disabled={!state.enabled}
            />
          </Field>
        </FieldRow>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">Üye olmadan değerlendirme</p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
              E-postadaki ürün düğmeleri müşteriye özel, {REVIEW_LINK_TTL_DAYS} gün geçerli bağlantılardır; misafir müşteriler de giriş yapmadan
              değerlendirebilir ve yorumları “Doğrulanmış alım” olarak işaretlenir.
            </p>
          </div>
          <Switch
            checked={state.allowGuestLinks}
            onChange={(v) => setField("allowGuestLinks", v)}
            disabled={!state.enabled}
            label={<span className="sr-only">Üye olmadan değerlendirme</span>}
          />
        </div>
        {state.enabled ? (
          <Hint>
            {state.allowGuestLinks
              ? `Sipariş teslim edildikten ${state.requestDaysAfterDelivery} gün sonra, her gün bir kez çalışan görevle gönderilir.`
              : `Kapalıyken e-posta yalnızca üye müşterilere gider; düğmeler ürün sayfasına götürür, değerlendirmek için giriş gerekir.`}{" "}
            E-postanın konusu ve giriş metni{" "}
            <Link href="/panel/ayarlar/e-posta" className={linkClass}>
              E-posta ayarlarından
            </Link>{" "}
            değiştirilebilir.
          </Hint>
        ) : (
          <Hint tone="pending">Değerlendirmeler kapalıyken bu e-posta gönderilmez.</Hint>
        )}
      </SettingsCard>
    </SettingsForm>
  );
}
