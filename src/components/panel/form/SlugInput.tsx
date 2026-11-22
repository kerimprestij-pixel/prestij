"use client";
import { useEffect, useState } from "react";
import { Info, WandSparkles } from "lucide-react";
import { affixClass, controlGroupClass, groupInputClass } from "@/components/panel/ui/styles";
import { slugify, SLUG_MAX_LENGTH } from "@/lib/panel/format";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";

export type SlugInputProps = {
  value: string | null | undefined;
  onChange: (slug: string) => void;
  /** The Turkish name the slug follows while in automatic mode. */
  source: string | null | undefined;
  /** Path shown before the slug, e.g. "/urunler/". */
  prefix?: string;
  /**
   * Start in automatic mode (follow `source`). Default: only when the slug is empty (new records),
   * so renaming a published item never changes its address by surprise.
   */
  auto?: boolean;
  /** The saved slug: when the value differs, a note explains that the old address will redirect. */
  original?: string | null;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
};

/** Keeps a trailing hyphen while typing ("lavanta-" → next word), otherwise the Turkish slug rules. */
function liveSlug(text: string): string {
  const slug = slugify(text, SLUG_MAX_LENGTH);
  return slug && /[-\s_]$/.test(text) ? `${slug}-` : slug;
}

/** URL slug: generated from the Turkish name until edited by hand ("Addan üret" switches back). */
export default function SlugInput({
  value,
  onChange,
  source,
  prefix,
  auto: autoInitial,
  original,
  invalid,
  disabled,
  id,
  className,
}: SlugInputProps) {
  const slug = value ?? "";
  const [auto, setAuto] = useState(() => autoInitial ?? !slug);
  const control = useFieldControl({ id, invalid });
  const generated = slugify(source, SLUG_MAX_LENGTH);

  useEffect(() => {
    if (auto && !disabled && generated !== slug) onChange(generated);
    // Only the name drives automatic mode; `slug`/`onChange` are read fresh on each run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, generated, disabled]);

  const changed = original != null && original !== "" && slug !== original;

  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className={controlGroupClass}>
        {prefix ? (
          <span className={cn(affixClass, "max-w-[45%] truncate border-e border-border font-mono font-normal")} title={prefix}>
            {prefix}
          </span>
        ) : null}
        <input
          type="text"
          {...control}
          value={slug}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          maxLength={SLUG_MAX_LENGTH + 1}
          onChange={(event) => {
            setAuto(false);
            onChange(liveSlug(event.target.value));
          }}
          onBlur={() => {
            const clean = slugify(slug, SLUG_MAX_LENGTH);
            if (clean !== slug) onChange(clean);
          }}
          className={cn(groupInputClass, "h-10 font-mono text-[0.8125rem]")}
        />
        {auto ? (
          <span className={cn(affixClass, "border-s border-border bg-gold/10 text-[0.6875rem] uppercase tracking-[0.12em] text-gold-text")}>
            Otomatik
          </span>
        ) : (
          <button
            type="button"
            disabled={disabled || !generated}
            onClick={() => {
              setAuto(true);
              onChange(generated);
            }}
            title="Kısa adı Türkçe addan yeniden üret ve ad değiştikçe güncelle"
            className="flex shrink-0 items-center gap-1.5 border-s border-border bg-surface-2/70 px-3 text-xs font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <WandSparkles aria-hidden className="size-3.5 text-text-muted" />
            Addan üret
          </button>
        )}
      </div>
      {changed ? (
        <p className="flex items-start gap-1.5 text-xs text-text-muted">
          <Info aria-hidden className="mt-px size-3.5 shrink-0 text-gold-text" />
          Kaydettiğinizde eski adres ({`${prefix ?? "/"}${original}`}) yeni adrese kalıcı olarak yönlendirilir.
        </p>
      ) : null}
    </div>
  );
}
