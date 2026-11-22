import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, Search, SearchX, Users, X } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { groupLabel, Pagination } from "@/components/panel/b2b/shared";
import { COMPANY_STATUS, formatDate, formatNumber } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { listCustomers, listGroupOptions, type CustomerList, type CustomerListInput, type CustomerRow, type GroupOption, type YesNo } from "@/lib/b2b/queries";
import { formatTryAmount } from "@/lib/panel/format";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Müşteriler" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Filter = { q: string; groupId: number | null; company: YesNo; companyId: number | null; hasOrders: YesNo; verified: YesNo };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const yesNo = (v: string | undefined): YesNo => (v === "evet" ? "yes" : v === "hayir" ? "no" : null);
const toParam = (v: YesNo) => (v === "yes" ? "evet" : v === "no" ? "hayir" : null);
const idParam = (v: string | undefined) => (v && /^\d{1,9}$/.test(v) ? Number(v) : null);

function listHref(filter: Partial<Filter> & { page?: number }): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("ara", filter.q);
  if (filter.groupId) params.set("grup", String(filter.groupId));
  if (filter.companyId) params.set("firma", String(filter.companyId));
  else if (filter.company) params.set("firma", toParam(filter.company)!);
  if (filter.hasOrders) params.set("siparis", toParam(filter.hasOrders)!);
  if (filter.verified) params.set("dogrulama", toParam(filter.verified)!);
  if (filter.page && filter.page > 1) params.set("sayfa", String(filter.page));
  const query = params.toString();
  return `/panel/musteriler${query ? `?${query}` : ""}`;
}

export default function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Satış"
        title="Müşteriler"
        description="Üye müşteri hesapları: siparişler, adresler, firma ve müşteri grubu. Panel kullanıcıları burada listelenmez (Ekip sayfası)."
      />
      <Suspense fallback={<ListFallback />}>
        <CustomersView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function ListFallback() {
  return (
    <>
      <Skeleton className="h-10 w-full max-w-3xl rounded-lg" />
      <TableSkeleton rows={8} />
    </>
  );
}

async function CustomersView({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff();
  const params = await searchParams;
  const firma = first(params.firma);
  const filter: Filter = {
    q: (first(params.ara) ?? "").trim().slice(0, 100),
    groupId: idParam(first(params.grup)),
    companyId: idParam(firma),
    company: yesNo(firma),
    hasOrders: yesNo(first(params.siparis)),
    verified: yesNo(first(params.dogrulama)),
  };
  const pageParam = Number(first(params.sayfa));
  const input: CustomerListInput = { ...filter, page: Number.isSafeInteger(pageParam) ? pageParam : 1 };
  const [list, groups] = await Promise.all([listCustomers(input), listGroupOptions()]);

  return (
    <>
      <Filters key={JSON.stringify(filter)} filter={filter} groups={groups} />
      <CustomersCard list={list} filter={filter} />
    </>
  );
}

const selectClass =
  "h-10 rounded-lg border border-border bg-surface px-3 pe-8 text-sm text-text focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20";

function Filters({ filter, groups }: { filter: Filter; groups: GroupOption[] }) {
  const active = filter.q || filter.groupId || filter.company || filter.companyId || filter.hasOrders || filter.verified;
  return (
    <Form action="/panel/musteriler" role="search" aria-label="Müşterilerde ara ve süz" className="flex flex-col gap-3">
      <div className="relative w-full max-w-xl">
        <label htmlFor="customer-search" className="sr-only">
          Ad, e-posta, telefon veya firma
        </label>
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          id="customer-search"
          name="ara"
          type="search"
          defaultValue={filter.q}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Ad, e-posta, telefon, firma…"
          className="h-10 w-full rounded-lg border border-border bg-surface ps-9 pe-12 text-sm text-text placeholder:text-text-muted/80 focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 [&::-webkit-search-cancel-button]:hidden"
        />
        <button
          type="submit"
          className="absolute end-1 top-1/2 grid h-8 w-9 -translate-y-1/2 place-items-center rounded-md bg-brand text-brand-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Search aria-hidden className="size-4" />
          <span className="sr-only">Ara</span>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="filter-group">
          Müşteri grubu
        </label>
        <select id="filter-group" name="grup" defaultValue={filter.groupId ? String(filter.groupId) : ""} className={selectClass}>
          <option value="">Tüm gruplar</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {groupLabel(g.name, g.slug)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="filter-company">
          Firma
        </label>
        <select id="filter-company" name="firma" defaultValue={filter.companyId ? String(filter.companyId) : (toParam(filter.company) ?? "")} className={selectClass}>
          <option value="">Firma: tümü</option>
          <option value="evet">Firmaya bağlı</option>
          <option value="hayir">Firması olmayan</option>
          {filter.companyId ? <option value={String(filter.companyId)}>Seçili firma (#{filter.companyId})</option> : null}
        </select>
        <label className="sr-only" htmlFor="filter-orders">
          Sipariş
        </label>
        <select id="filter-orders" name="siparis" defaultValue={toParam(filter.hasOrders) ?? ""} className={selectClass}>
          <option value="">Sipariş: tümü</option>
          <option value="evet">Siparişi olan</option>
          <option value="hayir">Siparişi olmayan</option>
        </select>
        <label className="sr-only" htmlFor="filter-verified">
          E-posta doğrulaması
        </label>
        <select id="filter-verified" name="dogrulama" defaultValue={toParam(filter.verified) ?? ""} className={selectClass}>
          <option value="">Doğrulama: tümü</option>
          <option value="evet">E-postası doğrulanmış</option>
          <option value="hayir">Doğrulanmamış</option>
        </select>
        <button type="submit" className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring">
          Uygula
        </button>
        {active ? (
          <Link href="/panel/musteriler" className="inline-flex h-10 items-center gap-1 rounded-lg px-3 text-sm text-text-muted hover:text-text">
            <X aria-hidden className="size-4" />
            Temizle
          </Link>
        ) : null}
      </div>
    </Form>
  );
}

function CustomersCard({ list, filter }: { list: CustomerList; filter: Filter }) {
  const title = filter.q ? `“${filter.q}” için ${formatNumber(list.total)} sonuç` : `${formatNumber(list.total)} müşteri`;
  return (
    <Card title={title} description="En yeni üyelik en üstte" flush>
      {list.rows.length === 0 ? (
        <EmptyState
          icon={filter.q ? SearchX : Users}
          title={filter.q ? "Sonuç bulunamadı" : "Bu filtrede müşteri yok"}
          description={filter.q ? "Adı, e-postayı, telefonun son hanelerini ya da firma adını deneyin." : "Filtreleri değiştirin veya temizleyin."}
          action={
            <Link href="/panel/musteriler" className="text-sm font-medium text-text underline underline-offset-4">
              Tüm müşteriler
            </Link>
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-border" aria-label="Müşteriler">
            {list.rows.map((row) => (
              <CustomerListRow key={row.id} row={row} />
            ))}
          </ul>
          <Pagination page={list.page} pageCount={list.pageCount} pageSize={list.pageSize} total={list.total} noun="müşteri" hrefFor={(page) => listHref({ ...filter, page })} />
        </>
      )}
    </Card>
  );
}

function CustomerListRow({ row }: { row: CustomerRow }) {
  return (
    <li>
      <Link
        href={`/panel/musteriler/${row.id}`}
        className={cn(
          "group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:px-5",
          row.anonymized && "opacity-70",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-sm font-semibold text-text">{row.name}</span>
            {row.anonymized ? <StatusBadge tone="neutral">Silinmiş hesap</StatusBadge> : null}
            {row.banned && !row.anonymized ? <StatusBadge tone="danger">Erişimi kapalı</StatusBadge> : null}
            {!row.emailVerified && !row.anonymized ? <StatusBadge tone="warning">Doğrulanmamış</StatusBadge> : null}
            {row.groupName ? <StatusBadge tone="gold">{groupLabel(row.groupName)}</StatusBadge> : null}
          </span>
          {!row.anonymized ? (
            <span className="mt-1 block truncate text-xs text-text-muted" dir="ltr">
              {[row.email, row.phone].filter(Boolean).join(" · ")}
            </span>
          ) : null}
          <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            {row.company ? (
              <span className="min-w-0 truncate">
                {row.company.name} · {COMPANY_STATUS[row.company.status].label}
              </span>
            ) : null}
            <span>
              {formatNumber(row.orderCount)} sipariş{row.spent > 0 ? ` · ${formatTryAmount(row.spent, { symbol: true })}` : ""}
            </span>
            {row.lastOrderAt ? <span>Son sipariş {formatDate(row.lastOrderAt)}</span> : null}
          </span>
        </span>
        <span className="hidden shrink-0 text-end text-xs text-text-muted sm:block">
          <span className="block">Üyelik</span>
          <time dateTime={row.createdAt} className="tabular-nums text-text">
            {formatDate(row.createdAt)}
          </time>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}
