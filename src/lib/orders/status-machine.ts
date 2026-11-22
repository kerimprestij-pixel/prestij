// The order status machine and the customer-facing timeline. Pure (unit-tested); the DB side is
// src/lib/orders/status.ts.
import type { OrderStatus, PaymentMethod } from "@/db/schema/commerce";

export type { OrderStatus };

export const ORDER_STATUSES = [
  "pending_payment",
  "awaiting_transfer",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const satisfies readonly OrderStatus[];

export const ORDER_ACTIONS = ["mark_paid", "start_processing", "ship", "deliver", "cancel", "mark_refunded", "add_note"] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

/** Panel roles (lowest → highest) plus the system actor (expiry job, payment callbacks). */
export type ActorRole = "staff" | "editor" | "admin" | "system";
const RANK: Record<ActorRole, number> = { staff: 0, editor: 1, admin: 2, system: 3 };

export type TransitionRule = {
  /** Statuses the action may start from ("any" for notes). */
  from: readonly OrderStatus[] | "any";
  /** Resulting status; null = unchanged (notes). */
  to: OrderStatus | null;
  minRole: ActorRole;
  /** Extra inputs the action needs. */
  requires: readonly ("note" | "carrier" | "trackingNumber")[];
  /** Puts the ordered quantities back into stock and releases one coupon use. */
  restock: readonly OrderStatus[];
};

/**
 * The whole state machine. Initial statuses (placeOrder): card → pending_payment; havale →
 * awaiting_transfer; kapıda ödeme and deferred → processing. A successful card payment
 * (completeCardPayment) moves pending_payment → paid, like mark_paid.
 */
export const ORDER_TRANSITIONS: Record<OrderAction, TransitionRule> = {
  mark_paid: { from: ["pending_payment", "awaiting_transfer"], to: "paid", minRole: "staff", requires: [], restock: [] },
  start_processing: { from: ["paid"], to: "processing", minRole: "staff", requires: [], restock: [] },
  ship: { from: ["paid", "processing"], to: "shipped", minRole: "staff", requires: ["carrier", "trackingNumber"], restock: [] },
  deliver: { from: ["shipped"], to: "delivered", minRole: "staff", requires: [], restock: [] },
  // From shipped only while no money was taken (paidAt null): a kapıda ödeme / deferred parcel that
  // was refused at the door and came back. The goods are back in the warehouse, so it restocks.
  cancel: {
    from: ["pending_payment", "awaiting_transfer", "paid", "processing", "shipped"],
    to: "cancelled",
    minRole: "staff",
    requires: ["note"],
    restock: ["pending_payment", "awaiting_transfer", "paid", "processing", "shipped"],
  },
  // Refund needs admin and money that was actually received (paidAt; kapıda ödeme sets it on
  // delivery, a captured card charge on a cancelled order sets it too). From paid/processing the goods
  // never left: restock like a cancel. From shipped/delivered (a return) stock is adjusted by hand.
  mark_refunded: {
    from: ["paid", "processing", "shipped", "delivered", "cancelled"],
    to: "refunded",
    minRole: "admin",
    requires: [],
    restock: ["paid", "processing"],
  },
  add_note: { from: "any", to: null, minRole: "staff", requires: ["note"], restock: [] },
};

/**
 * Vadeli (deferred) orders start in processing and move on unpaid; the company pays its invoice later.
 * mark_paid records that payment from these statuses without changing the status (so a later return
 * can be recorded with mark_refunded).
 */
export const DEFERRED_PAYABLE_STATUSES: readonly OrderStatus[] = ["processing", "shipped", "delivered"];

export type TransitionOrderState = { status: OrderStatus; paidAt: Date | string | null; paymentMethod?: PaymentMethod | null };

export type TransitionCheck =
  | { ok: true; to: OrderStatus; restock: boolean }
  | { ok: false; code: "invalid_transition" | "forbidden" | "not_paid" };

/** Can `role` run `action` on an order in this state? (Inputs like carrier are checked separately.) */
export function checkTransition(order: TransitionOrderState, action: OrderAction, role: ActorRole): TransitionCheck {
  const rule = ORDER_TRANSITIONS[action];
  if (!rule) return { ok: false, code: "invalid_transition" };
  if (RANK[role] === undefined || RANK[role] < RANK[rule.minRole]) return { ok: false, code: "forbidden" };
  if (action === "mark_paid" && order.paymentMethod === "deferred" && DEFERRED_PAYABLE_STATUSES.includes(order.status)) {
    return order.paidAt ? { ok: false, code: "invalid_transition" } : { ok: true, to: order.status, restock: false };
  }
  if (rule.from !== "any" && !rule.from.includes(order.status)) return { ok: false, code: "invalid_transition" };
  // Nothing to refund when no money came in (unpaid kapıda ödeme / deferred, cancelled before paying).
  if (action === "mark_refunded" && !order.paidAt) return { ok: false, code: "not_paid" };
  // After shipping, cancel is only for an unpaid parcel that came back; paid orders are refunded.
  if (action === "cancel" && order.status === "shipped" && order.paidAt) return { ok: false, code: "invalid_transition" };
  return { ok: true, to: rule.to ?? order.status, restock: rule.restock.includes(order.status) };
}

/**
 * Actions the panel should offer for this order and role. not_paid counts as "not offered": an
 * unpaid order is cancelled, never refunded.
 */
export function allowedActions(order: TransitionOrderState, role: ActorRole): OrderAction[] {
  return ORDER_ACTIONS.filter((action) => checkTransition(order, action, role).ok);
}

// ---------------------------------------------------------------------------------------------
// Timeline

export type TimelineStepKey = "placed" | "paid" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded";

export type TimelineStep = {
  key: TimelineStepKey;
  /** done = happened; current = what the order is waiting for; upcoming; skipped = never happened (cancelled). */
  state: "done" | "current" | "upcoming" | "skipped";
  at: string | null;
};

export type TimelineOrder = {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  createdAt: Date | string;
  paidAt: Date | string | null;
  shippedAt: Date | string | null;
  deliveredAt: Date | string | null;
  cancelledAt: Date | string | null;
};

export type TimelineEvent = { type: string; data: unknown; createdAt: Date | string };

const iso = (d: Date | string | null | undefined): string | null => (d == null ? null : typeof d === "string" ? d : d.toISOString());

/** First status_changed event into `status`, if any. */
function changedTo(events: readonly TimelineEvent[], status: OrderStatus): string | null {
  const e = events.find((x) => x.type === "status_changed" && (x.data as { to?: string } | null)?.to === status);
  return e ? iso(e.createdAt) : null;
}

/** Customer-facing progress steps (label them with your own messages by `key`). */
export function buildTimeline(order: TimelineOrder, events: readonly TimelineEvent[] = []): TimelineStep[] {
  const prepaid = order.paymentMethod === "card" || order.paymentMethod === "bank_transfer";
  const flow: TimelineStepKey[] = prepaid ? ["placed", "paid", "processing", "shipped", "delivered"] : ["placed", "processing", "shipped", "delivered"];
  const at: Partial<Record<TimelineStepKey, string | null>> = {
    placed: iso(order.createdAt),
    paid: iso(order.paidAt),
    processing: changedTo(events, "processing") ?? (prepaid ? null : iso(order.createdAt)),
    shipped: iso(order.shippedAt),
    delivered: iso(order.deliveredAt),
  };
  const terminal = order.status === "cancelled" || order.status === "refunded";
  const reachedIndex: Record<OrderStatus, number> = {
    pending_payment: 0,
    awaiting_transfer: 0,
    paid: flow.indexOf("paid"),
    processing: flow.indexOf("processing"),
    shipped: flow.indexOf("shipped"),
    delivered: flow.indexOf("delivered"),
    cancelled: -1,
    refunded: -1,
  };

  if (!terminal) {
    const reached = Math.max(0, reachedIndex[order.status]);
    return flow.map((key, i) => ({
      key,
      state: i <= reached ? "done" : i === reached + 1 ? "current" : "upcoming",
      at: i <= reached ? (at[key] ?? null) : null,
    }));
  }

  const steps: TimelineStep[] = flow.map((key) => {
    const when = at[key] ?? null;
    return { key, state: when ? "done" : "skipped", at: when };
  });
  if (order.status === "refunded" && order.cancelledAt) steps.push({ key: "cancelled", state: "done", at: iso(order.cancelledAt) });
  steps.push({
    key: order.status === "refunded" ? "refunded" : "cancelled",
    state: "done",
    at: order.status === "refunded" ? changedTo(events, "refunded") : iso(order.cancelledAt),
  });
  return steps;
}
