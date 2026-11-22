// Shared shape of the order status action result (server action ↔ client forms). Pure.
import type { OrderAction } from "@/lib/orders/status-machine";

export type OrderActionField = "note" | "carrier" | "trackingNumber";

export type OrderActionState = {
  status: "idle" | "success" | "error";
  /** Turkish message for the notice strip. */
  message: string | null;
  action: OrderAction | null;
  fieldErrors: Partial<Record<OrderActionField, string>>;
  /** Changes on every response, so the same message twice is still announced. */
  seq: number;
};

export const INITIAL_ORDER_ACTION_STATE: OrderActionState = {
  status: "idle",
  message: null,
  action: null,
  fieldErrors: {},
  seq: 0,
};
