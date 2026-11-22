"use client";
// Create / edit a category: localized name and description, slug (a change redirects the old address),
// editorial text and FAQ shown on the category page (day 5), image, accent color, visibility and SEO
// with a search preview.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Trash2 } from "lucide-react";
import { saveCategoryAction } from "@/app/panel/(dashboard)/kategoriler/actions";
import ColorInput from "@/components/panel/form/ColorInput";
import Field from "@/components/panel/form/Field";
import { LocalizedInput, LocalizedTextarea } from "@/components/panel/form/LocalizedInput";
import LocalizedRichText from "@/components/panel/form/LocalizedRichText";
import MediaPicker from "@/components/panel/form/MediaPicker";
import Repeater from "@/components/panel/form/Repeater";
import SaveBar from "@/components/panel/form/SaveBar";
import SlugInput from "@/components/panel/form/SlugInput";
import Switch from "@/components/panel/form/Switch";
import usePanelForm from "@/components/panel/form/usePanelForm";
import SeoPreview from "@/components/panel/products/SeoPreview";
import { Section, Warning } from "@/components/panel/products/editor/shared";
import Button from "@/components/panel/ui/Button";
import { buttonClass } from "@/components/panel/ui/styles";
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import type { MediaLike } from "@/lib/media/types";
import { wordCount } from "@/lib/panel/blog/reading";
import { CATEGORY_LIMITS, categorySaveSchema, type CategoryEditorState, type CategoryFaqState } from "@/lib/panel/categories/schema";
import { SEO_LIMITS } from "@/lib/panel/seo/rules";
import DeleteCategoryDialog from "./DeleteCategoryDialog";

type Props = {
  initial: CategoryEditorState;
  media: MediaLike[];
  productCount: number;
  others: { id: number; name: string }[];
  titleTemplate: string;
  siteUrl: string;
};

export default function CategoryEditor({ initial, media, productCount, others, titleTemplate, siteUrl }: Props) {
  const router = useRouter();
  const form = usePanelForm(initial);
  const { formRef } = form;
  const { state, setField, errorFor, localizedError } = form;
  const [deleting, setDeleting] = useState(false);
  const isNew = form.saved.id === null;
  const image = media.find((m) => m.id === state.imageId);
  const og = media.find((m) => m.id === state.seo.ogImageId);
  const bodyWords = wordCount(state.body?.tr);
  const minWords = SEO_LIMITS.words.category;

  const save = () =>
    form.submit(saveCategoryAction, {
      validate: categorySaveSchema,
      resetTo: (sent, data) => data?.state ?? sent,
      onSuccess: (data) => {
        if (data?.created) router.replace(`/panel/kategoriler/${data.id}`);
      },
    });

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} noValidate className="space-y-6 pb-28">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Kategori</p>
          <h1 className="mt-2 truncate font-heading text-3xl font-medium text-text sm:text-4xl">{isNew ? "Yeni kategori" : form.saved.name.tr}</h1>
        </div>
        {!isNew ? (
          <div className="flex flex-wrap gap-2">
            {form.saved.isVisible ? (
              <a href={href("tr", "category", { slug: form.saved.slug })} target="_blank" rel="noopener" className={buttonClass("secondary")}>
                Mağazada gör
                <ExternalLink aria-hidden className="size-4" />
              </a>
            ) : null}
            <Button variant="danger-outline" icon={Trash2} onClick={() => setDeleting(true)}>
              Sil
            </Button>
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Section title="Ad ve açıklama" description="Türkçe zorunlu; boş kalan diller Türkçesini gösterir.">
            <LocalizedInput label="Kategori adı" required value={state.name} onChange={(v) => setField("name", v)} error={localizedError("name")} name="name" maxLength={80} />
            <LocalizedTextarea
              label="Açıklama"
              value={state.description}
              onChange={(v) => setField("description", v)}
              error={localizedError("description")}
              name="description"
              maxLength={600}
              rows={3}
              help="Kategori sayfasının başında görünür."
            />
            <Field label="Kısa ad" required error={errorFor("slug")} name="slug" help="Kategori sayfasının adresi. Değiştirirseniz eski adres yeni adrese yönlendirilir.">
              <SlugInput value={state.slug} onChange={(v) => setField("slug", v)} source={state.name.tr} prefix="/kategori/" original={form.saved.slug || null} />
            </Field>
          </Section>
          <Section
            title="Kategori metni"
            description={`Ürünlerin altında okunan tanıtım yazısı: nasıl seçilir, hangi boy nerede kullanılır, kokular. Arama motorları için en az ${minWords} kelime önerilir.`}
          >
            <LocalizedRichText
              label="Metin"
              name="body"
              value={state.body}
              onChange={(v) => setField("body", v)}
              error={localizedError("body")}
              minHeight={16}
              placeholder="Kategoriyi tanıtan yazıya başlayın…"
              help="Ara başlık (H2, H3), liste ve bağlantı ekleyebilirsiniz. Ürünlere, kurumsal ve numune sayfalarına verilen site içi bağlantılar ziyaretçinin diline göre açılır."
            />
            <p className="text-xs text-text-muted">
              Türkçe metin: <span className="tabular-nums text-text">{bodyWords.toLocaleString("tr-TR")}</span> kelime
            </p>
            {bodyWords > 0 && bodyWords < minWords ? (
              <Warning>
                Metin kısa. {minWords} kelimeye yaklaştıkça sayfa hem müşterilere daha faydalı olur hem de arama motorları kategoriyi daha iyi anlar.
              </Warning>
            ) : null}
          </Section>
          <Section
            title="Sıkça sorulan sorular"
            description="Kategori sayfasının sonunda açılır–kapanır liste olarak görünür; arama motorları soruları ve cevapları da okur."
          >
            <Repeater<CategoryFaqState>
              items={state.faq}
              onChange={(items) => setField("faq", items)}
              createItem={() => ({ question: { tr: "" }, answer: { tr: "" } })}
              noun="Soru"
              addLabel="Soru ekle"
              ariaLabel="Sıkça sorulan sorular"
              max={CATEGORY_LIMITS.faqItems}
              itemSummary={(item) => item.question.tr || null}
              itemHasError={(i) => form.hasErrors(`faq.${i}`)}
              emptyText="Henüz soru yok. Müşterilerin gerçekten sorduğu 4–6 soru (ör. hangi boyu seçmeliyim, bidon nasıl doldurulur) sayfayı daha faydalı yapar."
              renderItem={(item, { index }) => (
                <>
                  <LocalizedInput
                    label="Soru"
                    required
                    name={`faq.${index}.question`}
                    value={item.question}
                    onChange={(v) => setField(`faq.${index}.question`, v)}
                    error={localizedError(`faq.${index}.question`)}
                    maxLength={CATEGORY_LIMITS.question}
                  />
                  <LocalizedTextarea
                    label="Cevap"
                    required
                    name={`faq.${index}.answer`}
                    value={item.answer}
                    onChange={(v) => setField(`faq.${index}.answer`, v)}
                    error={localizedError(`faq.${index}.answer`)}
                    maxLength={CATEGORY_LIMITS.answer}
                    rows={4}
                    help="Paragrafları boş bir satırla ayırın. Bir dilde soruyu yazdıysanız cevabını da o dilde yazın."
                  />
                </>
              )}
            />
          </Section>
          <Section title="Arama motorları" description="Boş bırakılırsa kategori adı ve açıklaması kullanılır.">
            <LocalizedInput label="SEO başlığı" value={state.seo.title} onChange={(v) => setField("seo.title", v)} error={localizedError("seo.title")} name="seo.title" maxLength={70} />
            <LocalizedTextarea label="SEO açıklaması" value={state.seo.description} onChange={(v) => setField("seo.description", v)} error={localizedError("seo.description")} name="seo.description" maxLength={170} rows={3} />
            <Field label="Paylaşım görseli" optional error={errorFor("seo.ogImageId")} name="seo.ogImageId" help="Boş: kategori görseli.">
              <MediaPicker value={state.seo.ogImageId} onChange={(id) => setField("seo.ogImageId", id)} items={og ? [og] : undefined} folder="kategoriler" aspect="1200/630" />
            </Field>
            <Switch checked={state.seo.noIndex} onChange={(v) => setField("seo.noIndex", v)} label="Arama motorlarında gösterme" />
            <SeoPreview
              build={(locale) => ({
                title: titleTemplate.replace("%s", localize(state.seo.title, locale) || localize(state.name, locale)),
                description: localize(state.seo.description, locale) || localize(state.description, locale),
                url: `${siteUrl}${href(locale, "category", { slug: state.slug || "kategori" })}`,
                noIndex: state.seo.noIndex,
              })}
            />
          </Section>
        </div>
        <div className="min-w-0 space-y-6">
          <Section title="Görünürlük">
            <Switch
              checked={state.isVisible}
              onChange={(v) => setField("isVisible", v)}
              label="Mağazada göster"
              description="Gizli kategorilerin sayfası açılmaz ve menülerde listelenmez; ürünleri yine satılır."
            />
            {!isNew ? (
              <p className="text-xs text-text-muted">
                Bu kategoride {productCount} ürün var.
              </p>
            ) : null}
          </Section>
          <Section title="Görsel ve renk">
            <Field label="Kategori görseli" optional error={errorFor("imageId")} name="imageId" help="Kategori kartlarında ve sayfa başında kullanılır.">
              <MediaPicker value={state.imageId} onChange={(id) => setField("imageId", id)} items={image ? [image] : undefined} folder="kategoriler" />
            </Field>
            <Field label="Vurgu rengi" optional error={errorFor("accentColor")} name="accentColor" help="Kategori kartındaki ince vurgu.">
              <ColorInput value={state.accentColor} onChange={(v) => setField("accentColor", v)} allowEmpty usage="fill" />
            </Field>
          </Section>
        </div>
      </div>

      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        errorCount={Object.keys(form.errors).length}
        onReset={() => form.reset()}
        onSave={() => void save()}
        saveLabel={isNew ? "Oluştur" : "Kaydet"}
      />
      {!isNew && deleting ? (
        <DeleteCategoryDialog
          category={{ id: form.saved.id!, name: form.saved.name.tr, productCount, updatedAt: form.saved.updatedAt ?? "" }}
          others={others}
          open
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            router.push("/panel/kategoriler");
          }}
        />
      ) : null}
    </form>
  );
}
