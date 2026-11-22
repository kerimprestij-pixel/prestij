import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Megaphone, Plus } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatNumber } from "@/components/panel/labels";
import FilterTabs, { type FilterTab } from "@/components/panel/marketing/FilterTabs";
import { CAMPAIGN_STATUS, windowLabel } from "@/components/panel/marketing/labels";
import PageHeader from "@/components/panel/PageHeader";
import { TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { buttonClass } from "@/components/panel/ui";
import { formatPercentOff } from "@/lib/campaigns/display";
import { listPanelCampaigns, type CampaignListRow, type CampaignStatus } from "@/lib/panel/marketing/queries";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Kampanyalar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const BASE = "/panel/kampanyalar";
const TABS: (FilterTab & { status: CampaignStatus | null })[] = [
  { param: null, label: "Tümü", status: null },
  { param: "yayinda", label: "Yayında", status: "live" },
  { param: "planlandi", label: "Planlandı", status: "scheduled" },
  { param: "bitti", label: "Bitti", status: "ended" },
  { param: "durduruldu", label: "Durduruldu", status: "inactive" },
];

export default function CampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pazarlama"
        title="Kampanyalar"
        description="Kod gerektirmeyen otomatik indirimler. Vitrinde rozet ve üstü çizili fiyatla görünür; sepette aynı fiyat uygulanır."
        actions={
          <Link href={`${BASE}/yeni`} className={buttonClass("primary")}>
            <Plus aria-hidden className="size-4" />
            Yeni kampanya
          </Link>
        }
      />
      <Suspense
        fallback={
          <>
            <FilterTabs base={BASE} tabs={TABS} active={undefined} label="Kampanya durumu" />
            <TableSkeleton rows={4} />
          </>
        }
      >
        <CampaignList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CampaignList({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff("editor");
  const [params, rows] = await Promise.all([searchParams, listPanelCampaigns()]);
  const param = Array.isArray(params.durum) ? params.durum[0] : params.durum;
  const tab = TABS.find((t) => t.param === param) ?? TABS[0];
  const withStatus = rows.map((row) => ({ row, status: row.status }));
  const counts = Object.fromEntries(TABS.map((t) => [t.param ?? "", t.status ? withStatus.filter((r) => r.status === t.status).length : rows.length]));
  const shown = tab.status ? withStatus.filter((r) => r.status === tab.status) : withStatus;

  return (
    <>
      <FilterTabs base={BASE} tabs={TABS} active={tab.param} counts={counts} label="Kampanya durumu" />
      <Card title={`${formatNumber(shown.length)} kampanya`} description={tab.status ? tab.label : "Etkin olanlar önce, önceliğe göre"} flush>
        {shown.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={rows.length === 0 ? "Henüz kampanya yok" : `“${tab.label}” durumunda kampanya yok`}
            description={
              rows.length === 0
                ? "İlk kampanyanızı oluşturun: örneğin hafta sonu 5 L ürünlerde %15 indirim. Rozet ve indirimli fiyat vitrinde kendiliğinden görünür."
                : "Başka bir sekme seçin."
            }
            action={
              rows.length === 0 ? (
                <Link href={`${BASE}/yeni`} className={buttonClass("primary")}>
                  <Plus aria-hidden className="size-4" />
                  Yeni kampanya
                </Link>
              ) : (
                <Link href={BASE} className="text-sm font-medium text-text underline underline-offset-4">
                  Tüm kampanyalar
                </Link>
              )
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-border md:hidden">
              {shown.map(({ row, status }) => (
                <li key={row.id}>
                  <Link
                    href={`${BASE}/${row.id}`}
                    className="block px-4 py-3.5 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-medium text-text">{row.name}</span>
                      <StatusBadge tone={CAMPAIGN_STATUS[status].tone}>{CAMPAIGN_STATUS[status].label}</StatusBadge>
                    </span>
                    <span className="mt-1 block text-sm text-text">
                      <span className="font-medium tabular-nums">{formatPercentOff(row.discountPercent, "tr")}</span> · {scopeLabel(row)}
                    </span>
                    <span className="mt-1 block truncate text-xs text-text-muted">{windowLabel(row.startsAt, row.endsAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="relative hidden overflow-x-auto md:block">
              <table className={cn(tableClass, "min-w-[46rem]")}>
                <caption className="sr-only">Kampanyalar</caption>
                <thead className={theadClass}>
                  <tr>
                    <th scope="col" className={thClass}>Kampanya</th>
                    <th scope="col" className={cn(thClass, "text-end")}>İndirim</th>
                    <th scope="col" className={thClass}>Kapsam</th>
                    <th scope="col" className={thClass}>Geçerlilik</th>
                    <th scope="col" className={cn(thClass, "text-end")}>Öncelik</th>
                    <th scope="col" className={thClass}>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ row, status }) => (
                    <tr key={row.id} className={cn(trClass, "relative")}>
                      <td className={tdClass}>
                        <Link
                          href={`${BASE}/${row.id}`}
                          className="font-medium text-text underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-offset-[-2px] focus-visible:before:outline-ring"
                        >
                          {row.name}
                        </Link>
                        <span className="block max-w-64 truncate text-xs text-text-muted">
                          {row.label?.tr ? `Rozet: ${row.label.tr}` : "Rozet: indirim oranı"}
                          {row.themeName ? ` · Tema: ${row.themeName}` : ""}
                        </span>
                      </td>
                      <td className={cn(tdClass, "whitespace-nowrap text-end font-medium tabular-nums")}>{formatPercentOff(row.discountPercent, "tr")}</td>
                      <td className={tdClass}>
                        <span className="block max-w-64 truncate">{scopeLabel(row)}</span>
                        <span className="block text-xs text-text-muted">{row.customerGroupNames.length ? `Yalnızca: ${row.customerGroupNames.join(", ")}` : "Herkes"}</span>
                      </td>
                      <td className={cn(tdClass, "text-xs text-text-muted")}>{windowLabel(row.startsAt, row.endsAt)}</td>
                      <td className={cn(tdClass, "text-end tabular-nums")}>{formatNumber(row.priority)}</td>
                      <td className={tdClass}>
                        <StatusBadge tone={CAMPAIGN_STATUS[status].tone}>{CAMPAIGN_STATUS[status].label}</StatusBadge>
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

function scopeLabel(row: CampaignListRow): string {
  const parts: string[] = [];
  if (row.productNames.length) parts.push(row.productNames.length <= 2 ? row.productNames.join(", ") : `${formatNumber(row.productNames.length)} ürün`);
  if (row.categoryNames.length) parts.push(row.categoryNames.length <= 2 ? `Kategori: ${row.categoryNames.join(", ")}` : `${formatNumber(row.categoryNames.length)} kategori`);
  return parts.length ? parts.join(" + ") : "Tüm ürünler";
}
