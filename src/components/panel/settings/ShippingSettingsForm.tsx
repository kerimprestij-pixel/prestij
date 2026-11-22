"use client";
import { Lock } from "lucide-react";
import { saveShippingSettingsAction } from "@/app/panel/(dashboard)/ayarlar/actions";
import Field from "@/components/panel/form/Field";
import { MoneyInput, NumberInput } from "@/components/panel/form/NumberInput";
import Repeater from "@/components/panel/form/Repeater";
import Switch from "@/components/panel/form/Switch";
import TextInput from "@/components/panel/form/TextInput";
import usePanelForm from "@/components/panel/form/usePanelForm";
import { formatTryAmount, slugify } from "@/lib/panel/format";
import { MAX_DELIVERY_DAYS, TRACKING_CODE } from "@/lib/panel/settings/schemas";
import type { SettingsState } from "./settings-pages";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"shipping">;
type Carrier = State["carriers"][number];

const tl = (kurus: number) => formatTryAmount(kurus, { symbol: true });
const kgLabel = (grams: number) => `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(grams / 1000)} kg`;

/** Example rows under the fee fields, computed like the cart engine (src/lib/cart/compute.ts). */
function feeExample(state: State): string {
  const { flatFee, freeThreshold } = state;
  if (freeThreshold <= 0) return `Her siparişe ${tl(flatFee)} kargo ücreti eklenir; ücretsiz kargo yok.`;
  if (flatFee <= 0) return "Kargo ücreti 0: tüm siparişler ücretsiz kargolanır.";
  const below = Math.round((freeThreshold * 0.8) / 10000) * 10000 || Math.floor(freeThreshold / 2);
  return `${tl(below)} tutarındaki sepete ${tl(flatFee)} kargo eklenir; ${tl(freeThreshold)} ve üzeri ücretsiz kargolanır.`;
}

function heavyExample(state: State): string | null {
  const { thresholdGrams, feePerKg } = state.heavy;
  if (feePerKg <= 0) return null;
  const sample = Math.max(21000, thresholdGrams + 1000);
  const kg = Math.ceil((sample - thresholdGrams) / 1000);
  return `Örnek: ${kgLabel(sample)}’lık bir siparişte ${kgLabel(thresholdGrams)} üzerindeki her başlayan kilogram için ${tl(feePerKg)} → ${kg} × ${tl(feePerKg)} = ${tl(kg * feePerKg)}.`;
}

export default function ShippingSettingsForm({ initial, carrierUsage }: { initial: State; carrierUsage: Record<string, number> }) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor, hasErrors, saved } = form;
  const savedKeys = new Set(saved.carriers.map((c) => c.key));
  const heavy = heavyExample(state);

  return (
    <SettingsForm form={form} action={saveShippingSettingsAction}>
      <SettingsCard
        title="Kargo ücreti"
        description="Sepette, ödeme sayfasında ve siparişte aynı kurallarla hesaplanır. Değişiklik açık sepetlere de hemen yansır."
      >
        <FieldRow>
          <Field label="Kargo ücreti" required name="flatFee" error={errorFor("flatFee")} help="Kargo gönderisi olan her siparişe eklenir.">
            <MoneyInput value={state.flatFee} onChange={(v) => setField("flatFee", v ?? 0)} />
          </Field>
          <Field
            label="Ücretsiz kargo sınırı"
            name="freeThreshold"
            error={errorFor("freeThreshold")}
            help="Kupon indirimi düşüldükten sonraki ürün tutarı bu sınıra ulaşınca kargo ücretsiz olur. 0 = ücretsiz kargo yok."
          >
            <MoneyInput value={state.freeThreshold} onChange={(v) => setField("freeThreshold", v ?? 0)} />
          </Field>
        </FieldRow>
        <Hint tone="storefront">{feeExample(state)} Sınır ürün sayfasında ve sepetteki “ücretsiz kargoya kalan” çubuğunda da görünür.</Hint>
      </SettingsCard>

      <SettingsCard
        title="Ağır paket farkı"
        description="20 L bidon gibi ağır siparişler için kilogram başına ek ücret. Ücretsiz kargolu siparişlerde de uygulanır."
        aside={
          <Switch
            checked={state.heavy.enabled}
            onChange={(v) => setField("heavy.enabled", v)}
            label={<span className="sr-only">Ağır paket farkı</span>}
          />
        }
      >
        <FieldRow>
          <Field
            label="Ağırlık sınırı"
            name="heavy.thresholdGrams"
            error={errorFor("heavy.thresholdGrams")}
            help="Siparişin toplam ağırlığı bu sınırı aşınca fark uygulanır."
          >
            <NumberInput
              value={state.heavy.thresholdGrams / 1000}
              onChange={(v) => setField("heavy.thresholdGrams", Math.round((v ?? 0) * 1000))}
              decimals={1}
              step={0.5}
              min={0}
              max={1000}
              suffix="kg"
              disabled={!state.heavy.enabled}
            />
          </Field>
          <Field label="Kilogram başına ücret" name="heavy.feePerKg" error={errorFor("heavy.feePerKg")} help="Sınırı aşan her başlayan kilogram için.">
            <MoneyInput value={state.heavy.feePerKg} onChange={(v) => setField("heavy.feePerKg", v ?? 0)} disabled={!state.heavy.enabled} />
          </Field>
        </FieldRow>
        {state.heavy.enabled ? (
          heavy ? <Hint tone="storefront">{heavy} Bu bilgi ağır ürünlerin sayfasında da gösterilir.</Hint> : null
        ) : (
          <Hint>Kapalı: ağırlık ne olursa olsun yalnızca kargo ücreti alınır.</Hint>
        )}
      </SettingsCard>

      <SettingsCard title="Kargoya verme süresi" description="Siparişin kaç iş günü içinde kargoya verileceği.">
        <FieldRow>
          <Field label="En kısa" required name="estimatedDays.min" error={errorFor("estimatedDays.min")}>
            <NumberInput
              value={state.estimatedDays.min}
              onChange={(v) => setField("estimatedDays.min", v ?? 0)}
              min={0}
              max={MAX_DELIVERY_DAYS}
              suffix="iş günü"
            />
          </Field>
          <Field label="En uzun" required name="estimatedDays.max" error={errorFor("estimatedDays.max")}>
            <NumberInput
              value={state.estimatedDays.max}
              onChange={(v) => setField("estimatedDays.max", v ?? 1)}
              min={1}
              max={MAX_DELIVERY_DAYS}
              suffix="iş günü"
            />
          </Field>
        </FieldRow>
        <Hint tone="storefront">
          Ürün sayfasında “{state.estimatedDays.min}–{state.estimatedDays.max} iş günü içinde kargoda”, sepette ve yasal metinlerin teslim
          süresi bölümünde görünür. Mevzuat gereği teslim en fazla {MAX_DELIVERY_DAYS} gündür.
        </Hint>
      </SettingsCard>

      <SettingsCard
        title="Kargo firmaları"
        description="Siparişi kargoya verirken bu listeden firma seçilir; müşteri sipariş sayfasında takip bağlantısını görür."
      >
        <Repeater<Carrier>
          items={state.carriers}
          onChange={(v) => setField("carriers", v)}
          noun="Kargo firması"
          addLabel="Kargo firması ekle"
          ariaLabel="Kargo firmaları"
          max={20}
          createItem={() => ({ key: "", name: "", trackingUrl: "" })}
          itemSummary={(c) => c.name || null}
          itemHasError={(i) => hasErrors(`carriers.${i}`)}
          allowDuplicate={false}
          emptyText="Henüz kargo firması yok. Siparişleri kargoya verebilmek için en az bir firma ekleyin."
          renderItem={(c, { index, update }) => {
            const locked = savedKeys.has(c.key) && c.key !== "";
            const used = carrierUsage[c.key] ?? 0;
            const example = c.trackingUrl.includes(TRACKING_CODE) ? c.trackingUrl.replace(TRACKING_CODE, "1234567890") : null;
            return (
              <div className="space-y-5">
                <FieldRow>
                  <Field label="Firma adı" required name={`carriers.${index}.name`} error={errorFor(`carriers.${index}.name`)}>
                    <TextInput
                      value={c.name}
                      maxLength={60}
                      placeholder="Yurtiçi Kargo"
                      onChange={(name) =>
                        update((prev) => ({
                          ...prev,
                          name,
                          // New carriers get a short code from the name until it is typed by hand.
                          key: !locked && (prev.key === "" || prev.key === slugify(prev.name, 40)) ? slugify(name, 40) : prev.key,
                        }))
                      }
                    />
                  </Field>
                  <Field
                    label="Kısa kod"
                    required
                    name={`carriers.${index}.key`}
                    error={errorFor(`carriers.${index}.key`)}
                    help={locked ? "Siparişlerde saklandığı için değiştirilemez." : "Siparişlerde saklanır; kaydettikten sonra değişmez."}
                    labelAside={locked ? <Lock aria-hidden className="size-3.5" /> : null}
                  >
                    <TextInput
                      value={c.key}
                      onChange={(key) => update((prev) => ({ ...prev, key: key.toLowerCase() }))}
                      readOnly={locked}
                      maxLength={40}
                      placeholder="yurtici"
                      dir="ltr"
                      className={locked ? "text-text-muted" : undefined}
                    />
                  </Field>
                </FieldRow>
                <Field
                  label="Takip adresi"
                  required
                  name={`carriers.${index}.trackingUrl`}
                  error={errorFor(`carriers.${index}.trackingUrl`)}
                  help={
                    <>
                      Kargo takip numarası <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.6875rem]">{TRACKING_CODE}</code> yerine
                      yazılır.{example ? <span className="mt-1 block break-all">Örnek: {example}</span> : null}
                    </>
                  }
                >
                  <TextInput
                    value={c.trackingUrl}
                    onChange={(trackingUrl) => update((prev) => ({ ...prev, trackingUrl }))}
                    type="url"
                    placeholder="https://www.ornekkargo.com/takip?kod={code}"
                    dir="ltr"
                  />
                </Field>
                {used > 0 ? (
                  <Hint>
                    {used} siparişte kullanıldı. Bu firmayı silmeyin; silinirse o siparişlerin takip bağlantısı kaybolur.
                  </Hint>
                ) : null}
              </div>
            );
          }}
        />
      </SettingsCard>
    </SettingsForm>
  );
}
