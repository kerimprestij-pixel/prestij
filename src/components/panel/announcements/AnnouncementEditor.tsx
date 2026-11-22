"use client";
// Create or edit one announcement: localized text, optional link, color, on/off and schedule, with a
// live preview of the bar in all three languages.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Field, LinkInput, LocalizedInput, SaveBar, ScheduleInput, Switch, usePanelForm } from "@/components/panel/form";
import Badge from "@/components/panel/ui/Badge";
import Button from "@/components/panel/ui/Button";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import { toast } from "@/components/panel/ui/toast-store";
import { deleteAnnouncementAction, saveAnnouncementAction } from "@/app/panel/(dashboard)/duyurular/actions";
import type { LocalizedText } from "@/db/schema/common";
import { toPayloadFormData } from "@/lib/panel/action-types";
import {
  ANNOUNCEMENT_STATUS,
  ANNOUNCEMENT_TEXT_MAX,
  ANNOUNCEMENT_VARIANT_CLASS,
  ANNOUNCEMENT_VARIANT_OPTIONS,
  announcementStatus,
  type AnnouncementVariantKey,
} from "@/lib/panel/content/announcements";
import { announcementSaveSchema } from "@/lib/panel/content/schemas";
import { formatIstanbul } from "@/lib/panel/format";
import { cn } from "@/lib/utils";
import AnnouncementPreview from "./AnnouncementPreview";

export type AnnouncementEditorState = {
  id: number | null;
  text: LocalizedText;
  href: string;
  variant: AnnouncementVariantKey;
  isActive: boolean;
  schedule: { startsAt: string | null; endsAt: string | null };
  updatedAt: string | null;
};

export const NEW_ANNOUNCEMENT: AnnouncementEditorState = {
  id: null,
  text: { tr: "" },
  href: "",
  variant: "brand",
  isActive: true,
  schedule: { startsAt: null, endsAt: null },
  updatedAt: null,
};

export default function AnnouncementEditor({ initial, liveCount = 0 }: { initial: AnnouncementEditorState; liveCount?: number }) {
  const router = useRouter();
  const form = usePanelForm(initial);
  const { state, setField, formRef } = form;
  const { confirm, confirmDialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const isNew = form.saved.id === null;
  const status = announcementStatus({ isActive: form.saved.isActive, startsAt: form.saved.schedule.startsAt, endsAt: form.saved.schedule.endsAt });

  const save = () =>
    form.submit(saveAnnouncementAction, {
      validate: announcementSaveSchema,
      resetTo: (sent, data) => (data ? { ...sent, id: data.id, updatedAt: data.updatedAt } : sent),
      onSuccess: (data) => {
        if (data?.created) router.replace(`/panel/duyurular/${data.id}`);
      },
    });

  const remove = async () => {
    if (form.saved.id === null || !form.saved.updatedAt) return;
    const ok = await confirm({
      title: "Duyuru silinsin mi?",
      description: `“${form.saved.text.tr}” kalıcı olarak silinir. Yalnızca bir süre gizlemek için “Yayında” anahtarını kapatabilirsiniz.`,
      confirmLabel: "Duyuruyu sil",
    });
    if (!ok) return;
    setDeleting(true);
    const result = await deleteAnnouncementAction(null, toPayloadFormData({ id: form.saved.id, updatedAt: form.saved.updatedAt })).catch(() => null);
    setDeleting(false);
    if (!result) {
      toast.error("Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
      return;
    }
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Duyuru silindi.");
    form.reset(form.state);
    router.push("/panel/duyurular");
  };

  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} noValidate className="space-y-6 pb-28">
      <div className="space-y-4">
        <Link
          href="/panel/duyurular"
          className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
          Duyurular
        </Link>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">Duyuru şeridi</p>
            <h1 className="mt-2 font-heading text-3xl font-medium leading-tight text-text sm:text-4xl">{isNew ? "Yeni duyuru" : "Duyuruyu düzenle"}</h1>
            {!isNew ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                <Badge tone={ANNOUNCEMENT_STATUS[status].tone}>{ANNOUNCEMENT_STATUS[status].label}</Badge>
                {form.saved.updatedAt ? <span>Son kayıt: {formatIstanbul(form.saved.updatedAt)}</span> : null}
              </div>
            ) : null}
          </div>
          {!isNew ? (
            <Button variant="danger-outline" icon={Trash2} onClick={remove} pending={deleting} pendingLabel="Siliniyor…">
              Duyuruyu sil
            </Button>
          ) : null}
        </header>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <section className="min-w-0 space-y-6 rounded-xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgb(3_38_95/0.04)]">
          <LocalizedInput
            label="Duyuru metni"
            required
            value={state.text}
            onChange={(v) => setField("text", v)}
            error={form.localizedError("text")}
            name="text"
            maxLength={ANNOUNCEMENT_TEXT_MAX}
            placeholder="ör. 1.500 TL ve üzeri siparişlerde ücretsiz kargo"
            help="Kısa ve tek cümle tutun; telefonda iki satırı geçmemesi iyi olur."
          />
          <Field label="Bağlantı" optional error={form.errorFor("href")} name="href" help="İsteğe bağlı: metne tıklanınca açılacak sayfa.">
            <LinkInput value={state.href} onChange={(href) => setField("href", href)} />
          </Field>

          <fieldset className="space-y-2" data-field="variant">
            <legend className="text-sm font-medium text-text">Renk</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {ANNOUNCEMENT_VARIANT_OPTIONS.map((option) => {
                const selected = state.variant === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setField("variant", option.value)}
                    className={cn(
                      "flex flex-col items-start gap-2 rounded-xl border p-3 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
                      selected ? "border-gold bg-gold/5 ring-1 ring-gold/40" : "border-border hover:bg-surface-2/60",
                    )}
                  >
                    <span aria-hidden className={cn("h-5 w-full rounded-md border border-border", ANNOUNCEMENT_VARIANT_CLASS[option.value])} />
                    <span className="text-sm font-medium text-text">{option.label}</span>
                    <span className="text-xs leading-relaxed text-text-muted">{option.description}</span>
                  </button>
                );
              })}
            </div>
            {form.errorFor("variant") ? <p className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{form.errorFor("variant")}</p> : null}
          </fieldset>

          <Switch
            checked={state.isActive}
            onChange={(on) => setField("isActive", on)}
            label="Yayında"
            description={state.isActive ? "Zamanlama uygunsa şerit sitede görünür." : "Kapalı: duyuru saklanır ama sitede görünmez."}
          />
          <ScheduleInput
            label="Yayın zamanı"
            value={state.schedule}
            onChange={(v) => setField("schedule", v)}
            error={form.errorsUnder("schedule")}
            name="schedule"
          />
        </section>

        <aside className="min-w-0 space-y-3 rounded-xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgb(3_38_95/0.04)] lg:sticky lg:top-20">
          <div>
            <h2 className="text-sm font-semibold text-text">Önizleme</h2>
            <p className="mt-0.5 text-xs text-text-muted">Şerit sitenin en üstünde, menünün üzerinde görünür. Ziyaretçi kapatabilir; metin değişince yeniden gösterilir.</p>
          </div>
          <AnnouncementPreview text={state.text} variant={state.variant} hasLink={Boolean(state.href)} multiple={liveCount > 1} />
        </aside>
      </div>

      {confirmDialog}
      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        errorCount={Object.keys(form.errors).length}
        onReset={isNew ? undefined : () => form.reset()}
        onSave={save}
        saveLabel={isNew ? "Duyuruyu oluştur" : "Kaydet"}
      />
    </form>
  );
}
