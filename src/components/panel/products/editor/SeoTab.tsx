"use client";
import Field from "@/components/panel/form/Field";
import { LocalizedInput, LocalizedTextarea } from "@/components/panel/form/LocalizedInput";
import MediaPicker from "@/components/panel/form/MediaPicker";
import SlugInput from "@/components/panel/form/SlugInput";
import Switch from "@/components/panel/form/Switch";
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import SeoPreview from "../SeoPreview";
import { Section, Warning, type TabProps } from "./shared";

export default function SeoTab({ form, ctx, media }: TabProps) {
  const { state, setField, errorFor, localizedError } = form;
  const og = media.get(state.seo.ogImageId);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <Section title="Adres" description="Ürün sayfasının bağlantısı. Değiştirirseniz eski adres yeni adrese kalıcı olarak yönlendirilir.">
          <Field label="Kısa ad" required error={errorFor("slug")} name="slug" help="Küçük harf, rakam ve tire. İngilizce ve Arapça sayfalarda da aynı kısa ad kullanılır.">
            <SlugInput value={state.slug} onChange={(v) => setField("slug", v)} source={state.name.tr} prefix="/urunler/" original={form.saved.slug} />
          </Field>
          {ctx.sampleSlug && state.slug !== form.saved.slug ? (
            <Warning>Numune ürünü “{ctx.sampleSlug}” bu ürünün kısa adıyla eşleşir. Kısa adı değiştirirseniz numunenin kısa adını da “{state.slug}-numune” yapın.</Warning>
          ) : null}
        </Section>
        <Section title="Arama motorları" description="Boş bırakılırsa ürün adı, alt başlık ve kısa açıklama kullanılır.">
          <LocalizedInput label="SEO başlığı" value={state.seo.title} onChange={(v) => setField("seo.title", v)} error={localizedError("seo.title")} name="seo.title" maxLength={70} />
          <LocalizedTextarea label="SEO açıklaması" value={state.seo.description} onChange={(v) => setField("seo.description", v)} error={localizedError("seo.description")} name="seo.description" maxLength={170} rows={3} />
          <Field label="Paylaşım görseli" optional error={errorFor("seo.ogImageId")} name="seo.ogImageId" help="Sosyal medyada paylaşılınca görünür. Boş: ilk ürün görseli.">
            <MediaPicker value={state.seo.ogImageId} onChange={(id, item) => {
              if (item) media.add([item]);
              setField("seo.ogImageId", id);
            }} items={og ? [og] : undefined} folder="urunler" aspect="1200/630" />
          </Field>
          <Switch
            checked={state.seo.noIndex}
            onChange={(v) => setField("seo.noIndex", v)}
            label="Arama motorlarında gösterme"
            description="Sayfa açık kalır ama Google’a “dizine ekleme” denir."
          />
        </Section>
      </div>
      <div className="min-w-0">
        <Section title="Önizleme">
          <SeoPreview
            build={(locale) => {
              const name = localize(state.name, locale);
              const subtitle = localize(state.subtitle, locale);
              const title = localize(state.seo.title, locale) || (subtitle ? `${name} — ${subtitle}` : name);
              return {
                title: ctx.titleTemplate.replace("%s", title),
                description: localize(state.seo.description, locale) || localize(state.shortDescription, locale),
                url: `${ctx.siteUrl}${href(locale, "product", { slug: state.slug || "urun" })}`,
                noIndex: state.seo.noIndex,
              };
            }}
          />
        </Section>
      </div>
    </div>
  );
}
