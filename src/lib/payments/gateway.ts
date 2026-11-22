// Picks the card gateway. PAYMENT_SIMULATOR=true wins (local default); otherwise the provider chosen in
// the panel (settings.payments.card.provider) when its environment keys exist; otherwise null, and card
// checkout fails closed. On a live site with the panel's test mode on, only staff get a gateway for new
// payments (getCardGatewayFor / isCardPaymentReadyFor, go-live CF-11).
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DbExecutor } from "@/lib/cart/settings";
import { parseSettings, type Settings } from "@/lib/settings/types";
import { iyzicoEnv, localPaymentMockAllowed, paytrEnv } from "./config";
import { createIyzicoGateway } from "./iyzico-gateway";
import { createPaytrGateway } from "./paytr-gateway";
import { isSimulatorEnabled, simulatorGateway } from "./simulator-gateway";
import type { CardProvider, PaymentGateway } from "./types";

export type PaymentSettings = Settings<"payments">;

/** Fresh (uncached) read of the payments settings: a provider switch in the panel applies at once. `exec`: DB tests. */
export async function loadPaymentSettings(exec: DbExecutor = db): Promise<PaymentSettings> {
  const [row] = await exec.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "payments")).limit(1);
  return parseSettings("payments", row?.value);
}

type GatewayOptions = { testMode: boolean; installments: boolean; maxInstallments: number };

const optionsOf = (payments: PaymentSettings): GatewayOptions => ({
  testMode: payments.card.testMode,
  installments: payments.card.installments,
  maxInstallments: payments.card.maxInstallments,
});

/**
 * The gateway of one provider when it is configured, whatever the panel currently selects: callbacks,
 * notifications and refunds of a payment always go to the provider (and environment) that took it.
 */
export function gatewayFor(provider: CardProvider, options: GatewayOptions = { testMode: true, installments: false, maxInstallments: 1 }): PaymentGateway | null {
  switch (provider) {
    case "simulator":
      return isSimulatorEnabled() ? simulatorGateway : null;
    case "iyzico": {
      const env = iyzicoEnv(options.testMode);
      return env ? createIyzicoGateway({ ...env, ...options }) : null;
    }
    case "paytr": {
      const env = paytrEnv();
      return env ? createPaytrGateway({ ...env, ...options }) : null;
    }
    default:
      return null;
  }
}

/** Whether payments of `provider` can be verified here (keys present / simulator on). No DB read. */
export function isProviderConfigured(provider: CardProvider): boolean {
  if (provider === "simulator") return isSimulatorEnabled();
  if (provider === "iyzico") return iyzicoEnv(true) !== null;
  if (provider === "paytr") return paytrEnv() !== null;
  return false;
}

/**
 * The card gateway for NEW payments, or null (card checkout then fails closed). Pass the payments
 * settings when you already have them (cart views, placeOrder); otherwise they are read fresh.
 */
export async function getCardGateway(payments?: PaymentSettings): Promise<PaymentGateway | null> {
  if (isSimulatorEnabled()) return simulatorGateway;
  const settings = payments ?? (await loadPaymentSettings());
  return gatewayFor(settings.card.provider, optionsOf(settings));
}

export async function isCardPaymentReady(payments?: PaymentSettings): Promise<boolean> {
  return (await getCardGateway(payments)) !== null;
}

/**
 * Go-live CF-11: on a live site (a production build on a public origin) a card payment in the panel's test
 * mode moves no money, so card is offered only to signed-in panel staff, who use it to test the provider.
 * Everyone else sees card as not configured (cart view, checkout, placeOrder). Locally (outside production,
 * or `next start` on a local origin) nothing changes.
 */
export function cardTestModeHidden(payments: Pick<PaymentSettings, "card">, customer?: { staff?: boolean } | null): boolean {
  return payments.card.testMode && !localPaymentMockAllowed() && customer?.staff !== true;
}

/** The card gateway for a new payment by `customer` (null when none, or hidden by cardTestModeHidden). */
export async function getCardGatewayFor(payments: PaymentSettings, customer?: { staff?: boolean } | null): Promise<PaymentGateway | null> {
  return cardTestModeHidden(payments, customer) ? null : getCardGateway(payments);
}

/** isCardPaymentReady for `customer` (cart views, the checkout's legal preview). */
export async function isCardPaymentReadyFor(payments: PaymentSettings, customer?: { staff?: boolean } | null): Promise<boolean> {
  return (await getCardGatewayFor(payments, customer)) !== null;
}
