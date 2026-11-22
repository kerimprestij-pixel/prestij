// The simulator as a PaymentGateway. Enabled ONLY when process.env.PAYMENT_SIMULATOR === "true", and never
// on a live site (go-live CF-1).
import "server-only";
import { randomUUID } from "node:crypto";
import { href } from "@/i18n/paths";
import { localPaymentMockAllowed } from "./config";
import type { GatewayCallback, GatewayOrder, GatewayRefundInput, GatewayRefundResult, PaymentGateway } from "./types";

/**
 * PAYMENT_SIMULATOR=true, and only where the local payment mock is allowed (outside production, or a
 * production build serving a local origin). A production build on a public https origin ignores the
 * variable, so a value copied into the hosting dashboard can never mark orders paid without money.
 */
export function isSimulatorEnabled(): boolean {
  return process.env.PAYMENT_SIMULATOR === "true" && localPaymentMockAllowed();
}

export const simulatorGateway: PaymentGateway = {
  provider: "simulator",
  isReady: isSimulatorEnabled,
  async initiate(order: GatewayOrder) {
    if (!isSimulatorEnabled()) throw new Error("Payment simulator is disabled");
    const params = new URLSearchParams({ order: order.orderNumber, t: order.accessToken });
    return { redirectUrl: `${href(order.locale, "paymentSimulator")}?${params.toString()}` };
  },
  async handleCallback(payload: unknown): Promise<GatewayCallback | null> {
    if (!isSimulatorEnabled() || !payload || typeof payload !== "object") return null;
    const p = payload as { orderId?: unknown; outcome?: unknown; amount?: unknown };
    if (typeof p.orderId !== "number" || typeof p.amount !== "number" || (p.outcome !== "success" && p.outcome !== "failure")) return null;
    return {
      orderId: p.orderId,
      providerRef: `SIM-${randomUUID()}`,
      success: p.outcome === "success",
      amount: p.amount,
      raw: { simulator: true, outcome: p.outcome, at: new Date().toISOString() },
    };
  },
  /** Local only: the "refund" always succeeds while the simulator is on (nothing leaves the machine). */
  async refund(input: GatewayRefundInput): Promise<GatewayRefundResult> {
    if (!isSimulatorEnabled()) return { ok: false, error: "Ödeme simülatörü bu ortamda kapalı." };
    return { ok: true, ref: `SIM-REFUND-${randomUUID()}`, raw: { simulator: true, amount: input.amount } };
  },
};
