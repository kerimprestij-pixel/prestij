// Card payment gateway contract (types only: safe anywhere). The simulator (local), iyzico (Checkout
// Form) and PayTR (iFrame API) implement it; getCardGateway() in ./gateway.ts picks one.
import type { Locale } from "@/i18n/config";
import type { PaymentProvider } from "@/db/schema/commerce";

/** Providers that take card payments through a gateway. */
export type CardProvider = Exclude<PaymentProvider, "manual">;
/** The real providers chosen in the panel (settings.payments.card.provider). */
export type ProviderKey = "iyzico" | "paytr";

/** One basket line sent to a provider. The lines of an order always add up to its grandTotal. */
export type GatewayLine = {
  /** Stable id within the order (order item id, "shipping", "fee"). */
  id: string;
  /** Turkish name shown in the provider's merchant panel ("Lavanta Sıvı El Sabunu · 500 ml"). */
  name: string;
  quantity: number;
  /** Line total after discounts, in kuruş (> 0). */
  total: number;
  kind: "item" | "shipping" | "fee";
};

export type GatewayAddress = {
  contactName: string;
  /** Province name ("Kayseri"). */
  city: string;
  district: string;
  /** Street address incl. neighbourhood and district. */
  line: string;
  zipCode: string | null;
  /** ISO code ("TR"). */
  country: string;
};

export type GatewayBuyer = {
  /** The account id, or "guest-<orderNumber>". */
  id: string;
  fullName: string;
  email: string;
  /** "+905321234567" when it is a Turkish mobile number, otherwise as typed. */
  phone: string;
  /** TCKN from an individual invoice, when given. */
  identityNumber: string | null;
  registeredAt: Date | null;
};

/** What a gateway needs to start a payment. */
export type GatewayOrder = {
  id: number;
  orderNumber: string;
  accessToken: string;
  /** Amount to charge in kuruş (orders.grandTotal). */
  amount: number;
  locale: Locale;
  email: string;
  /**
   * Buyer, addresses, basket and client IP (day 4). Always set by initiateCardPayment(); the real
   * providers refuse to start without it, the simulator ignores it.
   */
  details?: {
    buyer: GatewayBuyer;
    shippingAddress: GatewayAddress;
    billingAddress: GatewayAddress;
    lines: GatewayLine[];
    /** The buyer's IP (trusted client IP of the request that starts the payment). */
    clientIp: string | null;
    /** 1-based number of this payment attempt for the order (PayTR merchant_oid suffix). */
    attempt: number;
  };
};

/** What initiate() asks the caller to remember for this attempt (stored in payments.raw.attempts[]). */
export type GatewayAttempt = {
  /** The provider's id for the attempt: iyzico checkout form token, PayTR merchant_oid. */
  ref: string;
  /** The provider environment the attempt runs in (callbacks and refunds must use the same one). */
  testMode: boolean;
  /** Extra non-secret data, e.g. { conversationId } or { iframeUrl, paymentAmount }. */
  raw?: Record<string, unknown>;
};

/** iyzico and the simulator send the buyer to a page (redirectUrl); PayTR shows an iframe on /odeme/kart. */
export type GatewayInitiateResult = ({ redirectUrl: string; iframeUrl?: undefined } | { iframeUrl: string; redirectUrl?: undefined }) & {
  attempt?: GatewayAttempt;
};

/** A provider callback, verified and parsed into the shape completeCardPayment() takes. */
export type GatewayCallback = {
  orderId: number;
  providerRef: string;
  success: boolean;
  /** Amount the provider reports as charged, in kuruş. */
  amount: number;
  raw: Record<string, unknown>;
};

export type GatewayRefundInput = {
  orderId: number;
  /** payments.providerRef of the succeeded payment (iyzico paymentId, PayTR merchant_oid). */
  providerRef: string;
  /** Full amount to refund, in kuruş (partial refunds are out of scope). */
  amount: number;
  /** payments.raw of the succeeded payment (testMode, item transactions, earlier refund progress). */
  raw: Record<string, unknown>;
  clientIp?: string | null;
};

/** `raw` (both cases) is merged into payments.raw.refund, e.g. iyzico's per-item progress. */
export type GatewayRefundResult = { ok: true; ref: string; raw?: Record<string, unknown> } | { ok: false; error: string; raw?: Record<string, unknown> };

export interface PaymentGateway {
  readonly provider: CardProvider;
  /** True when the gateway is configured for this environment. Card checkout fails closed otherwise. */
  isReady(): boolean;
  /** Starts a payment: a page to send the buyer to (iyzico, simulator) or an iframe URL (PayTR). */
  initiate(order: GatewayOrder): Promise<GatewayInitiateResult>;
  /**
   * Verifies and parses a provider callback (signature/hash checks live here). Returns null for an
   * invalid or forged payload. The caller then runs completeCardPayment(result).
   */
  handleCallback(payload: unknown): Promise<GatewayCallback | null>;
  /** Refunds a succeeded payment in full at the provider. Never throws for provider errors. */
  refund(input: GatewayRefundInput): Promise<GatewayRefundResult>;
}
