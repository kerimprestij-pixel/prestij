"use server";
// Order status actions from the panel detail page. Each call re-checks the session and role
// (refunds: admin), validates the form with zod and runs the core state machine (transitionOrder),
// which re-checks the role and the current status inside its transaction.
import { refresh } from "next/cache";
import { z } from "zod";
import type { OrderActionField, OrderActionState } from "@/components/panel/orders/action-state";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { safeErrorInfo } from "@/lib/db-errors";
import { transitionOrder, type TransitionErrorCode } from "@/lib/orders/status";
import { ORDER_ACTIONS, ORDER_STATUSES, type OrderAction } from "@/lib/orders/status-machine";
import { requireAdmin, requireStaff } from "@/lib/session";

const orderId = z.coerce.number().int().positive().max(2_147_483_647);
/** The status shown on the page when the form was rendered; the action is refused if it changed since. */
const expectedStatus = z.enum(ORDER_STATUSES).optional().catch(undefined);
const NOTE_MAX = 1000;

const formSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark_paid"), orderId, expectedStatus }),
  z.object({ action: z.literal("start_processing"), orderId, expectedStatus }),
  z.object({
    action: z.literal("ship"),
    orderId,
    expectedStatus,
    carrier: z.string({ error: "Kargo firmasını seçin." }).trim().min(1, "Kargo firmasını seçin.").max(40, "Geçersiz kargo firması."),
    trackingNumber: z
      .string({ error: "Takip numarasını girin." })
      .transform((v) => v.replace(/\s+/g, "").toUpperCase())
      .pipe(
        z
          .string()
          .min(1, "Takip numarasını girin.")
          .regex(/^[A-Z0-9-]{4,40}$/, "Takip numarası 4–40 karakter olmalı; yalnızca harf, rakam ve tire içerebilir."),
      ),
  }),
  z.object({ action: z.literal("deliver"), orderId, expectedStatus }),
  z.object({
    action: z.literal("cancel"),
    orderId,
    expectedStatus,
    note: z
      .string({ error: "İptal nedenini yazın." })
      .trim()
      .min(3, "İptal nedenini yazın (en az 3 karakter).")
      .max(NOTE_MAX, `İptal nedeni en fazla ${NOTE_MAX} karakter olabilir.`),
  }),
  z.object({
    action: z.literal("mark_refunded"),
    orderId,
    expectedStatus,
    note: z.string({ error: "Açıklama geçersiz." }).trim().max(NOTE_MAX, `Açıklama en fazla ${NOTE_MAX} karakter olabilir.`).optional(),
  }),
  z.object({
    action: z.literal("add_note"),
    orderId,
    note: z.string({ error: "Not boş olamaz." }).trim().min(1, "Not boş olamaz.").max(NOTE_MAX, `Not en fazla ${NOTE_MAX} karakter olabilir.`),
  }),
]);

const ERROR_MESSAGES: Record<TransitionErrorCode, string> = {
  not_found: "Sipariş bulunamadı. Silinmiş olabilir.",
  invalid_transition: "Bu işlem siparişin şu anki durumunda yapılamaz; sipariş bu arada değişmiş olabilir. Sayfa yenilendi, güncel durumu kontrol edin.",
  forbidden: "Bu işlem için yetkiniz yok.",
  not_paid: "Ödemesi alınmamış bir sipariş iade edildi olarak işaretlenemez. Gerekirse siparişi iptal edin.",
  note_required: "Lütfen bir açıklama yazın.",
  carrier_required: "Kargo firmasını seçin.",
  invalid_carrier: "Seçilen kargo firması ayarlarda tanımlı değil.",
  tracking_required: "Takip numarasını girin.",
  invalid_tracking: "Takip numarası 4–40 karakter olmalı; yalnızca harf, rakam ve tire içerebilir.",
};

const FIELD_OF_ERROR: Partial<Record<TransitionErrorCode, OrderActionField>> = {
  note_required: "note",
  carrier_required: "carrier",
  invalid_carrier: "carrier",
  tracking_required: "trackingNumber",
  invalid_tracking: "trackingNumber",
};

const nextSeq = (prev: OrderActionState) => (prev?.seq ?? 0) + 1;

function fail(prev: OrderActionState, action: OrderAction | null, message: string, fieldErrors: OrderActionState["fieldErrors"] = {}): OrderActionState {
  return { status: "error", message, action, fieldErrors, seq: nextSeq(prev) };
}

/** useActionState handler for every status form on /panel/siparisler/[id]. */
export async function runOrderAction(prev: OrderActionState, formData: FormData): Promise<OrderActionState> {
  const requested = formData.get("action");
  const action = (ORDER_ACTIONS as readonly unknown[]).includes(requested) ? (requested as OrderAction) : null;
  // Auth first (redirects when the session is gone or the role is too low).
  const session = action === "mark_refunded" ? await requireAdmin() : await requireStaff();

  const raw = Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string"));
  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: OrderActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((field === "note" || field === "carrier" || field === "trackingNumber") && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    const first = Object.values(fieldErrors)[0];
    return fail(prev, action, first ?? "İşlem bilgileri geçersiz. Sayfayı yenileyip tekrar deneyin.", fieldErrors);
  }

  const input = parsed.data;
  const note = "note" in input ? (input.note ?? null) : null;
  const carrier = input.action === "ship" ? input.carrier : null;
  const trackingNumber = input.action === "ship" ? input.trackingNumber : null;

  let result: Awaited<ReturnType<typeof transitionOrder>>;
  try {
    result = await transitionOrder(input.orderId, input.action, {
      actor: { userId: session.user.id, role: session.staffRole, name: session.user.name },
      note,
      carrier,
      trackingNumber,
      // add_note never depends on the status; every status change does.
      expectedStatus: input.action === "add_note" ? null : (input.expectedStatus ?? null),
    });
  } catch (error) {
    console.error("[panel] order action failed", { orderId: input.orderId, action: input.action, ...safeErrorInfo(error) });
    return fail(prev, input.action, "İşlem kaydedilemedi. Lütfen tekrar deneyin.");
  }

  if (!result.ok) {
    // The status may have changed in the meantime (another tab, a payment callback): show it.
    if (result.code === "invalid_transition" || result.code === "not_paid") refresh();
    const field = FIELD_OF_ERROR[result.code];
    return fail(prev, input.action, ERROR_MESSAGES[result.code], field ? { [field]: ERROR_MESSAGES[result.code] } : {});
  }

  let message: string;
  switch (input.action) {
    case "mark_paid":
      message = `${result.orderNumber} ödendi olarak işaretlendi. Sipariş hazırlanmaya hazır.`;
      break;
    case "start_processing":
      message = "Sipariş hazırlanıyor durumuna alındı.";
      break;
    case "ship": {
      const { shipping } = await loadCommerceSettings();
      const name = shipping.carriers.find((c) => c.key === carrier)?.name ?? carrier;
      message = `Sipariş kargoya verildi: ${name}, takip no ${trackingNumber}.`;
      break;
    }
    case "deliver":
      message = "Sipariş teslim edildi olarak işaretlendi.";
      break;
    case "cancel":
      message = result.restocked ? "Sipariş iptal edildi. Ürünler stoğa geri eklendi." : "Sipariş iptal edildi.";
      break;
    case "mark_refunded":
      message = result.restocked
        ? "Sipariş iade edildi olarak işaretlendi. Ürünler stoğa geri eklendi."
        : "Sipariş iade edildi olarak işaretlendi. Stok değişmedi.";
      break;
    case "add_note":
      message = "Not sipariş geçmişine eklendi.";
      break;
  }

  refresh();
  return { status: "success", message, action: input.action, fieldErrors: {}, seq: nextSeq(prev) };
}
