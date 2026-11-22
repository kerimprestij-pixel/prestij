"use client";
import { CircleCheck } from "lucide-react";
import { savePaymentSettingsAction } from "@/app/panel/(dashboard)/ayarlar/actions";
import Field from "@/components/panel/form/Field";
import { LocalizedTextarea } from "@/components/panel/form/LocalizedInput";
import MediaPicker from "@/components/panel/form/MediaPicker";
import { MoneyInput, NumberInput, PercentInput } from "@/components/panel/form/NumberInput";
import Repeater from "@/components/panel/form/Repeater";
import Select from "@/components/panel/form/Select";
import Switch from "@/components/panel/form/Switch";
import TextInput from "@/components/panel/form/TextInput";
import usePanelForm from "@/components/panel/form/usePanelForm";
import type { MediaLike } from "@/lib/media/types";
import { BANK_TRANSFER_PAYMENT_DAYS } from "@/lib/orders/bank-transfer-deadline";
import { formatTryAmount } from "@/lib/panel/format";
import { formatIban, isValidIban } from "@/lib/validation/tr";
import type { SettingsState } from "./settings-pages";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"payments">;
type Account = State["bankTransfer"]["accounts"][number];

const PROVIDERS = [
  { value: "iyzico" as const, label: "iyzico" },
  { value: "paytr" as const, label: "PayTR" },
];

const tl = (kurus: number) => formatTryAmount(kurus, { symbol: true });

/** IBAN typed in any spacing, stored without spaces, shown in groups of four. */
function IbanInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const valid = compact.length === 26 && isValidIban(compact);
  return (
    <div className="space-y-1.5">
      <TextInput
        value={formatIban(compact)}
        onChange={(v) => onChange(v.replace(/[^0-9a-z]/gi, "").toUpperCase().slice(0, 26))}
        placeholder="TR00 0000 0000 0000 0000 0000 00"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        dir="ltr"
        className="font-mono tracking-wide"
        suffix={valid ? <CircleCheck aria-label="Geçerli IBAN" className="size-4 text-[#2F8F5B] dark:text-[#5CC08A]" /> : undefined}
      />
    </div>
  );
}

/** Which providers have their keys on this server (from the environment; never the values). */
export type GatewayAvailability = { simulator: boolean; ready: { provider: "iyzico" | "paytr"; ready: boolean }[] };

export default function PaymentSettingsForm({ initial, gateway, media }: { initial: State; gateway: GatewayAvailability; media: MediaLike[] }) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor, hasErrors, localizedError } = form;
  const { card, bankTransfer: bank, cashOnDelivery: cod } = state;
  const noneEnabled = !card.enabled && !(bank.enabled && bank.accounts.length > 0) && !cod.enabled;

  return (
    <SettingsForm form={form} action={savePaymentSettingsAction}>
      {noneEnabled ? (
        <Hint tone="warning">Açık bir ödeme yöntemi yok: müşteriler şu an sipariş veremez. En az bir yöntemi açın.</Hint>
      ) : null}

      <SettingsCard
        title="Kartla ödeme"
        description="Kredi ve banka kartıyla ödeme. Kapalıyken ödeme sayfasında kart seçeneği görünmez."
        aside={<Switch checked={card.enabled} onChange={(v) => setField("card.enabled", v)} label={<span className="sr-only">Kartla ödeme</span>} />}
      >
        <FieldRow>
          <Field
            label="Ödeme kuruluşu"
            name="card.provider"
            error={errorFor("card.provider")}
            help="Yeni kart ödemeleri bu kuruluş üzerinden alınır. Önceki ödemelerin bildirimleri ve iadeleri, ödemeyi alan kuruluşta işlenmeye devam eder."
          >
            <Select value={card.provider} onChange={(v) => setField("card.provider", v)} options={PROVIDERS} disabled={!card.enabled} />
          </Field>
          <Field
            label="En fazla taksit"
            name="card.maxInstallments"
            error={errorFor("card.maxInstallments")}
            help="1 = yalnızca tek çekim. Hangi taksitlerin sunulacağını kart ve banka belirler; seçenekler kuruluşun ödeme formunda gösterilir."
          >
            <NumberInput
              value={card.maxInstallments}
              onChange={(v) => setField("card.maxInstallments", Math.min(12, Math.max(1, v ?? 1)))}
              min={1}
              max={12}
              suffix="taksit"
              disabled={!card.enabled || !card.installments}
            />
          </Field>
        </FieldRow>
        {gateway.simulator ? (
          <Hint tone="pending">Bu sunucuda ödeme simülatörü açık; kuruluş seçimi canlı sunucuda geçerli olur.</Hint>
        ) : gateway.ready.find((g) => g.provider === card.provider)?.ready ? (
          <Hint tone="storefront">
            {PROVIDERS.find((p) => p.value === card.provider)?.label} anahtarları tanımlı: ödeme sayfasında kart seçeneği bu kuruluşla çalışır.
          </Hint>
        ) : (
          <Hint tone="warning">
            {PROVIDERS.find((p) => p.value === card.provider)?.label} anahtarları bu sunucuda tanımlı değil. Bu seçimle kart seçeneği ödeme
            sayfasında “kullanılamıyor” görünür.
          </Hint>
        )}
        <div className="space-y-4">
          <Switch
            checked={card.testMode}
            onChange={(v) => setField("card.testMode", v)}
            disabled={!card.enabled}
            label="Test modu"
            description="Açıkken ödemeler kuruluşun test ortamına gider (iyzico: sandbox, PayTR: test işlemi); gerçek para çekilmez. PayTR'de bunu ancak PayTR canlı moda geçiş talebinizi onaylayıp SMS veya e-postayla bildirince kapatın. Daha önce kapatırsanız müşteriler kart seçeneğini görür ama ödeme yapamaz."
          />
          <Switch
            checked={card.installments}
            onChange={(v) => setField("card.installments", v)}
            disabled={!card.enabled}
            label="Taksit seçenekleri"
            description="Kart ödemesinde taksit seçimi sunulur (en fazla yukarıdaki taksit sayısına kadar). Kapalıyken tek çekim yapılır. Avukatınızın onayladığı sözleşmeler taksiti anlatmıyorsa kapalı tutun."
          />
        </div>
        <Field
          label="PayTR logosu"
          optional
          name="paytrLogoImageId"
          error={errorFor("paytrLogoImageId")}
          help="PayTR sözleşmesi, ödeme sayfasında PayTR logosunun görünmesini ister. Logoyu PayTR'nin kendi logo dosyalarından alın (PayTR panelinden ya da dev.paytr.com › Sıkça Sorulan Sorular › PayTR görselleri), Medya'ya yükleyip burada seçin. Seçilmezse logo görünmez, yazı yine görünür."
        >
          <MediaPicker
            value={state.paytrLogoImageId}
            onChange={(id) => setField("paytrLogoImageId", id)}
            items={media}
            folder="logo"
            aspect="3/1"
            dialogTitle="PayTR logosu"
          />
        </Field>
        {card.provider === "paytr" ? (
          <Hint tone="storefront">
            Kart ödeme sayfasında, PayTR formunun altında “ödeme hizmetleri PAYTR Ödeme ve Elektronik Para Kuruluşu A.Ş. tarafından
            sağlanmaktadır” yazısı ve paytr.com bağlantısı görünür. Aynı yazı sitenin alt bilgisinde de görünür, ama yalnızca kart açık, kuruluş
            PayTR, test modu kapalı ve PayTR anahtarları tanımlıyken. Yazıyı Arayüz Metinleri › Alt bilgi › PayTR bölümünden değiştirebilirsiniz;
            imzaladığınız sözleşmedeki cümleyle aynı olmalı.
          </Hint>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title="Havale / EFT"
        description="Müşteri siparişi verir, tutarı aşağıdaki hesaplardan birine gönderir; ödeme panelden onaylanınca sipariş hazırlanır."
        aside={
          <Switch checked={bank.enabled} onChange={(v) => setField("bankTransfer.enabled", v)} label={<span className="sr-only">Havale / EFT</span>} />
        }
      >
        <div className="space-y-3">
          <p className="text-sm font-medium text-text">Banka hesapları</p>
          <Repeater<Account>
            items={bank.accounts}
            onChange={(v) => setField("bankTransfer.accounts", v)}
            noun="Hesap"
            addLabel="Banka hesabı ekle"
            ariaLabel="Banka hesapları"
            max={10}
            createItem={() => ({ bank: "", holder: "", iban: "" })}
            itemSummary={(a) => [a.bank, a.iban ? formatIban(a.iban) : ""].filter(Boolean).join(" · ") || null}
            itemHasError={(i) => hasErrors(`bankTransfer.accounts.${i}`)}
            allowDuplicate={false}
            disabled={!bank.enabled}
            emptyText="Henüz banka hesabı yok."
            renderItem={(a, { index, update }) => (
              <div className="space-y-5">
                <FieldRow>
                  <Field label="Banka" required name={`bankTransfer.accounts.${index}.bank`} error={errorFor(`bankTransfer.accounts.${index}.bank`)}>
                    <TextInput value={a.bank} onChange={(v) => update((p) => ({ ...p, bank: v }))} maxLength={80} placeholder="Ziraat Bankası" />
                  </Field>
                  <Field
                    label="Hesap sahibi"
                    required
                    name={`bankTransfer.accounts.${index}.holder`}
                    error={errorFor(`bankTransfer.accounts.${index}.holder`)}
                  >
                    <TextInput
                      value={a.holder}
                      onChange={(v) => update((p) => ({ ...p, holder: v }))}
                      maxLength={120}
                      placeholder="PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ."
                    />
                  </Field>
                </FieldRow>
                <Field
                  label="IBAN"
                  required
                  name={`bankTransfer.accounts.${index}.iban`}
                  error={errorFor(`bankTransfer.accounts.${index}.iban`)}
                  help="TR ile başlayan 26 karakter. Boşluklu ya da boşluksuz yapıştırabilirsiniz."
                >
                  <IbanInput value={a.iban} onChange={(iban) => update((p) => ({ ...p, iban }))} />
                </Field>
              </div>
            )}
          />
          {bank.enabled && bank.accounts.length === 0 ? (
            <Hint tone="warning">Banka hesabı eklenmeden havale ödeme sayfasında görünmez.</Hint>
          ) : (
            <Hint tone="storefront">
              Banka hesabı eklenince havale ödeme sayfasında görünür. Havale ile verilen siparişin sayfasında hesaplar, IBAN kopyalama
              düğmesiyle listelenir.
            </Hint>
          )}
        </div>

        <FieldRow>
          <Field
            label="Havale indirimi"
            name="bankTransfer.discountPercent"
            error={errorFor("bankTransfer.discountPercent")}
            help="Havale seçen müşteriye, kupon sonrası ürün tutarı üzerinden uygulanır (kargo hariç). En fazla %50."
          >
            <PercentInput
              value={bank.discountPercent}
              onChange={(v) => setField("bankTransfer.discountPercent", v ?? 0)}
              max={50}
              disabled={!bank.enabled}
            />
          </Field>
          <Field
            label="Ödeme süresi"
            name="bankTransfer.paymentDays"
            error={errorFor("bankTransfer.paymentDays")}
            help={`Müşterinin havaleyi yapması gereken gün sayısı (${BANK_TRANSFER_PAYMENT_DAYS.min}–${BANK_TRANSFER_PAYMENT_DAYS.max}). Son ödeme tarihi, siparişin verildiği günden bu kadar gün sonraki günün sonudur (Türkiye saati). Süre sipariş verilirken siparişe yazılır: sonradan değiştirirseniz yalnızca yeni siparişler etkilenir. Sözleşmelerin sipariş bölümüne bu süre kendiliğinden yazılır; avukatınızın metninde ayrıca bir süre geçiyorsa aynı gün sayısı olmalı.`}
          >
            <NumberInput
              value={bank.paymentDays}
              onChange={(v) =>
                setField("bankTransfer.paymentDays", Math.min(BANK_TRANSFER_PAYMENT_DAYS.max, Math.max(BANK_TRANSFER_PAYMENT_DAYS.min, v ?? BANK_TRANSFER_PAYMENT_DAYS.default)))
              }
              min={BANK_TRANSFER_PAYMENT_DAYS.min}
              max={BANK_TRANSFER_PAYMENT_DAYS.max}
              suffix="gün"
              disabled={!bank.enabled}
            />
          </Field>
        </FieldRow>
        {bank.enabled ? (
          <Hint tone="storefront">
            Son ödeme tarihi sipariş e-postasında, sipariş sayfasında, ödeme sayfasında ve satış sözleşmelerinin sipariş bölümünde gösterilir.
            Süresi dolan siparişler kendiliğinden iptal edilmez: her gün Siparişler › Havale bekleyen sekmesine bakın; “Ödeme süresi doldu”
            işaretli siparişlerde müşteriye ulaşın ya da siparişi iptal edin (iptal, stoku geri ekler).
          </Hint>
        ) : null}
        <LocalizedTextarea
          label="Ödeme açıklaması"
          name="bankTransfer.instructions"
          value={bank.instructions}
          onChange={(v) => setField("bankTransfer.instructions", v)}
          error={localizedError("bankTransfer.instructions")}
          maxLength={500}
          rows={3}
          disabled={!bank.enabled}
          help="Havale bekleyen siparişin sayfasında hesapların altında görünür. Boş bırakılırsa “ödeme açıklamasına sipariş numaranızı yazın” uyarısı gösterilir."
        />
      </SettingsCard>

      <SettingsCard
        title="Kapıda ödeme"
        description="Müşteri ödemeyi teslimatta kargo görevlisine yapar."
        aside={
          <Switch checked={cod.enabled} onChange={(v) => setField("cashOnDelivery.enabled", v)} label={<span className="sr-only">Kapıda ödeme</span>} />
        }
      >
        <FieldRow>
          <Field label="Kapıda ödeme ücreti" name="cashOnDelivery.fee" error={errorFor("cashOnDelivery.fee")} help="Kapıda ödeme seçilince siparişe eklenir.">
            <MoneyInput value={cod.fee} onChange={(v) => setField("cashOnDelivery.fee", v ?? 0)} disabled={!cod.enabled} />
          </Field>
          <Field
            label="Sipariş üst sınırı"
            name="cashOnDelivery.maxOrderTotal"
            error={errorFor("cashOnDelivery.maxOrderTotal")}
            help="Bu tutarı aşan siparişlerde kapıda ödeme seçilemez. 0 = sınır yok."
          >
            <MoneyInput value={cod.maxOrderTotal} onChange={(v) => setField("cashOnDelivery.maxOrderTotal", v ?? 0)} disabled={!cod.enabled} />
          </Field>
        </FieldRow>
        {cod.enabled ? (
          <Hint tone="storefront">
            Ödeme sayfasında seçilince toplama {tl(cod.fee)} hizmet bedeli eklenir
            {cod.maxOrderTotal > 0 ? `; ${tl(cod.maxOrderTotal)} üzerindeki siparişlerde seçilemez.` : "."}
          </Hint>
        ) : (
          <Hint>Kapalı: ödeme sayfasında kapıda ödeme seçeneği görünmez.</Hint>
        )}
      </SettingsCard>
    </SettingsForm>
  );
}
