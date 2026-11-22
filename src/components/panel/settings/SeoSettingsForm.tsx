"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { saveSeoSettingsAction } from "@/app/panel/(dashboard)/ayarlar/actions";
import Field from "@/components/panel/form/Field";
import { LocalizedInput, LocalizedTextarea } from "@/components/panel/form/LocalizedInput";
import MediaPicker from "@/components/panel/form/MediaPicker";
import { NumberInput } from "@/components/panel/form/NumberInput";
import Select from "@/components/panel/form/Select";
import TextInput from "@/components/panel/form/TextInput";
import usePanelForm from "@/components/panel/form/usePanelForm";
import CopyButton from "@/components/panel/orders/CopyButton";
import StatusBadge from "@/components/panel/StatusBadge";
import type { LocalizedText } from "@/db/schema/common";
import type { MediaLike } from "@/lib/media/types";
import { extractVerificationCode, type IndexNowKeyState, type SeoToolUrls } from "@/lib/panel/seo/launch";
import { TITLE_TOKEN } from "@/lib/panel/settings/schemas";
import { GOOGLE_PRODUCT_CATEGORIES, SEO_VERIFICATION_MAX_LENGTH } from "@/lib/settings/types";
import { cn } from "@/lib/utils";
import type { SettingsState } from "./settings-pages";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"seo">;
type PreviewLocale = "tr" | "en" | "ar";

const SAMPLE_PAGE: Record<PreviewLocale, string> = { tr: "Lavanta Latte", en: "Lavender Latte", ar: "لاتيه اللافندر" };
const LOCALE_TABS: { value: PreviewLocale; label: string }[] = [
  { value: "tr", label: "TR" },
  { value: "en", label: "EN" },
  { value: "ar", label: "AR" },
];

const pick = (text: LocalizedText, locale: PreviewLocale) => (locale === "tr" ? text.tr : text[locale] || text.tr) || "";
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Google-style result for the home page and for a product page that uses the title template. */
function SearchPreview({ state, siteUrl }: { state: State; siteUrl: string }) {
  const [locale, setLocale] = useState<PreviewLocale>("tr");
  const host = siteUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const homeTitle = pick(state.defaultTitle, locale);
  const description = pick(state.description, locale);
  const template = state.titleTemplate.includes(TITLE_TOKEN) ? state.titleTemplate : `${TITLE_TOKEN} | PRESTİJ`;
  const productTitle = template.replace(TITLE_TOKEN, SAMPLE_PAGE[locale]);
  const rtl = locale === "ar";
  const rows = [
    { title: homeTitle, url: `${host} › ${locale}`, note: "Ana sayfa" },
    { title: productTitle, url: `${host} › ${locale} › ${locale === "tr" ? "urunler" : "products"} › lavanta-latte`, note: "Şablonlu sayfa (örnek ürün)" },
  ];
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Önizleme dili" className="inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5">
        {LOCALE_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={locale === t.value}
            onClick={() => setLocale(t.value)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              locale === t.value ? "bg-surface text-text shadow-[0_1px_2px_rgb(3_38_95/0.08)]" : "text-text-muted hover:text-text",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.note} className="rounded-lg border border-border bg-white p-4 text-start dark:bg-[#202124]" dir={rtl ? "rtl" : "ltr"} lang={locale}>
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-[#70757a]" dir="ltr">
              {row.note}
            </p>
            <p className="mt-1.5 truncate text-xs text-[#4d5156] dark:text-[#bdc1c6]" dir="ltr">
              {row.url}
            </p>
            <p className="mt-0.5 truncate text-lg leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">{clip(row.title || "(başlık yok)", 65)}</p>
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[#4d5156] dark:text-[#bdc1c6]">
              {clip(description || "(açıklama yok)", 160)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function lengthNote(text: string, ideal: number, label: string): React.ReactNode {
  const n = text.trim().length;
  if (n === 0) return null;
  return n > ideal ? (
    <Hint tone="warning">
      Türkçe {label} {n} karakter; arama sonuçlarında yaklaşık {ideal} karakterden sonrası kesilir.
    </Hint>
  ) : null;
}

const codeClass = "rounded bg-surface-2 px-1 py-0.5 text-[0.6875rem]";

type Engine = "google" | "bing" | "yandex";

const ENGINES: { key: Engine; label: string; tag: string; help: React.ReactNode }[] = [
  {
    key: "google",
    label: "Google Search Console",
    tag: "google-site-verification",
    help: (
      <>
        Search Console › Mülk ekle › “URL öneki” › doğrulama yöntemi <b>HTML etiketi</b>. Etiketin tamamını ya da yalnızca
        <code className={cn(codeClass, "mx-1")}>content=&quot;…&quot;</code>içindeki kodu yapıştırın.
      </>
    ),
  },
  {
    key: "bing",
    label: "Bing Webmaster Tools",
    tag: "msvalidate.01",
    help: (
      <>
        Bing Webmaster Tools › Site ekle › <b>HTML Meta Etiketi</b>. Siteyi Search Console&apos;dan içe aktarırsanız bu kod
        gerekmez.
      </>
    ),
  },
  {
    key: "yandex",
    label: "Yandex Webmaster",
    tag: "yandex-verification",
    help: (
      <>
        Yandex Webmaster › Site ekle › doğrulama yöntemi <b>Meta etiketi</b>.
      </>
    ),
  },
];

const MERCHANT_PRESETS: { value: string; label: string; path: string }[] = [
  {
    value: GOOGLE_PRODUCT_CATEGORIES.liquidHandSoap,
    label: "Sıvı El Sabunu",
    path: "Sağlık ve Güzellik › Kişisel Bakım › Kozmetik › Banyo ve Vücut › Sıvı El Sabunu",
  },
  {
    value: GOOGLE_PRODUCT_CATEGORIES.bodyWash,
    label: "Vücut Şampuanı (duş jeli)",
    path: "Sağlık ve Güzellik › Kişisel Bakım › Kozmetik › Banyo ve Vücut › Vücut Şampuanları",
  },
  {
    value: GOOGLE_PRODUCT_CATEGORIES.bathAndBodyGiftSets,
    label: "Hediye setleri",
    path: "Sağlık ve Güzellik › Kişisel Bakım › Kozmetik › Banyo ve Vücut Bakımı Hediye Setleri",
  },
];

type ReturnFee = "unknown" | "free" | "customer";

const RETURN_FEE_OPTIONS: { value: ReturnFee; label: string }[] = [
  { value: "unknown", label: "Belirtilmedi" },
  { value: "free", label: "Mağaza öder (ücretsiz iade)" },
  { value: "customer", label: "Müşteri öder" },
];

const toReturnFee = (value: boolean | null): ReturnFee => (value === null ? "unknown" : value ? "free" : "customer");
const fromReturnFee = (value: ReturnFee): boolean | null => (value === "unknown" ? null : value === "free");

/** Turkish distance-sales rules: the withdrawal period is 14 days. */
const LEGAL_RETURN_DAYS = 14;

const INDEXNOW_STATE: Record<IndexNowKeyState, { tone: "success" | "warning" | "neutral"; label: string; note: string }> = {
  set: { tone: "success", label: "Anahtar tanımlı", note: "Değişen sayfalar her gün Bing ve Yandex'e bildirilir (yalnızca canlı sitede)." },
  invalid: {
    tone: "warning",
    label: "Anahtar geçersiz",
    note: "INDEXNOW_KEY 8–128 karakter olmalı ve yalnızca harf, rakam ve tire içermeli. Düzeltilene kadar dosya açılmaz.",
  },
  missing: {
    tone: "neutral",
    label: "Tanımlı değil",
    note: "Barındırma ayarlarına INDEXNOW_KEY eklenene kadar bu adres “bulunamadı” döner; site normal çalışır.",
  },
};

function ToolUrlRow({ label, url, note, aside }: { label: string; url: string; note?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
          {label}
          {aside}
        </p>
        <p className="mt-0.5 break-all text-xs text-text-muted" dir="ltr">
          {url}
        </p>
        {note ? <p className="mt-1 text-xs leading-relaxed text-text-muted">{note}</p> : null}
      </div>
      <CopyButton text={url} label="Kopyala" srLabel={`${label} adresini kopyala`} className="self-start sm:self-center" />
    </li>
  );
}

export default function SeoSettingsForm({
  initial,
  media,
  siteUrl,
  tools,
  indexNow,
  siteIsLocal,
}: {
  initial: State;
  media: MediaLike[];
  siteUrl: string;
  /** Public URLs of the sitemap, robots.txt, merchant feed and IndexNow key file. */
  tools: SeoToolUrls;
  /** Whether INDEXNOW_KEY is set (the value itself never reaches the panel). */
  indexNow: IndexNowKeyState;
  /** NEXT_PUBLIC_SITE_URL is a local address: the URLs are for testing until the live domain is set. */
  siteIsLocal: boolean;
}) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor, localizedError } = form;
  const preset = MERCHANT_PRESETS.find((p) => p.value === state.merchantCategory.trim());
  const indexNowInfo = INDEXNOW_STATE[indexNow];

  return (
    <SettingsForm form={form} action={saveSeoSettingsAction}>
      <SettingsCard
        title="Başlık ve açıklama"
        description="Kendi SEO başlığı veya açıklaması girilmemiş sayfalarda bu değerler kullanılır."
      >
        <FieldRow>
          <Field
            label="Başlık şablonu"
            required
            name="titleTemplate"
            error={errorFor("titleTemplate")}
            help={
              <>
                Sayfa başlıklarının biçimi. <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.6875rem]">{TITLE_TOKEN}</code> yerine
                sayfanın adı gelir, ör. “Lavanta Latte | PRESTİJ”.
              </>
            }
          >
            <TextInput value={state.titleTemplate} onChange={(v) => setField("titleTemplate", v)} maxLength={80} dir="ltr" />
          </Field>
        </FieldRow>
        <LocalizedInput
          label="Varsayılan başlık"
          required
          name="defaultTitle"
          value={state.defaultTitle}
          onChange={(v) => setField("defaultTitle", v)}
          error={localizedError("defaultTitle")}
          maxLength={120}
          help="Ana sayfanın tarayıcı sekmesindeki ve arama sonucundaki başlığı (ana sayfaya ayrı başlık girilmemişse)."
        />
        {lengthNote(state.defaultTitle.tr, 60, "başlık")}
        <LocalizedTextarea
          label="Varsayılan açıklama"
          required
          name="description"
          value={state.description}
          onChange={(v) => setField("description", v)}
          error={localizedError("description")}
          maxLength={320}
          rows={3}
          help="Arama sonucunda başlığın altında görünen özet. 150–160 karakter idealdir."
        />
        {lengthNote(state.description.tr, 160, "açıklama")}
      </SettingsCard>

      <SettingsCard
        title="Paylaşım görseli"
        description="Kendi görseli olmayan bir sayfa WhatsApp, Instagram, Facebook veya X'te paylaşıldığında bu görsel görünür."
      >
        <FieldRow>
          <Field label="Varsayılan görsel" name="ogImageId" error={errorFor("ogImageId")} help="1200 × 630 piksel (yatay) önerilir.">
            <MediaPicker
              value={state.ogImageId}
              onChange={(id) => setField("ogImageId", id)}
              items={media}
              folder="genel"
              aspect="1200/630"
              dialogTitle="Paylaşım görseli"
            />
          </Field>
        </FieldRow>
      </SettingsCard>

      <SettingsCard title="Arama sonucu önizlemesi" description="Google'da yaklaşık böyle görünür. Kaydetmeden önce kontrol edin.">
        <SearchPreview state={state} siteUrl={siteUrl} />
      </SettingsCard>

      <SettingsCard
        title="Arama motoru doğrulama"
        description="Sitenin size ait olduğunu Google, Bing ve Yandex'e kanıtlayan kodlar. Kod kaydedilince sitenin her sayfasına görünmez bir etiket olarak eklenir; ardından ilgili araçta Doğrula'ya basın."
      >
        {ENGINES.map((engine) => (
          <Field
            key={engine.key}
            label={engine.label}
            optional
            name={`verification.${engine.key}`}
            error={errorFor(`verification.${engine.key}`)}
            help={engine.help}
          >
            <TextInput
              value={state.verification[engine.key]}
              onChange={(v) => setField(`verification.${engine.key}`, v)}
              onBlur={(e) => {
                const code = extractVerificationCode(e.currentTarget.value);
                if (code !== state.verification[engine.key]) setField(`verification.${engine.key}`, code);
              }}
              placeholder={`<meta name="${engine.tag}" content="…"> veya yalnızca kod`}
              maxLength={SEO_VERIFICATION_MAX_LENGTH * 3}
              spellCheck={false}
              autoComplete="off"
              dir="ltr"
            />
          </Field>
        ))}
        <Hint tone="storefront">Boş bırakılan arama motoru için etiket eklenmez. Doğrulama bittikten sonra kodu silmeyin; araçlar zaman zaman yeniden kontrol eder.</Hint>
      </SettingsCard>

      <SettingsCard
        title="Arama motorları için adresler"
        description="Search Console, Bing, Yandex ve Merchant Center'a yapıştıracağınız adresler. Bu dosyalar site içeriğinden kendiliğinden oluşur."
        aside={
          <Link
            href="/panel/seo"
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-text-muted underline-offset-4 transition-colors hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            SEO Kontrol
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        }
      >
        {siteIsLocal ? (
          <Hint tone="warning">
            Site adresi şu an yerel bir adres ({siteUrl}). Canlı alan adı NEXT_PUBLIC_SITE_URL olarak tanımlanınca bu adresler de
            ona göre değişir; arama motorlarına canlı adresleri verin.
          </Hint>
        ) : null}
        <ul className="divide-y divide-border">
          <ToolUrlRow label="Site haritası" url={tools.sitemap} note="Search Console, Bing ve Yandex'teki “Site haritaları” bölümüne." />
          <ToolUrlRow label="robots.txt" url={tools.robots} note="Arama motorlarına hangi bölümlerin taranmayacağını söyler (panel, sepet, ödeme, hesap)." />
          <ToolUrlRow label="Google Merchant ürün akışı" url={tools.merchantFeed} note="Merchant Center'da ürün kaynağı olarak bu bağlantıyı ekleyin; günlük getirme seçin." />
          <ToolUrlRow
            label="IndexNow anahtar dosyası"
            url={tools.indexNowKey}
            aside={
              <StatusBadge tone={indexNowInfo.tone} className="font-normal">
                {indexNowInfo.label}
              </StatusBadge>
            }
            note={indexNowInfo.note}
          />
        </ul>
      </SettingsCard>

      <SettingsCard
        title="İade politikası"
        description="Google arama sonuçlarında ve Merchant Center'da ürünlerin yanında gösterilebilir. İade ve Değişim Koşulları metninizle aynı olmalı."
      >
        <FieldRow>
          <Field
            label="İade süresi"
            required
            name="returns.days"
            error={errorFor("returns.days")}
            help="Teslimattan sonra kaç gün içinde iade kabul edildiği. 0: iade kabul edilmiyor."
          >
            <NumberInput value={state.returns.days} onChange={(v) => setField("returns.days", v ?? 0)} min={0} max={365} suffix="gün" nullable={false} />
          </Field>
          <Field label="İade kargo ücreti" name="returns.freeReturns" error={errorFor("returns.freeReturns")} help="Ürünü geri gönderirken kargo ücretini kim öder?">
            <Select<ReturnFee>
              value={toReturnFee(state.returns.freeReturns)}
              onChange={(v) => setField("returns.freeReturns", fromReturnFee(v))}
              options={RETURN_FEE_OPTIONS}
            />
          </Field>
        </FieldRow>
        {state.returns.days < LEGAL_RETURN_DAYS ? (
          <Hint tone="warning">Mesafeli satışlarda yasal cayma süresi {LEGAL_RETURN_DAYS} gündür; daha kısa bir süre yazmadan önce iade koşullarınızı kontrol edin.</Hint>
        ) : null}
        {state.returns.freeReturns === null ? (
          <Hint>Belirtilmedi seçiliyken iade ücreti yapısal veride yer almaz. Kimin ödediğini seçmeniz önerilir.</Hint>
        ) : null}
        <Hint>
          Metnin kendisi <Link href="/panel/yasal" className="underline underline-offset-4 hover:text-text">Yasal Metinler › İade ve Değişim Koşulları</Link>{" "}
          bölümünden düzenlenir.
        </Hint>
      </SettingsCard>

      <SettingsCard
        title="Google ürün kategorisi"
        description="Merchant Center ürün akışında ürünlerinizin hangi kategoride listeleneceği. Ürünlerin çoğu sıvı el sabunu olduğu için 3208 önerilir."
      >
        <FieldRow>
          <Field
            label="Kategori numarası veya yolu"
            optional
            name="merchantCategory"
            error={errorFor("merchantCategory")}
            help="Google'ın ürün kategorisi numarası (ör. 3208) ya da tam yolu. Boş bırakılırsa kategoriyi Google seçer."
          >
            <TextInput value={state.merchantCategory} onChange={(v) => setField("merchantCategory", v)} maxLength={250} dir="ltr" spellCheck={false} />
          </Field>
        </FieldRow>
        <div role="group" aria-label="Hazır kategoriler" className="flex flex-wrap gap-2">
          {MERCHANT_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={state.merchantCategory.trim() === p.value}
              onClick={() => setField("merchantCategory", p.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                state.merchantCategory.trim() === p.value ? "border-gold/50 bg-gold/10 text-text" : "border-border bg-surface text-text-muted hover:text-text",
              )}
            >
              <span className="tabular-nums">{p.value}</span> · {p.label}
            </button>
          ))}
        </div>
        {preset ? <Hint tone="storefront">{preset.path}</Hint> : null}
      </SettingsCard>
    </SettingsForm>
  );
}
