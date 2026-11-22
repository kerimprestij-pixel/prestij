import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Banknote, ChartColumn, FerrisWheel, Gift, RotateCw, Settings2, ShoppingBag, UserPlus } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import PeriodTabs from "@/components/panel/gift-wheel/PeriodTabs";
import WheelDailyChart from "@/components/panel/gift-wheel/WheelDailyChart";
import WheelPageHeader from "@/components/panel/gift-wheel/WheelPageHeader";
import WheelSliceTable from "@/components/panel/gift-wheel/WheelSliceTable";
import WheelTabs from "@/components/panel/gift-wheel/WheelTabs";
import KpiCard from "@/components/panel/KpiCard";
import { formatNumber, type Tone } from "@/components/panel/labels";
import { KpiGridSkeleton, Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { buttonClass } from "@/components/panel/ui";
import { db } from "@/db";
import {
  parseWheelPeriod,
  WHEEL_SETTINGS_PATH,
  winnersListHref,
  type WheelPeriod,
} from "@/lib/panel/gift-wheel/filters";
import { formatHours, formatRatio, WHEEL_SCHEDULE_STATUS, wheelScheduleStatus } from "@/lib/panel/gift-wheel/labels";
import { getWheelDaily, getWheelPeriodStats, getWheelSliceStats } from "@/lib/panel/gift-wheel/queries";
import { formatIstanbul } from "@/lib/panel/format";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { formatPrice } from "@/lib/pricing/money";
import { requireStaff } from "@/lib/session";
import type { Settings } from "@/lib/settings/types";

export const metadata: Metadata = { title: "Hediye Çarkı" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function GiftWheelOverviewPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <WheelPageHeader
        actions={
          <Link href={WHEEL_SETTINGS_PATH} className={buttonClass("secondary")}>
            <Settings2 aria-hidden className="size-4" />
            Ayarlar
          </Link>
        }
      />
      <WheelTabs active="overview" />
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodTabs active={undefined} />
      </div>
      <KpiGridSkeleton count={5} />
      <TableSkeleton rows={4} title="Günlük etkinlik" />
    </div>
  );
}

async function Overview({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff("editor");
  const params = await searchParams;
  const period = parseWheelPeriod(params);
  const row = await readSettingsRow("giftWheel");
  const config = row.value;
  const [stats, daily, slices] = await Promise.all([
    getWheelPeriodStats(db, period),
    getWheelDaily(db, period),
    getWheelSliceStats(db, period, config.slices),
  ]);
  const status = wheelScheduleStatus(config, stats.now);
  const statusMeta = WHEEL_SCHEDULE_STATUS[status];

  return (
    <div className="space-y-6">
      <StatusCard
        statusLabel={statusMeta.label}
        statusTone={statusMeta.tone}
        description={statusLine(status, config)}
        neverSaved={row.updatedAt === null}
      />

      {stats.allTimeSpins === 0 ? (
        <Card>
          <EmptyState
            icon={FerrisWheel}
            title="Çark henüz hiç çevrilmedi"
            description={
              status === "live"
                ? "Çark yayında. İlk çevirmeler geldikçe sayılar burada görünür."
                : "Dilimleri ve tarihleri kontrol edin, çarkı açın. İlk çevirmeler geldikçe sayılar burada görünür."
            }
            action={
              status === "live" ? null : (
                <Link href={WHEEL_SETTINGS_PATH} className={buttonClass("primary")}>
                  <Settings2 aria-hidden className="size-4" />
                  Ayarlara git
                </Link>
              )
            }
          />
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodTabs active={period} />
        <p className="text-xs text-text-muted">Türkiye saatiyle, bugün dahil son {period} gün.</p>
      </div>

      <Kpis stats={stats} period={period} />

      <Card title="Günlük etkinlik" description="Bir sütunun üzerine gelin ya da grafiği seçip ok tuşlarıyla gezinin; o günün tüm sayıları görünür.">
        <div id="gunluk" className="scroll-mt-24">
          <WheelDailyChart days={daily} />
        </div>
      </Card>

      <Card
        title="Dilimlere göre"
        description="Gerçek pay, bu dönemde dilimin kaç çevirmede çıktığıdır; çevirme sayısı arttıkça ayarlanan paya (ince çizgi) yaklaşır."
        flush
      >
        {slices.length > 0 ? (
          <WheelSliceTable rows={slices} />
        ) : (
          <EmptyState icon={ChartColumn} title="Dilim yok" description="Ayarlar sekmesinden çarka dilim ekleyin." />
        )}
      </Card>

      <Definitions />
    </div>
  );
}

function statusLine(
  status: ReturnType<typeof wheelScheduleStatus>,
  config: Settings<"giftWheel">,
): string {
  const facts = [`${config.slices.length} dilim`, `hediye ${formatHours(config.validityHours)} geçerli`, `${config.round}. tur`];
  if (status === "scheduled" && config.startsAt) return `${formatIstanbul(config.startsAt)} tarihinde açılacak · ${facts.join(" · ")}`;
  if (status === "live" && config.endsAt) return `${formatIstanbul(config.endsAt)} tarihine kadar yayında · ${facts.join(" · ")}`;
  if (status === "ended" && config.endsAt) return `${formatIstanbul(config.endsAt)} tarihinde bitti · ${facts.join(" · ")}`;
  if (status === "off") return `Sitede görünmüyor · ${facts.join(" · ")}`;
  return facts.join(" · ");
}

function StatusCard({
  statusLabel,
  statusTone,
  description,
  neverSaved,
}: {
  statusLabel: string;
  statusTone: Tone;
  description: string;
  neverSaved: boolean;
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4" aria-label="Çark durumu">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
        <p className="min-w-0 text-sm text-text">{description}</p>
        {neverSaved ? <p className="basis-full text-xs text-text-muted">Ayarlar henüz kaydedilmedi; varsayılan değerler gösteriliyor.</p> : null}
      </div>
      <Link
        href={WHEEL_SETTINGS_PATH}
        className="shrink-0 rounded text-sm font-medium text-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Ayarları düzenle
      </Link>
    </section>
  );
}

function Kpis({ stats, period }: { stats: Awaited<ReturnType<typeof getWheelPeriodStats>>; period: WheelPeriod }) {
  const span = `Son ${period} gün`;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <KpiCard label="Çevirme" value={formatNumber(stats.spins)} hint={span} icon={RotateCw} href="#gunluk" />
      <KpiCard
        label="Hediyesini alan"
        value={formatNumber(stats.claims)}
        hint={`Alma oranı ${formatRatio(stats.claimedOfSpins, stats.spins)}`}
        icon={Gift}
        href={winnersListHref({})}
      />
      <KpiCard label="Çarkla üye olan" value={formatNumber(stats.signups)} hint="Çevirdikten sonra üye oldu" icon={UserPlus} href={winnersListHref({})} />
      <KpiCard
        label="Çark koduyla sipariş"
        value={formatNumber(stats.orders)}
        hint="Ödenmiş siparişler"
        icon={ShoppingBag}
        href={winnersListHref({ status: "used" })}
      />
      <KpiCard
        label="Ciro"
        value={formatPrice(stats.revenue, "tr")}
        hint="KDV dahil, çark kodlu siparişler"
        icon={Banknote}
        href={winnersListHref({ status: "used" })}
      />
    </div>
  );
}

function Definitions() {
  return (
    <details className="rounded-xl border border-border bg-surface px-5 py-4 text-sm">
      <summary className="cursor-pointer select-none font-medium text-text marker:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Sayılar nasıl hesaplanıyor?
      </summary>
      <dl className="mt-3 grid gap-x-6 gap-y-3 text-xs leading-relaxed text-text-muted sm:grid-cols-2">
        <div>
          <dt className="font-medium text-text">Çevirme</dt>
          <dd>Dönem içinde çarkı çeviren ziyaretçi sayısı. Aynı ziyaretçi bir turda yalnızca bir kez çevirebilir.</dd>
        </div>
        <div>
          <dt className="font-medium text-text">Hediyesini alan</dt>
          <dd>
            Dönem içinde hesabına hediye kodu tanımlanan kişi sayısı. Alma oranı: bu dönemde çevirenlerden kaçının hediyesini aldığı (bugüne kadar).
          </dd>
        </div>
        <div>
          <dt className="font-medium text-text">Çarkla üye olan</dt>
          <dd>Çarkı çevirdikten sonra yeni üyelik açan kişi sayısı (hesaba bağlandığı gün sayılır).</dd>
        </div>
        <div>
          <dt className="font-medium text-text">Çark koduyla sipariş ve ciro</dt>
          <dd>
            Dönem içinde verilen ve çark koduyla ödenen siparişler (ödendi, hazırlanıyor, kargoda, teslim edildi). Ciro KDV ve kargo dahil
            sipariş toplamıdır. İptal edilen siparişler sayılmaz.
          </dd>
        </div>
      </dl>
    </details>
  );
}
