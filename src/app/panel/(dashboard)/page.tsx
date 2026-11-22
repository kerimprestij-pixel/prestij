import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowUpRight,
  CircleCheckBig,
  ExternalLink,
  Inbox,
  Mail,
  Megaphone,
  Package,
  PanelsTopLeft,
  Palette,
  Settings,
  ShoppingBag,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  getDailySales,
  getDashboardTodo,
  getLowStockVariants,
  getRecentMessages,
  getRecentOrders,
  getSalesSummary,
} from "@/app/panel/_lib/dashboard";
import Card, { CardLink } from "@/components/panel/Card";
import JobStatusCard from "@/components/panel/dashboard/JobStatusCard";
import SalesChart from "@/components/panel/dashboard/SalesChart";
import SalesTiles from "@/components/panel/dashboard/SalesTiles";
import TodoCard from "@/components/panel/dashboard/TodoCard";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime, formatNumber, formatVolume, ORDER_STATUS } from "@/components/panel/labels";
import { canSeeNavItem, findNavItem } from "@/components/panel/nav-config";
import Notice from "@/components/panel/Notice";
import { PAYMENT_METHOD_SHORT } from "@/components/panel/orders/labels";
import PageHeader from "@/components/panel/PageHeader";
import { ListSkeleton, Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { localize } from "@/i18n/localize";
import { listJobStatus } from "@/lib/cron/run";
import { hasRole } from "@/lib/panel/roles";
import { formatPrice } from "@/lib/pricing/money";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Genel Bakış" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-8">
      <Suspense fallback={null}>
        <AccessNotice searchParams={searchParams} />
      </Suspense>

      <PageHeader
        eyebrow={
          <Suspense fallback="Hoş geldiniz">
            <Greeting />
          </Suspense>
        }
        title="Genel Bakış"
        description="Satışlarınız, bekleyen işler ve stok uyarıları. Saatler Türkiye saatiyle; iptal ve iadeler ciroya dahil değildir."
      />

      <section aria-labelledby="sales-title" className="space-y-4">
        <h2 id="sales-title" className="sr-only">
          Satışlar
        </h2>
        <Suspense fallback={<SalesSkeleton />}>
          <Sales />
        </Suspense>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Suspense fallback={<ChartSkeleton />}>
            <DailySalesCard />
          </Suspense>
        </div>
        <Suspense fallback={<ListSkeleton title="Yapılacaklar" rows={5} />}>
          <Todo />
        </Suspense>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Suspense fallback={<TableSkeleton title="Son siparişler" rows={5} />}>
            <RecentOrders />
          </Suspense>
        </div>
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<ListSkeleton title="Okunmamış mesajlar" rows={2} />}>
            <UnreadMessages />
          </Suspense>
          <Suspense fallback={<ListSkeleton title="Düşük stok" />}>
            <LowStock />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<ListSkeleton title="Zamanlanmış görevler" rows={4} />}>
        <Jobs />
      </Suspense>

      <Suspense fallback={<QuickLinksSkeleton />}>
        <QuickLinks />
      </Suspense>
    </div>
  );
}

async function AccessNotice({ searchParams }: { searchParams: SearchParams }) {
  const { yetki } = await searchParams;
  if (yetki !== "yetersiz") return null;
  return (
    <Notice tone="warning">
      Açmaya çalıştığınız bölüm için yetkiniz yok. Erişim gerekiyorsa bir yöneticiyle iletişime geçin.
    </Notice>
  );
}

async function Greeting() {
  const { user } = await requireStaff();
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;
  return <>Hoş geldiniz, {firstName}</>;
}

async function Sales() {
  await requireStaff();
  return <SalesTiles summary={await getSalesSummary()} />;
}

async function DailySalesCard() {
  await requireStaff();
  const days = await getDailySales(30);
  const total = days.reduce((sum, d) => sum + d.revenue, 0);
  const orders = days.reduce((sum, d) => sum + d.orders, 0);
  return (
    <Card
      title="Son 30 günün cirosu"
      description={orders > 0 ? `${formatPrice(total, "tr")} · ${formatNumber(orders)} sipariş · günlük` : "Günlük ciro"}
      action={<CardLink href="/panel/siparisler">Siparişler</CardLink>}
      className="h-full"
    >
      {orders === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="Son 30 günde satış yok"
          description="Ödemesi alınan ilk sipariş geldiğinde günlük ciro burada çizilecek."
          className="py-10"
        />
      ) : (
        <div className="pt-4">
          <SalesChart days={days} />
        </div>
      )}
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <div role="status" className="h-full rounded-xl border border-border bg-surface p-5">
      <span className="sr-only">Yükleniyor…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-56" />
      <div className="mt-8 flex h-44 items-end gap-1">
        {Array.from({ length: 30 }, (_, i) => (
          <Skeleton key={i} className="flex-1 rounded-t-[4px] rounded-b-none" />
        ))}
      </div>
    </div>
  );
}

async function Todo() {
  const { staffRole } = await requireStaff();
  return <TodoCard todo={await getDashboardTodo(new Date())} canModerateReviews={hasRole(staffRole, "editor")} canEditPayments={hasRole(staffRole, "admin")} />;
}

/** Scheduled jobs (staff); "Şimdi çalıştır" for admins (re-checked in runJobNowAction). */
async function Jobs() {
  const { staffRole } = await requireStaff();
  return <JobStatusCard jobs={await listJobStatus()} canRun={hasRole(staffRole, "admin")} />;
}

async function RecentOrders() {
  await requireStaff();
  const rows = await getRecentOrders(8);
  return (
    <Card
      title="Son siparişler"
      description="En yeni 8 sipariş"
      action={<CardLink href="/panel/siparisler">Tümünü gör</CardLink>}
      flush
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Henüz sipariş yok"
          description="İlk sipariş geldiğinde burada görünecek. Bu arada ödeme ve kargo ayarlarınızı gözden geçirebilirsiniz."
        />
      ) : (
        <>
          <ul className="divide-y divide-border md:hidden">
            {rows.map((order) => {
              const status = ORDER_STATUS[order.status];
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
                    <span className="mt-1 flex items-baseline justify-between gap-3 text-xs text-text-muted">
                      <span className="min-w-0 truncate">
                        {order.customerName || order.email} · {formatDateTime(order.createdAt)}
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-text">{formatPrice(order.grandTotal, "tr")}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className={`${tableClass} min-w-[36rem]`}>
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>Sipariş</th>
                  <th scope="col" className={thClass}>Müşteri</th>
                  <th scope="col" className={thClass}>Tarih</th>
                  <th scope="col" className={thClass}>Durum</th>
                  <th scope="col" className={`${thClass} text-end`}>Tutar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => {
                  const status = ORDER_STATUS[order.status];
                  return (
                    <tr key={order.id} className={cn(trClass, "relative")}>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {/* The link covers the whole row (before:inset-0), so any cell opens the order. */}
                        <Link
                          href={`/panel/siparisler/${order.id}`}
                          className="font-medium tabular-nums text-text underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-offset-[-2px] focus-visible:before:outline-ring"
                        >
                          {order.orderNumber}
                        </Link>
                        <span className="block text-xs text-text-muted">{PAYMENT_METHOD_SHORT[order.paymentMethod]}</span>
                      </td>
                      <td className={tdClass}>
                        <span className="block max-w-48 truncate">{order.customerName || order.email}</span>
                        {order.customerName ? (
                          <span className="block max-w-48 truncate text-xs text-text-muted">{order.email}</span>
                        ) : null}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-text-muted`}>{formatDateTime(order.createdAt)}</td>
                      <td className={tdClass}>
                        <StatusBadge tone={status?.tone}>{status?.label ?? order.status}</StatusBadge>
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-end font-medium tabular-nums`}>
                        {formatPrice(order.grandTotal, "tr")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

const SUBJECT_LABELS: Record<string, string> = {
  general: "Genel",
  quote: "Teklif",
  sample: "Numune",
  other: "Diğer",
};

async function UnreadMessages() {
  await requireStaff();
  const rows = await getRecentMessages(4);
  return (
    <Card
      title="Okunmamış mesajlar"
      description="İletişim formundan gelenler"
      action={rows.length > 0 ? <CardLink href="/panel/mesajlar">Gelen kutusu</CardLink> : undefined}
      flush
    >
      {rows.length === 0 ? (
        <EmptyState icon={Inbox} title="Okunmamış mesaj yok" description="Yeni mesajlar burada görünür." className="py-8" />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((m) => (
            <li key={m.id}>
              <Link
                href="/panel/mesajlar"
                className="block px-5 py-3.5 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-text">
                    <Mail aria-hidden className="size-3.5 shrink-0 text-gold-text" />
                    <span className="truncate">{m.name}</span>
                  </span>
                  <time dateTime={m.createdAt.toISOString()} className="shrink-0 text-xs text-text-muted">
                    {formatDateTime(m.createdAt)}
                  </time>
                </span>
                <span className="mt-1 line-clamp-2 text-xs text-text-muted">
                  {m.subject ? <span className="font-medium text-text">{SUBJECT_LABELS[m.subject] ?? m.subject} · </span> : null}
                  {m.message}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function LowStock() {
  await requireStaff();
  const rows = await getLowStockVariants(6);
  return (
    <Card
      title="Düşük stok"
      description="Eşiğin altına düşen varyantlar"
      action={rows.length > 0 ? <CardLink href="/panel/urunler?durum=dusuk-stok">Tümü</CardLink> : undefined}
      flush
    >
      {rows.length === 0 ? (
        <EmptyState icon={CircleCheckBig} title="Stoklar yerinde" description="Eşiğin altında varyant yok." className="py-8" />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((v) => {
            const ratio = v.threshold > 0 ? Math.min(1, Math.max(0, v.stock / v.threshold)) : 0;
            return (
              <li key={v.variantId}>
                <Link
                  href={`/panel/urunler/${v.productId}`}
                  className="block px-5 py-3.5 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-text">
                      {localize(v.productName, "tr")}
                      <span className="font-normal text-text-muted"> · {formatVolume(v.volumeMl)}</span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-text">
                      <span className={v.stock <= 0 ? "font-semibold text-[#C2413A]" : "font-semibold"}>{formatNumber(v.stock)}</span>
                      <span className="text-text-muted"> / {formatNumber(v.threshold)}</span>
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-text-muted">{v.sku}</span>
                  <span aria-hidden className="mt-2 block h-1 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className={v.stock <= 0 ? "block h-full bg-[#C2413A]" : "block h-full bg-gold"}
                      style={{ width: `${Math.max(ratio * 100, 4)}%` }}
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const QUICK_LINKS: { href: string; label: string; text: string; icon: LucideIcon }[] = [
  { href: "/panel/siparisler", label: "Siparişler", text: "Ödeme onayı, kargo ve faturalar", icon: ShoppingBag },
  { href: "/panel/urunler", label: "Ürünler", text: "Varyant, fiyat ve stokları inceleyin", icon: Package },
  { href: "/panel/sayfalar", label: "Sayfalar & Bölümler", text: "Ana sayfa içeriğini düzenleyin", icon: PanelsTopLeft },
  { href: "/panel/tema", label: "Tema & Renkler", text: "Marka ve dönemsel temalar", icon: Palette },
  { href: "/panel/ayarlar", label: "Ayarlar", text: "Kargo, ödeme ve firma bilgileri", icon: Settings },
  { href: "/panel/kampanyalar", label: "Kampanyalar", text: "İndirimleri planlayın", icon: Megaphone },
  { href: "/panel/mesajlar", label: "Mesajlar", text: "İletişim formundan gelenler", icon: Inbox },
];

const quickLinkClass =
  "group flex h-full items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-gold/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Shortcuts the viewer may open (items above their role are left out). */
async function QuickLinks() {
  const { staffRole } = await requireStaff();
  const links = QUICK_LINKS.filter((link) => {
    const item = findNavItem(link.href);
    return !item || canSeeNavItem(item, staffRole);
  }).slice(0, 5);
  return (
    <section aria-labelledby="quick-links-title">
      <h2 id="quick-links-title" className="eyebrow">
        Hızlı erişim
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {links.map(({ href, label, text, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className={quickLinkClass}>
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-gold-text" strokeWidth={1.75} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{label}</span>
                <span className="mt-0.5 block text-xs text-text-muted">{text}</span>
              </span>
              <ArrowUpRight
                aria-hidden
                className="ms-auto size-3.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none"
              />
            </Link>
          </li>
        ))}
        <li>
          <a href="/tr" target="_blank" rel="noopener" className={quickLinkClass}>
            <ExternalLink aria-hidden className="mt-0.5 size-4 shrink-0 text-gold-text" strokeWidth={1.75} />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-text">Siteyi görüntüle</span>
              <span className="mt-0.5 block text-xs text-text-muted">Mağazayı yeni sekmede açın</span>
            </span>
          </a>
        </li>
      </ul>
    </section>
  );
}

function QuickLinksSkeleton() {
  return (
    <section aria-hidden>
      <Skeleton className="h-3 w-24" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    </section>
  );
}

function SalesSkeleton() {
  return (
    <div role="status" className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <span className="sr-only">Yükleniyor…</span>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-3 h-9 w-40" />
          <Skeleton className="mt-3 h-3 w-36" />
          <Skeleton className="mt-6 h-3 w-48" />
        </div>
      ))}
    </div>
  );
}
