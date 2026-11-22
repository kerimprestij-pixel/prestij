"use server";
// "Kart iadesi yap" on /panel/siparisler/[id] (admin): refunds the card payment at the provider that took
// it, then marks the order refunded. The service re-checks the role, the order status and the payment.
import { refresh } from "next/cache";
import { z } from "zod";
import { ORDER_STATUSES } from "@/lib/orders/status-machine";
import { getPanelActor } from "@/lib/panel/action";
import { hasRole } from "@/lib/panel/roles";
import { refundCardPayment } from "@/lib/payments/refund";
import { safeErrorInfo } from "@/lib/db-errors";
import { clientIp } from "@/lib/request-ip";

export type CardRefundState = { status: "idle" | "success" | "error"; message: string; seq: number };

const input = z.object({
  orderId: z.coerce.number().int().positive().max(2_147_483_647),
  expectedStatus: z.enum(ORDER_STATUSES).optional().catch(undefined),
});

export async function refundCardAction(prev: CardRefundState, formData: FormData): Promise<CardRefundState> {
  const seq = (prev?.seq ?? 0) + 1;
  const actor = await getPanelActor();
  if (!actor) return { status: "error", message: "Oturumunuz sona ermiş. Yeni sekmede panele giriş yapıp tekrar deneyin.", seq };
  if (!hasRole(actor.staffRole, "admin")) return { status: "error", message: "Kart iadesini yalnızca yöneticiler yapabilir.", seq };
  const parsed = input.safeParse({ orderId: formData.get("orderId"), expectedStatus: formData.get("expectedStatus") ?? undefined });
  if (!parsed.success) return { status: "error", message: "İşlem bilgileri geçersiz. Sayfayı yenileyip tekrar deneyin.", seq };
  try {
    const result = await refundCardPayment(
      parsed.data.orderId,
      { userId: actor.user.id, role: actor.staffRole, name: actor.user.name },
      { expectedStatus: parsed.data.expectedStatus ?? null, clientIp: await clientIp() },
    );
    refresh();
    return result.ok ? { status: "success", message: result.message, seq } : { status: "error", message: result.error, seq };
  } catch (error) {
    console.error("[panel] card refund failed", { orderId: parsed.data.orderId, ...safeErrorInfo(error) });
    refresh();
    return { status: "error", message: "İade kaydedilemedi. Sipariş geçmişini kontrol edip tekrar deneyin.", seq };
  }
}
