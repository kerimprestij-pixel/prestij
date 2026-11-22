"use client";
import { useId, useRef, useState } from "react";
import { CircleExclamationPoint, Copy } from "lucide-react";
import { errorClass, helpClass, labelClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";
import {
  generalError,
  hasText,
  LOCALE_LABELS,
  localeError,
  PANEL_LOCALES,
  setLocale,
  type Locale,
  type LocalizedErrors,
  type LocalizedText,
} from "./localized";

export type LocalizedShellProps = {
  label: React.ReactNode;
  value: LocalizedText | null | undefined;
  onChange: (value: LocalizedText) => void;
  help?: React.ReactNode;
  /** One message for the field, or per locale ({ en: "…" }) from dotted field errors. */
  error?: LocalizedErrors;
  /** Turkish is required (the mark only; the server validates). */
  required?: boolean;
  /** Treat values as HTML when deciding whether a locale is filled. */
  html?: boolean;
  /** Content shown at the end of the footer row (e.g. a character counter). */
  footerAside?: (locale: Locale, text: string) => React.ReactNode;
  /** Field path for focusing the first invalid field after a failed save. */
  name?: string;
  /** Visually hide the label (it stays the accessible name); the language tabs stay visible. */
  hideLabel?: boolean;
  className?: string;
  /** Renders the control for the active locale. */
  children: (ctx: {
    locale: Locale;
    text: string;
    setText: (text: string) => void;
    controlProps: {
      id: string;
      lang: string;
      dir: "ltr" | "rtl";
      "aria-describedby"?: string;
      "aria-invalid"?: true;
      "aria-labelledby": string;
    };
  }) => React.ReactNode;
};

/** Label row with TR/EN/AR tabs (filled-state dots), the control, "TR'den kopyala", error and help. */
export default function LocalizedShell({
  label,
  value,
  onChange,
  help,
  error,
  required = false,
  html = false,
  footerAside,
  name,
  hideLabel = false,
  className,
  children,
}: LocalizedShellProps) {
  const baseId = useId();
  const [active, setActive] = useState<Locale>("tr");
  const tabRefs = useRef(new Map<Locale, HTMLButtonElement>());

  // Jump to the first locale with an error when new errors arrive.
  const errorKey = error ? JSON.stringify(error) : "";
  const [seenErrorKey, setSeenErrorKey] = useState(errorKey);
  if (errorKey !== seenErrorKey) {
    setSeenErrorKey(errorKey);
    const first = PANEL_LOCALES.find((l) => localeError(error, l));
    if (first && !localeError(error, active)) setActive(first);
  }

  const text = value?.[active] ?? "";
  const activeError = localeError(error, active);
  const fieldError = generalError(error);
  const invalid = Boolean(activeError || fieldError);
  const trText = value?.tr ?? "";
  const ids = {
    label: `${baseId}-label`,
    localeName: `${baseId}-locale`,
    control: `${baseId}-${active}`,
    help: `${baseId}-help`,
    error: `${baseId}-error`,
  };
  const describedBy = [help ? ids.help : null, invalid ? ids.error : null].filter(Boolean).join(" ") || undefined;

  const setText = (next: string) => onChange(setLocale(value, active, next));

  const copyFromTr = () => {
    if (!hasText(trText, html)) return;
    if (hasText(text, html) && !window.confirm(`${LOCALE_LABELS[active].name} metnin yerine Türkçe metin yazılsın mı?`)) return;
    setText(trText);
  };

  const onTabKey = (event: React.KeyboardEvent) => {
    const index = PANEL_LOCALES.indexOf(active);
    let next: Locale | undefined;
    if (event.key === "ArrowRight") next = PANEL_LOCALES[(index + 1) % PANEL_LOCALES.length];
    else if (event.key === "ArrowLeft") next = PANEL_LOCALES[(index - 1 + PANEL_LOCALES.length) % PANEL_LOCALES.length];
    else if (event.key === "Home") next = PANEL_LOCALES[0];
    else if (event.key === "End") next = PANEL_LOCALES[PANEL_LOCALES.length - 1];
    if (!next) return;
    event.preventDefault();
    setActive(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div className={cn("min-w-0 space-y-1.5", className)} data-field={name}>
      <div className={cn("flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5", hideLabel && "justify-end")}>
        <label id={ids.label} htmlFor={ids.control} className={cn(labelClass, hideLabel && "sr-only")}>
          {label}
          {required ? (
            <span aria-hidden className="ms-0.5 text-[#B3261E] dark:text-[#F28B82]">
              *
            </span>
          ) : null}
          <span id={ids.localeName} className="sr-only">
            {` (${LOCALE_LABELS[active].name})`}
          </span>
        </label>
        <div
          role="tablist"
          aria-label="Dil"
          onKeyDown={onTabKey}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface-2/70 p-0.5"
        >
          {PANEL_LOCALES.map((locale) => {
            const selected = locale === active;
            const filled = hasText(value?.[locale], html);
            const hasError = Boolean(localeError(error, locale));
            const meta = LOCALE_LABELS[locale];
            return (
              <button
                key={locale}
                ref={(el) => {
                  if (el) tabRefs.current.set(locale, el);
                  else tabRefs.current.delete(locale);
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                title={meta.name}
                onClick={() => setActive(locale)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[0.6875rem] font-semibold tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring motion-reduce:transition-none",
                  selected ? "bg-surface text-text shadow-[0_1px_2px_rgb(3_38_95/0.08)]" : "text-text-muted hover:text-text",
                )}
              >
                {meta.short}
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    hasError ? "bg-[#C2413A]" : filled ? "bg-gold" : "border border-text-muted/60 bg-transparent",
                  )}
                />
                <span className="sr-only">
                  {meta.name}, {hasError ? "hatalı" : filled ? "dolu" : "boş"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={ids.label}>
        {children({
          locale: active,
          text,
          setText,
          controlProps: {
            id: ids.control,
            lang: LOCALE_LABELS[active].lang,
            dir: LOCALE_LABELS[active].dir,
            "aria-describedby": describedBy,
            "aria-invalid": invalid ? true : undefined,
            "aria-labelledby": `${ids.label}`,
          },
        })}
      </div>

      {active !== "tr" || footerAside ? (
        <div className="flex min-h-5 items-center justify-between gap-3">
          {active !== "tr" ? (
            <button
              type="button"
              onClick={copyFromTr}
              disabled={!hasText(trText, html)}
              className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Copy aria-hidden className="size-3.5" />
              TR&apos;den kopyala
            </button>
          ) : (
            <span />
          )}
          {footerAside ? <span className="text-xs tabular-nums text-text-muted">{footerAside(active, text)}</span> : null}
        </div>
      ) : null}

      {invalid ? (
        <p id={ids.error} className={cn(errorClass, "flex items-start gap-1.5")}>
          <CircleExclamationPoint aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            {activeError ?? fieldError}
          </span>
        </p>
      ) : null}
      {!invalid && PANEL_LOCALES.some((l) => localeError(error, l)) ? (
        <p className={cn(errorClass, "flex items-start gap-1.5")}>
          <CircleExclamationPoint aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>Diğer dillerde düzeltilmesi gereken alan var.</span>
        </p>
      ) : null}
      {help ? (
        <p id={ids.help} className={helpClass}>
          {help}
        </p>
      ) : null}
    </div>
  );
}
