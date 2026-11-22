"use client";
import { useId, useState } from "react";
import { Tag, X } from "lucide-react";
import { useFieldControl } from "@/components/panel/form/Field";
import { controlGroupClass } from "@/components/panel/ui/styles";
import { normalizeTags } from "@/lib/panel/blog/reading";
import { cn } from "@/lib/utils";

export type TagInputProps = {
  value: readonly string[];
  onChange: (tags: string[]) => void;
  /** Tags used elsewhere, offered as suggestions. */
  suggestions?: readonly string[];
  max?: number;
  maxLength?: number;
  placeholder?: string;
  invalid?: boolean;
};

/** Free-form tags as chips: Enter or comma adds, Backspace on an empty field removes the last one. */
export default function TagInput({ value, onChange, suggestions = [], max = 12, maxLength = 40, placeholder = "Etiket yazıp Enter'a basın", invalid }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const control = useFieldControl({ invalid });
  const listId = useId();
  const full = value.length >= max;

  const add = (raw: string) => {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return;
    onChange(normalizeTags([...value, ...parts], { max, maxLength }));
    setDraft("");
  };
  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));
  const available = suggestions.filter((s) => !value.some((v) => v.toLocaleLowerCase("tr-TR") === s.toLocaleLowerCase("tr-TR")));

  return (
    <div className="space-y-2">
      <div className={cn(controlGroupClass, "min-h-10 flex-wrap items-center gap-1.5 px-2 py-1.5")}>
        <Tag aria-hidden className="ms-1 size-4 shrink-0 text-text-muted" />
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 py-0.5 ps-2.5 pe-1 text-xs font-medium text-text">
            {tag}
            <button
              type="button"
              onClick={() => remove(tag)}
              className="grid size-5 place-items-center rounded-full text-text-muted transition-colors hover:bg-gold/20 hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X aria-hidden className="size-3" />
              <span className="sr-only">“{tag}” etiketini kaldır</span>
            </button>
          </span>
        ))}
        <input
          type="text"
          {...control}
          value={draft}
          list={listId}
          disabled={full}
          maxLength={maxLength + 1}
          placeholder={full ? `En fazla ${max} etiket` : value.length ? "" : placeholder}
          enterKeyHint="enter"
          onChange={(event) => {
            const next = event.target.value;
            if (next.includes(",")) add(next);
            else setDraft(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(draft);
            } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
              event.preventDefault();
              remove(value[value.length - 1]);
            }
          }}
          onBlur={() => add(draft)}
          className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-text placeholder:text-text-muted/70 focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
      <datalist id={listId}>
        {available.slice(0, 50).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
