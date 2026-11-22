"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Ban, CircleCheckBig, CircleExclamationPoint, HandCoins, LoaderCircle, PackageCheck, PackageOpen, Truck, Undo2, X, type LucideIcon } from "lucide-react";
import { runOrderAction } from "@/app/panel/(dashboard)/siparisler/actions";
import type { OrderStatus, PaymentMethod } from "@/db/schema/commerce";
import type { OrderAction } from "@/lib/orders/status-machine";
import { cn } from "@/lib/utils";
import { INITIAL_ORDER_ACTION_STATE, type OrderActionState } from "./action-state";
import {
  dangerButtonClass,
  dangerOutlineButtonClass,
  errorClass,
  fieldClass,
  ghostButtonClass,
  hintClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./form-styles";

type StatusAction = Exclude<OrderAction, "add_note">;

type OrderActionsProps = {
  orderId: number;
  orderNumber: string;
  status: OrderStatus;
  /** Actions the current role may run now (from detail.actionsByRole), add_note excluded. */
  actions: StatusAction[];
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  grandTotalLabel: string;
  carriers: { key: string; name: string }[];
  hasCoupon: boolean;
  /** Money was taken (paidAt set): cancelling or refunding needs a manual money refund. */
  paid: boolean;
  /** mark_refunded from this status puts stock back (paid / processing). */
  refundRestocks: boolean;
  /** Admin: "Kart iadesi yap" on the Ödeme card can refund the card charge from the panel. */
  cardRefund?: boolean;
};

/** Natural order of the buttons: the next step first, refund and cancel last. */
const ORDER: StatusAction[] = ["mark_paid", "start_processing", "ship", "deliver", "mark_refunded", "cancel"];
/** Vadeli: the goods go out first; the invoice payment is recorded whenever it arrives. */
const DEFERRED_ORDER: StatusAction[] = ["start_processing", "ship", "deliver", "mark_paid", "mark_refunded", "cancel"];

const BUTTON: Record<StatusAction, { label: string; icon: LucideIcon }> = {
  mark_paid: { label: "Ödeme alındı", icon: HandCoins },
  start_processing: { label: "Hazırlamaya başla", icon: PackageOpen },
  ship: { label: "Kargoya ver", icon: Truck },
  deliver: { label: "Teslim edildi", icon: PackageCheck },
  mark_refunded: { label: "İade edildi", icon: Undo2 },
  cancel: { label: "Siparişi iptal et", icon: Ban },
};

/** Actions that open a confirm step or a small form before submitting. */
const NEEDS_PANEL = new Set<StatusAction>(["mark_paid", "ship", "cancel", "mark_refunded"]);

function Spinner() {
  return <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />;
}

export default function OrderActions(props: OrderActionsProps) {
  const { orderId, actions } = props;
  const [open, setOpen] = useState<StatusAction | null>(null);
  const [submitting, setSubmitting] = useState<OrderAction | null>(null);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [reason, setReason] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [dismissed, setDismissed] = useState(0);
  const noticeRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const [state, formAction, pending] = useActionState(async (prev: OrderActionState, formData: FormData) => {
    setSubmitting(formData.get("action") as OrderAction);
    const next = await runOrderAction(prev, formData);
    if (next.status === "success") {
      setOpen(null);
      setCarrier("");
      setTracking("");
      setReason("");
      setRefundNote("");
    }
    return next;
  }, INITIAL_ORDER_ACTION_STATE);

  const fieldError = Object.keys(state.fieldErrors)[0] as keyof OrderActionState["fieldErrors"] | undefined;

  // Field errors: focus the first invalid field (its message sits under it). Otherwise focus the
  // result notice, so keyboard and screen-reader users are not left on a button that disappeared.
  useEffect(() => {
    if (state.seq === 0 || state.action === "add_note") return;
    if (state.status === "error" && fieldError) {
      const suffix = fieldError === "carrier" ? "carrier" : fieldError === "trackingNumber" ? "tracking" : state.action === "cancel" ? "reason" : "refund-note";
      document.getElementById(`${baseId}-${suffix}`)?.focus();
      return;
    }
    noticeRef.current?.focus();
  }, [state.seq, state.action, state.status, fieldError, baseId]);

  const available = (props.paymentMethod === "deferred" ? DEFERRED_ORDER : ORDER).filter((a) => actions.includes(a));
  const primary = available.find((a) => a !== "cancel" && a !== "mark_refunded");
  const showNotice = state.message && state.action !== "add_note" && state.seq !== dismissed && !fieldError;
  const errorsFor = (action: StatusAction) => (state.status === "error" && state.action === action ? state.fieldErrors : {});
  const panelId = (action: StatusAction) => `${baseId}-${action}`;

  function toggle(action: StatusAction) {
    setOpen((current) => (current === action ? null : action));
  }

  function hidden(action: StatusAction) {
    return (
      <>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="action" value={action} />
        {/* Refused server-side when the order moved on meanwhile (a payment, another staff member). */}
        <input type="hidden" name="expectedStatus" value={props.status} />
      </>
    );
  }

  function submit(action: StatusAction, label: string, className: string) {
    const busy = pending && submitting === action;
    return (
      <button type="submit" disabled={pending} className={className}>
        {busy ? <Spinner /> : null}
        {busy ? "Kaydediliyor…" : label}
      </button>
    );
  }

  function dismissPanel() {
    return (
      <button type="button" onClick={() => setOpen(null)} disabled={pending} className={ghostButtonClass}>
        Vazgeç
      </button>
    );
  }

  function trigger(action: StatusAction) {
    const { label, icon: Icon } = BUTTON[action];
    const style =
      action === "cancel" ? dangerOutlineButtonClass : action === primary ? primaryButtonClass : secondaryButtonClass;
    if (!NEEDS_PANEL.has(action)) {
      return (
        <form action={formAction}>
          {hidden(action)}
          <button type="submit" disabled={pending} className={cn(style, "w-full")}>
            {pending && submitting === action ? <Spinner /> : <Icon aria-hidden className="size-4" />}
            {pending && submitting === action ? "Kaydediliyor…" : label}
          </button>
        </form>
      );
    }
    const expanded = open === action;
    return (
      <button
        type="button"
        onClick={() => toggle(action)}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId(action) : undefined}
        disabled={pending}
        className={cn(style, "w-full", expanded && action !== primary && "bg-surface-2")}
      >
        <Icon aria-hidden className="size-4" />
        {label}
      </button>
    );
  }

  function panel(action: StatusAction) {
    if (open !== action) return null;
    const errors = errorsFor(action);
    const box = "mt-2 rounded-xl border border-border bg-surface-2/60 p-3.5";

    if (action === "mark_paid") {
      return (
        <form id={panelId(action)} action={formAction} className={box}>
          {hidden(action)}
          <p className="text-sm font-medium text-text">Ödemenin hesabınıza geçtiğini doğruladınız mı?</p>
          <p className="mt-1.5 text-sm text-text-muted">
            {props.paymentMethodLabel} · <span className="font-medium text-text tabular-nums">{props.grandTotalLabel}</span>.{" "}
            {props.paymentMethod === "deferred"
              ? "Firmanın fatura ödemesi kaydedilir; siparişin durumu değişmez. Bu adım geri alınamaz."
              : "Onaylandığında sipariş “Ödendi” durumuna geçer ve hazırlanmaya hazır olur. Bu adım geri alınamaz."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {submit(action, "Evet, ödeme alındı", primaryButtonClass)}
            {dismissPanel()}
          </div>
        </form>
      );
    }

    if (action === "ship") {
      const noCarriers = props.carriers.length === 0;
      return (
        <form id={panelId(action)} action={formAction} className={cn(box, "space-y-4")} noValidate>
          {hidden(action)}
          <div>
            <label htmlFor={`${baseId}-carrier`} className={labelClass}>
              Kargo firması
            </label>
            <select
              id={`${baseId}-carrier`}
              name="carrier"
              required
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              aria-invalid={errors.carrier ? true : undefined}
              aria-describedby={errors.carrier ? `${baseId}-carrier-error` : undefined}
              disabled={noCarriers}
              className={cn(fieldClass, "h-10")}
            >
              <option value="">Seçin</option>
              {props.carriers.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
            {noCarriers ? <p className={errorClass}>Ayarlarda tanımlı kargo firması yok.</p> : null}
            {errors.carrier ? (
              <p id={`${baseId}-carrier-error`} className={errorClass}>
                {errors.carrier}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor={`${baseId}-tracking`} className={labelClass}>
              Takip numarası
            </label>
            <input
              id={`${baseId}-tracking`}
              name="trackingNumber"
              required
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={60}
              aria-invalid={errors.trackingNumber ? true : undefined}
              aria-describedby={`${baseId}-tracking-hint${errors.trackingNumber ? ` ${baseId}-tracking-error` : ""}`}
              className={cn(fieldClass, "h-10 font-mono uppercase tracking-wide")}
            />
            <p id={`${baseId}-tracking-hint`} className={hintClass}>
              Harf, rakam ve tire; 4–40 karakter. Boşluklar otomatik silinir.
            </p>
            {errors.trackingNumber ? (
              <p id={`${baseId}-tracking-error`} className={errorClass}>
                {errors.trackingNumber}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {submit(action, "Kargoya verildi olarak kaydet", primaryButtonClass)}
            {dismissPanel()}
          </div>
        </form>
      );
    }

    if (action === "cancel") {
      return (
        <form id={panelId(action)} action={formAction} className={cn(box, "space-y-4")} noValidate>
          {hidden(action)}
          <div className="space-y-1.5 text-sm text-text">
            <p className="font-medium">Sipariş iptal edilecek. Bu işlem geri alınamaz.</p>
            {props.status === "shipped" ? (
              <p className="text-text-muted">
                Yalnızca teslim alınmayan ve depoya geri dönen bir gönderi için kullanın (ör. kapıda ödemede alıcı paketi almadı).
              </p>
            ) : null}
            <p className="text-text-muted">
              Ürünler stoğa geri eklenir{props.hasCoupon ? " ve kupon kullanımı geri alınır" : ""}.
              {props.paid
                ? props.paymentMethod === "card"
                  ? props.cardRefund
                    ? ` İptal parayı iade etmez: kartla tahsil edilen ${props.grandTotalLabel} tutarını iade etmek için iptal yerine Ödeme kartındaki “Kart iadesi yap”ı kullanın.`
                    : ` Kartla tahsil edilen ${props.grandTotalLabel} tutarını ödeme sağlayıcısının panelinden ayrıca iade etmeniz gerekir.`
                  : ` Alınan ${props.grandTotalLabel} tutarını müşteriye ayrıca iade etmeniz gerekir.`
                : ""}
            </p>
          </div>
          <div>
            <label htmlFor={`${baseId}-reason`} className={labelClass}>
              İptal nedeni
            </label>
            <textarea
              id={`${baseId}-reason`}
              name="note"
              required
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={errors.note ? true : undefined}
              aria-describedby={`${baseId}-reason-hint${errors.note ? ` ${baseId}-reason-error` : ""}`}
              placeholder="Örn. Müşteri telefonla iptal istedi."
              className={cn(fieldClass, "min-h-20 py-2")}
            />
            <p id={`${baseId}-reason-hint`} className={hintClass}>
              Sipariş geçmişine kaydedilir; müşteriye gösterilmez.
            </p>
            {errors.note ? (
              <p id={`${baseId}-reason-error`} className={errorClass}>
                {errors.note}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {submit(action, "Siparişi iptal et", dangerButtonClass)}
            {dismissPanel()}
          </div>
        </form>
      );
    }

    // mark_refunded (admin)
    const stockText = props.refundRestocks
      ? `Ürünler henüz gönderilmediği için stoğa geri eklenir${props.hasCoupon ? " ve kupon kullanımı geri alınır" : ""}.`
      : props.status === "cancelled"
        ? "Sipariş zaten iptal edildiği için stok değişmez; yalnızca iade kaydı düşülür."
        : "Stok otomatik değişmez: iade gelen ürünleri kontrol edip stoğa elle ekleyin.";
    return (
      <form id={panelId(action)} action={formAction} className={cn(box, "space-y-4")} noValidate>
        {hidden(action)}
        <div className="space-y-1.5 text-sm">
          <p className="font-medium text-text">Sipariş “İade edildi” olarak işaretlenecek.</p>
          <p className="text-text-muted">
            {stockText}
            {props.paid
              ? props.paymentMethod === "card" && props.cardRefund
                ? ` Bu işaret parayı iade etmez. Kartla alınan ${props.grandTotalLabel} tutarını karta iade etmek için Ödeme kartındaki “Kart iadesi yap”ı kullanın; o işlem siparişi de “İade edildi” yapar. Burayı yalnızca parayı başka yoldan iade ettiyseniz kullanın.`
                : ` Para iadesini (${props.grandTotalLabel}) ödeme sağlayıcısından veya bankadan ayrıca yapmanız gerekir.`
              : ""}
          </p>
        </div>
        <div>
          <label htmlFor={`${baseId}-refund-note`} className={labelClass}>
            Açıklama <span className="font-normal text-text-muted">(isteğe bağlı)</span>
          </label>
          <textarea
            id={`${baseId}-refund-note`}
            name="note"
            rows={2}
            maxLength={1000}
            value={refundNote}
            onChange={(e) => setRefundNote(e.target.value)}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? `${baseId}-refund-error` : undefined}
            placeholder="Örn. Ürün hasarlı ulaştı, tutar karta iade edildi."
            className={cn(fieldClass, "min-h-16 py-2")}
          />
          {errors.note ? (
            <p id={`${baseId}-refund-error`} className={errorClass}>
              {errors.note}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {submit(action, "İade edildi olarak işaretle", primaryButtonClass)}
          {dismissPanel()}
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {showNotice ? (
        <div
          ref={noticeRef}
          tabIndex={-1}
          role={state.status === "error" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-ring",
            state.status === "error" ? "border-[#B3261E]/30 bg-[#B3261E]/[0.07] dark:border-[#F28B82]/30" : "border-[#2F8F5B]/30 bg-[#2F8F5B]/10",
          )}
        >
          {state.status === "error" ? (
            <CircleExclamationPoint aria-hidden className="mt-0.5 size-4 shrink-0 text-[#B3261E] dark:text-[#F28B82]" />
          ) : (
            <CircleCheckBig aria-hidden className="mt-0.5 size-4 shrink-0 text-[#2F8F5B]" />
          )}
          <span className="min-w-0 flex-1">{state.message}</span>
          <button
            type="button"
            onClick={() => setDismissed(state.seq)}
            className="-me-1 -mt-0.5 grid size-6 shrink-0 place-items-center rounded text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden className="size-3.5" />
            <span className="sr-only">Mesajı kapat</span>
          </button>
        </div>
      ) : null}

      {available.length === 0 ? (
        <p className="text-sm text-text-muted">
          {props.status === "delivered"
            ? "Sipariş teslim edildi. İade gerekiyorsa bir yöneticinin işaretlemesi gerekir."
            : props.status === "cancelled" || props.status === "refunded"
              ? "Bu sipariş kapandı; yapılabilecek bir durum değişikliği yok. Not eklemeye devam edebilirsiniz."
              : "Bu sipariş için şu anda yapılabilecek bir durum değişikliği yok."}
        </p>
      ) : (
        <ul className="space-y-2">
          {available.map((action) => (
            <li key={action} className={cn(action === "cancel" && available.length > 1 && "border-t border-border pt-3")}>
              {trigger(action)}
              {panel(action)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
