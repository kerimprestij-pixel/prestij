"use client";
// Live preview of the storefront announcement bar in the three languages (Arabic right-to-left).
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { LocalizedText } from "@/db/schema/common";
import { ANNOUNCEMENT_VARIANT_CLASS, type AnnouncementVariantKey } from "@/lib/panel/content/announcements";
import { cn } from "@/lib/utils";

const ROWS = [
  { locale: "tr", label: "Türkçe", dir: "ltr" },
  { locale: "en", label: "İngilizce", dir: "ltr" },
  { locale: "ar", label: "Arapça", dir: "rtl" },
] as const;

export default function AnnouncementPreview({
  text,
  variant,
  hasLink,
  multiple = false,
}: {
  text: LocalizedText;
  variant: AnnouncementVariantKey;
  hasLink: boolean;
  /** Show the previous/next arrows (more than one active announcement). */
  multiple?: boolean;
}) {
  return (
    <div className="space-y-3" aria-label="Duyuru şeridi önizlemesi" role="group">
      {ROWS.map((row) => {
        const value = row.locale === "tr" ? text.tr : text[row.locale];
        const fallback = row.locale !== "tr" && !value;
        const shown = (fallback ? text.tr : value)?.trim();
        return (
          <div key={row.locale}>
            <p className="mb-1 flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-text-muted">
              {row.label}
              {fallback && shown ? <span className="normal-case tracking-normal">· çeviri yok, Türkçe metin gösterilir</span> : null}
            </p>
            <div className="overflow-hidden rounded-lg border border-border">
              <div dir={row.dir} lang={row.locale} className={cn("text-xs", ANNOUNCEMENT_VARIANT_CLASS[variant], variant === "neutral" && "border-b-0")}>
                <div className="flex min-h-10 items-center gap-2 px-3 py-1.5">
                  <span aria-hidden className="flex w-8 shrink-0 justify-start opacity-80">
                    {multiple ? <ChevronLeft className="size-4 rtl:rotate-180" strokeWidth={1.5} /> : null}
                  </span>
                  <p
                    className={cn(
                      "min-w-0 flex-1 text-center font-medium leading-snug tracking-[0.04em] rtl:tracking-normal",
                      hasLink && shown && "underline decoration-current/40 underline-offset-4",
                    )}
                  >
                    {shown || <span className="opacity-60">Duyuru metni</span>}
                  </p>
                  <span aria-hidden className="flex w-8 shrink-0 items-center justify-end gap-1 opacity-80">
                    {multiple ? <ChevronRight className="size-4 rtl:rotate-180" strokeWidth={1.5} /> : null}
                    <X className="size-3.5" strokeWidth={1.5} />
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
