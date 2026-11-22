import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ExternalLink, Mail, MessageCircle, Phone, Truck } from "lucide-react";
import Card from "@/components/panel/Card";
import { formatDateTime, formatNumber, ORDER_STATUS } from "@/components/panel/labels";
import Notice from "@/components/panel/Notice";
import CopyButton from "@/components/panel/orders/CopyButton";
import {
  addressLines,
  addressText,
  formatPhone,
  invoiceText,
  isSameAddress,
  LEGAL_DOC_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_PROVIDER_LABELS,
  PAYMENT_RECORD_STATUS,
  telHref,
  whatsappHref,
} from "@/components/panel/orders/labels";
import LegalTextDialog from "@/components/panel/orders/LegalTextDialog";
import CardRefundButton from "@/components/panel/orders/CardRefundButton";
import OrderActions from "@/components/panel/orders/OrderActions";
import OrderEmailsCard from "@/components/panel/orders/OrderEmailsCard";
import OrderEventList from "@/components/panel/orders/OrderEventList";
import OrderNoteForm from "@/components/panel/orders/OrderNoteForm";
import OrderProgress from "@/components/panel/orders/OrderProgress";
import ProductThumb from "@/components/panel/ProductThumb";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import { localeDir, localeNames } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { getOrderDetail, type OrderDetail } from "@/lib/orders/read";
import { ORDER_TRANSITIONS, type OrderAction } from "@/lib/orders/status-machine";
import { PAYMENT_REFUSED_EVENT, PAYMENT_SUCCESS_AFTER_FAILURE_EVENT } from "@/lib/payments/alerts";
import { PAYMENT_UNVERIFIED_EVENT } from "@/lib/payments/paytr-window";
import { getCardRefundInfo, type CardRefundInfo } from "@/lib/payments/refund";
import { isBankTransferOverdue } from "@/lib/orders/bank-transfer-deadline";
import { formatIstanbul } from "@/lib/panel/format";
import { formatPrice } from "@/lib/pricing/money";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Sipariş detayı" };

/**
 * PayTR-fix C10: "Kart iadesi yap" (refund-actions.ts) is a Server Action of this page, and Server Actions use the
 * page's maxDuration (node_modules/next/dist/docs/.../route-segment-config/maxDuration.md). The PayTR iade call may
 * wait PAYTR_REFUND_TIMEOUT_MS (90 s); 120 s leaves room for the database steps around it, so the platform never
 * cuts the request first (Vercel: within every plan's limit with Fluid compute, the default for new projects).
 */
export const maxDuration = 120;

type Params = Promise<{ id: string }>;
type StatusAction = Exclude<OrderAction, "add_note">;

const price = (kurus: number) => formatPrice(kurus, "tr");

export default function OrderDetailPage({ params }: { params: Params }) {
  return (
    <div className="space-y-6">
      <Link
        href="/panel/siparisler"
        className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        Siparişler
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <OrderDetailView params={params} />
      </Suspense>
    </div>
  );
}

async function OrderDetailView({ params }: { params: Params }) {
  const session = await requireStaff();
  const { id } = await params;
  const orderId = /^\d{1,10}$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(orderId) || orderId <= 0) notFound();
  const order = await getOrderDetail(orderId);
  if (!order) notFound();

  const actions = order.actionsByRole[session.staffRole].filter((a): a is StatusAction => a !== "add_note");
  const status = ORDER_STATUS[order.status];
  const units = order.items.filter((i) => !i.isSample).reduce((sum, i) => sum + i.quantity, 0);
  const samples = order.items.filter((i) => i.isSample).length;
  const refund = session.staffRole === "admin" ? await getCardRefundInfo(order.id) : null;
  const anomalies = order.events.filter(
    (e) =>
      e.type === "payment_after_cancel" ||
      e.type === "payment_duplicate" ||
      e.type === "payment_amount_mismatch" ||
      e.type === PAYMENT_REFUSED_EVENT ||
      e.type === PAYMENT_SUCCESS_AFTER_FAILURE_EVENT,
  );
  // PayTR-fix C3: the expiry job could not check this card payment for 24 hours (it never cancels such an order).
  const unverified = order.status === "pending_payment" && order.events.some((e) => e.type === PAYMENT_UNVERIFIED_EVENT);
  // SR-2: an unpaid havale order past its payment deadline (settings.payments.bankTransfer.paymentDays). Marked only.
  const transfer = order.transferDeadline;
  const transferOverdue = transfer ? isBankTransferOverdue(order, transfer.paymentDays, new Date()) : false;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Sipariş</p>
          <h1 className="mt-1 font-heading text-3xl font-medium tabular-nums text-text sm:text-4xl">{order.orderNumber}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge tone={status?.tone}>{status?.label ?? order.status}</StatusBadge>
            <StatusBadge>{PAYMENT_METHOD_LABELS[order.paymentMethod]}</StatusBadge>
            {transferOverdue ? <StatusBadge tone="warning">Ödeme süresi doldu</StatusBadge> : null}
            {order.testPayment ? <TestPaymentBadge /> : null}
            {order.totals.couponCode ? <StatusBadge tone="gold">Kupon {order.totals.couponCode}</StatusBadge> : null}
            {order.invoice.type === "corporate" ? <StatusBadge tone="info">Kurumsal fatura</StatusBadge> : null}
          </div>
          <p className="mt-2 text-sm text-text-muted">
            <time dateTime={order.createdAt}>{formatDateTime(order.createdAt)}</time> · {formatNumber(units)} adet
            {samples > 0 ? ` + ${formatNumber(samples)} numune` : ""} ·{" "}
            <span className="font-medium tabular-nums text-text">{price(order.totals.grandTotal)}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <a
            href={order.customerHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
          >
            Müşteri sipariş sayfası
            <ExternalLink aria-hidden className="size-4" />
            <span className="sr-only">(yeni sekmede açılır)</span>
          </a>
          <CopyButton text={order.customerHref} absolute label="Bağlantıyı kopyala" srLabel="Müşteri sipariş sayfası bağlantısını kopyala" className="py-2" />
        </div>
      </header>

      {transferOverdue && transfer ? (
        <Notice tone="warning">
          Ödeme süresi doldu: son ödeme günü {formatIstanbul(transfer.deadline, { time: false })} idi (sipariş gününden itibaren{" "}
          {formatNumber(transfer.paymentDays)} gün). Sistem siparişi kendiliğinden iptal etmez. Müşteriye ulaşın; ödeme gelmeyecekse “İptal
          et” ile kapatın (iptal, stoku geri ekler). Ödeme geldiyse “Ödeme alındı” ile onaylayın.
        </Notice>
      ) : null}

      {unverified ? (
        // PayTR-fix R-UX7: PayTR knows the merchant_oid ("PayTR sipariş no"), never our dashed order number; its own docs
        // also search test transactions by the buyer's e-mail. The menu above İşlemler has had several names.
        <Notice tone="warning">
          Kart ödemesi doğrulanamadı: PayTR 24 saattir bu siparişin ödemesi için net bir sonuç vermedi. Sistem siparişi kendiliğinden
          iptal etmez. PayTR mağaza panelinin <strong className="font-medium">İşlemler</strong> sayfasında{" "}
          {order.paytrUnsettledRefs.length > 0 ? (
            <>
              {order.paytrUnsettledRefs.length > 1 ? "şu PayTR sipariş no’larıyla" : "şu PayTR sipariş no’suyla"}{" "}
              {order.paytrUnsettledRefs.map((ref, i) => (
                <span key={ref}>
                  {i > 0 ? ", " : null}
                  <code className="font-mono text-xs" dir="ltr">
                    {ref}
                  </code>
                </span>
              ))}{" "}
              ya da müşterinin e-postasıyla (<bdi>{order.email}</bdi>)
            </>
          ) : (
            <>
              müşterinin e-postasıyla (<bdi>{order.email}</bdi>) ya da sipariş geçmişindeki “PayTR sipariş no” ile
            </>
          )}{" "}
          arayın (sipariş numarası orada geçmez): ödeme alındıysa “Ödeme alındı” ile onaylayın, alınmadıysa “İptal et” ile kapatın (iptal,
          stoku geri ekler).
        </Notice>
      ) : null}

      {anomalies.length > 0 ? (
        <Notice tone="warning">
          Bu siparişte manuel kontrol gerektiren bir ödeme kaydı var (fazla, mükerrer, tutarı uyuşmayan, test modunda gelen ya da başarısız
          sonucun ardından gelen ödeme). Ayrıntılar sipariş geçmişinde; gerekirse tutarı ödeme sağlayıcısından iade edin.
        </Notice>
      ) : null}

      {/* lg+: main column + fixed-width side column; actions sit on top of the side column, history under the main one. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_auto_1fr] xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <Card title="İşlemler" description={statusHint(order, transfer && order.status === "awaiting_transfer" ? formatIstanbul(transfer.deadline, { time: false }) : null)}>
            <OrderActions
              orderId={order.id}
              orderNumber={order.orderNumber}
              status={order.status}
              actions={actions}
              paymentMethod={order.paymentMethod}
              paymentMethodLabel={PAYMENT_METHOD_LABELS[order.paymentMethod]}
              grandTotalLabel={price(order.totals.grandTotal)}
              carriers={order.carriers}
              hasCoupon={order.couponId != null}
              paid={order.paidAt != null}
              refundRestocks={ORDER_TRANSITIONS.mark_refunded.restock.includes(order.status)}
              cardRefund={Boolean(refund?.allowed && refund.configured && !refund.refunded)}
            />
          </Card>
        </div>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Card title="Durum">
            <OrderProgress steps={order.timeline} />
          </Card>
          <ItemsCard order={order} units={units} samples={samples} />
        </div>

        <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-span-2 lg:row-start-2">
          <CustomerCard order={order} />
          <DeliveryCard order={order} />
          <InvoiceCard order={order} />
          <PaymentCard order={order} refund={refund} />
          <OrderEmailsCard orderId={order.id} />
          <LegalCard order={order} />
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-3">
          <Card title="Sipariş geçmişi" description="Durum değişiklikleri, ödemeler ve ekip notları; en yeni en üstte.">
            {order.adminNote ? (
              <div className="mb-5 rounded-lg border border-gold/30 bg-gold/10 px-3.5 py-3 text-sm">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-gold-text">Yönetici notu</p>
                <p className="mt-1 whitespace-pre-line text-text">{order.adminNote}</p>
              </div>
            ) : null}
            <OrderNoteForm orderId={order.id} />
            <div className="mt-6 border-t border-border pt-6">
              <OrderEventList events={order.events} carriers={order.carriers} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** `transferDeadline`: the havale payment deadline as a date label (SR-2), while the order waits for the transfer. */
function statusHint(order: OrderDetail, transferDeadline: string | null = null): string {
  switch (order.status) {
    case "pending_payment":
      return "Müşterinin kart ödemesini tamamlaması bekleniyor. Ödeme gelince sipariş kendiliğinden “Ödendi” olur.";
    case "awaiting_transfer":
      return `Havale/EFT bekleniyor${transferDeadline ? ` (son ödeme günü ${transferDeadline})` : ""}. Tutar hesabınıza geçince “Ödeme alındı” ile onaylayın.`;
    case "paid":
      return "Ödeme alındı. Siparişi hazırlayıp kargoya verin.";
    case "processing":
      return order.paymentMethod === "cash_on_delivery"
        ? "Kapıda ödemeli sipariş: tutar teslimatta tahsil edilir. Hazırlayıp kargoya verin."
        : "Sipariş hazırlanıyor. Kargoya verirken takip numarasını girin.";
    case "shipped":
      return "Sipariş kargoda. Teslim edildiğinde işaretleyin.";
    case "delivered":
      return "Sipariş teslim edildi.";
    case "cancelled":
      return "Sipariş iptal edildi.";
    case "refunded":
      return "Sipariş iade edildi.";
  }
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-end text-sm text-text">{children}</dd>
    </div>
  );
}

function ItemsCard({ order, units, samples }: { order: OrderDetail; units: number; samples: number }) {
  return (
    <Card
      title="Ürünler"
      description={`${formatNumber(units)} adet${samples > 0 ? ` · ${formatNumber(samples)} ücretsiz numune` : ""} · fiyatlar KDV dahil`}
      flush
    >
      {/* Container query: prices move beside the item only when the card is wide enough. */}
      <ul className="@container divide-y divide-border">
        {order.items.map((item) => {
          const name = localize(item.name, "tr");
          const variant = localize(item.variantTitle, "tr");
          return (
            <li key={item.id} className="flex gap-3 px-4 py-4 sm:gap-4 sm:px-5">
              <ProductThumb media={item.image} accentColor={item.accentColor} size={52} />
              <div className="flex min-w-0 flex-1 flex-col gap-2 @md:flex-row @md:items-start @md:justify-between @md:gap-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/panel/urunler/${item.productId}`}
                      className="font-medium text-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {name || item.sku}
                    </Link>
                    {item.isSample ? (
                      <span className="rounded border border-border px-1.5 py-px text-[0.625rem] font-medium uppercase tracking-wider text-text-muted">
                        Numune
                      </span>
                    ) : null}
                  </p>
                  {variant ? <p className="text-sm text-text-muted">{variant}</p> : null}
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
                    <span className="whitespace-nowrap">
                      SKU <span className="font-mono text-text">{item.sku}</span>
                    </span>
                    <span className="whitespace-nowrap">
                      Barkod <span className="font-mono text-text">{item.barcode ?? "—"}</span>
                    </span>
                    {item.isSample ? null : <span>KDV %{item.vatRate}</span>}
                  </p>
                </div>
                <div className="shrink-0 text-sm tabular-nums @md:text-end">
                  <p className="text-text-muted">
                    {formatNumber(item.quantity)} × {item.isSample ? "Ücretsiz" : price(item.unitPrice)}
                    {item.compareAt && item.compareAt > item.unitPrice ? (
                      <span className="ms-1.5 text-xs line-through">{price(item.compareAt)}</span>
                    ) : null}
                  </p>
                  {item.discount > 0 ? (
                    <p className="text-xs text-text-muted">
                      {price(item.lineSubtotal)} · indirim −{price(item.discount)}
                    </p>
                  ) : null}
                  <p className="font-medium text-text">{item.isSample ? "Ücretsiz" : price(item.lineTotal)}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Totals order={order} />
    </Card>
  );
}

function TotalRow({ label, value, strong, muted }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "text-base font-semibold text-text" : muted ? "text-xs text-text-muted" : "text-sm text-text"}`}>
      <dt className={strong || muted ? undefined : "text-text-muted"}>{label}</dt>
      <dd className="text-end tabular-nums">{value}</dd>
    </div>
  );
}

function Totals({ order }: { order: OrderDetail }) {
  const t = order.totals;
  const freeReason = t.freeShippingReason === "coupon" ? " (kupon)" : t.freeShippingReason === "threshold" ? " (ücretsiz kargo eşiği)" : "";
  const weightKg = t.totalWeightGrams > 0 ? (t.totalWeightGrams / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) : null;
  return (
    <dl className="space-y-2 border-t border-border bg-surface-2/40 px-4 py-4 sm:px-5">
      <TotalRow label="Ara toplam" value={price(t.subtotal)} />
      {t.couponCode ? (
        <TotalRow
          label={`Kupon (${t.couponCode})`}
          value={t.couponDiscount > 0 ? `−${price(t.couponDiscount)}` : t.couponType === "free_shipping" ? "Ücretsiz kargo" : price(0)}
        />
      ) : null}
      {t.bankTransferDiscount > 0 ? (
        <TotalRow label={`Havale/EFT indirimi${t.bankTransferPercent ? ` (%${t.bankTransferPercent})` : ""}`} value={`−${price(t.bankTransferDiscount)}`} />
      ) : null}
      <TotalRow label="Kargo" value={t.shippingFlat > 0 ? price(t.shippingFlat) : `Ücretsiz${freeReason}`} />
      {t.shippingHeavy > 0 ? <TotalRow label={`Ağır gönderi ücreti (${formatNumber(t.heavyKg)} kg)`} value={price(t.shippingHeavy)} /> : null}
      {t.paymentFee > 0 ? <TotalRow label="Kapıda ödeme ücreti" value={price(t.paymentFee)} /> : null}
      <div className="border-t border-border pt-2">
        <TotalRow label="Genel toplam" value={price(t.grandTotal)} strong />
      </div>
      <TotalRow label="Toplama dahil KDV" value={price(t.vatTotal)} muted />
      {weightKg ? <TotalRow label="Toplam ağırlık" value={`${weightKg} kg`} muted /> : null}
    </dl>
  );
}

const linkClass =
  "[overflow-wrap:anywhere] text-text underline decoration-border underline-offset-4 hover:decoration-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function CustomerCard({ order }: { order: OrderDetail }) {
  const wa = whatsappHref(order.phone);
  const subject = encodeURIComponent(`PRESTİJ siparişiniz ${order.orderNumber}`);
  return (
    <Card title="Müşteri">
      <p className="font-medium text-text">{order.customerName}</p>
      <p className="mt-0.5 text-xs text-text-muted">
        {order.userId ? "Üye hesabı" : "Misafir sipariş"}
        {order.companyId ? " · Kurumsal hesap" : ""} · Sipariş dili: {localeNames[order.locale]}
      </p>
      <ul className="mt-4 space-y-2.5 text-sm">
        <li className="flex items-start gap-2.5">
          <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-text-muted" />
          <div className="min-w-0 flex-1">
            <a href={`mailto:${order.email}?subject=${subject}`} className={linkClass}>
              {order.email}
            </a>
            <div className="mt-1.5">
              <CopyButton text={order.email} label="Kopyala" srLabel="E-posta adresini kopyala" />
            </div>
          </div>
        </li>
        {order.phone ? (
          <li className="flex items-center gap-2.5">
            <Phone aria-hidden className="size-4 shrink-0 text-text-muted" />
            <a href={telHref(order.phone)} className={`${linkClass} tabular-nums`}>
              {formatPhone(order.phone)}
            </a>
          </li>
        ) : null}
        {wa ? (
          <li className="flex items-center gap-2.5">
            <MessageCircle aria-hidden className="size-4 shrink-0 text-text-muted" />
            <a href={wa} target="_blank" rel="noopener noreferrer" className={linkClass}>
              WhatsApp’tan yaz
              <span className="sr-only"> (yeni sekmede açılır)</span>
            </a>
          </li>
        ) : null}
      </ul>
      {order.customerNote ? (
        <div className="mt-4 rounded-lg border border-gold/30 bg-gold/10 px-3.5 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-gold-text">Müşteri notu</p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-text">{order.customerNote}</p>
        </div>
      ) : null}
    </Card>
  );
}

function DeliveryCard({ order }: { order: OrderDetail }) {
  const lines = addressLines(order.shippingAddress);
  const phone = order.shippingAddress.phone || order.phone;
  return (
    <Card
      title="Teslimat adresi"
      action={<CopyButton text={addressText(order.shippingAddress, phone)} label="Kopyala" srLabel="Teslimat adresini metin olarak kopyala" />}
    >
      <address className="text-sm not-italic leading-relaxed text-text">
        {lines.map((line, i) => (
          <span key={i} className={i === 0 ? "block font-medium" : "block"}>
            {line}
          </span>
        ))}
        {phone ? <span className="block tabular-nums text-text-muted">{formatPhone(phone)}</span> : null}
      </address>
      {order.carrier ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="flex items-center gap-2 text-sm font-medium text-text">
            <Truck aria-hidden className="size-4 text-text-muted" />
            {order.carrier.name}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-text">{order.carrier.trackingNumber}</span>
            <CopyButton text={order.carrier.trackingNumber} label="Kopyala" srLabel="Takip numarasını kopyala" />
          </div>
          {order.carrier.trackingUrl ? (
            <a href={order.carrier.trackingUrl} target="_blank" rel="noopener noreferrer" className={`${linkClass} mt-2 inline-flex items-center gap-1.5 text-sm`}>
              Kargoyu takip et
              <ExternalLink aria-hidden className="size-3.5" />
              <span className="sr-only">(yeni sekmede açılır)</span>
            </a>
          ) : null}
          {order.shippedAt ? <p className="mt-2 text-xs text-text-muted">Kargoya verildi: {formatDateTime(order.shippedAt)}</p> : null}
          {order.deliveredAt ? <p className="text-xs text-text-muted">Teslim edildi: {formatDateTime(order.deliveredAt)}</p> : null}
        </div>
      ) : order.status === "paid" || order.status === "processing" ? (
        <p className="mt-4 border-t border-border pt-4 text-xs text-text-muted">Henüz kargoya verilmedi.</p>
      ) : null}
    </Card>
  );
}

function InvoiceCard({ order }: { order: OrderDetail }) {
  const inv = order.invoice;
  const corporate = inv.type === "corporate";
  const billing = inv.address ?? order.shippingAddress;
  const same = isSameAddress(billing, order.shippingAddress);
  return (
    <Card
      title="Fatura"
      description={corporate ? "Kurumsal fatura" : "Bireysel fatura"}
      action={<CopyButton text={invoiceText(inv, order.shippingAddress)} label="Kopyala" srLabel="Fatura bilgilerini kopyala" />}
    >
      <dl className="-my-2.5 divide-y divide-border">
        {corporate ? (
          <>
            <InfoRow label="Firma unvanı">{inv.companyName || "—"}</InfoRow>
            <InfoRow label="Vergi dairesi">{inv.taxOffice || "—"}</InfoRow>
            <InfoRow label="VKN">
              <span className="font-mono tabular-nums">{inv.taxNumber || "—"}</span>
            </InfoRow>
            <InfoRow label="e-Fatura mükellefi">{inv.eInvoice ? "Evet" : "Hayır"}</InfoRow>
          </>
        ) : (
          <>
            <InfoRow label="Ad soyad">{inv.fullName || order.shippingAddress.fullName}</InfoRow>
            <InfoRow label="T.C. kimlik no">
              {inv.nationalId ? <span className="font-mono tabular-nums">{inv.nationalId}</span> : <span className="text-text-muted">Belirtilmedi</span>}
            </InfoRow>
          </>
        )}
        <div className="py-2.5">
          <dt className="text-sm text-text-muted">Fatura adresi</dt>
          <dd className="mt-1 text-sm text-text">
            {same ? (
              <span className="text-text-muted">Teslimat adresiyle aynı</span>
            ) : (
              addressLines(billing).map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function PaymentCard({ order, refund }: { order: OrderDetail; refund: CardRefundInfo | null }) {
  const hint =
    order.paymentMethod === "cash_on_delivery"
      ? `Tutar teslimatta kurye tarafından tahsil edilir${order.totals.paymentFee > 0 ? `; ${price(order.totals.paymentFee)} kapıda ödeme ücreti dahildir` : ""}.`
      : order.paymentMethod === "deferred"
        ? `Kurumsal vadeli ödeme: fatura, firmanın ödeme koşullarına göre tahsil edilir.${order.paidAt ? "" : " Ödeme geldiğinde İşlemler’den “Ödeme alındı” ile kaydedin."}`
        : order.paymentMethod === "bank_transfer" && order.status === "awaiting_transfer"
          ? `Açıklamasında ${order.orderNumber} geçen ${price(order.totals.grandTotal)} tutarındaki havaleyi bekleyin.`
          : null;
  return (
    <Card title="Ödeme">
      <dl className="-my-2.5 divide-y divide-border">
        <InfoRow label="Yöntem">{PAYMENT_METHOD_LABELS[order.paymentMethod]}</InfoRow>
        <InfoRow label="Sağlayıcı">{order.paymentProvider ? PAYMENT_PROVIDER_LABELS[order.paymentProvider] : "—"}</InfoRow>
        <InfoRow label="Tutar">
          <span className="font-medium tabular-nums">{price(order.totals.grandTotal)}</span>
        </InfoRow>
        <InfoRow label="Ödeme tarihi">{order.paidAt ? formatDateTime(order.paidAt) : <span className="text-text-muted">Ödenmedi</span>}</InfoRow>
      </dl>
      {hint ? <p className="mt-4 text-xs leading-relaxed text-text-muted">{hint}</p> : null}
      {refund ? <CardRefundBlock order={order} refund={refund} /> : null}
      {order.payments.length > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Ödeme kayıtları</h3>
          <ul className="mt-2 space-y-3">
            {order.payments.map((p) => {
              const st = PAYMENT_RECORD_STATUS[p.status];
              return (
                <li key={p.id} className="text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-text">{PAYMENT_PROVIDER_LABELS[p.provider] ?? p.provider}</span>
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {p.test ? <StatusBadge tone="danger">Test</StatusBadge> : null}
                      <StatusBadge tone={st?.tone}>{st?.label ?? p.status}</StatusBadge>
                    </span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap justify-between gap-x-3 text-xs text-text-muted">
                    <span className="tabular-nums">{price(p.amount)}</span>
                    <time dateTime={p.updatedAt}>{formatDateTime(p.updatedAt)}</time>
                  </p>
                  {p.providerRef ? <p className="mt-0.5 break-all font-mono text-[0.6875rem] text-text-muted">Ref: {p.providerRef}</p> : null}
                  {p.lastError ? <p className="mt-0.5 break-words text-xs text-text-muted">Ödeme kuruluşunun ret nedeni: {p.lastError}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

/** Go-live CF-11: the order was paid in test mode (or by the local simulator): no money was taken, do not ship. */
function TestPaymentBadge() {
  return (
    <StatusBadge
      tone="danger"
      className="border-[#C2413A]/50 bg-[#C2413A]/10 font-semibold text-[#9B2C26] dark:border-[#F2A7A1]/40 dark:bg-[#C2413A]/20 dark:text-[#F2A7A1]"
    >
      TEST ÖDEMESİ – para çekilmedi
    </StatusBadge>
  );
}

/** Admin only: the provider refund ("Kart iadesi yap"), or where it stands. */
function CardRefundBlock({ order, refund }: { order: OrderDetail; refund: CardRefundInfo }) {
  if (refund.refunded) {
    return <p className="mt-4 text-xs leading-relaxed text-text-muted">Kart ödemesi {refund.providerLabel} üzerinden iade edildi.</p>;
  }
  if (!refund.allowed) return null;
  return (
    <div className="mt-4 space-y-2 border-t border-border pt-4">
      {refund.configured ? (
        <CardRefundButton
          orderId={order.id}
          orderNumber={order.orderNumber}
          status={order.status}
          providerLabel={refund.providerLabel}
          amountLabel={price(refund.amount)}
          restocks={ORDER_TRANSITIONS.mark_refunded.restock.includes(order.status)}
        />
      ) : (
        <p className="text-xs leading-relaxed text-text-muted">
          {refund.providerLabel} anahtarları bu sunucuda tanımlı olmadığı için iade buradan yapılamaz; ödeme kuruluşunun panelinden iade edip “İade edildi” ile işaretleyin.
        </p>
      )}
      <p className="text-xs leading-relaxed text-text-muted">
        Tutarın tamamı müşterinin kartına iade edilir ve sipariş “İade edildi” olur. Parayı başka yoldan iade ettiyseniz yalnızca “İade edildi” ile işaretleyin.
      </p>
      {order.events.some((e) => e.type === "payment_duplicate") ? (
        <p className="rounded-lg border border-[#D68A12]/40 bg-[#D68A12]/10 px-3 py-2.5 text-xs leading-relaxed text-text">
          Bu siparişte mükerrer (ikinci) bir kart ödemesi var. “Kart iadesi yap” siparişin asıl ödemesini iade eder ve siparişi kapatır; yalnızca
          fazladan alınan tutarı iade etmek için bu düğmeyi kullanmayın, iadeyi ödeme kuruluşunun panelinden yapın.
        </p>
      ) : null}
      {refund.lastError ? <p className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">Son deneme başarısız: {refund.lastError}</p> : null}
    </div>
  );
}

function LegalCard({ order }: { order: OrderDetail }) {
  const snapshots = order.legal ? [order.legal.preInformation, order.legal.distanceSales] : [];
  const dir = localeDir(order.locale);
  return (
    <Card title="Yasal onaylar" description="Müşterinin sipariş sırasında onayladığı metinler">
      {order.consents.length === 0 ? (
        <p className="text-sm text-text-muted">Bu sipariş için onay kaydı yok.</p>
      ) : (
        <ul className="space-y-4">
          {order.consents.map((consent) => {
            const snap = snapshots.find((s) => s.key === consent.key);
            const title = LEGAL_DOC_LABELS[consent.key] ?? consent.key;
            const missing = consent.version === "missing";
            const meta = `${missing ? "Sürüm kaydı yok" : `Sürüm ${consent.version}`} · onay: ${formatDateTime(consent.acceptedAt)}`;
            return (
              <li key={consent.key} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{title}</p>
                  <p className="text-xs text-text-muted">{meta}</p>
                </div>
                {snap ? (
                  <LegalTextDialog title={title} meta={`${meta} · ${order.orderNumber}`} html={sanitizeHtml(snap.html)} lang={order.locale} dir={dir} />
                ) : (
                  <span className="text-xs text-text-muted">Metin saklanmamış</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
