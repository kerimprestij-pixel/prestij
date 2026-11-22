import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { Gift, Plus, Search, SearchX, TicketPercent } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatNumber } from "@/components/panel/labels";
import FilterTabs, { type FilterTab } from "@/components/panel/marketing/FilterTabs";
import { COUPON_STATUS, COUPON_TYPE, couponValueLabel, windowLabel } from "@/components/panel/marketing/labels";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { buttonClass } from "@/components/panel/ui";
import { findCouponByCode, listPanelCoupons, type CouponListRow } from "@/lib/panel/marketing/queries";
import type { ScheduleStatus } from "@/lib/panel/marketing/status";
import { formatPrice } from "@/lib/pricing/money";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";
import { WHEEL_CODE_PATTERN } from "@/lib/wheel/types";

export const metadata: Metadata = { title: "Kuponlar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const BASE = "/panel/kuponlar";
const TABS: (FilterTab & { status: ScheduleStatus | null })[] = [
  { param: null, label: "Tümü", status: null },
  { param: "gecerli", label: "Geçerli", status: "live" },
  { param: "planlandi", label: "Planlandı", status: "scheduled" },
  { param: "doldu", label: "Limit doldu", status: "exhausted" },
  { param: "bitti", label: "Süresi doldu", status: "ended" },
  { param: "pasif", label: "Pasif", status: "inactive" },
];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function CouponsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pazarlama"
        title="Kuponlar"
        description={
          <>
            Müşterilerin sepette yazdığı indirim kodları: oran veya tutar indirimi, ücretsiz kargo, kullanım limitleri ve geçerlilik tarihleri. Hediye çarkı
            ödülleri (CARK-…) burada listelenmez; onları{" "}
            <Link href="/panel/hediye-carki" className="font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              Hediye Çarkı
            </Link>{" "}
            sayfasında bulabilirsiniz.
          </>
        }
        actions={
          <Link href={`${BASE}/yeni`} className={buttonClass("primary")}>
            <Plus aria-hidden className="size-4" />
            Yeni kupon
          </Link>
        }
      />
      <Suspense
        fallback={
          <>
            <div className="flex flex-col gap-3">
              <FilterTabs base={BASE} tabs={TABS} active={undefined} label="Kupon durumu" />
              <Skeleton className="h-10 w-full max-w-md rounded-lg" />
            </div>
            <TableSkeleton rows={5} />
          </>
        }
      >
        <CouponList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CouponList({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff("editor");
  const [params, rows] = await Promise.all([searchParams, listPanelCoupons()]);
  const tab = TABS.find((t) => t.param === first(params.durum)) ?? TABS[0];
  const q = (first(params.ara) ?? "").trim().slice(0, 64);
  const needle = q.toUpperCase().replace(/\s+/g, "");
  // Day 6: a gift wheel code is not in this list, but a search for one leads to its read-only page.
  const wheelHit = WHEEL_CODE_PATTERN.test(needle) ? await findCouponByCode(needle) : null;
  const wheelCoupon = wheelHit?.source === "wheel" ? wheelHit : null;
  const withStatus = rows.map((row) => ({ row, status: row.status }));
  const searched = needle ? withStatus.filter(({ row }) => row.code.includes(needle) || (row.description ?? "").toLocaleUpperCase("tr").includes(q.toLocaleUpperCase("tr"))) : withStatus;
  const counts = Object.fromEntries(TABS.map((t) => [t.param ?? "", t.status ? searched.filter((r) => r.status === t.status).length : searched.length]));
  const shown = tab.status ? searched.filter((r) => r.status === tab.status) : searched;

  return (
    <>
      <div className="flex flex-col gap-3">
        <FilterTabs base={BASE} tabs={TABS} active={tab.param} counts={counts} label="Kupon durumu" extraQuery={{ ara: q }} />
        <Form action={BASE} role="search" aria-label="Kuponlarda ara" className="relative w-full max-w-md">
          {tab.param ? <input type="hidden" name="durum" value={tab.param} /> : null}
          <label htmlFor="coupon-search" className="sr-only">
            Kod veya açıklama
          </label>
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            id="coupon-search"
            name="ara"
            type="search"
            defaultValue={q}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="Kod veya açıklama…"
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

      {wheelCoupon ? (
        <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-gold/40 bg-gold-50 px-4 py-3 text-sm text-text dark:bg-gold-950/40">
          <Gift aria-hidden className="size-4 shrink-0 text-gold-text dark:text-gold" />
          <span>
            <span className="font-mono font-medium">{wheelCoupon.code}</span> bir hediye çarkı ödülü.
          </span>
          <Link
            href={`${BASE}/${wheelCoupon.id}`}
            className="font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Ödülü görüntüle
          </Link>
        </p>
      ) : null}

      <Card title={q ? `“${q}” için ${formatNumber(shown.length)} kupon` : `${formatNumber(shown.length)} kupon`} description={tab.status ? tab.label : "Etkin olanlar önce, en yeni üstte"} flush>
        {shown.length === 0 ? (
          rows.length === 0 ? (
            <EmptyState
              icon={TicketPercent}
              title="Henüz kupon yok"
              description="Bir indirim kodu oluşturun; örneğin ilk siparişe %10 veya 750 ₺ üzeri ücretsiz kargo. Müşteriler kodu sepette yazar."
              action={
                <Link href={`${BASE}/yeni`} className={buttonClass("primary")}>
                  <Plus aria-hidden className="size-4" />
                  Yeni kupon
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="Eşleşen kupon yok"
              description="Başka bir sekme seçin veya aramayı temizleyin."
              action={
                <Link href={BASE} className="text-sm font-medium text-text underline underline-offset-4">
                  Tüm kuponlar
                </Link>
              }
            />
          )
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
                      <span className="min-w-0 truncate font-mono font-medium tracking-wide text-text">{row.code}</span>
                      <StatusBadge tone={COUPON_STATUS[status].tone}>{COUPON_STATUS[status].label}</StatusBadge>
                    </span>
                    <span className="mt-1 block text-sm text-text">
                      {couponValueLabel(row.type, row.value)} · {usageLabel(row)}
                    </span>
                    <span className="mt-1 block truncate text-xs text-text-muted">{windowLabel(row.startsAt, row.endsAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="relative hidden overflow-x-auto md:block">
              <table className={cn(tableClass, "min-w-[46rem]")}>
                <caption className="sr-only">Kuponlar</caption>
                <thead className={theadClass}>
                  <tr>
                    <th scope="col" className={thClass}>Kod</th>
                    <th scope="col" className={thClass}>İndirim</th>
                    <th scope="col" className={cn(thClass, "text-end")}>Kullanım</th>
                    <th scope="col" className={thClass}>Geçerlilik</th>
                    <th scope="col" className={thClass}>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ row, status }) => (
                    <tr key={row.id} className={cn(trClass, "relative")}>
                      <td className={tdClass}>
                        <Link
                          href={`${BASE}/${row.id}`}
                          className="font-mono font-medium tracking-wide text-text underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-offset-[-2px] focus-visible:before:outline-ring"
                        >
                          {row.code}
                        </Link>
                        {row.description ? <span className="block max-w-56 truncate text-xs text-text-muted">{row.description}</span> : null}
                      </td>
                      <td className={tdClass}>
                        <span className="block font-medium tabular-nums">{couponValueLabel(row.type, row.value)}</span>
                        <span className="block text-xs text-text-muted">
                          {[
                            row.type === "free_shipping" ? null : COUPON_TYPE[row.type],
                            row.minOrderTotal > 0 ? `${formatPrice(row.minOrderTotal, "tr")} üzeri` : null,
                            row.scoped ? "seçili ürünler" : null,
                            row.grouped ? "seçili gruplar" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Tüm sepet"}
                        </span>
                      </td>
                      <td className={cn(tdClass, "whitespace-nowrap text-end tabular-nums")}>{usageLabel(row)}</td>
                      <td className={cn(tdClass, "text-xs text-text-muted")}>{windowLabel(row.startsAt, row.endsAt)}</td>
                      <td className={tdClass}>
                        <StatusBadge tone={COUPON_STATUS[status].tone}>{COUPON_STATUS[status].label}</StatusBadge>
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

function usageLabel(row: CouponListRow): string {
  return row.maxUses != null ? `${formatNumber(row.usedCount)} / ${formatNumber(row.maxUses)}` : `${formatNumber(row.usedCount)} kez`;
}
