"use client";
// Shared bits for the product editor tabs.
import type { PanelForm } from "@/components/panel/form/usePanelForm";
import type { MediaLike } from "@/lib/media/types";
import type { ProductEditorContext, ProductEditorState } from "@/lib/panel/products/types";
import { cn } from "@/lib/utils";

export type MediaLookup = {
  get: (id: number | null | undefined) => MediaLike | undefined;
  add: (items: readonly MediaLike[]) => void;
};

export type TabProps = {
  form: PanelForm<ProductEditorState>;
  ctx: ProductEditorContext;
  media: MediaLookup;
};

/** A titled block inside a tab. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-surface", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          {description ? <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className="space-y-5 p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** Amber hint (non-blocking warning) under a field. */
export function Warning({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-[#8A5A0B] dark:text-[#F0B85A]", className)}>
      <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-[#D68A12]" />
      <span>{children}</span>
    </p>
  );
}

/** Three plain inputs (TR / EN / AR) in one row: compact alternative to LocalizedInput for table-like rows. */
export function TriLingualRow({
  value,
  onChange,
  label,
  errors,
  maxLength = 80,
  namePrefix,
}: {
  value: { tr: string; en?: string; ar?: string };
  onChange: (next: { tr: string; en?: string; ar?: string }) => void;
  label: string;
  errors?: { tr?: string; en?: string; ar?: string };
  maxLength?: number;
  namePrefix?: string;
}) {
  const set = (locale: "tr" | "en" | "ar", text: string) => {
    const next = { ...value, [locale]: text };
    if (locale !== "tr" && !text) delete next[locale];
    onChange(next);
  };
  const cell = (locale: "tr" | "en" | "ar", short: string, placeholder: string) => {
    const error = errors?.[locale];
    const id = namePrefix ? `${namePrefix}.${locale}` : undefined;
    return (
      <div className="min-w-0">
        <label className="sr-only" htmlFor={id}>
          {label} ({short})
        </label>
        <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-surface focus-within:border-brand focus-within:ring-4 focus-within:ring-gold/20 has-[[aria-invalid=true]]:border-[#B3261E] dark:has-[[aria-invalid=true]]:border-[#F28B82]">
          <span aria-hidden className="flex w-9 shrink-0 items-center justify-center bg-surface-2/70 text-[0.625rem] font-semibold uppercase tracking-wider text-text-muted">
            {short}
          </span>
          <input
            id={id}
            name={id}
            value={value[locale] ?? ""}
            onChange={(e) => set(locale, e.target.value)}
            maxLength={maxLength}
            placeholder={placeholder}
            dir={locale === "ar" ? "rtl" : undefined}
            lang={locale}
            aria-invalid={error ? true : undefined}
            aria-required={locale === "tr" ? true : undefined}
            className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-sm text-text placeholder:text-text-muted/60 focus:outline-none"
          />
        </div>
        {error ? <p className="mt-1 text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{error}</p> : null}
      </div>
    );
  };
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-3">
      {cell("tr", "TR", label)}
      {cell("en", "EN", "English")}
      {cell("ar", "AR", "العربية")}
    </div>
  );
}

/** First error in an object of dotted-path errors, or undefined. */
export function firstError(errors: Record<string, string>): string | undefined {
  return Object.values(errors)[0];
}
