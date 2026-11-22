"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, ExternalLink, FileText, Globe, Trash2, X } from "lucide-react";
import { deletePostAction, savePostAction } from "@/app/panel/(dashboard)/blog/actions";
import {
  Field,
  LocalizedInput,
  LocalizedRichText,
  LocalizedTextarea,
  MediaPicker,
  ProductPicker,
  SaveBar,
  SlugInput,
  Switch,
  TextInput,
  usePanelForm,
  type PanelForm,
} from "@/components/panel/form";
import Badge from "@/components/panel/ui/Badge";
import Button from "@/components/panel/ui/Button";
import ConfirmDialog from "@/components/panel/ui/ConfirmDialog";
import { toast } from "@/components/panel/ui/toast-store";
import { buttonClass, controlGroupClass, groupInputClass, iconButtonClass } from "@/components/panel/ui/styles";
import { toPayloadFormData } from "@/lib/panel/action-types";
import { postVisibility, readingMinutes, wordCount } from "@/lib/panel/blog/reading";
import { BLOG_LIMITS, blogPostInput } from "@/lib/panel/blog/schema";
import { formatIstanbul, istanbulDateTimeLocal, parseIstanbulDateTimeLocal } from "@/lib/panel/format";
import type { MediaLike } from "@/lib/media/types";
import { cn } from "@/lib/utils";
import { VISIBILITY_LABELS } from "./labels";
import type { BlogEditorState } from "./state";
import TagInput from "./TagInput";

export type { BlogEditorState };

type BlogEditorProps = {
  initial: BlogEditorState;
  /** Images already used by the post (cover, share image): shown without a request. */
  media?: MediaLike[];
  knownTags?: string[];
  /** Site title template from settings ("%s | PRESTİJ") for the search preview. */
  titleTemplate: string;
  /** Public origin, e.g. https://prestij.com.tr (search preview, "Sitede gör"). */
  siteOrigin: string;
};

const cardClass = "min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]";

function Section({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn(cardClass, className)}>
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}
      </header>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  );
}

/** The whole post in one form: content, publishing (draft / now / scheduled), cover, tags, related products, SEO. */
export default function BlogEditor({ initial, media, knownTags = [], titleTemplate, siteOrigin }: BlogEditorProps) {
  const router = useRouter();
  const form = usePanelForm<BlogEditorState>(initial);
  const { state, setField, errorFor, formRef } = form;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isNew = state.id === null;
  const saved = form.saved;
  const savedVisibility = isNew ? "draft" : postVisibility(saved);
  const savedLink = `/tr/blog/${saved.slug}`;
  const minutes = readingMinutes(state.body?.tr);
  const words = wordCount(state.body?.tr);

  const save = () =>
    form.submit(savePostAction, {
      validate: blogPostInput,
      resetTo: (sent, data) =>
        data
          ? { ...sent, id: data.id, slug: data.slug, updatedAt: data.updatedAt, status: data.status, publishedAt: data.publishedAt }
          : sent,
      onSuccess: (data) => {
        if (data?.created) {
          // The "new post" route stays mounted in the background (Activity): empty it so a second
          // visit starts a new post instead of editing this one.
          form.reset(initial);
          router.replace(`/panel/blog/${data.id}`);
        }
      },
    });

  const remove = async () => {
    if (state.id === null) return;
    setDeleting(true);
    try {
      const result = await deletePostAction(null, toPayloadFormData({ id: state.id, updatedAt: saved.updatedAt }));
      if (result.ok) {
        toast.success(result.message ?? "Yazı silindi.");
        setConfirmDelete(false);
        router.push("/panel/blog");
      } else {
        toast.error(result.error, { duration: result.code === "in_use" ? 0 : undefined });
        setConfirmDelete(false);
      }
    } catch {
      toast.error("Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setDeleting(false);
    }
  };

  const titleText = state.title.tr.trim();

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-6 pb-28" noValidate>
      <div className="space-y-3">
        <Link
          href="/panel/blog"
          className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Blog
        </Link>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">{isNew ? "Yeni yazı" : "Yazıyı düzenle"}</p>
            <h1 className="mt-2 line-clamp-2 break-words font-heading text-3xl font-medium leading-tight text-text sm:text-4xl">
              {(isNew ? titleText : saved.title.tr) || "Adsız yazı"}
            </h1>
            {!isNew ? (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                <Badge tone={VISIBILITY_LABELS[savedVisibility].tone}>{VISIBILITY_LABELS[savedVisibility].label}</Badge>
                {savedVisibility === "scheduled" && saved.publishedAt ? <span>{formatIstanbul(saved.publishedAt)} tarihinde yayına girecek</span> : null}
                {savedVisibility === "published" && saved.publishedAt ? <span>{formatIstanbul(saved.publishedAt)} tarihinden beri yayında</span> : null}
              </p>
            ) : null}
          </div>
          {!isNew ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {savedVisibility === "published" ? (
                <a href={savedLink} target="_blank" rel="noopener" className={buttonClass("secondary")}>
                  <ExternalLink aria-hidden className="size-4" />
                  Sitede gör
                  <span className="sr-only">(yeni sekmede açılır)</span>
                </a>
              ) : null}
              <Button variant="danger-outline" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                Sil
              </Button>
            </div>
          ) : null}
        </header>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Section title="İçerik" description="Başlık ve metin Türkçe zorunludur; İngilizce ve Arapça boş bırakılırsa ziyaretçi Türkçesini görür.">
            <LocalizedInput
              label="Başlık"
              required
              name="title"
              maxLength={BLOG_LIMITS.title}
              value={state.title}
              onChange={(v) => setField("title", v)}
              error={form.localizedError("title")}
            />
            <Field label="Kısa ad (adres)" required name="slug" error={errorFor("slug")} help="Yazının adresi. Türkçe başlıktan otomatik oluşur; elle değiştirebilirsiniz.">
              <SlugInput
                value={state.slug}
                onChange={(v) => setField("slug", v)}
                source={state.title.tr}
                prefix="/blog/"
                original={savedVisibility === "published" ? saved.slug : null}
              />
            </Field>
            <LocalizedTextarea
              label="Özet"
              name="excerpt"
              rows={3}
              maxLength={BLOG_LIMITS.excerpt}
              help="Blog listesinde ve arama sonuçlarında görünür. Bir iki cümle yeterli."
              value={state.excerpt}
              onChange={(v) => setField("excerpt", v)}
              error={form.localizedError("excerpt")}
            />
            <LocalizedRichText
              label="Metin"
              required
              name="body"
              minHeight={22}
              placeholder="Yazınıza başlayın…"
              help="Ara başlık (H2, H3), liste, alıntı ve bağlantı ekleyebilirsiniz. Site içi bağlantılar ziyaretçinin diline göre açılır."
              value={state.body}
              onChange={(v) => setField("body", v)}
              error={form.localizedError("body")}
            />
          </Section>

          <SeoSection form={form} titleTemplate={titleTemplate} siteOrigin={siteOrigin} media={media} />
        </div>

        <aside className="min-w-0 space-y-6 lg:sticky lg:top-6">
          <Section title="Yayın">
            <PublishControls
              status={state.status}
              publishedAt={state.publishedAt}
              onStatus={(v) => setField("status", v)}
              onDate={(v) => setField("publishedAt", v)}
              error={errorFor("publishedAt")}
            />
            <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-2/50 p-3 text-xs">
              <div>
                <dt className="text-text-muted">Okuma süresi</dt>
                <dd className="mt-0.5 font-medium text-text">{minutes ? `${minutes} dk` : "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Kelime (TR)</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-text">{words.toLocaleString("tr-TR")}</dd>
              </div>
              <p className="col-span-2 text-[0.6875rem] leading-relaxed text-text-muted">Okuma süresi Türkçe metinden hesaplanır ve kaydedilince güncellenir.</p>
            </dl>
          </Section>

          <Section title="Kapak görseli" description="Listede, yazının başında ve paylaşımlarda kullanılır. Yatay (3:2) görseller en iyi sonucu verir.">
            <Field label="Kapak" hideLabel name="coverId" error={errorFor("coverId")}>
              <MediaPicker value={state.coverId} onChange={(id) => setField("coverId", id)} items={media} folder="blog" aspect="3/2" dialogTitle="Kapak görseli seç" />
            </Field>
          </Section>

          <Section title="Yazar ve etiketler">
            <Field label="Yazar" optional name="authorName" error={errorFor("authorName")} help="Boş bırakılırsa yazı marka adına yayınlanır.">
              <TextInput value={state.authorName} onChange={(v) => setField("authorName", v)} maxLength={BLOG_LIMITS.author} autoComplete="off" />
            </Field>
            <Field label="Etiketler" optional name="tags" error={errorFor("tags")} help="Yazıları panelde bulmak ve gruplamak içindir; arama motorlarına anahtar kelime olarak bildirilir.">
              <TagInput value={state.tags} onChange={(v) => setField("tags", v)} suggestions={knownTags} max={BLOG_LIMITS.tags} maxLength={BLOG_LIMITS.tagLength} />
            </Field>
          </Section>

          <Section title="İlişkili ürünler" description="Yazının altında ürün kartları olarak gösterilir. Yayında olmayan ürünler sitede görünmez.">
            <Field label="Ürünler" hideLabel name="relatedProductIds" error={errorFor("relatedProductIds")}>
              <ProductPicker
                multiple
                max={BLOG_LIMITS.related}
                value={state.relatedProductIds}
                onChange={(ids) => setField("relatedProductIds", ids)}
                dialogTitle="İlişkili ürün ekle"
              />
            </Field>
          </Section>
        </aside>
      </div>

      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        errorCount={Object.keys(form.errors).length}
        onReset={isNew ? undefined : () => form.reset()}
        onSave={save}
        saveLabel={isNew ? (state.status === "published" ? "Oluştur ve yayınla" : "Taslağı oluştur") : "Kaydet"}
        allowCleanSave={isNew}
        savedNote={!isNew && saved.updatedAt ? `Son kayıt: ${formatIstanbul(saved.updatedAt)}` : undefined}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => (deleting ? undefined : setConfirmDelete(false))}
        onConfirm={remove}
        pending={deleting}
        title="Yazı silinsin mi?"
        description={`“${saved.title.tr || "Adsız yazı"}” kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
        confirmLabel="Yazıyı sil"
      >
        {savedVisibility === "published" ? (
          <p className="text-sm text-text-muted">Yazı şu anda yayında; adresi silindikten sonra “sayfa bulunamadı” gösterir. Yalnızca gizlemek istiyorsanız taslağa almanız yeterli.</p>
        ) : null}
      </ConfirmDialog>
    </form>
  );
}

function PublishControls({
  status,
  publishedAt,
  onStatus,
  onDate,
  error,
}: {
  status: "draft" | "published";
  publishedAt: string | null;
  onStatus: (v: "draft" | "published") => void;
  onDate: (v: string | null) => void;
  error?: string;
}) {
  const id = useId();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  // A minute of slack: "now" (stamped by the server on save) must not read as a schedule.
  const future = publishedAt ? new Date(publishedAt).getTime() - now > 60_000 : false;
  const options = [
    { value: "draft" as const, label: "Taslak", icon: FileText },
    { value: "published" as const, label: future ? "Planla" : "Yayınla", icon: future ? CalendarClock : Globe },
  ];
  const note =
    status === "draft"
      ? "Taslaklar sitede görünmez."
      : !publishedAt
        ? "Kaydettiğiniz an yayına girer."
        : future
          ? `${formatIstanbul(publishedAt)} tarihinde sitede kendiliğinden görünür.`
          : `Sitede ${formatIstanbul(publishedAt)} tarihiyle görünür.`;

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">Durum</legend>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface-2/60 p-1">
          {options.map((o) => {
            const Icon = o.icon;
            const checked = status === o.value;
            return (
              <label
                key={o.value}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                  checked ? "bg-surface font-medium text-text shadow-[0_1px_2px_rgb(3_38_95/0.12)]" : "text-text-muted hover:text-text",
                )}
              >
                <input type="radio" name={`${id}-status`} value={o.value} checked={checked} onChange={() => onStatus(o.value)} className="sr-only" />
                <Icon aria-hidden className={cn("size-4", checked && o.value === "published" && "text-gold-text")} />
                {o.label}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-text-muted" aria-live="polite">
          {note}
        </p>
      </fieldset>

      <div className="space-y-1.5" data-field="publishedAt">
        <label htmlFor={`${id}-date`} className="block text-sm font-medium text-text">
          Yayın tarihi <span className="font-normal text-text-muted">(isteğe bağlı)</span>
        </label>
        <div className={controlGroupClass}>
          <span aria-hidden className="flex items-center ps-3 text-text-muted">
            <CalendarClock className="size-4" />
          </span>
          <input
            id={`${id}-date`}
            type="datetime-local"
            value={istanbulDateTimeLocal(publishedAt)}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-date-help`}
            onChange={(event) => onDate(parseIstanbulDateTimeLocal(event.target.value)?.toISOString() ?? null)}
            className={cn(groupInputClass, "h-10 ps-2 tabular-nums [color-scheme:light] dark:[color-scheme:dark]")}
          />
          {publishedAt ? (
            <button type="button" onClick={() => onDate(null)} className={iconButtonClass("sm", "my-auto me-1 size-7")}>
              <X aria-hidden className="size-3.5" />
              <span className="sr-only">Yayın tarihini temizle</span>
            </button>
          ) : null}
        </div>
        {error ? <p className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{error}</p> : null}
        <p id={`${id}-date-help`} className="text-xs leading-relaxed text-text-muted">
          Türkiye saatiyle. İleri bir tarih seçip yayınlarsanız yazı o saatte kendiliğinden yayına girer; boş bırakırsanız yayınladığınız an kullanılır.
        </p>
      </div>
    </div>
  );
}

function SeoSection({
  form,
  titleTemplate,
  siteOrigin,
  media,
}: {
  form: PanelForm<BlogEditorState>;
  titleTemplate: string;
  siteOrigin: string;
  media?: MediaLike[];
}) {
  const { state, setField, errorFor } = form;
  const seoTitle = state.seo.title?.tr?.trim() || state.title.tr.trim() || "Yazı başlığı";
  const shownTitle = titleTemplate.includes("%s") ? titleTemplate.replace("%s", seoTitle) : seoTitle;
  const description = state.seo.description?.tr?.trim() || state.excerpt?.tr?.trim() || "";
  let host = siteOrigin;
  try {
    host = new URL(siteOrigin).host;
  } catch {}

  return (
    <Section title="Arama motorları ve paylaşım" description="Boş bırakılan alanlar için başlık, özet ve kapak görseli kullanılır.">
      <div className="rounded-lg border border-border bg-surface-2/40 p-4" aria-label="Google önizlemesi">
        <p className="truncate text-xs text-text-muted">
          {host} › tr › blog › {state.slug || "kisa-ad"}
        </p>
        <p className="mt-1 line-clamp-1 text-lg leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">{shownTitle}</p>
        <p className={cn("mt-1 line-clamp-2 text-sm", description ? "text-text-muted" : "italic text-text-muted/70")}>
          {description || "Açıklama yok: arama motoru metinden bir parça gösterir."}
        </p>
        <p className="mt-3 text-[0.6875rem] text-text-muted">
          Başlık {shownTitle.length} karakter (önerilen ≤ 60) · Açıklama {description.length} karakter (önerilen ≤ 160)
        </p>
      </div>
      <LocalizedInput
        label="SEO başlığı"
        name="seo.title"
        maxLength={BLOG_LIMITS.seoTitle}
        value={state.seo.title}
        onChange={(v) => setField("seo.title", v)}
        error={form.localizedError("seo.title")}
        help="Boş bırakılırsa yazı başlığı kullanılır."
      />
      <LocalizedTextarea
        label="SEO açıklaması"
        name="seo.description"
        rows={2}
        maxLength={BLOG_LIMITS.seoDescription}
        value={state.seo.description}
        onChange={(v) => setField("seo.description", v)}
        error={form.localizedError("seo.description")}
        help="Boş bırakılırsa özet kullanılır."
      />
      <Field label="Paylaşım görseli" optional name="seo.ogImageId" error={errorFor("seo.ogImageId")} help="Sosyal medyada paylaşıldığında görünür. Boş bırakılırsa kapak görseli kullanılır.">
        <MediaPicker value={state.seo.ogImageId} onChange={(id) => setField("seo.ogImageId", id)} items={media} folder="blog" aspect="1200/630" dialogTitle="Paylaşım görseli seç" />
      </Field>
      <Switch
        checked={state.seo.noIndex}
        onChange={(v) => setField("seo.noIndex", v)}
        label="Arama motorlarından gizle"
        description="Yazı sitede görünür ama Google'da listelenmez ve site haritasına eklenmez."
      />
    </Section>
  );
}
