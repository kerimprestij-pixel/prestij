// iyzico Checkout Form gateway.
//
// ── What iyzico documents (read 2026-11-10) ──────────────────────────────────────────────────────────
// Sources:
//   Auth (IYZWSv2):        https://docs.iyzico.com/en/getting-started/preliminaries/authentication/hmacsha256-auth
//   CF initialize:         https://docs.iyzico.com/en/payment-methods/direct-charge/checkoutform/cf-implementation/cf-initialize
//   CF retrieve:           https://docs.iyzico.com/en/payment-methods/direct-charge/checkoutform/cf-implementation/cf-retrieve
//   Response signatures:   https://docs.iyzico.com/en/advanced/response-signature-validation
//   Refund & cancel:       https://docs.iyzico.com/en/advanced/refund-and-cancel
//   SDK cross-check:       https://github.com/iyzico/iyzipay-node (lib/utils.js generateHashV2, formatPrice,
//                          calculateHmacSHA256Signature; lib/IyzipayResource.js)
//
// Hosts: sandbox https://sandbox-api.iyzipay.com, live https://api.iyzipay.com (IYZICO_BASE_URL overrides;
// the panel's test mode picks sandbox when no override is set).
//
// Request authentication (every POST, JSON body, Content-Type: application/json):
//   randomKey   = any unique string, sent as header `x-iyzi-rnd` (we use epoch ms + 9 random digits)
//   signature   = hex( HMAC-SHA256( randomKey + uriPath + requestBodyJson, secretKey ) )
//                 uriPath is the path only, e.g. "/payment/iyzipos/checkoutform/initialize/auth/ecom";
//                 the body is the exact JSON string that is sent (SDK: JSON.stringify(body)).
//   Authorization: "IYZWSv2 " + base64( "apiKey:" + apiKey + "&randomKey:" + randomKey + "&signature:" + signature )
//                  (exactly one space after IYZWSv2).
//
// Checkout Form initialize  POST /payment/iyzipos/checkoutform/initialize/auth/ecom
//   locale (tr|en), conversationId, price, paidPrice, currency "TRY", basketId, paymentGroup "PRODUCT",
//   callbackUrl, enabledInstallments [1..n], buyer { id, name, surname, gsmNumber, email, identityNumber,
//   registrationAddress, ip, city, country, zipCode?, registrationDate? }, shippingAddress / billingAddress
//   { contactName, city, country, address, zipCode? }, basketItems [{ id, name, category1, itemType
//   PHYSICAL|VIRTUAL, price }]. Prices are decimal strings ("129.9", SDK formatPrice); basket item prices
//   must add up exactly to `price`. Answer: { status, token, paymentPageUrl, checkoutFormContent,
//   tokenExpireTime, conversationId, signature } — signature params: conversationId, token.
//   We send basketId = order number, conversationId = "<order number>-<attempt>", price = paidPrice =
//   orders.grandTotal, callbackUrl = <site>/api/payments/iyzico/callback?o=<order number>, and redirect the
//   buyer to paymentPageUrl.
//
// Callback: after the hosted page iyzico makes the buyer's browser POST (form) `token` to callbackUrl.
//   Nothing in that POST is trusted: we retrieve the result server-to-server.
//
// Checkout Form retrieve  POST /payment/iyzipos/checkoutform/auth/ecom/detail  { locale, conversationId, token }
//   Answer: status, paymentStatus (SUCCESS | FAILURE | INIT_THREEDS | CALLBACK_THREEDS …), paymentId, price,
//   paidPrice, currency, basketId, conversationId, installment, fraudStatus (1 ok, 0 review, -1 rejected),
//   itemTransactions[{ paymentTransactionId, itemId, price, paidPrice, transactionStatus }], token, signature.
//   Signature params (in this order): paymentStatus, paymentId, currency, basketId, conversationId,
//   paidPrice, price, token.
//
// Response signature (all endpoints): hex( HMAC-SHA256( params.join(":"), secretKey ) ). Price params are
//   trimmed of trailing zeros first ("10.50" → "10.5", "10.0" → "10"). Documented vector (/payment/auth):
//   secret "sandbox-qaIiLIxhjMgx3LSKIVvp6j17NunHOFtD", "22416032:TRY:basketId:conversationId:10.5:10.5" →
//   836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173 (tests/unit/payments-iyzico.test.ts).
//
// Refunds (full refunds only; partial refunds are out of scope):
//   1. POST /payment/cancel { locale, conversationId, paymentId, ip } — whole payment, same day only (before
//      the bank's end-of-day), leaves no statement entry.
//   2. Otherwise POST /payment/refund { locale, conversationId, paymentTransactionId, price, currency, ip }
//      once per basket item (paymentTransactionId and paidPrice from the retrieve answer). iyzico advises
//      against /v2/payment/refund (paymentId based) for baskets with more than one item, so we don't use it.
//      Refund signature params: paymentId, price, currency, conversationId. Items already refunded are kept
//      in payments.raw.refund.items so a retry after a partial failure refunds only the rest.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
import "server-only";
import { absoluteUrl } from "@/i18n/paths";
import { safeErrorInfo } from "@/lib/db-errors";
import type { IyzicoEnv } from "./config";
import {
  buildCheckoutFormBody,
  iyzicoAuthorization,
  iyzicoRandomKey,
  IYZICO_PATHS,
  parseCheckoutInitialize,
  parseCheckoutRetrieve,
  refundSignatureParams,
  verifyIyzicoResponseSignature,
  type CheckoutRetrieveResult,
} from "./iyzico-crypto";
import { iyzicoPrice, parseDecimalAmount } from "./money";
import type { GatewayCallback, GatewayOrder, GatewayRefundInput, GatewayRefundResult, PaymentGateway } from "./types";

export type IyzicoGatewayConfig = IyzicoEnv & {
  testMode: boolean;
  installments: boolean;
  maxInstallments: number;
  /** Tests inject a fetch; default the global one. */
  fetch?: typeof fetch;
  /** Per-request timeout (ms, default 20 s). The expiry job passes less: its run must stay short (PayTR-fix R4). */
  timeoutMs?: number;
};

const TIMEOUT_MS = 20_000;
type Json = Record<string, unknown>;

export class IyzicoHttpError extends Error {
  constructor(readonly status: number) {
    super(`iyzico answered HTTP ${status} without JSON`);
    this.name = "IyzicoHttpError";
  }
}

/**
 * One signed POST; returns the JSON answer (iyzico answers business errors with status "failure").
 * Throws IyzicoHttpError for an answer without JSON and for any HTTP 5xx (a server error tells nothing
 * about the payment, even when it carries an error body).
 */
export async function iyzicoPost(config: IyzicoGatewayConfig, path: string, body: Json): Promise<Json> {
  const json = JSON.stringify(body);
  const randomKey = iyzicoRandomKey();
  const response = await (config.fetch ?? fetch)(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: iyzicoAuthorization({ apiKey: config.apiKey, secretKey: config.secretKey, randomKey, uriPath: path, body: json }),
      "x-iyzi-rnd": randomKey,
      "x-iyzi-client-version": "prestij-node-1.0",
    },
    body: json,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs !== undefined && config.timeoutMs > 0 ? Math.min(config.timeoutMs, TIMEOUT_MS) : TIMEOUT_MS),
  });
  const text = await response.text();
  if (response.status >= 500) throw new IyzicoHttpError(response.status);
  try {
    const data = JSON.parse(text) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Json;
  } catch {
    // fall through
  }
  throw new IyzicoHttpError(response.status);
}

/** The callback URL iyzico posts the token to (absolute, from NEXT_PUBLIC_SITE_URL). */
export function iyzicoCallbackUrl(orderNumber: string): string {
  return absoluteUrl(`/api/payments/iyzico/callback?o=${encodeURIComponent(orderNumber)}`);
}

/** The hosted page must be on https (or on the local mock when the base URL is local). */
function safePageUrl(config: IyzicoGatewayConfig, raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return url.toString();
    if (config.local && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return url.toString();
  } catch {
    // invalid
  }
  return null;
}

/** Retrieves and checks a Checkout Form result for `token` (see the header for the rules). */
export async function retrieveIyzicoCheckout(
  config: IyzicoGatewayConfig,
  input: { token: string; orderNumber: string; conversationId?: string | null },
): Promise<CheckoutRetrieveResult> {
  let data: Json;
  try {
    data = await iyzicoPost(config, IYZICO_PATHS.retrieve, { locale: "tr", conversationId: input.conversationId ?? input.orderNumber, token: input.token });
  } catch (error) {
    console.error("[payments] iyzico retrieve failed", safeErrorInfo(error));
    return { ok: false, reason: "unreachable" };
  }
  return parseCheckoutRetrieve(data, { secretKey: config.secretKey, token: input.token, orderNumber: input.orderNumber, testMode: config.testMode });
}

type ItemTx = { paymentTransactionId: string; paidPrice: number };

function itemTransactionsOf(raw: Json): ItemTx[] | null {
  const list = Array.isArray(raw.itemTransactions) ? raw.itemTransactions : [];
  const out: ItemTx[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const t = item as Json;
    const id = typeof t.paymentTransactionId === "string" || typeof t.paymentTransactionId === "number" ? String(t.paymentTransactionId) : "";
    const paid = parseDecimalAmount(t.paidPrice);
    if (!id || paid === null) return null;
    out.push({ paymentTransactionId: id, paidPrice: paid });
  }
  return out.length ? out : null;
}

const shortError = (r: Json) => {
  const code = typeof r.errorCode === "string" || typeof r.errorCode === "number" ? String(r.errorCode) : "";
  const message = typeof r.errorMessage === "string" ? r.errorMessage.replace(/\s+/g, " ").slice(0, 160) : "";
  return [code && `iyzico ${code}`, message].filter(Boolean).join(": ") || "iyzico isteği reddetti";
};

/** Full refund: cancel (same day) or one refund per basket item; resumable after a partial failure. */
async function refundIyzico(config: IyzicoGatewayConfig, input: GatewayRefundInput): Promise<GatewayRefundResult> {
  const raw = input.raw;
  const paymentId = typeof raw.paymentId === "string" ? raw.paymentId : input.providerRef;
  const ip = input.clientIp ?? "127.0.0.1";
  const conversationId = `refund-${input.orderId}`;
  const progress = (raw.refund && typeof raw.refund === "object" ? (raw.refund as Json) : {}) as Json;
  const done = new Set(Array.isArray(progress.items) ? progress.items.filter((x): x is string => typeof x === "string") : []);
  const items = itemTransactionsOf(raw);

  try {
    if (done.size === 0) {
      const cancel = await iyzicoPost(config, IYZICO_PATHS.cancel, { locale: "tr", conversationId, paymentId, ip });
      if (cancel.status === "success") return { ok: true, ref: `cancel:${paymentId}`, raw: { method: "cancel" } };
    }
    if (!items) return { ok: false, error: "Ödeme kaydında iyzico işlem numaraları yok; iadeyi iyzico panelinden yapın." };
    const total = items.reduce((s, i) => s + i.paidPrice, 0);
    if (total < input.amount) return { ok: false, error: "iyzico işlem tutarları sipariş tutarını karşılamıyor; iadeyi iyzico panelinden yapın." };
    for (const item of items) {
      if (done.has(item.paymentTransactionId)) continue;
      const r = await iyzicoPost(config, IYZICO_PATHS.refund, {
        locale: "tr",
        conversationId,
        paymentTransactionId: item.paymentTransactionId,
        price: iyzicoPrice(item.paidPrice),
        currency: "TRY",
        ip,
      });
      if (r.status !== "success") return { ok: false, error: shortError(r), raw: { method: "refund", items: [...done] } };
      if (typeof r.signature === "string" && !verifyIyzicoResponseSignature(config.secretKey, refundSignatureParams(r), r.signature)) {
        return { ok: false, error: "iyzico yanıtının imzası doğrulanamadı.", raw: { method: "refund", items: [...done] } };
      }
      done.add(item.paymentTransactionId);
    }
    return { ok: true, ref: `refund:${[...done].join(",")}`.slice(0, 200), raw: { method: "refund", items: [...done] } };
  } catch (error) {
    console.error(`[payments] iyzico refund failed order=${input.orderId}`, safeErrorInfo(error));
    return { ok: false, error: "iyzico'ya ulaşılamadı. Bir süre sonra tekrar deneyin.", raw: { method: "refund", items: [...done] } };
  }
}

/** The iyzico gateway for one configuration (keys + endpoint + the panel's installment settings). */
export function createIyzicoGateway(config: IyzicoGatewayConfig): PaymentGateway {
  return {
    provider: "iyzico",
    isReady: () => true,
    async initiate(order: GatewayOrder) {
      const attempt = order.details?.attempt ?? 1;
      const conversationId = `${order.orderNumber}-${attempt}`;
      const body = buildCheckoutFormBody(order, {
        conversationId,
        callbackUrl: iyzicoCallbackUrl(order.orderNumber),
        installments: config.installments,
        maxInstallments: config.maxInstallments,
      });
      const data = await iyzicoPost(config, IYZICO_PATHS.initialize, body);
      const parsed = parseCheckoutInitialize(data, config.secretKey);
      if (!parsed.ok) throw new Error(`iyzico initialize refused: ${parsed.reason}${parsed.errorCode ? ` ${parsed.errorCode}` : ""}`);
      const redirectUrl = safePageUrl(config, parsed.paymentPageUrl);
      if (!redirectUrl) throw new Error("iyzico paymentPageUrl is not https");
      return { redirectUrl, attempt: { ref: parsed.token, testMode: config.testMode, raw: { conversationId } } };
    },
    async handleCallback(payload: unknown): Promise<GatewayCallback | null> {
      const p = (payload ?? {}) as { token?: unknown; order?: { id?: unknown; orderNumber?: unknown }; conversationId?: unknown };
      if (typeof p.token !== "string" || typeof p.order?.id !== "number" || typeof p.order.orderNumber !== "string") return null;
      const r = await retrieveIyzicoCheckout(config, {
        token: p.token,
        orderNumber: p.order.orderNumber,
        conversationId: typeof p.conversationId === "string" ? p.conversationId : null,
      });
      return r.ok ? { orderId: p.order.id, providerRef: r.providerRef, success: r.success, amount: r.amount, raw: r.raw } : null;
    },
    refund: (input) => refundIyzico(config, input),
  };
}
