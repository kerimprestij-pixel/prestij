// Small shared pieces of the B2B panel pages (server-safe: no hooks): the Firmalar / Müşteri Grupları
// section tabs, pagination, a definition-list row and Turkish formatters.
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LocalizedText } from "@/db/schema/common";
import { formatNumber } from "@/components/panel/labels";
import { cn } from "@/lib/utils";

/** Turkish name of a group (falls back to the slug). */
export function groupLabel(name: LocalizedText | null | undefined, fallback = "—"): string {
  return name?.tr?.trim() || fallback;
}

export const BACK_LINK_CLASS =
  "inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const DT_CLASS = "text-xs font-medium uppercase tracking-[0.12em] text-text-muted";
export const DD_CLASS = "mt-1 text-sm text-text break-words";

export function DetailRow({ label, children, ltr }: { label: string; children: React.ReactNode; ltr?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className={DT_CLASS}>{label}</dt>
      <dd className={DD_CLASS} dir={ltr ? "ltr" : undefined}>
        {children ?? <span className="text-text-muted">—</span>}
      </dd>
    </div>
  );
}

/** "Firmalar | Müşteri Grupları" under the page header of Kurumsal Hesaplar. */
export function B2bSectionTabs({ current, pending }: { current: "companies" | "groups"; pending?: number }) {
  const tabs = [
    { key: "companies" as const, label: "Firmalar", href: "/panel/kurumsal-hesaplar", badge: pending },
    { key: "groups" as const, label: "Müşteri Grupları", href: "/panel/kurumsal-hesaplar/gruplar" },
  ];
  return (
    <nav aria-label="Kurumsal hesap bölümleri" className="border-b border-border">
      <ul className="-mb-px flex gap-6">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 border-b-2 pb-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active ? "border-brand font-medium text-text dark:border-gold" : "border-transparent text-text-muted hover:text-text",
                )}
              >
                {tab.label}
                {tab.badge ? (
                  <span className="min-w-5 rounded-full bg-gold/20 px-1.5 text-center text-xs font-semibold tabular-nums text-text">
                    {formatNumber(tab.badge)}
                    <span className="sr-only"> bekleyen</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  noun,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  noun: string;
  hrefFor: (page: number) => string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkClass =
    "inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring";
  const disabledClass = "inline-flex h-9 cursor-not-allowed items-center gap-1 rounded-lg border border-border px-3 text-sm text-text-muted opacity-50";
  return (
    <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <p className="text-sm text-text-muted">
        <span className="tabular-nums">
          {formatNumber(from)}–{formatNumber(to)}
        </span>{" "}
        / <span className="tabular-nums">{formatNumber(total)}</span> {noun}
      </p>
      {pageCount > 1 ? (
        <div className="flex gap-2">
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} rel="prev" className={linkClass}>
              <ChevronLeft aria-hidden className="size-4" />
              Önceki
            </Link>
          ) : (
            <span aria-disabled="true" className={disabledClass}>
              <ChevronLeft aria-hidden className="size-4" />
              Önceki
            </span>
          )}
          {page < pageCount ? (
            <Link href={hrefFor(page + 1)} rel="next" className={linkClass}>
              Sonraki
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : (
            <span aria-disabled="true" className={disabledClass}>
              Sonraki
              <ChevronRight aria-hidden className="size-4" />
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}

/** "Kurumsal (%15 indirim)" */
export function groupSummary(group: { name: LocalizedText; discountPercent: number; isBusiness?: boolean }): string {
  const name = groupLabel(group.name);
  return group.discountPercent > 0 ? `${name} (%${group.discountPercent} indirim)` : name;
}

/** "30 gün vadeli" / "Vadeli ödeme yok" */
export function termsLabel(terms: { allowDeferred?: boolean; days?: number } | null | undefined): string {
  return terms?.allowDeferred && terms.days ? `${terms.days} gün vadeli` : "Vadeli ödeme yok";
}

export const EMAIL_STATUS_LABEL: Record<string, string> = {
  queued: "Sırada",
  sending: "Gönderiliyor",
  sent: "Gönderildi",
  failed: "Gönderilemedi",
  cancelled: "İptal edildi",
};
