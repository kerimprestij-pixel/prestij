"use client";
// Hediye Çarkı → Ayarlar: the whole `giftWheel` settings document in one form (save bar, Ctrl/⌘+S,
// unsaved-changes guard, optimistic lock) with a sticky live preview. Written for a non-technical owner:
// every field says what it does on the site, chances are shown in percent while typing, slice labels
// fill themselves in three languages, keys are handled automatically, and server errors land next to
// the field they belong to (paths like "slices.2.value", "texts.title.en", "endsAt").
import { useMemo } from "react";
import { CircleExclamationPoint, Lock, Scale } from "lucide-react";
import { saveGiftWheelAction } from "@/app/panel/(dashboard)/hediye-carki/actions";
import Field from "@/components/panel/form/Field";
import { LocalizedInput } from "@/components/panel/form/LocalizedInput";
import { MoneyInput, NumberInput, PercentInput } from "@/components/panel/form/NumberInput";
import Repeater from "@/components/panel/form/Repeater";
import ScheduleInput from "@/components/panel/form/ScheduleInput";
import Select from "@/components/panel/form/Select";
import Switch from "@/components/panel/form/Switch";
import usePanelForm, { type PanelForm } from "@/components/panel/form/usePanelForm";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "@/components/panel/settings/SettingsForm";
import type { SettingsState } from "@/components/panel/settings/settings-pages";
import StatusBadge from "@/components/panel/StatusBadge";
import Button from "@/components/panel/ui/Button";
import { errorClass } from "@/components/panel/ui/styles";
import { format } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { formatPrice } from "@/lib/pricing/money";
import {
  formatHours,
  formatShare,
  PRIZE_TYPE_OPTIONS,
  TONE_LABELS,
  WHEEL_SCHEDULE_STATUS,
  wheelScheduleStatus,
} from "@/lib/panel/gift-wheel/labels";
import {
  adjacentSameTone,
  missingLabelLocales,
  newSlice,
  normalizeWeightsTo100,
  SLICE_LIMITS,
  sliceWarnings,
  weightTotal,
  withPrize,
  rekeyChangedSlices,
  slicePrizeChanged,
  tinySliceLabels,
  withSliceKeys,
} from "@/lib/panel/gift-wheel/slices";
import { WHEEL_LIMITS, wheelDisplaySlices, wheelSliceShares, type GiftWheelTextKey, type WheelPrizeType } from "@/lib/wheel/types";
import { cn } from "@/lib/utils";
import { AudiencePicker, TonePicker } from "./choices";
import NewRoundCard from "./NewRoundCard";
import WheelPreview, { type WheelPreviewCopy } from "./WheelPreview";
import WheelTextInput from "./WheelTextInput";

type State = SettingsState<"giftWheel">;
type Slice = State["slices"][number];

const VALIDITY_PRESETS = [24, 48, 72, 168] as const;
const DEFAULT_AUTO_OPEN = 25;

const TEXT_FIELDS: { key: GiftWheelTextKey; label: string; help: string }[] = [
  { key: "title", label: "Başlık", help: "Çark penceresinin en üstünde." },
  { key: "subtitle", label: "Alt başlık", help: "Başlığın altındaki kısa açıklama." },
  { key: "teaser", label: "Çark düğmesi", help: "Sayfanın köşesinde çarkı açan küçük düğmenin metni." },
  { key: "claimCta", label: "“Hediyemi al” düğmesi", help: "Üye girişi yapmış ziyaretçi kazandıktan sonra görür." },
  { key: "registerCta", label: "Üye ol düğmesi", help: "Misafir ziyaretçi kazandıktan sonra görür; üyelik sayfasına götürür." },
  { key: "signInCta", label: "Giriş yap bağlantısı", help: "Üye ol düğmesinin altında; zaten üye olanlar için." },
];

export default function WheelSettingsForm({
  initial,
  copy,
  now,
}: {
  initial: State;
  /** Storefront default texts per locale (placeholders and preview). */
  copy: Record<Locale, WheelPreviewCopy>;
  /** Server time of the page render (ms), for the live/scheduled status line. */
  now: number;
}) {
  const form = usePanelForm<State>(initial);
  const { state, setField, setState, errorFor, errors, hasErrors, localizedError, saved, dirty, reset } = form;
  const lockedKeys = useMemo(() => new Set(saved.slices.map((s) => s.key)), [saved.slices]);

  const shares = wheelSliceShares(state.slices);
  // Labels the storefront wheel would draw too small on a phone, per slice and language (as the preview shows them).
  const tinyLabels = useMemo(
    () =>
      tinySliceLabels({
        tr: wheelDisplaySlices(state.slices, "tr").map((s) => s.label),
        en: wheelDisplaySlices(state.slices, "en", (s) => generatedSliceName(s, "en", copy.en.prize)).map((s) => s.label),
        ar: wheelDisplaySlices(state.slices, "ar", (s) => generatedSliceName(s, "ar", copy.ar.prize)).map((s) => s.label),
      }),
    [state.slices, copy],
  );
  const total = weightTotal(state.slices);
  const status = wheelScheduleStatus(state, now);
  const statusMeta = WHEEL_SCHEDULE_STATUS[status];
  const sameTone = adjacentSameTone(state.slices);
  const textDefaults = (key: GiftWheelTextKey): Record<Locale, string> => ({
    tr: copy.tr.texts[key],
    en: copy.en.texts[key],
    ar: copy.ar.texts[key],
  });

  /** Structural slice changes (add, remove, reorder, duplicate): keys re-derived, slice errors cleared (indexes moved). */
  const setSlices = (next: Slice[]) => setField("slices", withSliceKeys(next, lockedKeys));
  /** One field of one slice; a label change may change an unsaved slice's key. */
  const setSliceField = (index: number, field: keyof Slice, value: unknown) => {
    setField(`slices.${index}.${field}`, value);
    if (field === "label") setState((prev) => ({ ...prev, slices: withSliceKeys(prev.slices, lockedKeys) }));
  };
  /** Prize type/value: the automatic label follows (labels the owner wrote are kept). */
  const setPrize = (index: number, patch: { type?: WheelPrizeType; value?: number }) => {
    const slice = state.slices[index];
    if (!slice) return;
    setField(`slices.${index}`, withPrize(slice, patch));
    setState((prev) => ({ ...prev, slices: withSliceKeys(prev.slices, lockedKeys) }));
  };

  const autoOpen = state.autoOpenSeconds > 0;
  const savedAutoOpen = saved.autoOpenSeconds > 0 ? saved.autoOpenSeconds : DEFAULT_AUTO_OPEN;

  return (
    <SettingsForm form={form} action={saveGiftWheelAction} prepare={(s) => ({ ...s, slices: rekeyChangedSlices(saved.slices, s.slices) })}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {/* 1. On/off and schedule */}
          <SettingsCard
            title="Çark durumu"
            description="Çarkı açın, isterseniz başlangıç ve bitiş zamanı verin. Kapalıyken sitede hiçbir yerde görünmez."
            aside={<Switch checked={state.enabled} onChange={(v) => setField("enabled", v)} label={<span className="sr-only">Hediye çarkı açık</span>} />}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
              <span className="text-text-muted">{statusMeta.description}</span>
            </div>
            <ScheduleInput
              label="Yayın zamanı"
              name="startsAt"
              value={{ startsAt: state.startsAt, endsAt: state.endsAt }}
              onChange={(v) => {
                if (v.startsAt !== state.startsAt) setField("startsAt", v.startsAt);
                if (v.endsAt !== state.endsAt) setField("endsAt", v.endsAt);
              }}
              error={{ startsAt: errors.startsAt, endsAt: errors.endsAt }}
            />
            {state.enabled ? (
              <Hint tone="storefront">
                Açık: çark düğmesi ana sayfada, ürün, kategori ve içerik sayfalarında görünür; sepet, ödeme, hesap, sipariş ve yasal sayfalarda
                gösterilmez. Zamanlama verdiyseniz yalnızca o aralıkta görünür.
              </Hint>
            ) : (
              <Hint tone="warning">Kapalı: çark sitede görünmez. Ayarları şimdi hazırlayıp kaydedebilir, hazır olunca açabilirsiniz.</Hint>
            )}
          </SettingsCard>

          {/* 2. Slices */}
          <SettingsCard
            title="Dilimler"
            description={`Çarkta ${SLICE_LIMITS.min}–${SLICE_LIMITS.max} dilim olur ve her dilim bir hediyedir (“kaybettin” dilimi yoktur). Sonucu her zaman sunucu, şans ağırlıklarına göre seçer.`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 px-3.5 py-3">
              <p className="min-w-0 text-xs leading-relaxed text-text-muted">
                <span className="font-medium text-text">Şans ağırlığı nasıl çalışır?</span> Ağırlığı 20 olan dilim, 10 olandan iki kat sık çıkar. Toplam
                100 olunca her ağırlık doğrudan yüzde olasılığa eşittir. Şu an toplam: <span className="font-medium tabular-nums text-text">{total}</span>.
              </p>
              {total !== 100 && state.slices.length > 0 ? (
                <Button
                  size="sm"
                  icon={Scale}
                  onClick={() => {
                    const weights = normalizeWeightsTo100(state.slices.map((s) => s.weight));
                    setSlices(state.slices.map((s, i) => ({ ...s, weight: weights[i] ?? s.weight })));
                  }}
                >
                  Toplamı 100 yap
                </Button>
              ) : null}
            </div>

            {errors.slices ? (
              <p className={cn(errorClass, "flex items-start gap-1.5")} role="alert">
                <CircleExclamationPoint aria-hidden className="mt-px size-3.5 shrink-0" />
                <span>{errors.slices}</span>
              </p>
            ) : null}

            <Repeater<Slice>
              items={state.slices}
              onChange={setSlices}
              createItem={() => newSlice(state.slices)}
              noun="Dilim"
              addLabel="Dilim ekle"
              ariaLabel="Çark dilimleri"
              min={SLICE_LIMITS.min}
              max={SLICE_LIMITS.max}
              itemSummary={(s, i) => `${s.label.tr || "metin yok"} · ${formatShare(shares[i] ?? 0)}`}
              itemHasError={(i) => hasErrors(`slices.${i}`)}
              renderItem={(slice, { index }) => (
                <SliceFields
                  slice={slice}
                  index={index}
                  share={shares[index] ?? 0}
                  locked={lockedKeys.has(slice.key)}
                  prizeChanged={slicePrizeChanged(saved.slices, slice)}
                  tinyIn={tinyLabels[index] ?? []}
                  errorFor={errorFor}
                  localizedError={localizedError}
                  onField={(field, value) => setSliceField(index, field, value)}
                  onPrize={(patch) => setPrize(index, patch)}
                />
              )}
            />

            {sameTone.length > 0 ? (
              <Hint tone="warning">
                Yan yana duran dilimler aynı renkte:{" "}
                {sameTone.map(([a, b]) => `Dilim ${a + 1} ve Dilim ${b + 1} (${TONE_LABELS[state.slices[a].tone]})`).join(", ")}. Çarkta ayırt etmek
                zorlaşır; birinin rengini değiştirin ya da sırasını kaydırın.
              </Hint>
            ) : null}
          </SettingsCard>

          {/* 3. Audience */}
          <SettingsCard title="Kimler görür" description="Çark kimlere gösterilsin? Kural, hediye hesaba tanımlanırken bir kez daha kontrol edilir.">
            <AudiencePicker value={state.audience} onChange={(v) => setField("audience", v)} name="audience" error={errorFor("audience")} />
            <Switch
              checked={state.showToBusiness}
              onChange={(v) => setField("showToBusiness", v)}
              label="Onaylı kurumsal müşterilere de göster"
              description="Kapalıyken kurumsal hesaplar (bayi, toptan) çarkı görmez; onlara özel fiyatlar zaten uygulanır."
            />
            <Hint>Çalışan hesapları (personel, editör, yönetici) çarkı hiçbir zaman görmez.</Hint>
          </SettingsCard>

          {/* 4. Prize validity and hold */}
          <SettingsCard
            title="Hediye süreleri"
            description="Hediye, ziyaretçi üye olup hesabına tanımlandığında tek kullanımlık bir indirim koduna dönüşür ve sepette kendiliğinden uygulanır."
          >
            <FieldRow>
              <Field
                label="Kod ne kadar geçerli?"
                required
                name="validityHours"
                error={errorFor("validityHours")}
                help={`Hesaba tanımlandığı andan itibaren ${formatHours(state.validityHours)}. Sepette ve hesap sayfasında geri sayım görünür. ${WHEEL_LIMITS.validityHours.min}–${WHEEL_LIMITS.validityHours.max} saat.`}
              >
                <NumberInput
                  value={state.validityHours}
                  onChange={(v) => setField("validityHours", v ?? WHEEL_LIMITS.validityHours.min)}
                  min={WHEEL_LIMITS.validityHours.min}
                  max={WHEEL_LIMITS.validityHours.max}
                  step={24}
                  suffix="saat"
                  nullable={false}
                />
              </Field>
              <Field
                label="Alınmayan hediye kaç gün beklesin?"
                required
                name="holdDays"
                error={errorFor("holdDays")}
                help={`Çevirip henüz üye olmayan ziyaretçinin hediyesi ${state.holdDays} gün saklanır; bu sürede üye olursa hediye hesabına tanımlanır. Yeni süre yalnızca bundan sonraki çevirmelere uygulanır: ziyaretçiye gösterilmiş tarih değişmez.`}
              >
                <NumberInput
                  value={state.holdDays}
                  onChange={(v) => setField("holdDays", v ?? WHEEL_LIMITS.holdDays.min)}
                  min={WHEEL_LIMITS.holdDays.min}
                  max={WHEEL_LIMITS.holdDays.max}
                  suffix="gün"
                  nullable={false}
                />
              </Field>
            </FieldRow>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Hazır geçerlilik süreleri">
              <span className="text-xs text-text-muted">Hızlı seçim:</span>
              {VALIDITY_PRESETS.map((hours) => (
                <button
                  key={hours}
                  type="button"
                  aria-pressed={state.validityHours === hours}
                  onClick={() => setField("validityHours", hours)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
                    state.validityHours === hours ? "border-brand bg-brand text-brand-contrast" : "border-border text-text hover:bg-surface-2",
                  )}
                >
                  {hours < 48 ? `${hours} saat` : `${hours / 24} gün`}
                </button>
              ))}
            </div>
          </SettingsCard>

          {/* 5. Triggers */}
          <SettingsCard title="Ne zaman görünür" description="Çark düğmesi ve pencere ziyaretçiyi rahatsız etmeyecek şekilde gösterilir.">
            <FieldRow>
              <Field
                label="Düğme kaç saniye sonra görünsün?"
                required
                name="teaserDelaySeconds"
                error={errorFor("teaserDelaySeconds")}
                help="Sayfa yüklenip hazır olduktan sonra. Düğme sayfanın alt köşesinde, WhatsApp düğmesinin karşı tarafında durur."
              >
                <NumberInput
                  value={state.teaserDelaySeconds}
                  onChange={(v) => setField("teaserDelaySeconds", v ?? 0)}
                  min={WHEEL_LIMITS.teaserDelaySeconds.min}
                  max={WHEEL_LIMITS.teaserDelaySeconds.max}
                  suffix="saniye"
                  nullable={false}
                />
              </Field>
              <Field
                label="Pencere en fazla kaç günde bir kendiliğinden açılsın?"
                required
                name="autoOpenCooldownDays"
                error={errorFor("autoOpenCooldownDays")}
                help="Aynı ziyaretçiye bu süre içinde pencere kendiliğinden bir kez açılır."
              >
                <NumberInput
                  value={state.autoOpenCooldownDays}
                  onChange={(v) => setField("autoOpenCooldownDays", v ?? WHEEL_LIMITS.autoOpenCooldownDays.min)}
                  min={WHEEL_LIMITS.autoOpenCooldownDays.min}
                  max={WHEEL_LIMITS.autoOpenCooldownDays.max}
                  suffix="gün"
                  nullable={false}
                  disabled={!autoOpen && !state.exitIntent}
                />
              </Field>
            </FieldRow>
            <div className="space-y-4 rounded-lg border border-border px-4 py-4">
              <Switch
                checked={autoOpen}
                onChange={(v) => setField("autoOpenSeconds", v ? savedAutoOpen : 0)}
                label="Bilgisayarda pencereyi kendiliğinden aç"
                description="Ziyaretçi sayfada bir süre kaldıktan sonra çark penceresi bir kez açılır."
              />
              {autoOpen ? (
                <Field label="Kaç saniye sonra?" required name="autoOpenSeconds" error={errorFor("autoOpenSeconds")} className="max-w-xs">
                  <NumberInput
                    value={state.autoOpenSeconds}
                    onChange={(v) => setField("autoOpenSeconds", Math.max(1, v ?? DEFAULT_AUTO_OPEN))}
                    min={1}
                    max={WHEEL_LIMITS.autoOpenSeconds.max}
                    suffix="saniye"
                    nullable={false}
                  />
                </Field>
              ) : null}
              <Switch
                checked={state.exitIntent}
                onChange={(v) => setField("exitIntent", v)}
                label="Sayfadan çıkarken aç (bilgisayarda)"
                description="Fare tarayıcının üst kısmına, sekmeyi kapatmaya doğru gidince pencere bir kez açılır."
              />
            </div>
            <Hint tone="info">Telefonlarda pencere hiçbir zaman kendiliğinden açılmaz (Google’ın araya giren pencere kuralı); yalnızca düğme görünür.</Hint>
          </SettingsCard>

          {/* 6. Texts */}
          <SettingsCard
            title="Metinler"
            description="Boş bıraktığınız metinler için sitenin varsayılan metni kullanılır; kutuda gri olarak görünen odur. Türkçe yazmadan İngilizce veya Arapça girilemez."
          >
            <div className="space-y-5">
              {TEXT_FIELDS.map((field) => (
                <WheelTextInput
                  key={field.key}
                  label={field.label}
                  name={`texts.${field.key}`}
                  value={state.texts[field.key]}
                  onChange={(v) => setField(`texts.${field.key}`, v)}
                  defaults={textDefaults(field.key)}
                  maxLength={WHEEL_LIMITS.text[field.key]}
                  error={localizedError(`texts.${field.key}`)}
                  help={field.help}
                />
              ))}
            </div>
            <Hint>Çark penceresindeki diğer küçük metinler (hata mesajları, geri sayım, kampanya koşulları cümlesi) Arayüz Metinleri sayfasında “Hediye çarkı” başlığı altındadır.</Hint>
          </SettingsCard>

          {/* 7. Reminder e-mail */}
          <SettingsCard
            title="Hatırlatma e-postası"
            description="Hediye kodu kullanılmadıysa, süresi dolmadan yaklaşık 24 saat önce bir hatırlatma gönderilir."
            aside={
              <Switch checked={state.reminderEnabled} onChange={(v) => setField("reminderEnabled", v)} label={<span className="sr-only">Hatırlatma e-postası</span>} />
            }
          >
            <Hint>
              Yalnızca e-bülten aboneliğini onaylamış üyelere gider (ticari ileti izni). Hediye kodunun kendisi, kazanıldığında her zaman e-postayla
              gönderilir. Metinler E-postalar sayfasında düzenlenir. Hukuki uygunluğu avukatınıza onaylatın.
            </Hint>
            {state.reminderEnabled && state.validityHours < 37 ? (
              <Hint tone="warning">
                Hatırlatma günde bir kez (sabah) gönderilir. Kod {formatHours(state.validityHours)} geçerli olduğunda, akşam ve gece alınan kodların
                çoğu hatırlatma almadan sona erer. Herkesin hatırlatma alması için kodun geçerlilik süresini en az 48 saat yapın.
              </Hint>
            ) : null}
          </SettingsCard>

          <NewRoundCard
            round={saved.round}
            updatedAt={saved.updatedAt}
            dirty={dirty}
            onStarted={(result) => reset({ ...saved, round: result.round, updatedAt: result.updatedAt })}
          />
        </div>

        {/* Sticky preview, kept above the save bar; scrolls inside when it is taller than the window. */}
        <aside
          className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:overscroll-contain lg:rounded-xl"
          aria-label="Önizleme"
        >
          <WheelPreview slices={state.slices} texts={state.texts} copy={copy} />
        </aside>
      </div>
    </SettingsForm>
  );
}

/** The automatic prize name of a slice in `locale` (what the storefront shows without an en/ar label). */
function generatedSliceName(slice: Slice, locale: Locale, names: WheelPreviewCopy["prize"]): string {
  if (slice.type === "free_shipping") return names.freeShipping;
  if (slice.type === "fixed") return format(names.fixed, { amount: formatPrice(slice.value, locale) }, locale);
  return format(names.percent, { value: slice.value }, locale);
}

const LOCALE_NAMES: Record<Locale, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" };

function SliceFields({
  slice,
  index,
  share,
  locked,
  prizeChanged,
  tinyIn,
  errorFor,
  localizedError,
  onField,
  onPrize,
}: {
  slice: Slice;
  index: number;
  share: number;
  locked: boolean;
  /** Saved with another prize: the key changes at save time. */
  prizeChanged: boolean;
  /** Languages in which the wheel draws this label too small on a phone. */
  tinyIn: Locale[];
  errorFor: (path: string) => string | undefined;
  localizedError: PanelForm<State>["localizedError"];
  onField: (field: keyof Slice, value: unknown) => void;
  onPrize: (patch: { type?: WheelPrizeType; value?: number }) => void;
}) {
  const path = (field: string) => `slices.${index}.${field}`;
  const warnings = sliceWarnings(slice);
  const missing = missingLabelLocales(slice.label);
  const per100 = Math.round(share);
  const often = share > 0 && per100 < 1 ? "1 kezden az" : `yaklaşık ${per100} kez`;
  return (
    <div className="space-y-5">
      <FieldRow>
        <Field label="Ödül türü" required name={path("type")} error={errorFor(path("type"))}>
          <Select value={slice.type} onChange={(v) => onPrize({ type: v })} options={PRIZE_TYPE_OPTIONS} />
        </Field>
        {slice.type === "percent" ? (
          <Field
            label="İndirim oranı"
            required
            name={path("value")}
            error={errorFor(path("value"))}
            help={`Sepetteki ürünlere uygulanır. ${WHEEL_LIMITS.percent.min}–${WHEEL_LIMITS.percent.max} arası.`}
          >
            <PercentInput
              value={slice.value}
              onChange={(v) => onPrize({ value: v ?? WHEEL_LIMITS.percent.min })}
              min={WHEEL_LIMITS.percent.min}
              max={WHEEL_LIMITS.percent.max}
              nullable={false}
            />
          </Field>
        ) : slice.type === "fixed" ? (
          <Field label="İndirim tutarı" required name={path("value")} error={errorFor(path("value"))} help="KDV dahil, sepet toplamından düşülür. En az 1 TL.">
            <MoneyInput value={slice.value} onChange={(v) => onPrize({ value: v ?? WHEEL_LIMITS.fixedMin })} min={WHEEL_LIMITS.fixedMin} nullable={false} />
          </Field>
        ) : (
          <div className="min-w-0 space-y-1.5" data-field={path("value")}>
            <p className="text-sm font-medium text-text">Ödül</p>
            <p className="rounded-lg border border-border bg-surface-2/50 px-3 py-2.5 text-sm text-text-muted">
              Kargo ücreti alınmaz. Ağır paket farkı varsa yine uygulanır.
            </p>
          </div>
        )}
      </FieldRow>

      <LocalizedInput
        label="Çarkta görünen metin"
        required
        name={path("label")}
        value={slice.label}
        onChange={(v) => onField("label", v)}
        error={localizedError(path("label"))}
        maxLength={SLICE_LIMITS.labelMax}
        help="Ödül türünü ya da değeri değiştirince üç dilde kendiliğinden yazılır; elle değiştirdiğiniz metin korunur. Kısa tutun: çarkta okunabilsin."
      />
      {tinyIn.length > 0 ? (
        <Hint tone="warning">
          Bu metin telefonda çarkta çok küçük görünür ({tinyIn.map((l) => LOCALE_NAMES[l]).join(", ")}); kısaltın. Çarkta 2-3 kısa kelime en iyi okunur.
        </Hint>
      ) : null}
      {missing.length > 0 ? (
        <Hint>
          {missing.map((l) => (l === "en" ? "İngilizce" : "Arapça")).join(" ve ")} metin yok: bu dilde ödülün otomatik adı gösterilir (ör. “10% off”), Türkçe metin değil.
        </Hint>
      ) : null}

      <FieldRow>
        <Field
          label="En düşük sepet tutarı"
          name={path("minOrderTotal")}
          error={errorFor(path("minOrderTotal"))}
          help={slice.minOrderTotal > 0 ? `Kod ${formatPrice(slice.minOrderTotal, "tr")} ve üzeri sepette geçerli olur.` : "0 = alt sınır yok."}
        >
          <MoneyInput value={slice.minOrderTotal} onChange={(v) => onField("minOrderTotal", v ?? 0)} />
        </Field>
        <Field
          label="Şans ağırlığı"
          required
          name={path("weight")}
          error={errorFor(path("weight"))}
          labelAside={<span className="font-medium tabular-nums text-text">{formatShare(share)} olasılık</span>}
          help={`100 çevirmede ${often} bu dilim çıkar. ${WHEEL_LIMITS.weight.min}–${WHEEL_LIMITS.weight.max} arası bir sayı.`}
        >
          <NumberInput
            value={slice.weight}
            onChange={(v) => onField("weight", v ?? WHEEL_LIMITS.weight.min)}
            min={WHEEL_LIMITS.weight.min}
            max={WHEEL_LIMITS.weight.max}
            nullable={false}
          />
        </Field>
      </FieldRow>

      <TonePicker value={slice.tone} onChange={(v) => onField("tone", v)} name={path("tone")} error={errorFor(path("tone"))} />

      {warnings.map((w) => (
        <Hint key={w} tone="warning">
          {w}
        </Hint>
      ))}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-xs text-text-muted" data-field={path("key")}>
        {locked ? <Lock aria-hidden className="size-3.5" /> : null}
        <span>
          Kısa kod: <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.6875rem] text-text">{slice.key || "—"}</code>
        </span>
        <span>
          {locked && prizeChanged
            ? "Ödül değişti: kaydedince bu dilim yeni bir kısa kod alır. Önceki ödülün sonuçları Genel bakış'ta “Artık çarkta yok” altında kalır."
            : locked
              ? "İstatistikler ve kazanılmış hediyeler bu koda bağlıdır. Ödülü (tür, değer, en düşük sepet) değiştirirseniz kaydederken yeni bir kod alır; metin, renk ve şans ağırlığı değişince kod aynı kalır."
              : "Metinden kendiliğinden oluşur; kaydettikten sonra sabitlenir."}
        </span>
        {errorFor(path("key")) ? (
          <span className={cn(errorClass, "flex basis-full items-start gap-1.5")}>
            <CircleExclamationPoint aria-hidden className="mt-px size-3.5 shrink-0" />
            {errorFor(path("key"))}
          </span>
        ) : null}
      </div>
    </div>
  );
}
