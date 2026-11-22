"use client";
// "Kart iadesi yap" (admin): a confirm dialog, then the refund at the provider + mark_refunded.
import { startTransition, useActionState, useState } from "react";
import { Undo2 } from "lucide-react";
import { refundCardAction, type CardRefundState } from "@/app/panel/(dashboard)/siparisler/refund-actions";
import ConfirmDialog from "@/components/panel/ui/ConfirmDialog";
import { toast } from "@/components/panel/ui/toast-store";
import type { OrderStatus } from "@/db/schema/commerce";
import { dangerOutlineButtonClass } from "./form-styles";

type Props = {
  orderId: number;
  orderNumber: string;
  status: OrderStatus;
  providerLabel: string;
  amountLabel: string;
  /** mark_refunded from this status puts stock back (paid / processing). */
  restocks: boolean;
};

const INITIAL: CardRefundState = { status: "idle", message: "", seq: 0 };

export default function CardRefundButton({ orderId, orderNumber, status, providerLabel, amountLabel, restocks }: Props) {
  const [open, setOpen] = useState(false);
  const [, action, pending] = useActionState(async (prev: CardRefundState, data: FormData) => {
    const next = await refundCardAction(prev, data);
    setOpen(false);
    if (next.status === "success") toast.success(next.message, { duration: 8000 });
    else if (next.status === "error") toast.error(next.message, { duration: 0 });
    return next;
  }, INITIAL);

  const confirm = () => {
    const data = new FormData();
    data.set("orderId", String(orderId));
    data.set("expectedStatus", status);
    startTransition(() => action(data));
  };

  return (
    <>
      <button type="button" className={dangerOutlineButtonClass} onClick={() => setOpen(true)} disabled={pending}>
        <Undo2 aria-hidden className="size-4" />
        Kart iadesi yap
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={confirm}
        pending={pending}
        title={`${orderNumber} kart ile iade edilsin mi?`}
        confirmLabel="İadeyi yap"
        description={
          <>
            {amountLabel} tutarın tamamı {providerLabel} üzerinden müşterinin kartına iade edilir ve sipariş “İade edildi” olarak işaretlenir
            {restocks ? "; ürünler stoğa geri eklenir" : ""}. Bu işlem geri alınamaz. Paranın karta yansıması bankaya göre birkaç gün sürebilir.
          </>
        }
      />
    </>
  );
}
