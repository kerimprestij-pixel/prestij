"use client";
// "Bölüm ekle": every section type from sectionMeta (label + one-line description), plus where to insert.
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Field, Select } from "@/components/panel/form";
import Dialog from "@/components/panel/ui/Dialog";
import { controlGroupClass, groupInputClass } from "@/components/panel/ui/styles";
import { sectionMeta, sectionTypes, type SectionType } from "@/components/sections/schemas";
import { foldText } from "@/lib/panel/format";
import { cn } from "@/lib/utils";
import { SectionIcon } from "./section-ui";

export type InsertSlot = { label: string };

export default function SectionPickerDialog({
  open,
  onClose,
  onPick,
  position,
  slots,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (type: SectionType, position: number) => void;
  /** Initial insert position (0 = top, slots.length = bottom). */
  position: number;
  /** One entry per existing section, in order (used to describe the positions). */
  slots: InsertSlot[];
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Bölüm ekle"
      description="Bir bölüm türü seçin. Bölüm, seçtiğiniz konuma örnek içerikle eklenir; sonra dilediğiniz gibi düzenleyebilirsiniz."
      size="lg"
    >
      {open ? <PickerBody key={position} onPick={onPick} position={position} slots={slots} /> : null}
    </Dialog>
  );
}

function PickerBody({ onPick, position: initialPosition, slots }: { onPick: (type: SectionType, position: number) => void; position: number; slots: InsertSlot[] }) {
  const [position, setPosition] = useState(Math.min(Math.max(initialPosition, 0), slots.length));
  const [q, setQ] = useState("");

  const options = useMemo(() => {
    const list = [{ value: 0, label: "En üste" }];
    slots.forEach((slot, i) => list.push({ value: i + 1, label: i + 1 === slots.length ? "En alta" : `${i + 1}. bölümden sonra: ${slot.label}` }));
    return list;
  }, [slots]);

  const needle = foldText(q.trim());
  const types = sectionTypes.filter((type) => {
    if (!needle) return true;
    const meta = sectionMeta[type];
    return foldText(`${meta.label} ${meta.description}`).includes(needle);
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
        <Field label="Konum">
          <Select value={position} onChange={(v) => setPosition(v)} options={options} />
        </Field>
        <div className={cn(controlGroupClass, "h-10")}>
          <span aria-hidden className="flex items-center ps-3 text-text-muted">
            <Search className="size-4" />
          </span>
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Bölüm türü ara…"
            aria-label="Bölüm türü ara"
            autoComplete="off"
            className={cn(groupInputClass, "[&::-webkit-search-cancel-button]:hidden")}
          />
        </div>
      </div>

      {types.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">“{q}” ile eşleşen bölüm türü yok.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Bölüm türleri">
          {types.map((type) => {
            const meta = sectionMeta[type];
            return (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => onPick(type, position)}
                  className="group flex h-full w-full items-start gap-3 rounded-xl border border-border bg-surface p-3.5 text-start transition-colors hover:border-gold/60 hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-gold-text transition-colors group-hover:border-gold/50">
                    <SectionIcon type={type} className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text">{meta.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{meta.description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
