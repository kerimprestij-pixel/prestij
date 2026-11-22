import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { AlarmClock, ChevronLeft, ChevronRight, Inbox, Search, SearchX, TriangleAlert, X } from "lucide-react";
import { listPanelOrders, type PanelOrderList, type PanelOrderRow } from "@/app/panel/_lib/orders";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime, formatNumber, ORDER_STATUS } from "@/components/panel/labels";
import {
  ORDER_ALERT_PARAM,
  ORDER_ALERTS,
  ORDER_TABS,
  OVERDUE_PARAM,
  orderAlertFromParam,
  orderTabFromParam,
  ordersListHref,
  PAYMENT_METHOD_SHORT,
  formatPhone,
  type OrderAlertKey,
  type OrderTab,
} from "@/components/panel/orders/labels";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { formatPrice } from "@/lib/pricing/money";
import { getSettings } from "@/lib/settings/get-settings";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Siparişler" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Satış"
        title="Siparişler"
        description="Siparişleri durumlarına göre izleyin; ödemeyi onaylayın, kargoya verin, iptal ve iadeleri yönetin."
      />
      <Suspense fallback={<OrdersFallback />}>
        <OrdersView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function OrdersFallback() {
  return (
    <>
      <div className="flex flex-col gap-3">
        <StatusTabs active={null} counts={null} q="" />
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
      </div>
      <TableSkeleton rows={8} />
    </>
  );
}

const TRANSFER_TAB = ORDER_TABS.find((t) => t.key === "transfer") ?? ORDER_TABS[0];

async function OrdersView({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff();
  const params = await searchParams;
  // SR-2: ?sure=doldu = havale orders past their payment deadline (always inside the "Havale bekleyen" tab).
  // PayTR-fix R-UX8: ?uyari=… = orders with one of the dashboard's payment warnings (always with "Tümü").
  const alert = orderAlertFromParam(first(params[ORDER_ALERT_PARAM]));
  const overdue = !alert && first(params[OVERDUE_PARAM.name]) === OVERDUE_PARAM.value;
  const tab = alert ? ORDER_TABS[0] : overdue ? TRANSFER_TAB : orderTabFromParam(first(params.durum));
  const q = (first(params.ara) ?? "").trim().slice(0, 100);
  const pageParam = Number(first(params.sayfa));
  const paymentDays = (await getSettings("payments")).bankTransfer.paymentDays;
  const list = await listPanelOrders({
    tab,
    q,
    page: Number.isSafeInteger(pageParam) ? pageParam : 1,
    overdueAt: { now: new Date(), paymentDays },
    overdueOnly: overdue,
    alert,
  });

  return (
    <>
      <div className="flex flex-col gap-3">
        <StatusTabs active={tab} counts={list.tabCounts} q={q} />
        <SearchForm key={`${tab.key}:${overdue}:${alert}:${q}`} tab={tab} q={q} overdue={overdue} alert={alert} />
        {alert ? (
          <AlertFilter alert={alert} q={q} />
        ) : tab.key === "transfer" || (tab.key === "all" && list.overdueCount > 0) ? (
          <OverdueTransfers count={list.overdueCount} active={overdue} paymentDays={paymentDays} q={q} />
        ) : null}
      </div>
      <OrdersCard list={list} tab={tab} q={q} overdue={overdue} alert={alert} />
    </>
  );
}

/**
 * SR-2: havale orders whose payment deadline has passed. Nothing cancels them by itself: the owner checks this
 * every day and calls the customer or cancels the order (cancel puts the stock back).
 */
function OverdueTransfers({ count, active, paymentDays, q }: { count: number; active: boolean; paymentDays: number; q: string }) {
  const linkClass =
    "rounded text-sm font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <div className={cn("rounded-lg border px-3.5 py-2.5", count > 0 ? "border-[#D68A12]/40 bg-[#D68A12]/10" : "border-border bg-surface")}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text">
        <AlarmClock aria-hidden className={cn("size-4 shrink-0", count > 0 ? "text-[#B5730C]" : "text-text-muted")} />
        <span className={count > 0 ? "font-medium" : undefined}>
          {count > 0 ? `Ödeme süresi dolan havale siparişi: ${formatNumber(count)}` : "Ödeme süresi dolan havale siparişi yok"}
        </span>
        {active ? (
          <Link href={ordersListHref({ tab: TRANSFER_TAB, q })} className={linkClass}>
            Tüm havale bekleyenler
          </Link>
        ) : count > 0 ? (
          <Link href={ordersListHref({ tab: TRANSFER_TAB, q, overdue: true })} className={linkClass}>
            Yalnızca bunları göster
          </Link>
        ) : null}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        Havale ödemesi sipariş gününden itibaren {formatNumber(paymentDays)} gün içinde beklenir (Ayarlar › Ödeme yöntemleri; her sipariş, verildiği
        andaki süreyle değerlendirilir). Süresi dolan siparişler “Ödeme süresi doldu” olarak işaretlenir ve kendiliğinden iptal edilmez. Her gün bu sekmeye bakın: müşteriye ulaşın ya da
        siparişi açıp “İptal et” ile kapatın (iptal, stoku geri ekler).
      </p>
    </div>
  );
}

/** PayTR-fix R-UX8: the list shows only the orders of one dashboard payment warning. */
function AlertFilter({ alert, q }: { alert: OrderAlertKey; q: string }) {
  return (
    <div className="rounded-lg border border-[#D68A12]/40 bg-[#D68A12]/10 px-3.5 py-2.5">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text">
        <TriangleAlert aria-hidden className="size-4 shrink-0 text-[#B5730C]" />
        <span className="font-medium">Yalnızca: {ORDER_ALERTS[alert].label}</span>
        <Link
          href={ordersListHref({ q })}
          className="rounded text-sm font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Tüm siparişler
        </Link>
      </p>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        Siparişi açın ve sipariş geçmişindeki uyarıya göre PayTR mağaza panelinin İşlemler sayfasında kontrol edin.
      </p>
    </div>
  );
}

/** `active`/`counts` are null in the prerendered fallback (search params unknown yet). */
function StatusTabs({ active, counts, q }: { active: OrderTab | null; counts: PanelOrderList["tabCounts"] | null; q: string }) {
  return (
    // `relative` keeps the absolutely positioned sr-only labels inside the scroll box (no page-wide overflow).
    <nav aria-label="Sipariş durumu" className="relative -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg border border-border bg-surface p-1">
        {ORDER_TABS.map((tab) => {
          const current = active?.key === tab.key;
          const n = counts?.[tab.key];
          const highlight = tab.attention && n != null && n > 0 && !current;
          return (
            <li key={tab.key}>
              <Link
                href={ordersListHref({ tab, q })}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  current ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {tab.label}
                {n != null ? (
                  <span
                    className={cn(
                      "min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums",
                      current ? "bg-brand-contrast/15" : highlight ? "bg-gold/20 font-semibold text-text" : "bg-surface-2",
                    )}
                  >
                    {formatNumber(n)}
                    <span className="sr-only"> sipariş</span>
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

function SearchForm({ tab, q, overdue = false, alert = null }: { tab: OrderTab; q: string; overdue?: boolean; alert?: OrderAlertKey | null }) {
  return (
    <Form action="/panel/siparisler" role="search" aria-label="Siparişlerde ara" className="relative w-full max-w-md">
      {tab.param ? <input type="hidden" name="durum" value={tab.param} /> : null}
      {overdue ? <input type="hidden" name={OVERDUE_PARAM.name} value={OVERDUE_PARAM.value} /> : null}
      {alert ? <input type="hidden" name={ORDER_ALERT_PARAM} value={ORDER_ALERTS[alert].param} /> : null}
      <label htmlFor="order-search" className="sr-only">
        Sipariş no, e-posta, ad veya telefon
      </label>
      <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      <input
        id="order-search"
        name="ara"
        type="search"
        defaultValue={q}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Sipariş no, e-posta, ad, telefon…"
        className="h-10 w-full rounded-lg border border-border bg-surface ps-9 pe-20 text-sm text-text placeholder:text-text-muted/80 focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {q ? (
        <Link
          href={ordersListHref({ tab, alert })}
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

function OrdersCard({ list, tab, q, overdue, alert }: { list: PanelOrderList; tab: OrderTab; q: string; overdue: boolean; alert: OrderAlertKey | null }) {
  const from = list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const to = Math.min(list.total, list.page * list.pageSize);
  const title = q ? `“${q}” için ${formatNumber(list.total)} sonuç` : `${formatNumber(list.total)} sipariş`;
  const description = alert ? ORDER_ALERTS[alert].label : overdue ? "Ödeme süresi dolan havale siparişleri" : tab.key === "all" ? "En yeni sipariş en üstte" : tab.label;

  return (
    <Card title={title} description={description} flush>
      {list.rows.length === 0 ? (
        <EmptyOrders list={list} tab={tab} q={q} overdue={overdue} alert={alert} />
      ) : (
        <>
          <MobileList rows={list.rows} />
          <div className="relative hidden overflow-x-auto md:block">
            <table className={`${tableClass} min-w-[40rem]`}>
              <caption className="sr-only">
                {title}, {description}
              </caption>
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>Sipariş / tarih</th>
                  <th scope="col" className={thClass}>Müşteri</th>
                  <th scope="col" className={`${thClass} hidden text-end xl:table-cell`}>Ürün</th>
                  <th scope="col" className={`${thClass} text-end`}>Tutar / ödeme</th>
                  <th scope="col" className={thClass}>Durum</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((order) => (
                  <OrderRow key={order.id} order={order} />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination list={list} tab={tab} q={q} overdue={overdue} alert={alert} from={from} to={to} />
        </>
      )}
    </Card>
  );
}

function customerLabel(order: PanelOrderRow): { primary: string; secondary: string | null } {
  const name = order.customerName?.trim();
  const primary = order.companyName?.trim() || name || order.email;
  const secondary = order.companyName ? name || order.email : name ? order.email : formatPhone(order.phone) || null;
  return { primary, secondary };
}

function unitsLabel(order: PanelOrderRow) {
  return (
    <>
      {formatNumber(order.units)} adet
      {order.samples > 0 ? <span className="block text-xs text-text-muted">+{formatNumber(order.samples)} numune</span> : null}
    </>
  );
}

function OrderRow({ order }: { order: PanelOrderRow }) {
  const status = ORDER_STATUS[order.status];
  const customer = customerLabel(order);
  return (
    <tr className={cn(trClass, "relative")}>
      <td className={`${tdClass} whitespace-nowrap`}>
        {/* The link covers the whole row (before:inset-0 on a relative <tr>), so any cell opens the order. */}
        <Link
          href={`/panel/siparisler/${order.id}`}
          className="font-medium tabular-nums text-text underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-offset-[-2px] focus-visible:before:outline-ring"
        >
          {order.orderNumber}
        </Link>
        <time dateTime={order.createdAt} className="block text-xs text-text-muted">
          {formatDateTime(order.createdAt)}
        </time>
      </td>
      <td className={tdClass}>
        <span className="block max-w-48 truncate xl:max-w-64">{customer.primary}</span>
        {customer.secondary ? <span className="block max-w-48 truncate text-xs text-text-muted xl:max-w-64">{customer.secondary}</span> : null}
      </td>
      <td className={`${tdClass} hidden whitespace-nowrap text-end tabular-nums xl:table-cell`}>{unitsLabel(order)}</td>
      <td className={`${tdClass} whitespace-nowrap text-end tabular-nums`}>
        <span className="block font-medium">{formatPrice(order.grandTotal, "tr")}</span>
        <span className="block text-xs text-text-muted">{PAYMENT_METHOD_SHORT[order.paymentMethod]}</span>
      </td>
      <td className={tdClass}>
        <StatusBadge tone={status?.tone}>{status?.label ?? order.status}</StatusBadge>
        {order.transferOverdue ? <OverdueBadge className="mt-1" /> : null}
      </td>
    </tr>
  );
}

/** SR-2: unpaid havale order past its payment deadline. */
function OverdueBadge({ className }: { className?: string }) {
  return (
    <span className={cn("block w-fit", className)}>
      <StatusBadge tone="warning">Ödeme süresi doldu</StatusBadge>
    </span>
  );
}

/** Below md: one tappable block per order instead of a wide table. */
function MobileList({ rows }: { rows: PanelOrderRow[] }) {
  return (
    <ul className="divide-y divide-border md:hidden">
      {rows.map((order) => {
        const status = ORDER_STATUS[order.status];
        const customer = customerLabel(order);
        return (
          <li key={order.id}>
            <Link
              href={`/panel/siparisler/${order.id}`}
              className="block px-4 py-3.5 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="font-medium tabular-nums text-text">{order.orderNumber}</span>
                <StatusBadge tone={status?.tone}>{status?.label ?? order.status}</StatusBadge>
              </span>
              {order.transferOverdue ? <OverdueBadge className="mt-1.5 ms-auto" /> : null}
              <span className="mt-1 block truncate text-sm text-text">{customer.primary}</span>
              <span className="mt-1 flex items-baseline justify-between gap-3 text-xs text-text-muted">
                <span className="min-w-0 truncate">
                  {formatDateTime(order.createdAt)} · {PAYMENT_METHOD_SHORT[order.paymentMethod]} · {formatNumber(order.units)} adet
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-text">{formatPrice(order.grandTotal, "tr")}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Pagination({
  list,
  tab,
  q,
  overdue,
  alert,
  from,
  to,
}: {
  list: PanelOrderList;
  tab: OrderTab;
  q: string;
  overdue: boolean;
  alert: OrderAlertKey | null;
  from: number;
  to: number;
}) {
  const prev = list.page > 1 ? ordersListHref({ tab, q, overdue, alert, page: list.page - 1 }) : null;
  const next = list.page < list.pageCount ? ordersListHref({ tab, q, overdue, alert, page: list.page + 1 }) : null;
  const linkClass =
    "inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring";
  const disabledClass = "inline-flex h-9 cursor-not-allowed items-center gap-1 rounded-lg border border-border px-3 text-sm text-text-muted opacity-50";

  return (
    <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <p className="text-sm text-text-muted">
        <span className="tabular-nums">
          {formatNumber(from)}–{formatNumber(to)}
        </span>{" "}
        / <span className="tabular-nums">{formatNumber(list.total)}</span> sipariş
        {list.pageCount > 1 ? (
          <span className="hidden sm:inline">
            {" "}
            · Sayfa {formatNumber(list.page)} / {formatNumber(list.pageCount)}
          </span>
        ) : null}
      </p>
      {list.pageCount > 1 ? (
        <div className="flex gap-2">
          {prev ? (
            <Link href={prev} rel="prev" className={linkClass}>
              <ChevronLeft aria-hidden className="size-4" />
              Önceki
            </Link>
          ) : (
            <span aria-disabled="true" className={disabledClass}>
              <ChevronLeft aria-hidden className="size-4" />
              Önceki
            </span>
          )}
          {next ? (
            <Link href={next} rel="next" className={linkClass}>
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

function EmptyOrders({ list, tab, q, overdue, alert }: { list: PanelOrderList; tab: OrderTab; q: string; overdue: boolean; alert: OrderAlertKey | null }) {
  const linkClass = "text-sm font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  if (alert && !q) {
    return (
      <EmptyState
        icon={Inbox}
        title="Bu uyarıya ait sipariş yok"
        description="Uyarının süresi dolmuş ya da sipariş ödendi olarak işaretlenmiş olabilir."
        action={
          <Link href={ordersListHref({})} className={linkClass}>
            Tüm siparişler
          </Link>
        }
      />
    );
  }
  if (overdue && !q) {
    return (
      <EmptyState
        icon={Inbox}
        title="Ödeme süresi dolan havale siparişi yok"
        description="Bekleyen havale siparişlerinin hepsi ödeme süresi içinde."
        action={
          <Link href={ordersListHref({ tab })} className={linkClass}>
            Tüm havale bekleyenler
          </Link>
        }
      />
    );
  }
  if (q) {
    return (
      <EmptyState
        icon={SearchX}
        title="Sonuç bulunamadı"
        description={`“${q}” ile eşleşen ${tab.key === "all" ? "" : `“${tab.label}” durumunda `}sipariş yok. Sipariş numarasını, e-postayı, adı veya telefonun son hanelerini deneyin.`}
        action={
          <Link href={ordersListHref({ tab, alert })} className={linkClass}>
            Aramayı temizle
          </Link>
        }
      />
    );
  }
  if (list.tabCounts.all === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Henüz sipariş yok"
        description="İlk sipariş geldiğinde burada listelenecek. Bu arada ödeme ve kargo ayarlarınızı gözden geçirebilirsiniz."
      />
    );
  }
  return (
    <EmptyState
      icon={Inbox}
      title={`“${tab.label}” durumunda sipariş yok`}
      description={tab.attention ? "Bekleyen iş yok; her şey yolunda." : "Başka bir sekme seçin veya tüm siparişlere dönün."}
      action={
        <Link href="/panel/siparisler" className={linkClass}>
          Tüm siparişler
        </Link>
      }
    />
  );
}
