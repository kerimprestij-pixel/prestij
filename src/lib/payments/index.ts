// Card payments: the simulator (PAYMENT_SIMULATOR=true, local default), iyzico Checkout Form and PayTR
// iFrame behind one PaymentGateway interface; getCardGateway() picks one (async, reads the panel choice).
export type {
  CardProvider,
  GatewayCallback,
  GatewayInitiateResult,
  GatewayOrder,
  GatewayRefundInput,
  GatewayRefundResult,
  PaymentGateway,
  ProviderKey,
} from "./types";
export { gatewayFor, getCardGateway, isCardPaymentReady, isProviderConfigured, loadPaymentSettings, type PaymentSettings } from "./gateway";
export {
  cardPageHref,
  completeCardPayment,
  initiateCardPayment,
  recordPaymentInitiated,
  type CompleteCardPaymentInput,
  type CompleteCardPaymentResult,
  type InitiateCardPaymentOptions,
  type InitiateCardPaymentResult,
} from "./complete";
export { handleIyzicoCallback, handlePaytrNotify, type IyzicoCallbackResult, type PaytrNotifyResult } from "./callbacks";
export { getCardPageSession, getCardReturnState, type CardPageSession, type CardReturnState } from "./card-page";
export { CARD_PROVIDER_LABELS, getCardRefundInfo, refundCardPayment, type CardRefundInfo, type RefundCardPaymentResult } from "./refund";
export { getPaymentReadiness, type PaymentReadiness } from "./readiness";
export { getSimulatorSession, isSimulatorEnabled, simulateCardPayment, type SimulateResult, type SimulatorSession } from "./simulator";
