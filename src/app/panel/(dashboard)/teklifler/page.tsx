import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileText, SearchX } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import { quoteStatusFromParam, requestListHref, statusBadge, type RequestListFilter } from "@/components/panel/requests/labels";
import { RequestPagination, RequestSearch, StatusTabs } from "@/components/panel/requests/RequestListParts";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { formatTryAmount } from "@/lib/panel/format";
import { listQuoteRequests, type QuoteListRow } from "@/lib/requests/queries";
import { QUOTE_STATUSES } from "@/lib/requests/types";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Teklif Talepleri" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const BASE = "/panel/teklifler";

export default function QuotesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Satış"
        title="Teklif Talepleri"
        description="Kurumsal sayfasındaki formdan gelen toplu alım talepleri. Bir talebi açıp birim fiyatları girin ve teklifi müşterinin dilinde e-postayla gönderin."
      />
      <Suspense fallback={<ListFallback />}>
        <QuotesView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function ListFallback() {
  return (
    <>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full max-w-xl rounded-lg" />
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
      </div>
      <TableSkeleton rows={6} />
    </>
  );
}

async function QuotesView({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff();
  const params = await searchParams;
  const status = quoteStatusFromParam(first(params.durum));
  const filter: RequestListFilter = { status, q: (first(params.ara) ?? "").trim().slice(0, 100) };
  const pageParam = Number(first(params.sayfa));
  const list = await listQuoteRequests({ status, q: filter.q, page: Number.isSafeInteger(pageParam) ? pageParam : 1 });
  const title = filter.q ? `“${filter.q}” için ${formatNumber(list.total)} sonuç` : `${formatNumber(list.total)} talep`;

  return (
    <>
      <div className="flex flex-col gap-3">
        <StatusTabs base={BASE} statuses={QUOTE_STATUSES} filter={filter} counts={list.counts} label="Talep durumu" />
        <RequestSearch key={`${filter.status}:${filter.q}`} base={BASE} filter={filter} label="Teklif taleplerinde ara" placeholder="Firma, kişi, e-posta, telefon, TKL-…" />
      </div>
      <Card title={title} description={filter.status ? `${statusBadge(filter.status).label} · en yeni en üstte` : "En yeni talep en üstte"} flush>
        {list.rows.length === 0 ? (
          <EmptyQuotes filter={filter} anyRequests={list.counts.all > 0 || Boolean(filter.q)} />
        ) : (
          <>
            <ul className="divide-y divide-border" aria-label="Teklif talepleri">
              {list.rows.map((row) => (
                <QuoteRow key={row.id} row={row} />
              ))}
            </ul>
            <RequestPagination base={BASE} filter={filter} page={list.page} pageCount={list.pageCount} pageSize={list.pageSize} total={list.total} />
          </>
        )}
      </Card>
    </>
  );
}

function QuoteRow({ row }: { row: QuoteListRow }) {
  const status = statusBadge(row.status);
  const isNew = row.status === "new";
  return (
    <li>
      <Link
        href={`${BASE}/${row.id}`}
        className={cn(
          "group flex gap-3 px-4 py-4 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:gap-4 sm:px-5",
          isNew && "bg-gold/[0.04]",
        )}
      >
        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", isNew ? "bg-gold" : "bg-transparent")} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={cn("min-w-0 truncate text-sm text-text", isNew && "font-semibold")}>{row.companyName}</span>
            <time dateTime={row.createdAt} className="shrink-0 text-xs tabular-nums text-text-muted">
              {formatDateTime(row.createdAt)}
            </time>
          </span>
          <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            <span className="font-mono text-xs text-text-muted">{row.reference}</span>
            {row.locale !== "tr" ? (
              <span className="rounded border border-border px-1.5 text-[0.6875rem] font-medium uppercase leading-5 text-text-muted">{row.locale}</span>
            ) : null}
            <span className="min-w-0 truncate text-xs text-text-muted">
              {row.contactName} · <span dir="ltr">{row.email}</span>
            </span>
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-text-muted">
            <span>
              {formatNumber(row.lineCount)} kalem · {formatNumber(row.totalQuantity)} adet
            </span>
            {row.offerTotal !== null ? <span className="font-medium text-text tabular-nums">Teklif: {formatTryAmount(row.offerTotal, { symbol: true })}</span> : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

function EmptyQuotes({ filter, anyRequests }: { filter: RequestListFilter; anyRequests: boolean }) {
  const linkClass = "text-sm font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  if (filter.q) {
    return (
      <EmptyState
        icon={SearchX}
        title="Sonuç bulunamadı"
        description={`“${filter.q}” ile eşleşen talep yok. Firma adını, kişiyi, e-postayı, telefonun son hanelerini ya da TKL numarasını deneyin.`}
        action={
          <Link href={requestListHref(BASE, { status: filter.status })} className={linkClass}>
            Aramayı temizle
          </Link>
        }
      />
    );
  }
  if (!anyRequests) {
    return (
      <EmptyState
        icon={FileText}
        title="Henüz teklif talebi yok"
        description="İşletmeler Kurumsal sayfasındaki teklif formunu gönderdiğinde talepler burada listelenir ve yöneticilere e-posta gider."
        action={
          <a href="/tr/kurumsal#teklif" target="_blank" rel="noopener noreferrer" className={linkClass}>
            Teklif formunu aç
          </a>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={FileText}
      title="Bu durumda talep yok"
      description="Başka bir durum seçin veya tüm taleplere dönün."
      action={
        <Link href={BASE} className={linkClass}>
          Tüm talepler
        </Link>
      }
    />
  );
}
