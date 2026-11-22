// iyzico request signing, response signature checks and the Checkout Form bodies (pure: node:crypto
// only, no secrets read here). The algorithms and their sources are documented at the top of
// ./iyzico-gateway.ts; scripts/payment-mock.mjs re-implements the same rules independently.
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { clip, splitName } from "./basket";
import { iyzicoPrice, parseDecimalAmount, trimTrailingZeros } from "./money";
import type { GatewayOrder } from "./types";

export const IYZICO_PATHS = {
  initialize: "/payment/iyzipos/checkoutform/initialize/auth/ecom",
  retrieve: "/payment/iyzipos/checkoutform/auth/ecom/detail",
  cancel: "/payment/cancel",
  refund: "/payment/refund",
} as const;

export const IYZICO_SANDBOX_URL = "https://sandbox-api.iyzipay.com";
export const IYZICO_LIVE_URL = "https://api.iyzipay.com";

/** Placeholder TCKN iyzico accepts when the buyer gave none (also used by e-Arşiv). */
export const PLACEHOLDER_IDENTITY_NUMBER = "11111111111";

/** x-iyzi-rnd / randomKey: epoch milliseconds + 9 random digits (like iyzico's Postman sample). */
export function iyzicoRandomKey(): string {
  return `${Date.now()}${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
}

/** HMAC-SHA256(randomKey + uriPath + body, secretKey) as lower-case hex. */
export function iyzicoSignature(secretKey: string, randomKey: string, uriPath: string, body: string): string {
  return createHmac("sha256", secretKey).update(randomKey + uriPath + body).digest("hex");
}

/** "IYZWSv2 " + base64("apiKey:<apiKey>&randomKey:<randomKey>&signature:<hex>"). */
export function iyzicoAuthorization(input: { apiKey: string; secretKey: string; randomKey: string; uriPath: string; body: string }): string {
  const signature = iyzicoSignature(input.secretKey, input.randomKey, input.uriPath, input.body);
  const params = `apiKey:${input.apiKey}&randomKey:${input.randomKey}&signature:${signature}`;
  return `IYZWSv2 ${Buffer.from(params, "utf8").toString("base64")}`;
}

/** Reads an IYZWSv2 header back into its parts (the mock server and tests); null when malformed. */
export function parseIyzicoAuthorization(header: string | null | undefined): { apiKey: string; randomKey: string; signature: string } | null {
  const match = /^IYZWSv2 ([A-Za-z0-9+/=]+)$/.exec(header ?? "");
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const parts = /^apiKey:([^&]+)&randomKey:([^&]+)&signature:([0-9a-f]{64})$/.exec(decoded);
  return parts ? { apiKey: parts[1], randomKey: parts[2], signature: parts[3] } : null;
}

const hexEqual = (a: string, b: string) => {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a.toLowerCase(), "utf8"), Buffer.from(b.toLowerCase(), "utf8"));
};

/** Response signature: HMAC-SHA256(params.join(":"), secretKey) hex; null/undefined become "" (Array.join). */
export function iyzicoResponseSignature(secretKey: string, params: readonly unknown[]): string {
  const data = params.map((p) => (p === null || p === undefined ? "" : String(p))).join(":");
  return createHmac("sha256", secretKey).update(data).digest("hex");
}

/** Timing-safe check of a response `signature` against the given params (in iyzico's documented order). */
export function verifyIyzicoResponseSignature(secretKey: string, params: readonly unknown[], signature: unknown): boolean {
  return typeof signature === "string" && hexEqual(iyzicoResponseSignature(secretKey, params), signature);
}

type Json = Record<string, unknown>;
const price = (v: unknown) => (typeof v === "number" || typeof v === "string" ? trimTrailingZeros(v) : v);

/** Checkout Form initialize response: conversationId, token. */
export const cfInitializeSignatureParams = (r: Json): unknown[] => [r.conversationId, r.token];
/** Checkout Form retrieve: paymentStatus, paymentId, currency, basketId, conversationId, paidPrice, price, token. */
export const cfRetrieveSignatureParams = (r: Json): unknown[] => [r.paymentStatus, r.paymentId, r.currency, r.basketId, r.conversationId, price(r.paidPrice), price(r.price), r.token];
/** Refund (/payment/refund, /v2/payment/refund): paymentId, price, currency, conversationId. */
export const refundSignatureParams = (r: Json): unknown[] => [r.paymentId, price(r.price), r.currency, r.conversationId];

/** enabledInstallments: [1] for single payment, else 1..max (iyzico shows only what the card supports). */
export function enabledInstallments(installments: boolean, maxInstallments: number): number[] {
  const max = installments ? Math.min(12, Math.max(1, Math.floor(maxInstallments))) : 1;
  return Array.from({ length: max }, (_, i) => i + 1);
}

const IYZICO_DATE = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/**
 * The Checkout Form initialize request body. `price` = `paidPrice` = the order total; basket items are
 * the order lines (each price = line total) and add up to it exactly; basketId = order number.
 */
export function buildCheckoutFormBody(
  order: GatewayOrder,
  options: { conversationId: string; callbackUrl: string; installments: boolean; maxInstallments: number },
): Json {
  const d = order.details;
  if (!d) throw new Error("iyzico needs the order details (buyer, addresses, basket)");
  const { name, surname } = splitName(d.buyer.fullName);
  const total = d.lines.reduce((s, l) => s + l.total, 0);
  if (total !== order.amount) throw new Error("Basket lines do not add up to the order amount");
  const country = (c: string) => (c === "TR" ? "Turkey" : c);
  const address = (a: typeof d.shippingAddress) => ({
    contactName: clip(a.contactName, 100),
    city: a.city,
    country: country(a.country),
    address: a.line,
    ...(a.zipCode ? { zipCode: a.zipCode } : {}),
  });
  return {
    locale: order.locale === "tr" ? "tr" : "en",
    conversationId: options.conversationId,
    price: iyzicoPrice(order.amount),
    paidPrice: iyzicoPrice(order.amount),
    currency: "TRY",
    basketId: order.orderNumber,
    paymentGroup: "PRODUCT",
    callbackUrl: options.callbackUrl,
    enabledInstallments: enabledInstallments(options.installments, options.maxInstallments),
    buyer: {
      id: clip(d.buyer.id, 60),
      name: clip(name, 60),
      surname: clip(surname, 60),
      gsmNumber: d.buyer.phone,
      email: d.buyer.email,
      identityNumber: d.buyer.identityNumber ?? PLACEHOLDER_IDENTITY_NUMBER,
      ...(d.buyer.registeredAt ? { registrationDate: IYZICO_DATE(d.buyer.registeredAt) } : {}),
      registrationAddress: d.billingAddress.line,
      ip: d.clientIp ?? "127.0.0.1",
      city: d.billingAddress.city,
      country: country(d.billingAddress.country),
      ...(d.billingAddress.zipCode ? { zipCode: d.billingAddress.zipCode } : {}),
    },
    shippingAddress: address(d.shippingAddress),
    billingAddress: address(d.billingAddress),
    basketItems: d.lines.map((l) => ({
      id: l.id,
      name: clip(l.quantity > 1 ? `${l.name} × ${l.quantity}` : l.name, 120),
      category1: l.kind === "item" ? "Kozmetik" : l.kind === "shipping" ? "Kargo" : "Hizmet",
      itemType: l.kind === "item" ? "PHYSICAL" : "VIRTUAL",
      price: iyzicoPrice(l.total),
    })),
  };
}

export type CheckoutInitializeResult = { ok: true; token: string; paymentPageUrl: string } | { ok: false; reason: "failure" | "bad_signature" | "malformed"; errorCode?: string };

/** Validates the initialize answer: status success, a token, a page URL and a valid signature. */
export function parseCheckoutInitialize(data: Json, secretKey: string): CheckoutInitializeResult {
  if (data.status !== "success") return { ok: false, reason: "failure", errorCode: typeof data.errorCode === "string" ? data.errorCode : undefined };
  if (typeof data.token !== "string" || !data.token || typeof data.paymentPageUrl !== "string") return { ok: false, reason: "malformed" };
  if (!verifyIyzicoResponseSignature(secretKey, cfInitializeSignatureParams(data), data.signature)) return { ok: false, reason: "bad_signature" };
  return { ok: true, token: data.token, paymentPageUrl: data.paymentPageUrl };
}

export type CheckoutRetrieveResult =
  | {
      ok: true;
      success: boolean;
      /** paymentId on success; "FAIL-<token>" for a failed attempt (one per token, replays idempotent). */
      providerRef: string;
      /** Charged amount compared with grandTotal: `price` (paidPrice when it is lower). */
      amount: number;
      raw: Json;
    }
  | {
      ok: false;
      /**
       * unreachable: no usable answer (timeout, network error, HTTP 5xx): the result is unknown, the
       * payment may have gone through. retrieve_failed: iyzico answered an error without a payment status.
       */
      reason: "bad_signature" | "order_mismatch" | "token_mismatch" | "pending" | "retrieve_failed" | "unreachable" | "malformed";
      errorCode?: string;
    };

const ITEM_FIELDS = ["paymentTransactionId", "itemId", "price", "paidPrice", "transactionStatus"] as const;

/**
 * Checks a Checkout Form retrieve answer for `token` of order `orderNumber`.
 * - SUCCESS needs status success, a valid signature, basketId = orderNumber, the same token, fraudStatus
 *   not -1, and parseable amounts.
 * - FAILURE (or fraudStatus -1) is a failed attempt; its signature is checked when present.
 * - Anything else (3-D Secure not finished, an API error without paymentStatus) changes nothing.
 */
export function parseCheckoutRetrieve(data: Json, input: { secretKey: string; token: string; orderNumber: string; testMode: boolean }): CheckoutRetrieveResult {
  const hasSignature = typeof data.signature === "string" && data.signature !== "";
  if (hasSignature && !verifyIyzicoResponseSignature(input.secretKey, cfRetrieveSignatureParams(data), data.signature)) return { ok: false, reason: "bad_signature" };
  const errorCode = typeof data.errorCode === "string" ? data.errorCode : undefined;
  if (data.token !== undefined && data.token !== input.token) return { ok: false, reason: "token_mismatch" };
  if (data.basketId !== undefined && data.basketId !== input.orderNumber) return { ok: false, reason: "order_mismatch" };

  const fraudRejected = data.fraudStatus === -1 || data.fraudStatus === "-1";
  const succeeded = data.status === "success" && data.paymentStatus === "SUCCESS" && !fraudRejected;
  const failed = data.paymentStatus === "FAILURE" || (data.paymentStatus === "SUCCESS" && fraudRejected);
  if (!succeeded && !failed) return { ok: false, reason: data.status === "success" ? "pending" : "retrieve_failed", errorCode };

  const priceKurus = parseDecimalAmount(data.price);
  const paidKurus = parseDecimalAmount(data.paidPrice);
  const items = Array.isArray(data.itemTransactions)
    ? data.itemTransactions
        .filter((t): t is Json => !!t && typeof t === "object")
        .slice(0, 100)
        .map((t) => Object.fromEntries(ITEM_FIELDS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]])))
    : [];
  const raw: Json = {
    provider: "iyzico",
    testMode: input.testMode,
    token: input.token,
    paymentStatus: data.paymentStatus ?? null,
    paymentId: typeof data.paymentId === "string" || typeof data.paymentId === "number" ? String(data.paymentId) : null,
    conversationId: data.conversationId ?? null,
    price: data.price ?? null,
    paidPrice: data.paidPrice ?? null,
    currency: data.currency ?? null,
    installment: data.installment ?? null,
    fraudStatus: data.fraudStatus ?? null,
    cardAssociation: data.cardAssociation ?? null,
    cardFamily: data.cardFamily ?? null,
    lastFourDigits: data.lastFourDigits ?? null,
    itemTransactions: items,
    ...(errorCode ? { errorCode } : {}),
    ...(typeof data.errorMessage === "string" ? { errorMessage: clip(data.errorMessage, 200) } : {}),
    signed: hasSignature,
  };

  if (succeeded) {
    if (!hasSignature) return { ok: false, reason: "bad_signature" };
    if (data.basketId !== input.orderNumber || data.token !== input.token) return { ok: false, reason: "order_mismatch" };
    if (typeof raw.paymentId !== "string" || !raw.paymentId || priceKurus === null || paidKurus === null) return { ok: false, reason: "malformed" };
    // Another currency can never match a TRY grandTotal: report 0 so it is recorded as an amount mismatch.
    if (data.currency !== undefined && data.currency !== "TRY") return { ok: true, success: true, providerRef: raw.paymentId, amount: 0, raw };
    return { ok: true, success: true, providerRef: raw.paymentId, amount: paidKurus < priceKurus ? paidKurus : priceKurus, raw };
  }
  return { ok: true, success: false, providerRef: `FAIL-${input.token}`.slice(0, 200), amount: priceKurus ?? 0, raw };
}
