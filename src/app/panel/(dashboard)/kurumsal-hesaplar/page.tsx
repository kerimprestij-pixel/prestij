import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { BriefcaseBusiness, ChevronRight, Search, SearchX, X } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { B2bSectionTabs, groupLabel, Pagination } from "@/components/panel/b2b/shared";
import { COMPANY_STATUS, formatDate, formatNumber } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { SECTOR_LABELS_TR } from "@/lib/b2b/application";
import { listCompanies, type CompanyList, type CompanyRow, type CompanyStatusFilter } from "@/lib/b2b/queries";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Kurumsal Hesaplar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** URL values of the status tabs (Turkish) → filter. Pending is the default tab. */
const STATUS_PARAM: Record<string, CompanyStatusFilter> = { bekleyen: "pending", onayli: "approved", reddedilen: "rejected", tumu: "all" };
const PARAM_OF: Record<CompanyStatusFilter, string> = { pending: "bekleyen", approved: "onayli", rejected: "reddedilen", all: "tumu" };

function listHref(filter: { status: CompanyStatusFilter; q?: string; page?: number }): string {
  const params = new URLSearchParams();
  if (filter.status !== "pending") params.set("durum", PARAM_OF[filter.status]);
  if (filter.q) params.set("ara", filter.q);
  if (filter.page && filter.page > 1) params.set("sayfa", String(filter.page));
  const query = params.toString();
  return `/panel/kurumsal-hesaplar${query ? `?${query}` : ""}`;
}

export default function CompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Satış"
        title="Kurumsal Hesaplar"
        description="Otel, spa, ofis ve restoran başvuruları. Onaylarken müşteri grubunu ve ödeme koşullarını seçersiniz; onaylanan firmanın üyeleri kurumsal fiyatları hemen görür."
      />
      <Suspense fallback={<ListFallback />}>
        <CompaniesView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function ListFallback() {
  return (
    <>
      <Skeleton className="h-9 w-64 rounded-lg" />
      <Skeleton className="h-10 w-full max-w-md rounded-lg" />
      <TableSkeleton rows={6} />
    </>
  );
}

async function CompaniesView({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff();
  const params = await searchParams;
  const status = STATUS_PARAM[first(params.durum) ?? ""] ?? "pending";
  const q = (first(params.ara) ?? "").trim().slice(0, 100);
  const pageParam = Number(first(params.sayfa));
  const list = await listCompanies({ status, q, page: Number.isSafeInteger(pageParam) ? pageParam : 1 });

  return (
    <>
      <B2bSectionTabs current="companies" pending={list.counts.pending} />
      <div className="flex flex-col gap-3">
        <StatusTabs status={status} q={q} counts={list.counts} />
        <SearchForm key={`${status}:${q}`} status={status} q={q} />
      </div>
      <CompaniesCard list={list} status={status} q={q} />
    </>
  );
}

function StatusTabs({ status, q, counts }: { status: CompanyStatusFilter; q: string; counts: CompanyList["counts"] }) {
  const tabs: { key: CompanyStatusFilter; label: string }[] = [
    { key: "pending", label: "Bekleyen" },
    { key: "approved", label: "Onaylı" },
    { key: "rejected", label: "Reddedilen" },
    { key: "all", label: "Tümü" },
  ];
  return (
    <nav aria-label="Başvuru durumu" className="relative -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg border border-border bg-surface p-1">
        {tabs.map((tab) => {
          const current = status === tab.key;
          const highlight = tab.key === "pending" && counts.pending > 0 && !current;
          return (
            <li key={tab.key}>
              <Link
                href={listHref({ status: tab.key, q })}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  current ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums",
                    current ? "bg-brand-contrast/15" : highlight ? "bg-gold/20 font-semibold text-text" : "bg-surface-2",
                  )}
                >
                  {formatNumber(counts[tab.key])}
                  <span className="sr-only"> firma</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SearchForm({ status, q }: { status: CompanyStatusFilter; q: string }) {
  return (
    <Form action="/panel/kurumsal-hesaplar" role="search" aria-label="Firmalarda ara" className="relative w-full max-w-md">
      {status !== "pending" ? <input type="hidden" name="durum" value={PARAM_OF[status]} /> : null}
      <label htmlFor="company-search" className="sr-only">
        Firma adı, vergi no, il, başvuran veya e-posta
      </label>
      <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      <input
        id="company-search"
        name="ara"
        type="search"
        defaultValue={q}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Firma, vergi no, il, başvuran…"
        className="h-10 w-full rounded-lg border border-border bg-surface ps-9 pe-20 text-sm text-text placeholder:text-text-muted/80 focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {q ? (
        <Link
          href={listHref({ status })}
          className="absolute end-11 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden className="size-4" />
          <span className="sr-only">Aramayı temizle</span>
        </Link>
      ) : null}
      <button
        type="submit"
        className="absolute end-1 top-1/2 grid h-8 w-9 -translate-y-1/2 place-items-center rounded-md bg-brand text-brand-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Search aria-hidden className="size-4" />
        <span className="sr-only">Ara</span>
      </button>
    </Form>
  );
}

const TITLES: Record<CompanyStatusFilter, string> = {
  pending: "onay bekleyen başvuru",
  approved: "onaylı firma",
  rejected: "reddedilen başvuru",
  all: "firma",
};

function CompaniesCard({ list, status, q }: { list: CompanyList; status: CompanyStatusFilter; q: string }) {
  const title = q ? `“${q}” için ${formatNumber(list.total)} sonuç` : `${formatNumber(list.total)} ${TITLES[status]}`;
  const description = status === "pending" ? "En eski başvuru en üstte" : status === "all" ? "Bekleyenler önce, sonra son değişenler" : "Son değişen en üstte";
  return (
    <Card title={title} description={description} flush>
      {list.rows.length === 0 ? (
        <EmptyCompanies status={status} q={q} />
      ) : (
        <>
          <ul className="divide-y divide-border" aria-label="Firmalar">
            {list.rows.map((row) => (
              <CompanyListRow key={row.id} row={row} />
            ))}
          </ul>
          <Pagination page={list.page} pageCount={list.pageCount} pageSize={list.pageSize} total={list.total} noun="firma" hrefFor={(page) => listHref({ status, q, page })} />
        </>
      )}
    </Card>
  );
}

function CompanyListRow({ row }: { row: CompanyRow }) {
  const status = COMPANY_STATUS[row.status];
  const meta = [SECTOR_LABELS_TR[row.sector], row.city, row.taxNumber ? `VKN ${row.taxNumber}` : null].filter(Boolean).join(" · ");
  return (
    <li>
      <Link
        href={`/panel/kurumsal-hesaplar/${row.id}`}
        className={cn(
          "group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:px-5",
          row.status === "pending" && "bg-gold/[0.04]",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 truncate text-sm font-semibold text-text">{row.name}</span>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </span>
          <span className="mt-1 block truncate text-xs text-text-muted">{meta}</span>
          <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            {row.applicant ? (
              <span className="min-w-0 truncate">
                Başvuran: <span className="text-text">{row.applicant.name}</span> <span dir="ltr">({row.applicant.email})</span>
              </span>
            ) : null}
            {row.status === "approved" ? (
              <span>
                {groupLabel(row.groupName, "Grup yok")} · {row.deferredDays ? `${row.deferredDays} gün vadeli` : "Peşin"}
              </span>
            ) : null}
            <span>
              {formatNumber(row.memberCount)} üye · {formatNumber(row.orderCount)} sipariş
            </span>
          </span>
        </span>
        <span className="hidden shrink-0 text-end text-xs text-text-muted sm:block">
          <span className="block">{row.status === "pending" ? "Başvuru" : "Güncelleme"}</span>
          <time dateTime={row.status === "pending" ? row.createdAt : row.updatedAt} className="tabular-nums text-text">
            {formatDate(row.status === "pending" ? row.createdAt : row.updatedAt)}
          </time>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

function EmptyCompanies({ status, q }: { status: CompanyStatusFilter; q: string }) {
  const linkClass = "text-sm font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  if (q) {
    return (
      <EmptyState
        icon={SearchX}
        title="Sonuç bulunamadı"
        description={`“${q}” ile eşleşen firma yok. Firma adını, vergi numarasını veya başvuranın e-postasını deneyin.`}
        action={
          <Link href={listHref({ status })} className={linkClass}>
            Aramayı temizle
          </Link>
        }
      />
    );
  }
  if (status === "pending") {
    return (
      <EmptyState
        icon={BriefcaseBusiness}
        title="Bekleyen başvuru yok"
        description="Müşteriler hesaplarındaki “Kurumsal hesap” sayfasından başvurduğunda başvurular burada sıralanır ve yöneticilere e-posta gider."
        action={
          <Link href={listHref({ status: "all" })} className={linkClass}>
            Tüm firmaları göster
          </Link>
        }
      />
    );
  }
  return <EmptyState icon={BriefcaseBusiness} title="Bu durumda firma yok" description="Başka bir sekme seçin." />;
}
