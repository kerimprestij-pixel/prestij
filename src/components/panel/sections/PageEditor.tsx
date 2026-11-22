"use client";
// Page builder: page meta (title, address, published, SEO) and every section in one form with one save
// (savePageAction, locked by the page's updatedAt). Sections are reordered by drag or keyboard, added
// at any position from the picker, duplicated, hidden, scheduled, targeted and edited through the
// generic SectionFieldsEditor. The section types come from sectionMeta, so new types need no change.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ChevronsDownUp, ChevronsUpDown, Layers, Plus, Trash2 } from "lucide-react";
import {
  Field,
  LocalizedInput,
  LocalizedTextarea,
  MediaPicker,
  SaveBar,
  SlugInput,
  Switch,
  primeMedia,
  usePanelForm,
} from "@/components/panel/form";
import Badge from "@/components/panel/ui/Badge";
import Button from "@/components/panel/ui/Button";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import SortableList from "@/components/panel/ui/SortableList";
import { buttonClass } from "@/components/panel/ui/styles";
import { toast } from "@/components/panel/ui/toast-store";
import type { SectionType } from "@/components/sections/schemas";
import { deletePageAction, savePageAction } from "@/app/panel/(dashboard)/sayfalar/actions";
import { toPayloadFormData } from "@/lib/panel/action-types";
import {
  canDeletePage,
  isAlwaysPublished,
  isFixedSlugPage,
  pageAddressNote,
  pageKindLabel,
  pageSitePath,
} from "@/lib/panel/content/pages";
import { MAX_SECTIONS_PER_PAGE, pageSaveSchema } from "@/lib/panel/content/schemas";
import { newSectionContent, sectionSummary } from "@/lib/panel/content/sections";
import type { PageEditorState, SectionState } from "@/lib/panel/content/types";
import type { PanelMedia } from "@/lib/panel/media/types";
import { formatIstanbul } from "@/lib/panel/format";
import { cn } from "@/lib/utils";
import SectionCard from "./SectionCard";
import SectionPickerDialog from "./SectionPickerDialog";

let keySeed = 0;
const newKey = () => `n${Date.now().toString(36)}${(++keySeed).toString(36)}`;

export default function PageEditor({ initial, media }: { initial: PageEditorState; media: PanelMedia[] }) {
  const router = useRouter();
  const form = usePanelForm(initial);
  const { state, setField, formRef } = form;
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [picker, setPicker] = useState<{ open: boolean; position: number }>({ open: false, position: 0 });
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [seoOpen, setSeoOpen] = useState(false);
  // Drafts and empty pages open their settings (the "Yayında" switch lives there).
  const [settingsOpen, setSettingsOpen] = useState(!initial.isPublished || initial.sections.length === 0);
  const { confirm, confirmDialog } = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);

  // Media referenced by the page: the pickers show thumbnails without a request.
  useEffect(() => {
    primeMedia(media);
  }, [media]);

  // A new or duplicated section opens and scrolls into view.
  useEffect(() => {
    if (!focusKey) return;
    const card = listRef.current?.querySelector<HTMLElement>(`[data-section-key="${focusKey}"]`);
    card?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    card?.querySelector<HTMLElement>("[data-section-toggle]")?.focus({ preventScroll: true });
  }, [focusKey]);

  const sections = state.sections;
  const fixedSlug = isFixedSlugPage(initial);
  const alwaysPublished = isAlwaysPublished(initial);
  const sitePath = pageSitePath({ slug: form.saved.slug, kind: initial.kind });
  const errorCount = Object.keys(form.errors).length;

  const slots = useMemo(
    () =>
      sections.map((s) => {
        const summary = sectionSummary(s.type, s.content);
        return { label: summary.heading ? `${summary.label} — ${summary.heading}` : summary.label };
      }),
    [sections],
  );

  const setSections = (next: SectionState[]) => setField("sections", next);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const insert = (type: SectionType, position: number) => {
    if (sections.length >= MAX_SECTIONS_PER_PAGE) {
      toast.error(`Bir sayfada en fazla ${MAX_SECTIONS_PER_PAGE} bölüm olabilir.`);
      return;
    }
    const key = newKey();
    const section: SectionState = {
      key,
      id: null,
      type,
      isVisible: true,
      audience: "all",
      schedule: { startsAt: null, endsAt: null },
      content: newSectionContent(type),
    };
    const at = Math.min(Math.max(position, 0), sections.length);
    setSections([...sections.slice(0, at), section, ...sections.slice(at)]);
    setOpen((prev) => new Set(prev).add(key));
    setPicker({ open: false, position: 0 });
    setFocusKey(key);
  };

  const duplicate = (index: number) => {
    if (sections.length >= MAX_SECTIONS_PER_PAGE) {
      toast.error(`Bir sayfada en fazla ${MAX_SECTIONS_PER_PAGE} bölüm olabilir.`);
      return;
    }
    const source = sections[index];
    const key = newKey();
    const copy: SectionState = { ...structuredClone(source), key, id: null };
    setSections([...sections.slice(0, index + 1), copy, ...sections.slice(index + 1)]);
    setOpen((prev) => new Set(prev).add(key));
    setFocusKey(key);
  };

  const remove = async (index: number) => {
    const section = sections[index];
    const summary = sectionSummary(section.type, section.content);
    const ok = await confirm({
      title: `“${summary.heading ?? summary.label}” bölümü silinsin mi?`,
      description:
        section.id === null
          ? "Bu bölüm henüz kaydedilmedi; listeden çıkarılır."
          : "Bölüm, sayfayı kaydettiğinizde kalıcı olarak silinir. Kaydetmeden önce Vazgeç ile geri alabilirsiniz.",
      confirmLabel: "Bölümü sil",
    });
    if (!ok) return;
    setSections(sections.filter((_, i) => i !== index));
    const neighbor = sections[index + 1] ?? sections[index - 1];
    requestAnimationFrame(() => {
      const target = neighbor
        ? listRef.current?.querySelector<HTMLElement>(`[data-section-key="${neighbor.key}"] [data-section-toggle]`)
        : listRef.current?.querySelector<HTMLElement>("[data-add-section]");
      target?.focus();
    });
  };

  const allOpen = sections.length > 0 && sections.every((s) => open.has(s.key));

  /** After a failed save, open every card (and the SEO box) that holds an error so it can be fixed. */
  const revealErrors = (fieldErrors: Record<string, string> | undefined) => {
    const keys = Object.keys(fieldErrors ?? {});
    if (keys.some((k) => k.startsWith("seo."))) setSeoOpen(true);
    if (keys.some((k) => k === "title" || k.startsWith("title.") || k === "slug" || k === "isPublished")) setSettingsOpen(true);
    const indexes = new Set(keys.map((k) => /^sections\.(\d+)(?:\.|$)/.exec(k)?.[1]).filter(Boolean).map(Number));
    if (indexes.size > 0) {
      setOpen((prev) => {
        const next = new Set(prev);
        for (const i of indexes) if (state.sections[i]) next.add(state.sections[i].key);
        return next;
      });
    }
  };

  const save = () =>
    form.submit(savePageAction, {
      validate: pageSaveSchema,
      onError: (result) => revealErrors(result.fieldErrors),
      onSuccess: (data) => {
        // New sections got their ids: keep them open under their new keys.
        if (!data) return;
        setOpen((prev) => {
          const next = new Set(prev);
          state.sections.forEach((s, i) => {
            if (s.id === null && next.has(s.key) && data.sections[i]) next.add(`s${data.sections[i].id}`);
          });
          return next;
        });
      },
      resetTo: (sent, data) =>
        data
          ? {
              ...sent,
              slug: data.slug,
              updatedAt: data.updatedAt,
              sections: sent.sections.map((s, i) => {
                const saved = data.sections[i];
                return saved ? { ...s, key: s.id === null ? `s${saved.id}` : s.key, id: saved.id, content: saved.content } : s;
              }),
            }
          : sent,
    });

  const removePage = async () => {
    const ok = await confirm({
      title: `“${initial.title.tr}” sayfası silinsin mi?`,
      description: "Sayfa ve tüm bölümleri kalıcı olarak silinir; bu işlem geri alınamaz. Sayfanın adresi artık açılmaz.",
      confirmLabel: "Sayfayı sil",
    });
    if (!ok) return;
    setDeleting(true);
    const result = await deletePageAction(null, toPayloadFormData({ id: initial.id, updatedAt: form.saved.updatedAt })).catch(() => null);
    setDeleting(false);
    if (!result) {
      toast.error("Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
      return;
    }
    if (!result.ok) {
      toast.error(result.error, { duration: result.code === "in_use" ? 0 : undefined });
      return;
    }
    toast.success(result.message ?? "Sayfa silindi.");
    form.reset(form.state);
    router.push("/panel/sayfalar");
  };

  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="space-y-6 pb-28" noValidate>
      <div className="space-y-4">
        <Link
          href="/panel/sayfalar"
          className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
          Sayfalar
        </Link>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">{pageKindLabel(initial)}</p>
            <h1 className="mt-2 break-words font-heading text-3xl font-medium leading-tight text-text sm:text-4xl">
              {state.title.tr.trim() || form.saved.title.tr || "Adsız sayfa"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
              <Badge tone={form.saved.isPublished ? "success" : "warning"}>{form.saved.isPublished ? "Yayında" : "Taslak"}</Badge>
              <span className="font-mono text-xs">{sitePath}</span>
              <span aria-hidden>·</span>
              <span>Son kayıt: {formatIstanbul(form.saved.updatedAt)}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {form.saved.isPublished ? (
              <a href={sitePath} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
                <ArrowUpRight aria-hidden className="size-4" />
                Sitede gör
                <span className="sr-only"> (yeni sekmede açılır)</span>
              </a>
            ) : (
              <span className={cn(buttonClass("secondary", "md"), "cursor-not-allowed opacity-55")} title="Sayfa yayında değil." aria-disabled="true">
                <ArrowUpRight aria-hidden className="size-4" />
                Sitede gör
              </span>
            )}
            {canDeletePage(initial) ? (
              <Button variant="danger-outline" icon={Trash2} onClick={removePage} pending={deleting} pendingLabel="Siliniyor…">
                Sayfayı sil
              </Button>
            ) : null}
          </div>
        </header>
      </div>

      <div className="space-y-6">
        {/* Page settings and SEO: two collapsible boxes (side by side on wide screens), so the sections get the full width. */}
        <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
          <details
            className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]"
            open={settingsOpen}
            onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text">Sayfa ayarları</span>
                <span className="mt-0.5 block truncate text-xs text-text-muted">Başlık, adres ve yayın durumu</span>
              </span>
              <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-text-muted" />
            </summary>
            <div className="space-y-5 border-t border-border p-5">
              <LocalizedInput
                label="Sayfa başlığı"
                required
                value={state.title}
                onChange={(v) => setField("title", v)}
                error={form.localizedError("title")}
                name="title"
                maxLength={120}
                help={initial.kind === "home" ? "Panelde sayfayı tanımak için kullanılır; SEO başlığı boşsa tarayıcı sekmesinde görünür." : "Sayfanın en üstünde ve tarayıcı sekmesinde görünür."}
              />
              {fixedSlug ? (
                <div>
                  <p className="text-sm font-medium text-text">Adres</p>
                  <p className="mt-1 font-mono text-xs text-text">{sitePath}</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">
                    {pageAddressNote(initial)} {initial.kind === "legal" ? "Ödeme sayfası ve sözleşmeler bu adrese bağlantı verdiği için adres sabittir." : "Bu sayfanın adresi sabittir."}
                  </p>
                </div>
              ) : (
                <Field label="Kısa ad (adres)" required error={form.errorFor("slug")} name="slug" help="Yalnızca küçük harf, rakam ve tire.">
                  <SlugInput value={state.slug} onChange={(v) => setField("slug", v)} source={state.title.tr} prefix="/sayfa/" auto={false} original={form.saved.slug} />
                </Field>
              )}
              <div data-field="isPublished">
                <Switch
                  checked={state.isPublished}
                  onChange={(on) => setField("isPublished", on)}
                  disabled={alwaysPublished}
                  label="Yayında"
                  description={
                    alwaysPublished
                      ? initial.kind === "home"
                        ? "Ana sayfa her zaman yayındadır."
                        : "Yasal metin sayfaları her zaman yayında kalmalıdır."
                      : state.isPublished
                        ? "Sayfa sitede görünür."
                        : "Taslak: sayfa sitede görünmez, yalnızca panelden düzenlenir."
                  }
                  invalid={Boolean(form.errorFor("isPublished"))}
                />
                {form.errorFor("isPublished") ? <p className="mt-1 text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{form.errorFor("isPublished")}</p> : null}
              </div>
            </div>
          </details>

          <details
            className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]"
            open={seoOpen}
            onToggle={(event) => setSeoOpen(event.currentTarget.open)}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block text-sm font-semibold text-text">Arama ve paylaşım (SEO)</span>
                <span className="mt-0.5 block text-xs text-text-muted">Google sonuçları ve sosyal medya önizlemesi</span>
              </span>
              <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-text-muted" />
            </summary>
            <div className="space-y-5 border-t border-border p-5">
              <LocalizedInput
                label="SEO başlığı"
                value={state.seo.title}
                onChange={(v) => setField("seo.title", v.tr || v.en || v.ar ? v : null)}
                error={form.localizedError("seo.title")}
                name="seo.title"
                maxLength={120}
                help="Boş bırakılan dilde o dildeki sayfa başlığı kullanılır. 60 karakteri geçmemesi önerilir."
              />
              <LocalizedTextarea
                label="SEO açıklaması"
                value={state.seo.description}
                onChange={(v) => setField("seo.description", v.tr || v.en || v.ar ? v : null)}
                error={form.localizedError("seo.description")}
                name="seo.description"
                maxLength={320}
                rows={3}
                help={
                  initial.kind === "home"
                    ? "Arama sonuçlarında başlığın altında görünür; 150–160 karakter idealdir."
                    : "Arama sonuçlarında başlığın altında görünür; sayfada da başlığın altında giriş metni olarak gösterilir (kapak bölümüyle başlayan Kurumsal, Numune ve İletişim sayfaları hariç). 150–160 karakter idealdir."
                }
              />
              <Field label="Paylaşım görseli" error={form.errorFor("seo.ogImageId")} name="seo.ogImageId" help="WhatsApp ve sosyal medya paylaşımlarında görünür. 1200×630 px önerilir.">
                <MediaPicker value={state.seo.ogImageId} onChange={(id) => setField("seo.ogImageId", id)} folder="sayfalar" aspect="1200/630" dialogTitle="Paylaşım görseli seçin" />
              </Field>
              <Switch
                checked={state.seo.noIndex}
                onChange={(on) => setField("seo.noIndex", on)}
                label="Arama motorlarından gizle"
                description="Açıkken Google bu sayfayı arama sonuçlarında göstermez."
              />
            </div>
          </details>
        </div>

        {/* Sections */}
        <section aria-labelledby="sections-title" className="min-w-0 space-y-3" ref={listRef}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="sections-title" className="font-heading text-xl text-text">
                Bölümler
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                {sections.length > 0
                  ? `${sections.length} bölüm · yukarıdan aşağıya sitedeki sırayla. Sürükleyerek veya oklarla sıralayın.`
                  : "Sayfa henüz boş."}
              </p>
            </div>
            {sections.length > 0 ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={allOpen ? ChevronsDownUp : ChevronsUpDown}
                  onClick={() => setOpen(allOpen ? new Set() : new Set(sections.map((s) => s.key)))}
                >
                  {allOpen ? "Tümünü kapat" : "Tümünü aç"}
                </Button>
                <Button size="sm" variant="secondary" icon={Plus} onClick={() => setPicker({ open: true, position: sections.length })}>
                  Bölüm ekle
                </Button>
              </div>
            ) : null}
          </div>

          {sections.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-full border border-border bg-surface-2 text-gold-text">
                <Layers aria-hidden className="size-5" strokeWidth={1.5} />
              </span>
              <p className="mt-4 font-heading text-lg text-text">Bu sayfada henüz bölüm yok</p>
              <p className="mt-1 max-w-sm text-sm text-text-muted">Kapak, metin, ürünler, galeri veya soru–cevap gibi hazır bölümlerden ekleyerek sayfayı oluşturun.</p>
              <Button className="mt-5" variant="primary" icon={Plus} data-add-section onClick={() => setPicker({ open: true, position: 0 })}>
                İlk bölümü ekle
              </Button>
            </div>
          ) : (
            <>
              <InsertPoint position={0} onInsert={(position) => setPicker({ open: true, position })} first />
              <SortableList
                items={sections}
                ariaLabel="Sayfa bölümleri"
                className="space-y-0"
                getKey={(s) => s.key}
                getItemLabel={(s, i) => {
                  const summary = sectionSummary(s.type, s.content);
                  return `${i + 1}. ${summary.heading ? `${summary.label}: ${summary.heading}` : summary.label}`;
                }}
                onReorder={(next) => setSections(next)}
                renderItem={(section, ctx) => (
                  <div>
                    <SectionCard
                      section={section}
                      index={ctx.index}
                      ctx={ctx}
                      open={open.has(section.key)}
                      onToggle={() => toggle(section.key)}
                      onDuplicate={() => duplicate(ctx.index)}
                      onRemove={() => remove(ctx.index)}
                      setField={setField}
                      errorsUnder={form.errorsUnder}
                      hasErrors={form.hasErrors(`sections.${ctx.index}`)}
                    />
                    {ctx.index < ctx.count - 1 ? <InsertPoint position={ctx.index + 1} onInsert={(position) => setPicker({ open: true, position })} /> : null}
                  </div>
                )}
              />
              <button
                type="button"
                data-add-section
                onClick={() => setPicker({ open: true, position: sections.length })}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-4 text-sm font-medium text-text-muted transition-colors hover:border-gold/60 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
              >
                <Plus aria-hidden className="size-4" />
                Sona bölüm ekle
              </button>
            </>
          )}
          {form.errorFor("sections") && !Object.keys(form.errors).some((k) => k.startsWith("sections.")) ? (
            <p role="alert" className="text-sm font-medium text-[#B3261E] dark:text-[#F28B82]">
              {form.errorFor("sections")}
            </p>
          ) : null}
        </section>
      </div>

      <SectionPickerDialog
        open={picker.open}
        position={picker.position}
        slots={slots}
        onClose={() => setPicker((p) => ({ ...p, open: false }))}
        onPick={insert}
      />
      {confirmDialog}

      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        errorCount={errorCount}
        onReset={() => form.reset()}
        onSave={save}
        saveLabel="Sayfayı kaydet"
        savedNote={`Son kayıt: ${formatIstanbul(form.saved.updatedAt)}`}
      />
    </form>
  );
}

/** Slim "add a section here" control between two section cards. */
function InsertPoint({ position, onInsert, first = false }: { position: number; onInsert: (position: number) => void; first?: boolean }) {
  return (
    <div className={cn("group/insert relative flex h-7 items-center", first && "-mb-1")}>
      <span aria-hidden className="h-px flex-1 bg-transparent transition-colors group-hover/insert:bg-gold/40 group-focus-within/insert:bg-gold/40" />
      <button
        type="button"
        onClick={() => onInsert(position)}
        className="mx-2 inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-bg px-2.5 py-0.5 text-[0.6875rem] font-medium text-text-muted opacity-70 transition-[opacity,color,border-color] hover:border-gold/60 hover:text-text hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
      >
        <Plus aria-hidden className="size-3" />
        {first ? "En üste ekle" : "Buraya ekle"}
        <span className="sr-only">{` (${position + 1}. sıraya bölüm ekle)`}</span>
      </button>
      <span aria-hidden className="h-px flex-1 bg-transparent transition-colors group-hover/insert:bg-gold/40 group-focus-within/insert:bg-gold/40" />
    </div>
  );
}

