import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { Repeat, Search, SearchX, Settings2 } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDate, formatNumber } from "@/components/panel/labels";
import FilterTabs, { type FilterTab } from "@/components/panel/marketing/FilterTabs";
import { PAYMENT_METHOD_SHORT } from "@/components/panel/orders/labels";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import SectionTabs from "@/components/panel/subscriptions/SectionTabs";
import { SUBSCRIPTION_STATUS, SUBSCRIPTIONS_BASE } from "@/components/panel/subscriptions/labels";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { buttonClass } from "@/components/panel/ui";
import { hasRole } from "@/lib/panel/roles";
import { requireStaff } from "@/lib/session";
import { listPanelSubscriptions } from "@/lib/subscriptions/queries";
import type { SubscriptionStatus } from "@/lib/subscriptions/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Abonelikler" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS: (FilterTab & { status: SubscriptionStatus | null })[] = [
  { param: null, label: "Tümü", status: null },
  { param: "aktif", label: "Aktif", status: "active" },
  { param: "duraklatildi", label: "Duraklatıldı", status: "paused" },
  { param: "odeme-bekleniyor", label: "Ödeme bekleniyor", status: "past_due" },
  { param: "iptal", label: "İptal edildi", status: "cancelled" },
];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function SubscriptionsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Satış"
        title="Abonelikler"
        description="Abone ol ve kazan ile başlayan düzenli siparişler: sonraki sipariş tarihi, yenileme siparişleri ve müşteri adına duraklatma veya iptal."
        actions={
          <Suspense fallback={null}>
            <SettingsLink />
          </Suspense>
        }
      />
      <SectionTabs active="list" />
      <Suspense
        fallback={
          <>
            <div className="flex flex-col gap-3">
              <FilterTabs base={SUBSCRIPTIONS_BASE} tabs={TABS} active={undefined} label="Abonelik durumu" />
              <Skeleton className="h-10 w-full max-w-md rounded-lg" />
            </div>
            <TableSkeleton rows={5} />
          </>
        }
      >
        <SubscriptionList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** The settings page is admin only: editors and staff would only be sent back. */
async function SettingsLink() {
  const { staffRole } = await requireStaff("staff");
  if (!hasRole(staffRole, "admin")) return null;
  return (
    <Link href="/panel/ayarlar/abonelik" className={buttonClass("secondary")}>
      <Settings2 aria-hidden className="size-4" />
      Abonelik ayarları
    </Link>
  );
}

async function SubscriptionList({ searchParams }: { searchParams: SearchParams }) {
  const { staffRole } = await requireStaff("staff");
  const params = await searchParams;
  const tab = TABS.find((t) => t.param === first(params.durum)) ?? TABS[0];
  const q = (first(params.ara) ?? "").trim().slice(0, 80);
  const { rows, counts } = await listPanelSubscriptions({ status: tab.status, q });
  const tabCounts = Object.fromEntries(TABS.map((t) => [t.param ?? "", t.status ? counts[t.status] : counts.all]));

  return (
    <>
      <div className="flex flex-col gap-3">
        <FilterTabs base={SUBSCRIPTIONS_BASE} tabs={TABS} active={tab.param} counts={tabCounts} label="Abonelik durumu" extraQuery={{ ara: q }} />
        <Form action={SUBSCRIPTIONS_BASE} role="search" aria-label="Aboneliklerde ara" className="relative w-full max-w-md">
          {tab.param ? <input type="hidden" name="durum" value={tab.param} /> : null}
          <label htmlFor="subscription-search" className="sr-only">
            Müşteri adı, e-posta veya abonelik no
          </label>
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            id="subscription-search"
            name="ara"
            type="search"
            defaultValue={q}
            maxLength={80}
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Müşteri, e-posta veya abonelik no…"
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
        title={q ? `“${q}” için ${formatNumber(rows.length)} abonelik` : `${formatNumber(rows.length)} abonelik`}
        description={hasRole(staffRole, "editor") ? "Aktif olanlar önce, en yakın sipariş tarihi üstte. Duraklatma ve iptal detay sayfasından yapılır." : "Aktif olanlar önce, en yakın sipariş tarihi üstte."}
        flush
      >
        {rows.length === 0 ? (
          counts.all === 0 && !q ? (
            <EmptyState
              icon={Repeat}
              title="Henüz abonelik yok"
              description="Müşteriler ürün sayfasında “Abone ol” seçeneğiyle sipariş verdiğinde abonelikler burada listelenir."
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="Eşleşen abonelik yok"
              description="Başka bir sekme seçin veya aramayı temizleyin."
              action={
                <Link href={SUBSCRIPTIONS_BASE} className="text-sm font-medium text-text underline underline-offset-4">
                  Tüm abonelikler
                </Link>
              }
            />
          )
        ) : (
          <>
            <ul className="divide-y divide-border md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`${SUBSCRIPTIONS_BASE}/${row.id}`}
                    className="block px-4 py-3.5 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-medium text-text">{row.customerName}</span>
                      <StatusBadge tone={SUBSCRIPTION_STATUS[row.status].tone}>{SUBSCRIPTION_STATUS[row.status].label}</StatusBadge>
                    </span>
                    <span className="mt-1 block text-sm text-text">
                      #{row.id} · {row.planName}
                      {row.percent > 0 ? ` · %${row.percent}` : ""} · {formatNumber(row.itemCount)} ürün
                    </span>
                    <span className="mt-1 block text-xs text-text-muted">{nextLabel(row)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="relative hidden overflow-x-auto md:block">
              <table className={cn(tableClass, "min-w-[52rem]")}>
                <caption className="sr-only">Abonelikler</caption>
                <thead className={theadClass}>
                  <tr>
                    <th scope="col" className={thClass}>Abonelik</th>
                    <th scope="col" className={thClass}>Müşteri</th>
                    <th scope="col" className={thClass}>Plan</th>
                    <th scope="col" className={thClass}>Sonraki sipariş</th>
                    <th scope="col" className={cn(thClass, "text-end")}>Yenileme</th>
                    <th scope="col" className={thClass}>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className={cn(trClass, "relative")}>
                      <td className={tdClass}>
                        <Link
                          href={`${SUBSCRIPTIONS_BASE}/${row.id}`}
                          className="font-medium tabular-nums text-text underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-offset-[-2px] focus-visible:before:outline-ring"
                        >
                          #{row.id}
                        </Link>
                        <span className="block text-xs text-text-muted">{formatDate(row.createdAt)}</span>
                      </td>
                      <td className={tdClass}>
                        <span className="block max-w-56 truncate text-text">{row.customerName}</span>
                        <span className="block max-w-56 truncate text-xs text-text-muted">{row.email}</span>
                      </td>
                      <td className={tdClass}>
                        <span className="block text-text">{row.planName}</span>
                        <span className="block text-xs text-text-muted">
                          {[row.percent > 0 ? `%${row.percent} indirim` : null, PAYMENT_METHOD_SHORT[row.paymentMethod], `${formatNumber(row.itemCount)} ürün`].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className={cn(tdClass, "text-sm")}>{nextLabel(row)}</td>
                      <td className={cn(tdClass, "text-end tabular-nums")}>{formatNumber(row.renewals)}</td>
                      <td className={tdClass}>
                        <StatusBadge tone={SUBSCRIPTION_STATUS[row.status].tone}>{SUBSCRIPTION_STATUS[row.status].label}</StatusBadge>
                        {row.failedCount > 0 && row.status === "active" ? <span className="mt-1 block text-xs text-[#C2413A]">{row.failedCount} başarısız deneme</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function nextLabel(row: { status: SubscriptionStatus; nextRunAt: string; skipNext: boolean }): string {
  if (row.status === "cancelled") return "—";
  if (row.status === "paused") return "Duraklatıldı";
  return row.skipNext ? `${formatDate(row.nextRunAt)} (atlanacak)` : formatDate(row.nextRunAt);
}
