// What /panel/ayarlar/odeme shows about the card providers: which environment variables are set (never
// their values), which endpoint is used, which gateway new payments go to, the URLs to give the
// providers, and refused PayTR notifications of the last 72 hours (alerts.ts).
import "server-only";
import { db } from "@/db";
import { absoluteUrl, siteOrigin } from "@/i18n/paths";
import { loadCheckoutLegalDocs } from "@/lib/orders/legal-docs";
import { checkoutLegalReady } from "@/lib/orders/legal-ready";
import { notifyRefusalSummary, type NotifyRefusalSummary } from "./alerts";
import { providerEnvStatus, type ProviderEnvStatus } from "./config";
import { cardTestModeHidden, loadPaymentSettings } from "./gateway";
import { isSimulatorEnabled } from "./simulator-gateway";

export type PaymentReadiness = {
  /** "Kartla ödeme" is switched on. When off, the block says so instead of naming the gateway (`active`). */
  cardEnabled: boolean;
  simulator: boolean;
  selected: "iyzico" | "paytr";
  testMode: boolean;
  /**
   * Go-live CF-11: test mode on a live site (a production build on a public origin): card is offered only
   * to signed-in panel staff, everyone else sees it as unavailable.
   */
  testModeStaffOnly: boolean;
  /**
   * At least one payment method is switched on, but the checkout cannot take orders because the
   * pre-information form or the distance sales agreement is missing or still a "taslak…" version
   * (checkoutLegalReady, the same rule as the checkout page and placeOrder).
   */
  checkoutClosedByContracts: boolean;
  /** The gateway new card payments use right now. */
  active: "simulator" | "iyzico" | "paytr" | null;
  providers: ProviderEnvStatus[];
  /**
   * iyzico keys that cannot work with the current mode (sandbox keys start with "sandbox-"): live keys
   * while test mode is on, or sandbox keys in live mode. Null when fine, unknown or the mock is used.
   */
  iyzicoKeyMismatch: "live_keys_in_test" | "sandbox_keys_live" | null;
  /**
   * PayTR-fix IMPL-A2: /api/payments/paytr/notify refused notifications in the last 72 hours (bad hash, missing
   * fields, keys not configured): "PayTR bildirimleri reddediliyor". Null when there were none.
   */
  notifyRefusals: NotifyRefusalSummary | null;
  urls: {
    siteOrigin: string;
    /** NEXT_PUBLIC_SITE_URL is not a public https address (callbacks cannot reach it). */
    siteOriginProblem: string | null;
    iyzicoCallback: string;
    paytrNotify: string;
  };
};

export async function getPaymentReadiness(): Promise<PaymentReadiness> {
  const [settings, contracts, notifyRefusals] = await Promise.all([loadPaymentSettings(), loadCheckoutLegalDocs(), notifyRefusalSummary(db)]);
  const anyMethodOn = settings.card.enabled || settings.bankTransfer.enabled || settings.cashOnDelivery.enabled;
  const providers = providerEnvStatus(settings.card.testMode);
  const simulator = isSimulatorEnabled();
  const selected = settings.card.provider;
  const selectedReady = providers.find((p) => p.provider === selected)?.ready ?? false;
  const origin = siteOrigin();
  let siteOriginProblem: string | null = null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") siteOriginProblem = "Site adresi https:// ile başlamıyor; ödeme kuruluşları bu adrese bildirim gönderemez.";
    else if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname === "127.0.0.1") siteOriginProblem = "Site adresi yerel bir adres; ödeme kuruluşları ulaşamaz.";
  } catch {
    siteOriginProblem = "NEXT_PUBLIC_SITE_URL geçerli bir adres değil.";
  }
  const iyzicoKey = process.env.IYZICO_API_KEY?.trim() ?? "";
  const iyzicoSandboxKey = iyzicoKey.toLowerCase().startsWith("sandbox-");
  const iyzicoKeyMismatch =
    !iyzicoKey || process.env.IYZICO_BASE_URL?.trim()
      ? null
      : settings.card.testMode && !iyzicoSandboxKey
        ? "live_keys_in_test"
        : !settings.card.testMode && iyzicoSandboxKey
          ? "sandbox_keys_live"
          : null;
  return {
    cardEnabled: settings.card.enabled,
    simulator,
    selected,
    testMode: settings.card.testMode,
    testModeStaffOnly: cardTestModeHidden(settings),
    checkoutClosedByContracts: anyMethodOn && !checkoutLegalReady(contracts),
    iyzicoKeyMismatch,
    active: simulator ? "simulator" : selectedReady ? selected : null,
    providers,
    notifyRefusals,
    urls: {
      siteOrigin: origin,
      siteOriginProblem,
      iyzicoCallback: absoluteUrl("/api/payments/iyzico/callback"),
      paytrNotify: absoluteUrl("/api/payments/paytr/notify"),
    },
  };
}
