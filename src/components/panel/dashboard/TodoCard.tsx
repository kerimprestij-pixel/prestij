// "Yapılacaklar": everything that waits for staff, each line linking to the filtered list. Lines with
// work are highlighted; optional lines (quotes, samples, company applications, reviews, payment warnings) appear
// only when non-zero, and reviews only for roles that may moderate them (editor+). The PayTR warnings link to the
// payment settings for admins (who can fix them there) and to the orders for everyone else; the two order-event
// warnings open the affected order (one order) or the orders list filtered by the warning (several; PayTR-fix R-UX8).
import Link from "next/link";
import {
  AlarmClock,
  ArrowUpRight,
  BellOff,
  BriefcaseBusiness,
  CircleCheckBig,
  CreditCard,
  FileText,
  FlaskConical,
  Inbox,
  Landmark,
  MessageSquareQuote,
  PackageOpen,
  ShieldAlert,
  TestTubeDiagonal,
  TriangleAlert,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { DashboardTodo } from "@/app/panel/_lib/dashboard";
import Card from "@/components/panel/Card";
import { formatNumber } from "@/components/panel/labels";
import { ORDER_TABS, ordersListHref, type OrderAlertKey } from "@/components/panel/orders/labels";
import { formatIstanbul } from "@/lib/panel/format";
import { cn } from "@/lib/utils";

type TodoItem = { key: string; n: number; label: string; hint: string; href: string; icon: LucideIcon; optional?: boolean };

const tab = (key: string) => ORDER_TABS.find((t) => t.key === key);

/** R-UX8: the affected order when there is exactly one, else the orders list filtered by the warning. */
const alertHref = (alert: OrderAlertKey, orderId: number | null) => (orderId != null ? `/panel/siparisler/${orderId}` : ordersListHref({ alert }));

/** Warning lines: they are not order work, so they do not count in "N iş sizi bekliyor". */
const WARNING_KEYS = new Set([
  "stock",
  "transfer-overdue",
  "card-unverified",
  "paytr-notify",
  "paytr-test-live",
  "paytr-test-live-orders",
  "payment-success-after-failure",
]);

export default function TodoCard({
  todo,
  canModerateReviews = false,
  canEditPayments = false,
}: {
  todo: DashboardTodo;
  canModerateReviews?: boolean;
  /** Admins: the PayTR warnings open /panel/ayarlar/odeme. */
  canEditPayments?: boolean;
}) {
  const paymentSettings = canEditPayments ? "/panel/ayarlar/odeme" : ordersListHref({ tab: tab("pending") });
  const refused = todo.paytrNotifyRefused;
  const items: TodoItem[] = [
    {
      key: "transfer",
      n: todo.awaitingTransfer,
      label: "Havale onayı bekliyor",
      hint: "Ödemeyi hesapta görünce onaylayın",
      href: ordersListHref({ tab: tab("transfer") }),
      icon: Landmark,
    },
    {
      // SR-2: never cancelled automatically; the owner checks this line every day.
      key: "transfer-overdue",
      n: todo.overdueTransfers,
      label: "Havale ödeme süresi doldu",
      hint: "Müşteriye ulaşın ya da siparişi iptal edin (stok geri eklenir)",
      href: ordersListHref({ tab: tab("transfer"), overdue: true }),
      icon: AlarmClock,
      optional: true,
    },
    {
      key: "ship",
      n: todo.toShip,
      label: "Kargoya verilecek",
      hint: "Ödendi veya hazırlanıyor",
      href: ordersListHref({ tab: tab("prepare") }),
      icon: Truck,
    },
    {
      key: "pending",
      n: todo.pendingPayment,
      label: "Ödeme bekleniyor",
      hint: "Kart ödemesi tamamlanmamış",
      href: ordersListHref({ tab: tab("pending") }),
      icon: CreditCard,
    },
    {
      key: "messages",
      n: todo.unreadMessages,
      label: "Okunmamış mesaj",
      hint: "İletişim formundan",
      href: "/panel/mesajlar",
      icon: Inbox,
    },
    {
      key: "stock",
      n: todo.lowStockVariants,
      label: "Düşük stoklu varyant",
      hint: "Eşiğin altına indi",
      href: "/panel/urunler?durum=dusuk-stok",
      icon: PackageOpen,
    },
    {
      key: "quotes",
      n: todo.pendingQuotes,
      label: "Teklif talebi",
      hint: "Yanıt bekliyor",
      href: "/panel/teklifler",
      icon: FileText,
      optional: true,
    },
    {
      key: "samples",
      n: todo.pendingSamples,
      label: "Numune talebi",
      hint: "Yanıt bekliyor",
      href: "/panel/numune-talepleri",
      icon: FlaskConical,
      optional: true,
    },
    {
      key: "samples-ship",
      n: todo.samplesToShip,
      label: "Kargoya verilecek numune",
      hint: "Onaylandı, henüz gönderilmedi",
      href: "/panel/numune-talepleri?durum=onaylandi",
      icon: FlaskConical,
      optional: true,
    },
    {
      // PayTR-fix C3: the expiry job never cancels a PayTR order whose result it cannot check; after 24 h it lands here.
      key: "card-unverified",
      n: todo.unverifiedCard,
      label: "Kart ödemesi doğrulanamadı",
      hint: "PayTR panelinde kontrol edin: ödeme alındıysa “Ödeme alındı”, alınmadıysa “İptal et”",
      href: ordersListHref({ tab: tab("pending") }),
      icon: ShieldAlert,
      optional: true,
    },
    {
      // PayTR-fix IMPL-A2: /api/payments/paytr/notify answered bad hash / missing fields / keys not configured (72 h),
      // for a notification naming one of our stored attempts (R5). Someone who knows such a number can still forge one.
      key: "paytr-notify",
      n: refused?.count ?? 0,
      label: "PayTR bildirimleri reddediliyor",
      hint: `Bildirim URL'sini ve anahtarları kontrol edin${refused ? ` · son: ${formatIstanbul(refused.lastAt)}` : ""} · sahte bir istekten de olabilir; o durumda siparişler etkilenmez`,
      href: paymentSettings,
      icon: BellOff,
      optional: true,
    },
    {
      // PayTR-fix C5: a PayTR test payment for an attempt sent live was refused (no money moved, order not paid).
      // R-UX3: it happens when the test mode was switched off before PayTR's live approval: switch it back on.
      key: "paytr-test-live",
      n: todo.paytrTestOnLive,
      label: "Canlı siparişe PayTR test ödemesi geldi",
      hint: "Test modunu yeniden açıp kaydedin (Ayarlar › Ödeme yöntemleri); PayTR canlı mod onayını SMS/e-postayla bildirene kadar açık tutun. Para çekilmedi, sipariş ödendi sayılmadı",
      href: canEditPayments ? paymentSettings : alertHref("testOnLive", todo.paytrTestOnLiveOrderId),
      icon: TestTubeDiagonal,
      optional: true,
    },
    ...(canEditPayments
      ? [
          {
            // R-UX8: admins fix the setting from the line above; this one opens the affected order(s).
            key: "paytr-test-live-orders",
            n: todo.paytrTestOnLive,
            label: "Test ödemesi gelen sipariş",
            hint: "Siparişi açın ve müşteriyle görüşün: ödeme alınmadı",
            href: alertHref("testOnLive", todo.paytrTestOnLiveOrderId),
            icon: TestTubeDiagonal,
            optional: true,
          },
        ]
      : []),
    {
      // PayTR-fix C13a: a success after a recorded failure for the same payment (PayTR counts only the first result).
      key: "payment-success-after-failure",
      n: todo.paymentSuccessAfterFailure,
      label: "Başarısız ödemeden sonra başarılı bildirim",
      hint: "PayTR panelinde kontrol edin: para çekildiyse “Ödeme alındı” ile onaylayın ya da tutarı iade edin",
      href: alertHref("successAfterFailure", todo.paymentSuccessAfterFailureOrderId),
      icon: TriangleAlert,
      optional: true,
    },
    {
      key: "paid-cancelled",
      n: todo.paidCancelled,
      label: "İptal edilmiş siparişe gelen ödeme",
      hint: "Tutarı iade edip “İade edildi” ile kapatın",
      href: ordersListHref({ tab: tab("closed") }),
      icon: Undo2,
      optional: true,
    },
    {
      key: "companies",
      n: todo.pendingCompanies,
      label: "Kurumsal hesap başvurusu",
      hint: "Onay bekliyor",
      href: "/panel/kurumsal-hesaplar",
      icon: BriefcaseBusiness,
      optional: true,
    },
    ...(canModerateReviews
      ? [
          {
            key: "reviews",
            n: todo.pendingReviews,
            label: "Onay bekleyen yorum",
            hint: "Yayınlanmadan önce inceleyin",
            href: "/panel/yorumlar",
            icon: MessageSquareQuote,
            optional: true,
          },
        ]
      : []),
  ].filter((item) => !item.optional || item.n > 0);
  // Low stock and the payment warnings are not order work: they do not make the card "busy". Overdue havale orders
  // are already counted in "Havale onayı bekliyor", unverified card payments in "Ödeme bekleniyor".
  const waiting = items.filter((i) => !WARNING_KEYS.has(i.key)).reduce((sum, i) => sum + i.n, 0);
  const warnings = items.filter((i) => WARNING_KEYS.has(i.key) && i.key !== "stock").length;
  // R-UX2: never "her şey yolunda" above a warning line. With no order work, the remaining warnings are the payment ones.
  const description =
    waiting > 0
      ? `${formatNumber(waiting)} iş sizi bekliyor`
      : warnings > 0
        ? "Bekleyen iş yok; ödeme uyarılarını kontrol edin"
        : todo.lowStockVariants > 0
          ? "Bekleyen iş yok; düşük stoklu varyantlara göz atın"
          : "Bekleyen iş yok, her şey yolunda";

  return (
    <Card
      title="Yapılacaklar"
      description={description}
      flush
      className="h-full"
    >
      {waiting === 0 && todo.lowStockVariants === 0 && warnings === 0 ? (
        <p className="flex items-center gap-2 px-5 pt-4 text-sm text-text-muted">
          <CircleCheckBig aria-hidden className="size-4 text-[#2F8F5B]" />
          Siparişler, mesajlar ve stoklar güncel.
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {items.map(({ key, n, label, hint, href, icon: Icon }) => {
          const busy = n > 0;
          return (
            <li key={key}>
              <Link
                href={href}
                className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-lg border",
                    busy ? "border-gold/40 bg-gold/10 text-gold-text" : "border-border bg-surface-2 text-text-muted",
                  )}
                >
                  <Icon aria-hidden className="size-4" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", busy ? "font-medium text-text" : "text-text-muted")}>{label}</span>
                  <span className="block truncate text-xs text-text-muted">{hint}</span>
                </span>
                <span
                  className={cn(
                    "min-w-7 rounded-full px-2 py-0.5 text-center text-sm tabular-nums",
                    busy ? "bg-gold/20 font-semibold text-text" : "text-text-muted",
                  )}
                >
                  {formatNumber(n)}
                </span>
                <ArrowUpRight
                  aria-hidden
                  className="size-3.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
