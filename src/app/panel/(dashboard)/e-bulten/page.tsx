import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, Download, Lock, Mail, Search, SearchX } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import FilterTabs, { type FilterTab } from "@/components/panel/marketing/FilterTabs";
import { SUBSCRIBER_LOCALE, SUBSCRIBER_SOURCE, SUBSCRIBER_STATUS } from "@/components/panel/marketing/labels";
import SubscriberActions from "@/components/panel/marketing/SubscriberActions";
import NewsletterTabs from "@/components/panel/newsletter/NewsletterTabs";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { buttonClass } from "@/components/panel/ui";
import { db } from "@/db";
import { LOCALES } from "@/db/schema/common";
import { listSubscribers, type SubscriberList } from "@/lib/panel/marketing/newsletter";
import {
  parsePage,
  parseSubscriberFilter,
  STATUS_PARAM,
  subscriberExportHref,
  subscriberListHref,
  type SubscriberFilter,
} from "@/lib/panel/marketing/newsletter-filter";
import { SUBSCRIBER_SOURCES } from "@/lib/panel/marketing/schemas";
import { hasRole } from "@/lib/panel/roles";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "E-bülten" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const BASE = "/panel/e-bulten";
const TABS: FilterTab[] = [
  { param: null, label: "Tümü" },
  { param: STATUS_PARAM.active, label: "Aktif" },
  { param: STATUS_PARAM.pending, label: "Onay bekleyen" },
  { param: STATUS_PARAM.unsubscribed, label: "Ayrılan" },
];

export default function NewsletterPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <>
            <Header exportHref={null} canExport={false} />
            <NewsletterTabs active="subscribers" />
            <div className="flex flex-col gap-3">
              <FilterTabs base={BASE} tabs={TABS} active={undefined} label="Abonelik durumu" />
              <Skeleton className="h-10 w-full max-w-2xl rounded-lg" />
            </div>
            <TableSkeleton rows={8} />
          </>
        }
      >
        <SubscriberView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function Header({ exportHref, canExport }: { exportHref: string | null; canExport: boolean }) {
  return (
    <PageHeader
      eyebrow="Pazarlama"
      title="E-bülten"
      description="Sitedeki formlardan açık rızayla abone olan adresler. Yeni aboneler e-postalarındaki bağlantıyla onaylayana kadar “Onay bekliyor” görünür ve kampanya almaz. Silme talebinde kaydı kalıcı olarak silin (KVKK)."
      actions={
        exportHref && canExport ? (
          <a href={exportHref} download className={buttonClass("secondary")}>
            <Download aria-hidden className="size-4" />
            CSV indir
          </a>
        ) : exportHref ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted" title="Kişisel veri içerdiği için yalnızca yöneticiler indirebilir.">
            <Lock aria-hidden className="size-3.5" />
            CSV dışa aktarma yalnızca yöneticilere açık
          </span>
        ) : null
      }
    />
  );
}

async function SubscriberView({ searchParams }: { searchParams: SearchParams }) {
  const { staffRole } = await requireStaff("editor");
  const params = await searchParams;
  const filter = parseSubscriberFilter(params);
  const list = await listSubscribers(db, filter, parsePage(params));
  const statusParam = filter.status ? STATUS_PARAM[filter.status] : null;

  return (
    <>
      <Header exportHref={subscriberExportHref(filter)} canExport={hasRole(staffRole, "admin")} />
      <NewsletterTabs active="subscribers" />
      <Stats stats={list.stats} />
      <div className="flex flex-col gap-3">
        <FilterTabs
          base={BASE}
          tabs={TABS}
          active={statusParam}
          counts={{ "": list.stats.all, [STATUS_PARAM.active]: list.stats.active, [STATUS_PARAM.pending]: list.stats.pending, [STATUS_PARAM.unsubscribed]: list.stats.unsubscribed }}
          label="Abonelik durumu"
          extraQuery={{ ara: filter.q, kaynak: filter.source, dil: filter.locale }}
        />
        <FilterForm key={JSON.stringify(filter)} filter={filter} statusParam={statusParam} />
      </div>
      <SubscriberTable list={list} filter={filter} />
    </>
  );
}

function Stats({ stats }: { stats: SubscriberList["stats"] }) {
  const items = [
    { label: "Aktif (onaylı) abone", value: stats.active },
    { label: "Onay bekleyen", value: stats.pending },
    { label: "Son 30 günde katılan", value: stats.last30Days },
    { label: "Aboneliği sonlanan", value: stats.unsubscribed },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-border bg-surface px-5 py-4">
          <dt className="text-xs text-text-muted">{item.label}</dt>
          <dd className="mt-1 font-heading text-2xl tabular-nums text-text">{formatNumber(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

const selectClass =
  "h-10 min-w-0 rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20";

function FilterForm({ filter, statusParam }: { filter: SubscriberFilter; statusParam: string | null }) {
  return (
    <Form action={BASE} role="search" aria-label="Abonelerde ara" className="flex w-full max-w-3xl flex-col gap-2 sm:flex-row sm:items-center">
      {statusParam ? <input type="hidden" name="durum" value={statusParam} /> : null}
      <div className="relative min-w-0 flex-1">
        <label htmlFor="subscriber-search" className="sr-only">
          E-posta adresi
        </label>
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          id="subscriber-search"
          name="ara"
          type="search"
          defaultValue={filter.q}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="E-posta adresinde ara…"
          className="h-10 w-full rounded-lg border border-border bg-surface ps-9 pe-3 text-sm text-text placeholder:text-text-muted/80 focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:flex">
        <label className="sr-only" htmlFor="subscriber-source">
          Kaynak
        </label>
        <select id="subscriber-source" name="kaynak" defaultValue={filter.source ?? ""} className={selectClass}>
          <option value="">Tüm kaynaklar</option>
          {SUBSCRIBER_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SUBSCRIBER_SOURCE[s]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="subscriber-locale">
          Dil
        </label>
        <select id="subscriber-locale" name="dil" defaultValue={filter.locale ?? ""} className={selectClass}>
          <option value="">Tüm diller</option>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {SUBSCRIBER_LOCALE[l]}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass("primary")}>
          Filtrele
        </button>
      </div>
    </Form>
  );
}

function SubscriberTable({ list, filter }: { list: SubscriberList; filter: SubscriberFilter }) {
  const filtered = Boolean(filter.q || filter.source || filter.locale || filter.status);
  const title = filter.q ? `“${filter.q}” için ${formatNumber(list.total)} abone` : `${formatNumber(list.total)} abone`;
  return (
    <Card title={title} description="En yeni kayıt en üstte · saatler Türkiye saatiyle" flush>
      {list.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="Eşleşen abone yok"
            description="Filtreleri değiştirin veya temizleyin."
            action={
              <Link href={BASE} className="text-sm font-medium text-text underline underline-offset-4">
                Filtreleri temizle
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={Mail}
            title="Henüz abone yok"
            description="Ziyaretçiler sitenin alt bilgisindeki veya bülten bölümündeki formdan abone olduğunda burada listelenir."
          />
        )
      ) : (
        <>
          <ul className="divide-y divide-border md:hidden">
            {list.rows.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{row.email}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    <StatusBadge tone={SUBSCRIBER_STATUS[row.status].tone}>{SUBSCRIBER_STATUS[row.status].label}</StatusBadge>
                    <span>{SUBSCRIBER_LOCALE[row.locale] ?? row.locale}</span>
                    <span>· {formatDateTime(row.consentAt)}</span>
                  </p>
                </div>
                <SubscriberActions id={row.id} email={row.email} active={row.status !== "unsubscribed"} />
              </li>
            ))}
          </ul>
          <div className="relative hidden overflow-x-auto md:block">
            <table className={cn(tableClass, "min-w-[44rem]")}>
              <caption className="sr-only">{title}</caption>
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>E-posta</th>
                  <th scope="col" className={thClass}>Durum</th>
                  <th scope="col" className={thClass}>Dil</th>
                  <th scope="col" className={thClass}>Kaynak</th>
                  <th scope="col" className={thClass}>İzin tarihi</th>
                  <th scope="col" className={cn(thClass, "text-end")}>
                    <span className="sr-only">İşlemler</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => (
                  <tr key={row.id} className={trClass}>
                    <td className={cn(tdClass, "max-w-72 truncate font-medium")}>{row.email}</td>
                    <td className={tdClass}>
                      <StatusBadge tone={SUBSCRIBER_STATUS[row.status].tone}>{SUBSCRIBER_STATUS[row.status].label}</StatusBadge>
                    </td>
                    <td className={tdClass}>{SUBSCRIBER_LOCALE[row.locale] ?? row.locale}</td>
                    <td className={cn(tdClass, "text-text-muted")}>{row.source ? (SUBSCRIBER_SOURCE[row.source] ?? row.source) : "—"}</td>
                    <td className={cn(tdClass, "whitespace-nowrap text-text-muted")}>
                      <time dateTime={row.consentAt}>{formatDateTime(row.consentAt)}</time>
                    </td>
                    <td className={cn(tdClass, "py-2")}>
                      <SubscriberActions id={row.id} email={row.email} active={row.status !== "unsubscribed"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination list={list} filter={filter} />
        </>
      )}
    </Card>
  );
}

function Pagination({ list, filter }: { list: SubscriberList; filter: SubscriberFilter }) {
  const from = (list.page - 1) * list.pageSize + 1;
  const to = Math.min(list.total, list.page * list.pageSize);
  const linkClass =
    "inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <p className="text-sm text-text-muted">
        <span className="tabular-nums">
          {formatNumber(from)}–{formatNumber(to)}
        </span>{" "}
        / <span className="tabular-nums">{formatNumber(list.total)}</span> abone
      </p>
      {list.pageCount > 1 ? (
        <div className="flex gap-2">
          {list.page > 1 ? (
            <Link href={subscriberListHref(filter, list.page - 1)} rel="prev" className={linkClass}>
              <ChevronLeft aria-hidden className="size-4" />
              Önceki
            </Link>
          ) : null}
          {list.page < list.pageCount ? (
            <Link href={subscriberListHref(filter, list.page + 1)} rel="next" className={linkClass}>
              Sonraki
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
