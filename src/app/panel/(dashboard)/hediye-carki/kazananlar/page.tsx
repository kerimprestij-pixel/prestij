import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, Download, Lock, Search, SearchX, Trophy } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import WheelPageHeader from "@/components/panel/gift-wheel/WheelPageHeader";
import WheelTabs from "@/components/panel/gift-wheel/WheelTabs";
import { formatDateTime, formatNumber, ORDER_STATUS } from "@/components/panel/labels";
import FilterTabs, { type FilterTab } from "@/components/panel/marketing/FilterTabs";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { buttonClass } from "@/components/panel/ui";
import { db } from "@/db";
import {
  parseWinnerFilter,
  parseWinnerPage,
  WHEEL_WINNERS_PATH,
  winnersExportHref,
  winnersListHref,
  type WinnerFilter,
} from "@/lib/panel/gift-wheel/filters";
import { BOUND_VIA_LABELS, prizeDetail, WINNER_STATUS, WINNER_STATUSES } from "@/lib/panel/gift-wheel/labels";
import { listWheelWinners, type WinnerList, type WinnerRow } from "@/lib/panel/gift-wheel/queries";
import { hasRole } from "@/lib/panel/roles";
import { formatPrice } from "@/lib/pricing/money";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

const th = cn(thClass, "px-4");
const td = cn(tdClass, "px-4");

export const metadata: Metadata = { title: "Hediye Çarkı · Kazananlar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS: FilterTab[] = [{ param: null, label: "Tümü" }, ...WINNER_STATUSES.map((s) => ({ param: WINNER_STATUS[s].param, label: WINNER_STATUS[s].label }))];

export default function GiftWheelWinnersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <>
            <WheelPageHeader />
            <WheelTabs active="winners" />
            <div className="flex flex-col gap-3">
              <FilterTabs base={WHEEL_WINNERS_PATH} tabs={TABS} active={undefined} label="Hediye durumu" />
              <Skeleton className="h-10 w-full max-w-md rounded-lg" />
            </div>
            <TableSkeleton rows={5} />
          </>
        }
      >
        <Winners searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function ExportAction({ filter, canExport }: { filter: WinnerFilter; canExport: boolean }) {
  if (canExport) {
    return (
      <a href={winnersExportHref(filter)} download className={buttonClass("secondary")}>
        <Download aria-hidden className="size-4" />
        CSV indir
      </a>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted" title="Kişisel veri içerdiği için yalnızca yöneticiler indirebilir.">
      <Lock aria-hidden className="size-3.5" />
      CSV dışa aktarma yalnızca yöneticilere açık
    </span>
  );
}

async function Winners({ searchParams }: { searchParams: SearchParams }) {
  const { staffRole } = await requireStaff("editor");
  const isAdmin = hasRole(staffRole, "admin");
  const params = await searchParams;
  const filter = parseWinnerFilter(params);
  const list = await listWheelWinners(db, filter, parseWinnerPage(params), { revealEmail: isAdmin });
  const counts: Record<string, number> = { "": list.all };
  for (const s of WINNER_STATUSES) counts[WINNER_STATUS[s].param] = list.counts[s];
  const activeParam = filter.status ? WINNER_STATUS[filter.status].param : null;

  return (
    <>
      <WheelPageHeader actions={<ExportAction filter={filter} canExport={isAdmin} />} />
      <WheelTabs active="winners" />
      <div className="flex flex-col gap-3">
        <FilterTabs base={WHEEL_WINNERS_PATH} tabs={TABS} active={activeParam} counts={counts} label="Hediye durumu" extraQuery={{ ara: filter.q }} />
        <Form action={WHEEL_WINNERS_PATH} role="search" aria-label="Kazananlarda ara" className="relative w-full max-w-md">
          {activeParam ? <input type="hidden" name="durum" value={activeParam} /> : null}
          <label htmlFor="winner-search" className="sr-only">
            {isAdmin ? "Kod veya e-posta" : "Kod"}
          </label>
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            id="winner-search"
            name="ara"
            type="search"
            defaultValue={filter.q}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder={isAdmin ? "Kod veya e-posta…" : "Kod (ör. CARK-7KQ2MX)…"}
            className="h-10 w-full rounded-lg border border-border bg-surface ps-9 pe-12 text-sm text-text placeholder:text-text-muted/80 focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="submit"
            className="absolute end-1 top-1/2 grid h-8 w-9 -translate-y-1/2 place-items-center rounded-md bg-brand text-brand-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Search aria-hidden className="size-4" />
            <span className="sr-only">Ara</span>
          </button>
        </Form>
      </div>

      <Card
        title={filter.q ? `“${filter.q}” için ${formatNumber(list.total)} kayıt` : `${formatNumber(list.total)} kayıt`}
        description={filter.status ? WINNER_STATUS[filter.status].description : "Hesaba bağlanmış çark hediyeleri, en son hareket üstte."}
        flush
      >
        {list.rows.length === 0 ? (
          list.all === 0 && !filter.q ? (
            <EmptyState
              icon={Trophy}
              title="Henüz kazanan yok"
              description="Ziyaretçiler çarkı çevirip üye olduğunda ya da giriş yaptığında hediyeleri burada listelenir."
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="Eşleşen kayıt yok"
              description="Başka bir sekme seçin veya aramayı temizleyin."
              action={
                <Link href={WHEEL_WINNERS_PATH} className="text-sm font-medium text-text underline underline-offset-4">
                  Tüm kazananlar
                </Link>
              }
            />
          )
        ) : (
          <>
            <ul className="divide-y divide-border md:hidden">
              {list.rows.map((row) => (
                <li key={row.id} className="space-y-1 px-4 py-3.5">
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-medium text-text">{row.prize.label?.tr ?? row.sliceKey}</span>
                    <StatusBadge tone={WINNER_STATUS[row.status].tone}>{WINNER_STATUS[row.status].label}</StatusBadge>
                  </span>
                  <span className="block text-sm text-text">
                    {row.code ? <CodeLink row={row} /> : <span className="text-text-muted">Kod henüz yok</span>}
                    {row.email ? <span className="text-text-muted"> · {row.email}</span> : null}
                  </span>
                  <span className="block text-xs text-text-muted">{datesLine(row)}</span>
                  {row.order ? (
                    <span className="block text-xs">
                      <OrderLink order={row.order} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="relative hidden overflow-x-auto md:block">
              <table className={cn(tableClass, "min-w-[56rem]")}>
                <caption className="sr-only">Çark kazananları</caption>
                <thead className={theadClass}>
                  <tr>
                    <th scope="col" className={th}>
                      Hediye
                    </th>
                    <th scope="col" className={th}>
                      Kod
                    </th>
                    <th scope="col" className={th}>
                      Hesap
                    </th>
                    <th scope="col" className={th}>
                      Tarihler
                    </th>
                    <th scope="col" className={th}>
                      Sipariş
                    </th>
                    <th scope="col" className={th}>
                      Durum
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((row) => (
                    <tr key={row.id} className={trClass}>
                      <td className={td}>
                        <span className="block min-w-32 font-medium">{row.prize.label?.tr ?? row.sliceKey}</span>
                        <span className="block text-xs text-text-muted">
                          {[prizeDetail(row.prize), `${row.round}. tur`].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className={cn(td, "whitespace-nowrap")}>{row.code ? <CodeLink row={row} /> : <span className="text-xs text-text-muted">Henüz yok</span>}</td>
                      <td className={td}>
                        <span className="block max-w-56 truncate">{row.email ?? <span className="text-text-muted">Silinmiş hesap</span>}</span>
                        {row.boundVia ? <span className="block text-xs text-text-muted">{BOUND_VIA_LABELS[row.boundVia]}</span> : null}
                      </td>
                      <td className={cn(td, "whitespace-nowrap text-xs text-text-muted")}>
                        <span className="block">Çevirme: {formatDateTime(row.createdAt)}</span>
                        {row.claimedAt ? <span className="block">Alındı: {formatDateTime(row.claimedAt)}</span> : null}
                        {row.endsAt ? <span className="block">Son kullanım: {formatDateTime(row.endsAt)}</span> : null}
                      </td>
                      <td className={cn(td, "text-xs")}>
                        {row.order ? <OrderLink order={row.order} /> : <span className="text-text-muted">–</span>}
                      </td>
                      <td className={td}>
                        <StatusBadge tone={WINNER_STATUS[row.status].tone}>{WINNER_STATUS[row.status].label}</StatusBadge>
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

      <p className="text-xs leading-relaxed text-text-muted">
        Üye olmadan çarkı çeviren ziyaretçiler burada listelenmez; sayıları Genel bakış sekmesindedir.{" "}
        {isAdmin
          ? "E-posta adresleri kişisel veridir: CSV dosyasını yalnızca gerektiği kadar saklayın. Her dışa aktarma işlem kaydına yazılır."
          : "E-posta adresleri kişisel veri olduğu için gizlenmiştir; tam adresleri yalnızca yöneticiler görür."}
      </p>
    </>
  );
}

function datesLine(row: WinnerRow): string {
  const parts = [`Çevirme ${formatDateTime(row.createdAt)}`];
  if (row.endsAt) parts.push(`son kullanma ${formatDateTime(row.endsAt)}`);
  return parts.join(" · ");
}

function CodeLink({ row }: { row: WinnerRow }) {
  if (!row.code) return null;
  if (!row.couponId) return <span className="font-mono text-sm tracking-wide">{row.code}</span>;
  return (
    <Link
      href={`/panel/kuponlar/${row.couponId}`}
      className="font-mono text-sm font-medium tracking-wide text-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {row.code}
    </Link>
  );
}

function OrderLink({ order }: { order: NonNullable<WinnerRow["order"]> }) {
  const status = ORDER_STATUS[order.status];
  return (
    <Link
      href={`/panel/siparisler/${order.id}`}
      className="inline-block rounded text-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="block whitespace-nowrap font-medium">{order.orderNumber}</span>
      <span className="block whitespace-nowrap text-text-muted">
        {formatPrice(order.grandTotal, "tr")} · {status?.label ?? order.status}
      </span>
    </Link>
  );
}

function Pagination({ list, filter }: { list: WinnerList; filter: WinnerFilter }) {
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
        / <span className="tabular-nums">{formatNumber(list.total)}</span> kayıt
      </p>
      {list.pageCount > 1 ? (
        <div className="flex gap-2">
          {list.page > 1 ? (
            <Link href={winnersListHref(filter, list.page - 1)} rel="prev" className={linkClass}>
              <ChevronLeft aria-hidden className="size-4" />
              Önceki
            </Link>
          ) : null}
          {list.page < list.pageCount ? (
            <Link href={winnersListHref(filter, list.page + 1)} rel="next" className={linkClass}>
              Sonraki
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
