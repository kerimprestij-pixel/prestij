import Link from "next/link";
import {
  Ban,
  CircleAlert,
  CreditCard,
  HandCoins,
  PackageCheck,
  PackageOpen,
  Receipt,
  Repeat,
  RotateCcw,
  ShoppingBag,
  StickyNote,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { OrderStatus, PaymentMethod, PaymentProvider } from "@/db/schema/commerce";
import { formatDateTime, ORDER_STATUS, type Tone } from "@/components/panel/labels";
import type { OrderEventView } from "@/lib/orders/read";
import { formatPrice } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_LABELS, PAYMENT_PROVIDER_LABELS } from "./labels";

type Described = { title: string; details: string[]; tone: Tone; icon: LucideIcon; transition?: [string, string]; links?: { href: string; label: string }[] };

const TONE_RING: Record<Tone, string> = {
  neutral: "border-border bg-surface text-text-muted",
  success: "border-[#2F8F5B]/35 bg-[#2F8F5B]/10 text-[#2F8F5B]",
  warning: "border-[#D68A12]/40 bg-[#D68A12]/10 text-[#B5730C] dark:text-[#E9A23B]",
  danger: "border-[#B3261E]/35 bg-[#B3261E]/10 text-[#B3261E] dark:text-[#F28B82]",
  info: "border-[#3A7BC8]/35 bg-[#3A7BC8]/10 text-[#3A7BC8] dark:text-[#7FB0E8]",
  gold: "border-gold/40 bg-gold/10 text-gold-text",
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const money = (v: unknown) => {
  const n = num(v);
  return n == null ? null : formatPrice(n, "tr");
};
const statusLabel = (v: unknown) => (str(v) ? (ORDER_STATUS[v as OrderStatus]?.label ?? String(v)) : null);
const providerLabel = (v: unknown) => (str(v) ? (PAYMENT_PROVIDER_LABELS[v as PaymentProvider] ?? String(v)) : null);

function describe(e: OrderEventView, carrierNames: Map<string, string>): Described {
  const d = e.data ?? {};
  switch (e.type) {
    case "placed": {
      const method = str(d.paymentMethod) ? PAYMENT_METHOD_LABELS[d.paymentMethod as PaymentMethod] : null;
      const coupon = str(d.couponCode);
      return {
        title: "Sipariş oluşturuldu",
        details: [[method, money(d.grandTotal)].filter(Boolean).join(" · "), coupon ? `Kupon: ${coupon}` : ""].filter(Boolean),
        tone: "gold",
        icon: ShoppingBag,
      };
    }
    case "payment_initiated":
      return { title: "Kart ödemesi başlatıldı", details: [[providerLabel(d.provider), money(d.amount)].filter(Boolean).join(" · ")].filter(Boolean), tone: "neutral", icon: CreditCard };
    case "payment_succeeded":
      return {
        title: "Kart ödemesi alındı",
        details: [[providerLabel(d.provider), money(d.amount)].filter(Boolean).join(" · "), str(d.providerRef) ? `Referans: ${d.providerRef}` : ""].filter(Boolean),
        tone: "success",
        icon: CreditCard,
      };
    case "payment_failed":
      return { title: "Kart ödemesi başarısız", details: [providerLabel(d.provider) ?? ""].filter(Boolean), tone: "danger", icon: CreditCard };
    case "payment_amount_mismatch":
      return {
        title: "Ödeme tutarı uyuşmadı, ödeme reddedildi",
        details: [`Beklenen ${money(d.expected) ?? "—"}, gelen ${money(d.received) ?? "—"}`],
        tone: "danger",
        icon: CircleAlert,
      };
    case "payment_after_cancel":
      return {
        title: "İptal edilmiş siparişe ödeme geldi",
        details: [`${money(d.amount) ?? ""} tahsil edildi. Tutarı müşteriye manuel olarak iade edin.`.trim()],
        tone: "danger",
        icon: CircleAlert,
      };
    case "payment_duplicate":
      return {
        title: "Mükerrer ödeme",
        details: [`${money(d.amount) ?? ""} ikinci kez tahsil edildi. Fazla tutarı manuel olarak iade edin.`.trim()],
        tone: "danger",
        icon: CircleAlert,
      };
    case "payment_unverified":
      return {
        title: "Kart ödemesi doğrulanamadı",
        details: [
          "PayTR 24 saattir net bir sonuç vermedi; sistem siparişi kendiliğinden iptal etmez. PayTR mağaza panelinin İşlemler sayfasında aşağıdaki PayTR sipariş no’suyla ya da müşterinin e-postasıyla arayın (sipariş numarası orada geçmez): ödeme alındıysa “Ödeme alındı”, alınmadıysa “İptal et”.",
          str(d.merchantOid) ? `PayTR sipariş no: ${d.merchantOid}` : "",
        ].filter(Boolean),
        tone: "warning",
        icon: CircleAlert,
      };
    case "payment_refused":
      // PayTR-fix C5 (src/lib/payments/alerts.ts): the only reason so far is "test_payment_on_live".
      return {
        title: d.reason === "test_payment_on_live" ? "PayTR test ödemesi reddedildi (para çekilmedi)" : "Kart ödemesi sonucu uygulanmadı",
        details: [
          d.reason === "test_payment_on_live"
            ? "PayTR bu ödemeyi test ödemesi olarak bildirdi (test_mode=1), oysa ödeme canlı modda başlatılmıştı. Para çekilmediği için sipariş ödendi sayılmadı. PayTR mağazanız henüz canlı modda değil: Ayarlar › Ödeme yöntemleri’nde test modunu yeniden açıp kaydedin; PayTR canlı mod onayını SMS/e-postayla bildirene kadar açık tutun. Müşteriyle görüşün: ödeme alınmadı."
            : "",
          [providerLabel(d.provider), money(d.amount)].filter(Boolean).join(" · "),
          str(d.providerRef) ? `PayTR sipariş no: ${d.providerRef}` : "",
        ].filter(Boolean),
        tone: "danger",
        icon: CircleAlert,
      };
    case "payment_success_after_failure":
      // PayTR-fix C13a: the first result per payment counts; this later success changed nothing.
      return {
        title: "Başarısız ödemeden sonra başarılı bildirim geldi",
        details: [
          "Ödeme sağlayıcısı aynı ödeme için önce başarısız, sonra başarılı sonuç bildirdi. İlk sonuç geçerli sayıldı, sipariş değişmedi. Sağlayıcının panelinde kontrol edin: para çekildiyse “Ödeme alındı” ile onaylayın ya da tutarı iade edin.",
          [providerLabel(d.provider), money(d.amount)].filter(Boolean).join(" · "),
          str(d.providerRef) ? `Referans: ${d.providerRef}` : "",
        ].filter(Boolean),
        tone: "danger",
        icon: CircleAlert,
      };
    case "payment_refunded":
      return {
        title: "Kart ödemesi iade edildi",
        details: [[providerLabel(d.provider), money(d.amount)].filter(Boolean).join(" · "), str(d.refundRef) ? `İade referansı: ${d.refundRef}` : ""].filter(Boolean),
        tone: "neutral",
        icon: Undo2,
      };
    case "payment_refund_failed":
      return {
        title: "Kart iadesi yapılamadı",
        details: [providerLabel(d.provider) ?? "", str(d.error) ?? ""].filter(Boolean),
        tone: "danger",
        icon: CircleAlert,
      };
    case "note":
      return { title: "Not", details: [e.message ?? ""].filter(Boolean), tone: "gold", icon: StickyNote };
    case "subscription_pending":
      return { title: "Abonelik, ödeme alınınca başlayacak", details: ["Kart ödemesi tamamlandığında abonelik otomatik oluşturulur."], tone: "info", icon: Repeat };
    case "subscription_created": {
      const ids = Array.isArray(d.subscriptionIds) ? d.subscriptionIds.filter((x): x is number => typeof x === "number" && Number.isSafeInteger(x)) : [];
      return {
        title: ids.length > 1 ? "Abonelikler oluşturuldu" : "Abonelik oluşturuldu",
        details: [],
        tone: "success",
        icon: Repeat,
        links: ids.map((id) => ({ href: `/panel/abonelikler/${id}`, label: `Abonelik #${id}` })),
      };
    }
    case "subscription_skipped":
      return {
        title: "Abonelik başlatılmadı",
        details: [d.reason === "account_deleted" ? "Ödeme geldiğinde müşterinin hesabı silinmişti; abonelik oluşturulmadı." : "Abonelik oluşturulmadı."],
        tone: "neutral",
        icon: Repeat,
      };
    case "status_changed": {
      const from = statusLabel(d.from);
      const to = statusLabel(d.to);
      const transition: [string, string] | undefined = from && to && from !== to ? [from, to] : undefined;
      const extra: string[] = [];
      if (d.restocked === true) extra.push(d.couponReleased === true ? "Ürünler stoğa geri eklendi, kupon kullanımı geri alındı." : "Ürünler stoğa geri eklendi.");
      const note = e.message ? [e.message] : [];
      switch (str(d.action)) {
        case "payment":
          return { title: "Ödeme onaylandı", details: ["Kart ödemesi başarıyla tamamlandı."], tone: "success", icon: HandCoins, transition };
        case "mark_paid":
          return { title: "Ödeme alındı olarak işaretlendi", details: note, tone: "success", icon: HandCoins, transition };
        case "start_processing":
          return { title: "Hazırlanmaya başlandı", details: note, tone: "info", icon: PackageOpen, transition };
        case "ship": {
          const carrier = str(d.carrier);
          const name = carrier ? (carrierNames.get(carrier) ?? carrier) : null;
          return {
            title: "Kargoya verildi",
            details: [[name, str(d.trackingNumber) ? `Takip no ${d.trackingNumber}` : null].filter(Boolean).join(" · "), ...note].filter(Boolean),
            tone: "gold",
            icon: Truck,
            transition,
          };
        }
        case "deliver":
          return { title: "Teslim edildi", details: note, tone: "success", icon: PackageCheck, transition };
        case "cancel":
          return {
            title: d.reason === "payment_timeout" ? "Ödeme tamamlanmadığı için otomatik iptal edildi" : "Sipariş iptal edildi",
            details: [...(note.length ? [`Neden: ${note[0]}`] : []), ...extra],
            tone: "danger",
            icon: Ban,
            transition,
          };
        case "mark_refunded":
          return {
            title: "İade edildi olarak işaretlendi",
            details: [...note, ...(extra.length ? extra : ["Stok değişmedi."])],
            tone: "neutral",
            icon: Undo2,
            transition,
          };
        default:
          return { title: "Durum değişti", details: note, tone: "info", icon: RotateCcw, transition };
      }
    }
    default:
      return { title: e.type, details: e.message ? [e.message] : [], tone: "neutral", icon: Receipt };
  }
}

function actorOf(e: OrderEventView): string {
  if (e.actorName) return e.actorName;
  if (e.createdBy === "system") return e.type === "status_changed" && e.data?.action === "payment" ? "Ödeme altyapısı" : "Sistem";
  if (e.createdBy) return "Panel kullanıcısı";
  if (e.type === "placed" || e.type === "payment_initiated") return "Müşteri";
  if (e.type.startsWith("payment_")) return "Ödeme altyapısı";
  return "Sistem";
}

/** Order history, newest first: status changes, payments, notes (with who and when). */
export default function OrderEventList({ events, carriers }: { events: OrderEventView[]; carriers: { key: string; name: string }[] }) {
  const carrierNames = new Map(carriers.map((c) => [c.key, c.name]));
  const items = [...events].reverse();
  if (items.length === 0) return <p className="text-sm text-text-muted">Henüz kayıt yok.</p>;

  return (
    <ol className="relative space-y-5">
      {items.map((e, index) => {
        const { title, details, tone, icon: Icon, transition, links } = describe(e, carrierNames);
        return (
          <li key={e.id} className="relative flex gap-3">
            {index < items.length - 1 ? <span aria-hidden className="absolute start-[0.9375rem] top-9 bottom-[-1.25rem] w-px bg-border" /> : null}
            <span className={cn("relative grid size-8 shrink-0 place-items-center rounded-full border", TONE_RING[tone])}>
              <Icon aria-hidden className="size-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm font-medium text-text">{title}</p>
              {transition ? (
                <p className="mt-0.5 text-xs text-text-muted">
                  <span aria-hidden>
                    {transition[0]} → {transition[1]}
                  </span>
                  <span className="sr-only">
                    {transition[0]} durumundan {transition[1]} durumuna
                  </span>
                </p>
              ) : null}
              {details.map((line, i) => (
                <p
                  key={i}
                  className={cn(
                    "mt-1 whitespace-pre-line break-words text-sm text-text",
                    e.type === "note" ? "rounded-lg border border-border bg-surface-2/60 px-3 py-2" : "text-text-muted",
                  )}
                >
                  {line}
                </p>
              ))}
              {links?.length ? (
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {links.map((l) => (
                    <Link key={l.href} href={l.href} className="font-medium text-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      {l.label}
                    </Link>
                  ))}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-text-muted">
                <time dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time> · {actorOf(e)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
