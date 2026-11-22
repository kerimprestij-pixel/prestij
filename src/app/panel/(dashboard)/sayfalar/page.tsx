import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileText, House, Lock, Scale } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import NewPageButton from "@/components/panel/sections/NewPageButton";
import { TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { PAGE_GROUPS, canDeletePage, pageKindLabel, pageGroup, pageSitePath, pageSortRank, type PageGroupKey } from "@/lib/panel/content/pages";
import { listPanelPages, type PanelPageRow } from "@/lib/panel/content/queries";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sayfalar & Bölümler" };

export default function PagesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="İçerik ve Görünüm"
        title="Sayfalar & Bölümler"
        description="Ana sayfayı ve diğer sayfaları hazır bölümlerden oluşturun: sıralayın, gizleyin, zamanlayın ve metinlerini üç dilde düzenleyin."
        actions={<NewPageButton />}
      />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <PagesList />
      </Suspense>
    </div>
  );
}

async function PagesList() {
  await requireStaff("editor");
  const rows = await listPanelPages();
  const groups = PAGE_GROUPS.map((group) => ({
    ...group,
    rows: rows
      .filter((row) => pageGroup(row) === group.key)
      .sort((a, b) => pageSortRank(a) - pageSortRank(b) || a.title.tr.localeCompare(b.title.tr, "tr")),
  }));

  return (
    <div className="space-y-6">
      {groups.map((group) =>
        group.rows.length === 0 && group.key !== "custom" ? null : (
          <Card key={group.key} title={group.title} description={group.description} flush>
            {group.rows.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="Henüz özel sayfa yok"
                description="Hakkımızda, kampanya veya bilgilendirme sayfası gibi yeni bir sayfa oluşturun; hazır bölümlerle dakikalar içinde yayına alın."
                action={<NewPageButton />}
              />
            ) : (
              <PagesTable rows={group.rows} group={group.key} />
            )}
          </Card>
        ),
      )}
    </div>
  );
}

const GROUP_ICON: Record<PageGroupKey, typeof FileText> = { site: House, custom: FileText, legal: Scale };

function PagesTable({ rows, group }: { rows: PanelPageRow[]; group: PageGroupKey }) {
  const Icon = GROUP_ICON[group];
  return (
    <>
      {/* Phones: one tappable block per page. */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/panel/sayfalar/${row.id}`}
              className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
            >
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-gold-text">
                <Icon aria-hidden className="size-4" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium text-text">{row.title.tr}</span>
                  <StatusBadge tone={row.isPublished ? "success" : "warning"}>{row.isPublished ? "Yayında" : "Taslak"}</StatusBadge>
                </span>
                <span className="mt-0.5 block truncate font-mono text-xs text-text-muted">{pageSitePath(row)}</span>
                <span className="mt-1 block text-xs text-text-muted">
                  {pageKindLabel(row)} · {sectionCountLabel(row)} · {formatDateTime(row.updatedAt)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="relative hidden overflow-x-auto md:block">
        <table className={cn(tableClass, "min-w-[44rem]")}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={thClass}>Sayfa</th>
              <th scope="col" className={thClass}>Tür</th>
              <th scope="col" className={cn(thClass, "text-end")}>Bölüm</th>
              <th scope="col" className={thClass}>Durum</th>
              <th scope="col" className={cn(thClass, "text-end")}>Güncellendi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={cn(trClass, "relative")}>
                <td className={tdClass}>
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-gold-text">
                      <Icon aria-hidden className="size-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <Link
                        href={`/panel/sayfalar/${row.id}`}
                        className="font-medium text-text underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-offset-[-2px] focus-visible:before:outline-ring"
                      >
                        {row.title.tr}
                      </Link>
                      <span className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-text-muted">
                        {pageSitePath(row)}
                        {!canDeletePage(row) ? (
                          <span title="Sabit sayfa: adresi değiştirilemez, silinemez.">
                            <Lock aria-hidden className="size-3" />
                            <span className="sr-only">(sabit sayfa)</span>
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                </td>
                <td className={cn(tdClass, "whitespace-nowrap text-text-muted")}>{pageKindLabel(row)}</td>
                <td className={cn(tdClass, "whitespace-nowrap text-end tabular-nums")}>{sectionCountLabel(row)}</td>
                <td className={tdClass}>
                  <StatusBadge tone={row.isPublished ? "success" : "warning"}>{row.isPublished ? "Yayında" : "Taslak"}</StatusBadge>
                </td>
                <td className={cn(tdClass, "whitespace-nowrap text-end text-text-muted")}>
                  <time dateTime={row.updatedAt}>{formatDateTime(row.updatedAt)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function sectionCountLabel(row: PanelPageRow): string {
  if (row.sectionCount === 0) return "Boş";
  const hidden = row.sectionCount - row.visibleCount;
  return hidden > 0 ? `${formatNumber(row.sectionCount)} bölüm (${formatNumber(hidden)} gizli)` : `${formatNumber(row.sectionCount)} bölüm`;
}
