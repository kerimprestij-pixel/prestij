"use client";
import { useEffect, useState } from "react";
import { Check, EyeOff, RefreshCw } from "lucide-react";
import Button from "@/components/panel/ui/Button";
import { cn } from "@/lib/utils";
import { useFieldControl, useFieldLabelId } from "./Field";
import { loadCategories, type PickerCategory } from "./picker-data";
import Select from "./Select";

type Common = {
  /** Categories preloaded by the page (skips the request). */
  categories?: readonly PickerCategory[];
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
};

export type CategoryPickerSingleProps = Common & {
  multiple?: false;
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  /** Allow "no category" (default true). */
  allowEmpty?: boolean;
  placeholder?: string;
};

export type CategoryPickerMultipleProps = Common & {
  multiple: true;
  value: readonly number[] | null | undefined;
  onChange: (ids: number[]) => void;
};

export type CategoryPickerProps = CategoryPickerSingleProps | CategoryPickerMultipleProps;

function useCategories(preloaded?: readonly PickerCategory[]) {
  const [list, setList] = useState<readonly PickerCategory[] | null>(preloaded ?? null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (preloaded) return;
    let alive = true;
    loadCategories(attempt > 0)
      .then((c) => {
        if (!alive) return;
        setList(c);
        setError(false);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [preloaded, attempt]);
  return { list: preloaded ?? list, error, retry: () => setAttempt((n) => n + 1) };
}

/** Category field: a select (single) or toggle chips (multiple). Hidden categories are marked. */
export default function CategoryPicker(props: CategoryPickerProps) {
  const { list, error, retry } = useCategories(props.categories);
  const control = useFieldControl({ id: props.id, invalid: props.invalid });
  const labelId = useFieldLabelId();

  if (error && !list) {
    return (
      <div className={cn("flex items-center gap-3 text-sm text-text-muted", props.className)}>
        Kategoriler yüklenemedi.
        <Button size="sm" icon={RefreshCw} onClick={retry}>
          Tekrar dene
        </Button>
      </div>
    );
  }

  if (!props.multiple) {
    const { value, onChange, allowEmpty = true, placeholder = "Kategori seçin" } = props;
    return (
      <Select
        id={props.id}
        value={value ?? null}
        onChange={(v) => onChange(v)}
        onClear={() => onChange(null)}
        allowEmpty={allowEmpty}
        placeholder={list ? (allowEmpty ? "Kategori yok" : placeholder) : "Yükleniyor…"}
        disabled={props.disabled || !list}
        invalid={props.invalid}
        className={props.className}
        options={(list ?? []).map((c) => ({ value: c.id, label: c.isVisible ? c.name : `${c.name} (gizli)` }))}
      />
    );
  }

  const selected = new Set(props.value ?? []);
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Keep the category order of the catalog.
    props.onChange((list ?? []).map((c) => c.id).filter((c) => next.has(c)));
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={control["aria-describedby"]}
      id={control.id}
      className={cn("flex flex-wrap gap-2", props.className)}
    >
      {list === null ? (
        <span role="status" className="text-sm text-text-muted">
          Yükleniyor…
        </span>
      ) : list.length === 0 ? (
        <span className="text-sm text-text-muted">Henüz kategori yok.</span>
      ) : (
        list.map((c) => {
          const on = selected.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              disabled={props.disabled}
              onClick={() => toggle(c.id)}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 motion-reduce:transition-none",
                on ? "border-gold bg-gold/15 font-medium text-text" : "border-border bg-surface text-text-muted hover:border-gold/50 hover:text-text",
              )}
            >
              {on ? <Check aria-hidden className="size-3.5 text-gold-text" strokeWidth={2.5} /> : null}
              {c.name}
              {!c.isVisible ? (
                <>
                  <EyeOff aria-hidden className="size-3.5 opacity-60" />
                  <span className="sr-only">(gizli)</span>
                </>
              ) : null}
            </button>
          );
        })
      )}
    </div>
  );
}
