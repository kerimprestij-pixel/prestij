import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import Card from "@/components/panel/Card";
import { formatDate, formatDateTime, formatNumber, ORDER_STATUS } from "@/components/panel/labels";
import Notice from "@/components/panel/Notice";
import { PAYMENT_METHOD_LABELS } from "@/components/panel/orders/labels";
import ProductThumb from "@/components/panel/ProductThumb";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import SubscriptionActions from "@/components/panel/subscriptions/SubscriptionActions";
import { rhythmLabel, SUBSCRIPTION_STATUS, SUBSCRIPTIONS_BASE } from "@/components/panel/subscriptions/labels";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { localeNames, isLocale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { hasRole } from "@/lib/panel/roles";
import { formatPrice } from "@/lib/pricing/money";
import { requireStaff } from "@/lib/session";
import { addressLines, describeItems, getSubscriptionDetail } from "@/lib/subscriptions/queries";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Abonelik detayı" };

type Params = Promise<{ id: string }>;

export default function SubscriptionDetailPage({ params }: { params: Params }) {
  return (
    <div className="space-y-6">
      <Link
        href={SUBSCRIPTIONS_BASE}
        className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        Abonelikler
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <Detail params={params} />
      </Suspense>
    </div>
  );
}

async function Detail({ params }: { params: Params }) {
  const { staffRole } = await requireStaff("staff");
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const sub = await getSubscriptionDetail(id);
  if (!sub) notFound();
  const [items, [owner]] = await Promise.all([
    describeItems(sub.items, "tr"),
    db.select({ name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, sub.userId)).limit(1),
  ]);
  const status = SUBSCRIPTION_STATUS[sub.status];
  const canEdit = hasRole(staffRole, "editor");
  const renewals = sub.orders.filter((o) => !o.first).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Abonelik #{sub.id}</p>
          <h1 className="mt-2 flex flex-wrap items-center gap-3 font-heading text-3xl font-medium leading-tight text-text sm:text-4xl">
            {owner?.name ?? sub.email}
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {[localize(sub.planName, "tr"), rhythmLabel(sub.interval, sub.intervalCount)].filter((x, i, all) => all.indexOf(x) === i).join(" · ")}
            {sub.percent > 0 ? ` · %${sub.percent} abone indirimi` : ""} · {formatDate(sub.createdAt)} tarihinde başladı
          </p>
        </div>
        {canEdit ? <SubscriptionActions id={sub.id} status={sub.status} updatedAt={sub.updatedAt} /> : null}
      </header>

      {sub.skipNext ? <Notice tone="info">Müşteri {formatDate(sub.nextRunAt)} tarihli teslimatı atladı; sonraki sipariş {formatDate(sub.followingRunAt ?? sub.nextRunAt)} tarihinde oluşturulacak.</Notice> : null}
      {sub.failedCount > 0 && sub.status === "active" ? (
        <Notice tone="warning">
          Son {formatNumber(sub.failedCount)} yenileme denemesi başarısız oldu (ör. stok tükendi veya ödeme yöntemi kapalı). Sistem her gün yeniden dener; müşteri dönem başına bir kez e-postayla bilgilendirilir.
        </Notice>
      ) : null}
      {!canEdit ? <Notice tone="info">Duraklatma ve iptal için editör veya yönetici yetkisi gerekir.</Notice> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="Ürünler" description="Her yenilemede güncel fiyat ve abone indirimiyle (ya da daha avantajlıysa kampanya fiyatıyla) sipariş oluşturulur." flush>
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.variantId} className="flex items-center gap-3 px-5 py-3">
                  <ProductThumb media={item.image} accentColor={item.accentColor} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{item.name}</p>
                    {item.detail ? <p className="truncate text-xs text-text-muted">{item.detail}</p> : null}
                  </div>
                  <span className="text-sm tabular-nums text-text-muted">× {formatNumber(item.quantity)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Siparişler" description={`İlk sipariş ve ${formatNumber(renewals)} yenileme siparişi`} flush>
            {sub.orders.length === 0 ? (
              <p className="px-5 py-4 text-sm text-text-muted">Henüz sipariş yok.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={cn(tableClass, "min-w-[36rem]")}>
                  <caption className="sr-only">Abonelik siparişleri</caption>
                  <thead className={theadClass}>
                    <tr>
                      <th scope="col" className={thClass}>Sipariş</th>
                      <th scope="col" className={thClass}>Tür</th>
                      <th scope="col" className={thClass}>Tarih</th>
                      <th scope="col" className={cn(thClass, "text-end")}>Tutar</th>
                      <th scope="col" className={thClass}>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.orders.map((o) => (
                      <tr key={o.id} className={cn(trClass, "relative")}>
                        <td className={cn(tdClass, "whitespace-nowrap")}>
                          <Link
                            href={`/panel/siparisler/${o.id}`}
                            className="font-medium tracking-wide text-text underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-offset-[-2px] focus-visible:before:outline-ring"
                          >
                            {o.orderNumber}
                          </Link>
                        </td>
                        <td className={cn(tdClass, "whitespace-nowrap text-sm")}>{o.first ? "İlk sipariş" : "Yenileme"}</td>
                        <td className={cn(tdClass, "text-sm text-text-muted")}>{formatDateTime(o.createdAt)}</td>
                        <td className={cn(tdClass, "text-end tabular-nums")}>{formatPrice(o.grandTotal, "tr")}</td>
                        <td className={tdClass}>
                          <StatusBadge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Takvim">
            <dl className="space-y-3 text-sm">
              <Row label="Sonraki sipariş" value={sub.status === "cancelled" ? "—" : sub.status === "paused" ? "Duraklatıldı" : formatDate(sub.nextRunAt)} />
              <Row label="Hatırlatma" value={sub.reminderSentAt ? `${formatDateTime(sub.reminderSentAt)} gönderildi` : "Henüz gönderilmedi"} />
              {sub.cancelledAt ? <Row label="İptal" value={formatDateTime(sub.cancelledAt)} /> : null}
              <Row label="Son değişiklik" value={formatDateTime(sub.updatedAt)} />
            </dl>
          </Card>
          <Card title="Müşteri">
            <dl className="space-y-3 text-sm">
              <Row label="Ad" value={owner?.name ?? "—"} />
              <div>
                <dt className="text-xs text-text-muted">E-posta (abonelik)</dt>
                <dd className="mt-0.5 flex items-center gap-2 break-all text-text">
                  <Mail aria-hidden className="size-3.5 shrink-0 text-text-muted" />
                  <a href={`mailto:${sub.email}`} className="underline-offset-4 hover:underline">
                    {sub.email}
                  </a>
                </dd>
              </div>
              <Row label="E-posta dili" value={isLocale(sub.locale) ? localeNames[sub.locale] : sub.locale} />
              <Row label="Ödeme yöntemi" value={PAYMENT_METHOD_LABELS[sub.paymentMethod]} />
            </dl>
          </Card>
          <Card title="Teslimat adresi">
            <address className="text-sm not-italic leading-relaxed text-text">
              {addressLines(sub.shippingAddress).map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </address>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-text">{value}</dd>
    </div>
  );
}
