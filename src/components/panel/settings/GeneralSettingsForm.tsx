"use client";
import { saveGeneralSettingsAction } from "@/app/panel/(dashboard)/ayarlar/actions";
import Field from "@/components/panel/form/Field";
import { LocalizedInput } from "@/components/panel/form/LocalizedInput";
import MediaPicker from "@/components/panel/form/MediaPicker";
import Select from "@/components/panel/form/Select";
import TextInput from "@/components/panel/form/TextInput";
import usePanelForm from "@/components/panel/form/usePanelForm";
import type { MediaLike } from "@/lib/media/types";
import { TR_PROVINCE_NAMES } from "@/lib/validation/tr";
import type { SettingsState } from "./settings-pages";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"general">;

const SOCIAL: { key: keyof State["social"]; label: string; placeholder: string }[] = [
  { key: "instagram", label: "Instagram", placeholder: "prestij veya https://instagram.com/prestij" },
  { key: "facebook", label: "Facebook", placeholder: "prestij veya https://facebook.com/prestij" },
  { key: "youtube", label: "YouTube", placeholder: "prestij veya https://youtube.com/@prestij" },
  { key: "tiktok", label: "TikTok", placeholder: "prestij veya https://tiktok.com/@prestij" },
  { key: "linkedin", label: "LinkedIn", placeholder: "şirket-adı veya https://linkedin.com/company/…" },
];

export default function GeneralSettingsForm({ initial, media }: { initial: State; media: MediaLike[] }) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor, localizedError } = form;
  const cities = TR_PROVINCE_NAMES.map((name) => ({ value: name, label: name }));
  if (state.address.city && !cities.some((c) => c.value === state.address.city)) {
    cities.unshift({ value: state.address.city, label: state.address.city });
  }
  const sellerFilled = [state.mersisNo, state.taxOffice, state.taxNumber, state.kep].filter((v) => v.trim()).length;

  return (
    <SettingsForm form={form} action={saveGeneralSettingsAction}>
      <SettingsCard title="Mağaza kimliği" description="Sitenin adı, kısa tanımı ve logoları.">
        <FieldRow>
          <Field
            label="Site adı"
            required
            name="siteName"
            error={errorFor("siteName")}
            help="Tarayıcı sekmesinde, arama sonuçlarında ve logo yüklenmemişse logo yerine görünür."
          >
            <TextInput value={state.siteName} onChange={(v) => setField("siteName", v)} maxLength={60} />
          </Field>
        </FieldRow>
        <LocalizedInput
          label="Kısa tanım"
          name="tagline"
          value={state.tagline}
          onChange={(v) => setField("tagline", v)}
          error={localizedError("tagline")}
          maxLength={160}
          placeholder="Bakım koleksiyonu"
          help="Alt bilgide logonun altında görünür. Boş bırakılırsa gösterilmez."
        />
        <FieldRow>
          <Field
            label="Logo (açık zemin)"
            name="logo.lightId"
            error={errorFor("logo.lightId")}
            help="Üst menüde görünür. Şeffaf PNG önerilir; seçilmezse site adı yazıyla gösterilir."
          >
            <MediaPicker
              value={state.logo.lightId}
              onChange={(id) => setField("logo.lightId", id)}
              items={media}
              folder="logo"
              aspect="3/1"
              dialogTitle="Açık zemin logosu"
            />
          </Field>
          <Field
            label="Logo (koyu zemin)"
            name="logo.darkId"
            error={errorFor("logo.darkId")}
            help="Lacivert alt bilgide ve karanlık modda görünür; seçilmezse orada site adı yazıyla gösterilir."
          >
            <MediaPicker
              value={state.logo.darkId}
              onChange={(id) => setField("logo.darkId", id)}
              items={media}
              folder="logo"
              aspect="3/1"
              dialogTitle="Koyu zemin logosu"
            />
          </Field>
        </FieldRow>
      </SettingsCard>

      <SettingsCard
        title="Satıcı bilgileri"
        description="Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi'nde satıcı bilgisi olarak, siparişe özel kısmın başında otomatik yer alır. Unvan, MERSİS numarası, KEP adresi, meslek odası ve marka ayrıca sitenin alt bilgisindeki “İletişim” bölümünde ve İletişim sayfasında görünür; boş bırakılanlar gösterilmez."
      >
        <Field
          label="Ticari unvan"
          required
          name="legalName"
          error={errorFor("legalName")}
          help="Yasal metinlerde satıcı adı olarak, alt bilgideki “İletişim” bölümünde ve telif satırında görünür."
        >
          <TextInput value={state.legalName} onChange={(v) => setField("legalName", v)} maxLength={200} />
        </Field>
        <FieldRow>
          <Field label="MERSİS numarası" optional name="mersisNo" error={errorFor("mersisNo")}>
            <TextInput
              value={state.mersisNo}
              onChange={(v) => setField("mersisNo", v.replace(/\D/g, ""))}
              inputMode="numeric"
              maxLength={16}
              placeholder="16 hane"
            />
          </Field>
          <Field label="KEP adresi" optional name="kep" error={errorFor("kep")}>
            <TextInput value={state.kep} onChange={(v) => setField("kep", v)} type="email" placeholder="firma@hs01.kep.tr" autoComplete="off" />
          </Field>
          <Field label="Vergi dairesi" optional name="taxOffice" error={errorFor("taxOffice")}>
            <TextInput value={state.taxOffice} onChange={(v) => setField("taxOffice", v)} maxLength={80} placeholder="Erciyes" />
          </Field>
          <Field label="Vergi numarası" optional name="taxNumber" error={errorFor("taxNumber")}>
            <TextInput
              value={state.taxNumber}
              onChange={(v) => setField("taxNumber", v.replace(/\D/g, ""))}
              inputMode="numeric"
              maxLength={10}
              placeholder="10 hane"
            />
          </Field>
        </FieldRow>
        <LocalizedInput
          label="Kayıtlı olduğu meslek odası"
          name="chamber.name"
          value={state.chamber.name}
          onChange={(v) => setField("chamber.name", v)}
          error={localizedError("chamber.name")}
          maxLength={160}
          placeholder="Kayseri Ticaret Odası"
          help="Firmanızın kayıtlı olduğu oda (ör. Kayseri Ticaret Odası veya Kayseri Sanayi Odası). Alt bilgideki “İletişim” bölümünde görünür; boş bırakılırsa gösterilmez."
        />
        <FieldRow>
          <Field
            label="Meslek kuralları bağlantısı"
            optional
            name="chamber.rulesUrl"
            error={errorFor("chamber.rulesUrl")}
            help="Odanın meslek kurallarına ulaşılan https:// sayfası; oda adı bu bağlantıyı yeni sekmede açar. E-ticaret mevzuatı, satıcının kayıtlı olduğu odayı ve meslek kurallarına nasıl ulaşılacağını ana sayfada göstermesini ister; avukatınız veya mali müşavirinizle teyit edin."
          >
            <TextInput
              value={state.chamber.rulesUrl}
              onChange={(v) => setField("chamber.rulesUrl", v)}
              type="url"
              placeholder="https://…"
              dir="ltr"
              autoComplete="off"
            />
          </Field>
          <Field
            label="Tescilli marka"
            optional
            name="trademark"
            error={errorFor("trademark")}
            help="TÜRKPATENT'te tescilli bir markanız varsa yazın (ör. PRESTİJ). Alt bilgideki “İletişim” bölümünde görünür; boş bırakılırsa gösterilmez."
          >
            <TextInput value={state.trademark} onChange={(v) => setField("trademark", v)} maxLength={120} placeholder="PRESTİJ" />
          </Field>
        </FieldRow>
        {sellerFilled < 4 ? (
          <Hint tone="warning">
            Boş bırakılan satıcı bilgileri yasal metinlerde yer almaz. E-ticaret mevzuatı MERSİS numarası, vergi bilgileri ve KEP
            adresinin paylaşılmasını ister; bilgiler netleşince doldurun.
          </Hint>
        ) : (
          <Hint tone="storefront">Satıcı bilgileri yasal metinlerde eksiksiz görünüyor.</Hint>
        )}
      </SettingsCard>

      <SettingsCard title="İletişim" description="Alt bilgide, sipariş sayfalarında, ödeme sayfasında ve yasal metinlerde görünür.">
        <FieldRow>
          <Field label="Telefon" required name="phone" error={errorFor("phone")}>
            <TextInput value={state.phone} onChange={(v) => setField("phone", v)} type="tel" inputMode="tel" placeholder="0352 353 30 70" dir="ltr" />
          </Field>
          <Field label="E-posta" optional name="email" error={errorFor("email")}>
            <TextInput value={state.email} onChange={(v) => setField("email", v)} type="email" placeholder="info@prestij.com.tr" dir="ltr" />
          </Field>
        </FieldRow>
        {!state.email.trim() ? (
          <Hint tone="warning">E-posta adresi boş: alt bilgide ve yasal metinlerde e-posta gösterilmiyor.</Hint>
        ) : null}
      </SettingsCard>

      <SettingsCard title="Adres" description="Alt bilgide ve yasal metinlerde satıcı adresi olarak görünür.">
        <Field label="Açık adres" required name="address.line" error={errorFor("address.line")}>
          <TextInput value={state.address.line} onChange={(v) => setField("address.line", v)} maxLength={200} />
        </Field>
        <FieldRow columns={3}>
          <Field label="İlçe" required name="address.district" error={errorFor("address.district")}>
            <TextInput value={state.address.district} onChange={(v) => setField("address.district", v)} maxLength={80} />
          </Field>
          <Field label="İl" required name="address.city" error={errorFor("address.city")}>
            <Select value={state.address.city || null} onChange={(v) => setField("address.city", v)} options={cities} placeholder="İl seçin" />
          </Field>
          <Field label="Ülke" required name="address.country" error={errorFor("address.country")}>
            <TextInput value={state.address.country} onChange={(v) => setField("address.country", v)} maxLength={80} />
          </Field>
        </FieldRow>
        <Field
          label="Harita bağlantısı"
          optional
          name="mapUrl"
          error={errorFor("mapUrl")}
          help="Alt bilgideki adres bu bağlantıyı yeni sekmede açar. Google Haritalar'da “Paylaş” ile aldığınız https:// bağlantısını yapıştırın."
        >
          <TextInput value={state.mapUrl ?? ""} onChange={(v) => setField("mapUrl", v)} type="url" placeholder="https://maps.app.goo.gl/…" dir="ltr" />
        </Field>
      </SettingsCard>

      <SettingsCard
        title="Sosyal medya"
        description="Doldurulan hesaplar alt bilgide simge olarak görünür. Tam adres ya da yalnızca kullanıcı adı yazabilirsiniz."
      >
        <FieldRow>
          {SOCIAL.map(({ key, label, placeholder }) => (
            <Field key={key} label={label} optional name={`social.${key}`} error={errorFor(`social.${key}`)}>
              <TextInput
                value={state.social[key] ?? ""}
                onChange={(v) => setField(`social.${key}`, v)}
                placeholder={placeholder}
                dir="ltr"
                autoComplete="off"
              />
            </Field>
          ))}
        </FieldRow>
      </SettingsCard>
    </SettingsForm>
  );
}
