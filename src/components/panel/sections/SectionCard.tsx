"use client";
// One section in the page editor: a summary header (type, first heading, facts, status badges) with
// quick actions, and, when open, the generic fields editor plus visibility, audience and schedule.
import { useState } from "react";
import { CalendarClock, ChevronDown, Copy, Eye, EyeOff, Trash2, TriangleAlert } from "lucide-react";
import { Field, ScheduleInput, Select, Switch } from "@/components/panel/form";
import Badge from "@/components/panel/ui/Badge";
import Button from "@/components/panel/ui/Button";
import type { SortableItemContext } from "@/components/panel/ui/SortableList";
import { iconButtonClass } from "@/components/panel/ui/styles";
import { isSectionType, sectionMeta } from "@/components/sections/schemas";
import { AUDIENCE_OPTIONS, rendersOnStorefront, sectionSummary, type Audience } from "@/lib/panel/content/sections";
import type { SectionState } from "@/lib/panel/content/types";
import { cn } from "@/lib/utils";
import SectionFieldsEditor from "./SectionFieldsEditor";
import { scheduleNote, SectionIcon } from "./section-ui";

export type SectionCardProps = {
  section: SectionState;
  index: number;
  ctx: SortableItemContext;
  open: boolean;
  onToggle: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  setField: (path: string, value: unknown) => void;
  errorsUnder: (path: string) => Record<string, string>;
  hasErrors: boolean;
};

const AUDIENCE_BADGE: Record<Audience, string | null> = { all: null, retail: "Bireysel", business: "Kurumsal" };

export default function SectionCard({ section, index, ctx, open, onToggle, onDuplicate, onRemove, setField, errorsUnder, hasErrors }: SectionCardProps) {
  const base = `sections.${index}`;
  const summary = sectionSummary(section.type, section.content);
  const known = isSectionType(section.type);
  const note = scheduleNote(section.schedule);
  const renders = known && rendersOnStorefront(section.type, section.content);
  const audience = AUDIENCE_BADGE[section.audience];
  const bodyId = `section-${section.key}-body`;
  const typeError = errorsUnder(`${base}.type`)[""] ?? errorsUnder(base)[""];
  const [showSchedule, setShowSchedule] = useState(Boolean(section.schedule.startsAt || section.schedule.endsAt));
  const label = summary.heading ? `${summary.label}: ${summary.heading}` : summary.label;

  return (
    <div
      data-section-key={section.key}
      className={cn(
        "overflow-hidden rounded-xl border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)] transition-[border-color,opacity] motion-reduce:transition-none",
        hasErrors || !known ? "border-[#C2413A]/50" : open ? "border-gold/50" : "border-border",
      )}
    >
      <div className={cn("flex items-start gap-1 py-2 ps-1.5 pe-1.5", open && "border-b border-border bg-surface-2/40")}>
        <div className="pt-1">{ctx.handle}</div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          data-section-toggle
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-1.5 py-1 text-start focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        >
          <span
            className={cn(
              "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-gold-text",
              !section.isVisible && "opacity-50",
            )}
          >
            <SectionIcon type={section.type} className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-text-muted">
              <span className="tabular-nums">{index + 1}</span>
              <span aria-hidden>·</span>
              <span className="truncate">{summary.label}</span>
            </span>
            <span className={cn("mt-0.5 block truncate text-sm font-medium text-text", !section.isVisible && "text-text-muted")}>
              {summary.heading ?? <span className="font-normal italic text-text-muted">Başlıksız</span>}
            </span>
            {summary.facts.length > 0 || !section.isVisible || note || audience || section.id === null || hasErrors || (known && !renders) || !known ? (
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {section.id === null ? (
                  <Badge tone="gold" variant="soft" size="sm">
                    Yeni
                  </Badge>
                ) : null}
                {hasErrors ? (
                  <Badge tone="danger" size="sm">
                    Düzeltilmesi gereken alan var
                  </Badge>
                ) : known && !renders ? (
                  <Badge tone="warning" size="sm" title="İçerik doğrulanamadığı için bu bölüm sitede gösterilmiyor.">
                    Eksik içerik
                  </Badge>
                ) : null}
                {!known ? (
                  <Badge tone="danger" size="sm">
                    Tanınmayan tür
                  </Badge>
                ) : null}
                {!section.isVisible ? (
                  <Badge tone="neutral" size="sm">
                    Gizli
                  </Badge>
                ) : null}
                {note ? (
                  <Badge tone={note.tone} size="sm">
                    {note.label}
                  </Badge>
                ) : null}
                {audience ? (
                  <Badge tone="info" variant="soft" size="sm">
                    {audience}
                  </Badge>
                ) : null}
                {summary.facts.map((fact) => (
                  <span key={fact} className="text-xs text-text-muted">
                    {fact}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            className={cn("mt-2 size-4 shrink-0 text-text-muted transition-transform motion-reduce:transition-none", !open && "-rotate-90 rtl:rotate-90")}
          />
        </button>
        <div className="flex shrink-0 items-center pt-1">
          <span className="hidden sm:inline-flex">{ctx.moveButtons}</span>
          <button
            type="button"
            onClick={() => setField(`${base}.isVisible`, !section.isVisible)}
            aria-label={`${label}: ${section.isVisible ? "gizle" : "göster"}`}
            title={section.isVisible ? "Sitede gizle" : "Sitede göster"}
            className={iconButtonClass("sm")}
          >
            {section.isVisible ? <Eye aria-hidden className="size-4" /> : <EyeOff aria-hidden className="size-4" />}
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            disabled={!known}
            aria-label={`${label}: çoğalt`}
            title="Çoğalt"
            className={cn(iconButtonClass("sm"), "max-[379px]:hidden")}
          >
            <Copy aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`${label}: sil`}
            title="Sil"
            className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      {open ? (
        <div id={bodyId} className="space-y-6 p-4 sm:p-5">
          {typeError ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-[#C2413A]/30 bg-[#C2413A]/[0.06] px-3 py-2 text-sm text-text">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-[#C2413A]" />
              {typeError}
            </p>
          ) : null}
          {known ? (
            <>
              <p className="text-xs leading-relaxed text-text-muted">{sectionMeta[section.type as keyof typeof sectionMeta].description}</p>
              <SectionFieldsEditor
                fields={sectionMeta[section.type as keyof typeof sectionMeta].fields}
                value={section.content}
                path={`${base}.content`}
                setField={setField}
                errorsUnder={errorsUnder}
                mediaFolder="sayfalar"
              />
            </>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-[#C2413A]/30 bg-[#C2413A]/[0.05] p-4 text-sm">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-[#C2413A]" />
              <div className="space-y-2">
                <p className="font-medium text-text">Bu bölümün türü (“{section.type}”) artık tanınmıyor.</p>
                <p className="text-text-muted">Sitede gösterilmiyor ve düzenlenemiyor. Sayfayı kaydedebilmek için bu bölümü silin.</p>
                <Button size="sm" variant="danger-outline" icon={Trash2} onClick={onRemove}>
                  Bölümü sil
                </Button>
              </div>
            </div>
          )}

          <fieldset className="space-y-4 rounded-xl border border-border bg-surface-2/40 p-4">
            <legend className="sr-only">Görünürlük ve zamanlama</legend>
            <p className="text-sm font-medium text-text" aria-hidden>
              Görünürlük ve zamanlama
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Switch
                checked={section.isVisible}
                onChange={(on) => setField(`${base}.isVisible`, on)}
                label="Sitede göster"
                description={section.isVisible ? "Bölüm sayfada görünür." : "Bölüm gizli; içerik saklanır."}
              />
              <Field
                label="Kimler görsün?"
                error={errorsUnder(`${base}.audience`)[""]}
                name={`${base}.audience`}
                help={section.audience === "business" ? "Yalnızca onaylı kurumsal müşterilere gösterilir — gizli bilgi koymayın (sayfa kaynağında görünür)." : section.audience === "retail" ? "Onaylı kurumsal müşterilere gösterilmez; diğer herkes görür." : undefined}
              >
                <Select value={section.audience} onChange={(v) => setField(`${base}.audience`, v)} options={AUDIENCE_OPTIONS} size="sm" />
              </Field>
            </div>
            {showSchedule ? (
              <ScheduleInput
                label="Yayın zamanı"
                value={section.schedule}
                onChange={(v) => setField(`${base}.schedule`, v)}
                error={errorsUnder(`${base}.schedule`)}
                name={`${base}.schedule`}
              />
            ) : (
              <Button size="sm" variant="ghost" icon={CalendarClock} onClick={() => setShowSchedule(true)}>
                Zamanlama ekle
              </Button>
            )}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
