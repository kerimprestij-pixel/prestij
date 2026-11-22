import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FlaskConical, SearchX } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import { requestListHref, sampleStatusFromParam, statusBadge, type RequestListFilter } from "@/components/panel/requests/labels";
import { RequestPagination, RequestSearch, StatusTabs } from "@/components/panel/requests/RequestListParts";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { listSampleRequests, type SampleListRow } from "@/lib/requests/queries";
import { SAMPLE_STATUSES } from "@/lib/requests/types";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Numune Talepleri" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const BASE = "/panel/numune-talepleri";

export default function SamplesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Satış"
        title="Numune Talepleri"
        description="Numune sayfasındaki formdan gelen ücretsiz numune talepleri. Onaylayın, kargo bilgisiyle gönderin ve sonucu işaretleyin; her adımda müşteriye e-posta gider."
      />
      <Suspense fallback={<ListFallback />}>
        <SamplesView searchParams={searchParams} />
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

async function SamplesView({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff();
  const params = await searchParams;
  const status = sampleStatusFromParam(first(params.durum));
  const filter: RequestListFilter = { status, q: (first(params.ara) ?? "").trim().slice(0, 100) };
  const pageParam = Number(first(params.sayfa));
  const list = await listSampleRequests({ status, q: filter.q, page: Number.isSafeInteger(pageParam) ? pageParam : 1 });
  const title = filter.q ? `“${filter.q}” için ${formatNumber(list.total)} sonuç` : `${formatNumber(list.total)} talep`;

  return (
    <>
      <div className="flex flex-col gap-3">
        <StatusTabs base={BASE} statuses={SAMPLE_STATUSES} filter={filter} counts={list.counts} label="Talep durumu" />
        <RequestSearch key={`${filter.status}:${filter.q}`} base={BASE} filter={filter} label="Numune taleplerinde ara" placeholder="Firma, kişi, e-posta, telefon, NMN-…" />
      </div>
      <Card title={title} description={filter.status ? `${statusBadge(filter.status).label} · en yeni en üstte` : "En yeni talep en üstte"} flush>
        {list.rows.length === 0 ? (
          <EmptySamples filter={filter} anyRequests={list.counts.all > 0 || Boolean(filter.q)} />
        ) : (
          <>
            <ul className="divide-y divide-border" aria-label="Numune talepleri">
              {list.rows.map((row) => (
                <SampleRow key={row.id} row={row} />
              ))}
            </ul>
            <RequestPagination base={BASE} filter={filter} page={list.page} pageCount={list.pageCount} pageSize={list.pageSize} total={list.total} />
          </>
        )}
      </Card>
    </>
  );
}

function SampleRow({ row }: { row: SampleListRow }) {
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
              {row.contactName} · {row.city}
            </span>
          </span>
          <span className="mt-2 flex flex-wrap gap-1.5">
            {row.products.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-text">
                <span aria-hidden className="size-2 rounded-full bg-surface-2" style={p.accent ? { backgroundColor: p.accent } : undefined} />
                {p.name}
              </span>
            ))}
          </span>
        </span>
      </Link>
    </li>
  );
}

function EmptySamples({ filter, anyRequests }: { filter: RequestListFilter; anyRequests: boolean }) {
  const linkClass = "text-sm font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  if (filter.q) {
    return (
      <EmptyState
        icon={SearchX}
        title="Sonuç bulunamadı"
        description={`“${filter.q}” ile eşleşen talep yok. Firma adını, kişiyi, e-postayı, telefonun son hanelerini ya da NMN numarasını deneyin.`}
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
        icon={FlaskConical}
        title="Henüz numune talebi yok"
        description="İşletmeler Numune sayfasındaki formu gönderdiğinde talepler burada listelenir ve yöneticilere e-posta gider."
        action={
          <a href="/tr/numune#numune-formu" target="_blank" rel="noopener noreferrer" className={linkClass}>
            Numune formunu aç
          </a>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={FlaskConical}
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
