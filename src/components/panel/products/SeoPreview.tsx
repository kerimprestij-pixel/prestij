"use client";
// Google-style search result preview (title, URL breadcrumb, description) per locale.
import { useState } from "react";
import type { Locale } from "@/db/schema/common";
import { cn } from "@/lib/utils";

const LOCALES: { value: Locale; label: string }[] = [
  { value: "tr", label: "TR" },
  { value: "en", label: "EN" },
  { value: "ar", label: "AR" },
];

const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 160;

function cut(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

export type SeoPreviewData = { title: string; description: string; url: string; noIndex?: boolean };

/** `build(locale)` returns what the storefront would render for that locale. */
export default function SeoPreview({ build }: { build: (locale: Locale) => SeoPreviewData }) {
  const [locale, setLocale] = useState<Locale>("tr");
  const data = build(locale);
  let host = data.url;
  let crumbs: string[] = [];
  try {
    const u = new URL(data.url);
    host = u.host;
    crumbs = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    // keep the raw value
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-text-muted">Arama sonucu önizlemesi</p>
        <div role="group" aria-label="Önizleme dili" className="inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5">
          {LOCALES.map((l) => (
            <button
              key={l.value}
              type="button"
              aria-pressed={locale === l.value}
              onClick={() => setLocale(l.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                locale === l.value ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div dir={locale === "ar" ? "rtl" : "ltr"} lang={locale} className="rounded-xl border border-border bg-white p-4 text-start font-[Arial,sans-serif] shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
        <p className="truncate text-xs text-[#202124]">
          {host}
          {crumbs.length ? <span className="text-[#4d5156]"> › {crumbs.join(" › ")}</span> : null}
        </p>
        <p className="mt-1 text-lg leading-snug text-[#1a0dab]">{cut(data.title || "Başlık", TITLE_LIMIT)}</p>
        <p className="mt-1 text-sm leading-relaxed text-[#4d5156]">{data.description ? cut(data.description, DESCRIPTION_LIMIT) : <em>Açıklama yok: arama motoru sayfadan bir metin seçer.</em>}</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-text-muted">
        <span className={data.title.length > TITLE_LIMIT ? "text-[#8A5A0B] dark:text-[#F0B85A]" : undefined}>
          Başlık {data.title.length}/{TITLE_LIMIT}
        </span>
        <span className={data.description.length > DESCRIPTION_LIMIT ? "text-[#8A5A0B] dark:text-[#F0B85A]" : undefined}>
          Açıklama {data.description.length}/{DESCRIPTION_LIMIT}
        </span>
        {data.noIndex ? <span className="font-medium text-text">Arama motorlarından gizli (noindex)</span> : null}
      </div>
    </div>
  );
}
