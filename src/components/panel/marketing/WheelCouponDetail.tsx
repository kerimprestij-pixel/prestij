"use client";
// A gift wheel prize coupon (day 6), read-only: the wheel issued it to one account, single use, with a
// real expiry. Staff can see who won what, when, and which order used it, and may only deactivate it
// (e.g. abuse); editing, deleting and re-activating are refused by the service too.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Ban, Gift } from "lucide-react";
import { setCouponActiveAction } from "@/app/panel/(dashboard)/kuponlar/actions";
import Card from "@/components/panel/Card";
import { formatDateTime, formatNumber, ORDER_STATUS } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import StatusBadge from "@/components/panel/StatusBadge";
import { Button, ConfirmDialog } from "@/components/panel/ui";
import type { WheelCouponDetail as Detail } from "@/lib/panel/marketing/queries";
import { formatPrice } from "@/lib/pricing/money";
import { couponValueLabel, WHEEL_BOUND_VIA, WHEEL_COUPON_STATUS } from "./labels";
import { useActionRunner } from "./use-action-runner";

const LIST_PATH = "/panel/kuponlar";
const WHEEL_PATH = "/panel/hediye-carki";

type Props = {
  /** owner.email arrives already masked for editors (the page masks it on the server; admins see it in full). */
  coupon: Detail;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-end text-sm text-text">{children}</dd>
    </div>
  );
}

export default function WheelCouponDetail({ coupon }: Props) {
  const router = useRouter();
  const runner = useActionRunner();
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState({ isActive: coupon.isActive, updatedAt: coupon.updatedAt, status: coupon.status });
  const status = WHEEL_COUPON_STATUS[state.status];
  const prizeLabel = coupon.spin?.label.tr || couponValueLabel(coupon.type, coupon.value);

  const deactivate = () =>
    runner.run(setCouponActiveAction, { id: coupon.id, isActive: false, updatedAt: state.updatedAt }, {
      onSuccess: (data) => {
        setConfirming(false);
        setState((s) => ({ isActive: false, updatedAt: data?.updatedAt ?? s.updatedAt, status: s.status === "used" ? "used" : "inactive" }));
        router.refresh();
      },
    });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={LIST_PATH}
          className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Kuponlar
        </Link>
      </div>
      <PageHeader
        eyebrow="Pazarlama · Hediye çarkı"
        title={<span className="font-mono tracking-wide">{coupon.code}</span>}
        description="Hediye çarkı ödülü: yalnızca kazanan hesap, bir kez kullanabilir. Çark tarafından verildiği için düzenlenemez ve silinemez; gerekirse pasifleştirebilirsiniz."
        actions={
          <>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {state.isActive ? (
              <Button variant="danger-outline" icon={Ban} onClick={() => setConfirming(true)}>
                Pasifleştir
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mx-auto grid max-w-4xl gap-6 pb-12 lg:grid-cols-2">
        <Card title="Ödül">
          <dl className="-my-2.5 divide-y divide-border">
            <Row label="Hediye">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Gift aria-hidden className="size-4 text-gold-text dark:text-gold" />
                {prizeLabel}
              </span>
            </Row>
            <Row label="İndirim">{couponValueLabel(coupon.type, coupon.value)}</Row>
            <Row label="En düşük sepet">{coupon.minOrderTotal > 0 ? formatPrice(coupon.minOrderTotal, "tr") : "Yok"}</Row>
            <Row label="Kullanım">
              <span className="tabular-nums">
                {formatNumber(coupon.usedCount)} / {formatNumber(coupon.maxUses ?? 1)}
              </span>
            </Row>
            <Row label="Verildiği an">{coupon.startsAt ? formatDateTime(coupon.startsAt) : formatDateTime(coupon.createdAt)}</Row>
            <Row label="Son kullanım">{coupon.endsAt ? formatDateTime(coupon.endsAt) : "—"}</Row>
          </dl>
        </Card>

        <Card title="Kazanan">
          <dl className="-my-2.5 divide-y divide-border">
            <Row label="Hesap">
              {coupon.owner ? (
                <Link
                  href={`/panel/musteriler/${encodeURIComponent(coupon.owner.id)}`}
                  className="rounded underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="block font-medium">{coupon.owner.name}</span>
                  <span className="block text-xs text-text-muted">{coupon.owner.email}</span>
                </Link>
              ) : (
                "—"
              )}
            </Row>
            {coupon.spin ? (
              <>
                <Row label="Tur">{formatNumber(coupon.spin.round)}. tur</Row>
                <Row label="Dilim">
                  <span className="font-mono text-xs">{coupon.spin.sliceKey}</span>
                </Row>
                <Row label="Nasıl alındı">{coupon.spin.boundVia ? WHEEL_BOUND_VIA[coupon.spin.boundVia] : "—"}</Row>
                <Row label="Çark çevrildi">{formatDateTime(coupon.spin.spunAt)}</Row>
                <Row label="Hediye alındı">{coupon.spin.claimedAt ? formatDateTime(coupon.spin.claimedAt) : "—"}</Row>
              </>
            ) : (
              <Row label="Çevirme kaydı">Bulunamadı (temizlenmiş olabilir)</Row>
            )}
          </dl>
        </Card>

        <Card
          title="Siparişler"
          description="İptal edilen bir sipariş, ödülü süresi bitene kadar yeniden kullanılabilir yapar."
          className="lg:col-span-2"
          flush
        >
          {coupon.orders.length === 0 ? (
            <p className="px-5 py-6 text-sm text-text-muted">Bu kodla henüz sipariş verilmedi.</p>
          ) : (
            <ul className="divide-y divide-border">
              {coupon.orders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/panel/siparisler/${order.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-sm font-medium text-text">{order.orderNumber}</span>
                      <span className="block text-xs text-text-muted">{formatDateTime(order.createdAt)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-sm tabular-nums text-text">{formatPrice(order.grandTotal, "tr")}</span>
                      <StatusBadge tone={ORDER_STATUS[order.status].tone}>{ORDER_STATUS[order.status].label}</StatusBadge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-sm text-text-muted lg:col-span-2">
          Tüm kazananlar, ödül istatistikleri ve çark ayarları:{" "}
          <Link href={WHEEL_PATH} className="font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Pazarlama → Hediye Çarkı
          </Link>
        </p>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={deactivate}
        pending={runner.pending}
        tone="default"
        title="Hediye kodu pasifleştirilsin mi?"
        description={`“${coupon.code}” artık sepette kabul edilmez ve kazanan hesabın sepetine otomatik uygulanmaz. Bu işlem geri alınamaz: hediye çarkı kodları yeniden etkinleştirilemez.`}
        confirmLabel="Pasifleştir"
      />
    </div>
  );
}
