"use client";
// SEO Kontrol report: status and language filters, then one card per page kind with every page and
// its three language rows (status badge, title/description preview, reasons, editor link). Read-only.
import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Pencil, SearchX } from "lucide-react";
import EmptyState from "@/components/panel/EmptyState";
import type { Tone } from "@/components/panel/labels";
import StatusBadge from "@/components/panel/StatusBadge";
import { buttonClass } from "@/components/panel/ui/styles";
import type { Locale } from "@/i18n/locales";
import {
  SEO_KIND_LABELS,
  SEO_LIMITS,
  SEO_STATUS_LABELS,
  seoLength,
  type SeoPageKind,
  type SeoReport,
  type SeoRow,
  type SeoSeverity,
  type SeoStatus,
} from "@/lib/panel/seo/rules";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | SeoStatus;
type LocaleFilter = "all" | Locale;

const STATUS_TONE: Record<SeoStatus, Tone> = { missing: "danger", improve: "warning", good: "success" };
const STATUS_ORDER: SeoStatus[] = ["missing", "improve", "good"];
const KIND_ORDER: SeoPageKind[] = ["home", "products", "category", "product", "page", "post"];
const LOCALE_LABELS: Record<Locale, string> = { tr: "TR", en: "EN", ar: "AR" };
const SEVERITY_DOT: Record<SeoSeverity, string> = {
  error: "bg-[#C2413A]",
  warning: "bg-[#D68A12]",
  info: "bg-text-muted/60",
};
const SEVERITY_SR: Record<SeoSeverity, string> = { error: "Eksik:", warning: "Geliştirilebilir:", info: "Not:" };
const OVERALL_DOT: Record<SeoStatus, string> = { missing: "bg-[#C2413A]", improve: "bg-[#D68A12]", good: "bg-[#2F8F5B]" };

const worst = (rows: readonly SeoRow[]): SeoStatus => STATUS_ORDER.find((s) => rows.some((r) => r.status === s)) ?? "good";

function Count({ n, min, max }: { n: number; min: number; max: number }) {
  const ok = n >= min && n <= max;
  return (
    <span className={cn("ms-1.5 whitespace-nowrap text-[0.6875rem] tabular-nums", ok ? "text-text-muted" : "text-[#B5730C] dark:text-[#E9B45C]")}>
      {n} krk.
    </span>
  );
}

function LocaleRow({ row }: { row: SeoRow }) {
  const rtl = row.locale === "ar";
  const titleLength = seoLength(row.title);
  const descriptionLength = seoLength(row.description);
  return (
    <li className="grid gap-3 px-5 py-4 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-4">
      <div className="flex items-center gap-2 sm:flex-col sm:items-start">
        <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-text-muted">
          {LOCALE_LABELS[row.locale]}
        </span>
        <StatusBadge tone={STATUS_TONE[row.status]}>{SEO_STATUS_LABELS[row.status]}</StatusBadge>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="min-w-0" lang={row.locale} dir={rtl ? "rtl" : "ltr"}>
          <p className="flex min-w-0 items-baseline text-sm text-text">
            <span className="truncate font-medium">{row.fullTitle || "(başlık yok)"}</span>
            {titleLength ? <Count n={titleLength} min={SEO_LIMITS.title.min} max={SEO_LIMITS.title.max} /> : null}
          </p>
          <p className="mt-0.5 flex min-w-0 items-baseline text-xs text-text-muted">
            <span className="line-clamp-1">{row.description || "(açıklama yok)"}</span>
            {descriptionLength ? <Count n={descriptionLength} min={SEO_LIMITS.description.min} max={SEO_LIMITS.description.max} /> : null}
          </p>
        </div>
        {row.findings.length > 0 ? (
          <ul className="space-y-1">
            {row.findings.map((f) => (
              <li key={`${f.code}-${f.message}`} className={cn("flex items-start gap-2 text-xs leading-relaxed", f.severity === "info" ? "text-text-muted" : "text-text")}>
                <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", SEVERITY_DOT[f.severity])} />
                <span className="min-w-0">
                  <span className="sr-only">{SEVERITY_SR[f.severity]} </span>
                  {f.message}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-text-muted">Sorun bulunmadı.</p>
        )}
        <a
          href={row.path}
          target="_blank"
          rel="noopener"
          className="inline-flex max-w-full items-center gap-1 rounded text-[0.6875rem] text-text-muted underline-offset-4 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="truncate" dir="ltr">
            {row.path}
          </span>
          <ExternalLink aria-hidden className="size-3 shrink-0" />
          <span className="sr-only">(sitede yeni sekmede açılır)</span>
        </a>
      </div>
    </li>
  );
}

function FilterButton({
  pressed,
  onClick,
  children,
  className,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        pressed ? "bg-surface text-text shadow-[0_1px_2px_rgb(3_38_95/0.08)]" : "text-text-muted hover:text-text",
        className,
      )}
    >
      {children}
    </button>
  );
}

export default function SeoReportView({ report, locales }: { report: SeoReport; locales: readonly Locale[] }) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [locale, setLocale] = useState<LocaleFilter>("all");

  const inLocale = useMemo(() => report.rows.filter((r) => locale === "all" || r.locale === locale), [report.rows, locale]);
  const counts = useMemo(() => {
    const out: Record<SeoStatus, number> = { missing: 0, improve: 0, good: 0 };
    for (const row of inLocale) out[row.status] += 1;
    return out;
  }, [inLocale]);

  const groups = useMemo(() => {
    const visible = inLocale.filter((r) => status === "all" || r.status === status);
    return KIND_ORDER.map((kind) => {
      const entities = new Map<string, SeoRow[]>();
      for (const row of visible) {
        if (row.kind !== kind) continue;
        entities.set(row.key, [...(entities.get(row.key) ?? []), row]);
      }
      return { kind, entities: [...entities.values()] };
    }).filter((g) => g.entities.length > 0);
  }, [inLocale, status]);

  const total = inLocale.length;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(status === s ? "all" : s)}
            className={cn(
              "rounded-xl border bg-surface p-4 text-start shadow-[0_1px_2px_rgb(3_38_95/0.04)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              status === s ? "border-gold/60 ring-1 ring-gold/40" : "border-border hover:border-gold/40",
            )}
          >
            <StatusBadge tone={STATUS_TONE[s]}>{SEO_STATUS_LABELS[s]}</StatusBadge>
            <p className="mt-3 font-heading text-3xl leading-none text-text tabular-nums">{counts[s]}</p>
            <p className="mt-1.5 text-xs text-text-muted">
              {total ? `${total} sayfa-dil satırından` : "Satır yok"}
              {status === s ? " · filtre açık" : ""}
            </p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Durum" className="inline-flex flex-wrap rounded-lg border border-border bg-surface-2/60 p-0.5">
          <FilterButton pressed={status === "all"} onClick={() => setStatus("all")}>
            Tüm durumlar
          </FilterButton>
          {STATUS_ORDER.map((s) => (
            <FilterButton key={s} pressed={status === s} onClick={() => setStatus(s)}>
              {SEO_STATUS_LABELS[s]}
            </FilterButton>
          ))}
        </div>
        <div role="group" aria-label="Dil" className="inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5">
          <FilterButton pressed={locale === "all"} onClick={() => setLocale("all")}>
            Tüm diller
          </FilterButton>
          {locales.map((l) => (
            <FilterButton key={l} pressed={locale === l} onClick={() => setLocale(l)}>
              {LOCALE_LABELS[l]}
            </FilterButton>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={SearchX}
            title="Bu filtreye uyan sayfa yok"
            description={status === "good" ? "Henüz tamamen iyi durumda bir sayfa yok." : "Başka bir durum veya dil seçin."}
          />
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.kind} aria-labelledby={`seo-kind-${group.kind}`} className="min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]">
            <header className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-4">
              <h2 id={`seo-kind-${group.kind}`} className="text-sm font-semibold text-text">
                {SEO_KIND_LABELS[group.kind]}
              </h2>
              <span className="text-xs text-text-muted tabular-nums">{group.entities.length}</span>
            </header>
            <div className="divide-y divide-border">
              {group.entities.map((rows) => {
                const first = rows[0];
                const overall = worst(rows);
                return (
                  <article key={first.key} aria-label={first.label}>
                    <div className="flex items-center gap-3 bg-surface-2/40 px-5 py-2.5">
                      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", OVERALL_DOT[overall])} />
                      <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-text">{first.label}</h3>
                      <Link href={first.editHref} className={buttonClass("secondary", "sm")} aria-label={`Düzenle: ${first.label}`}>
                        <Pencil aria-hidden className="size-3.5" />
                        Düzenle
                      </Link>
                    </div>
                    <ul className="divide-y divide-border/70">
                      {rows.map((row) => (
                        <LocaleRow key={`${row.key}-${row.locale}`} row={row} />
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
