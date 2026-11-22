// PayTR iFrame API gateway.
//
// ── What PayTR documents (read 2026-11-10) ───────────────────────────────────────────────────────────
// Sources:
//   iFrame API step 1 (get-token):    https://dev.paytr.com/en/iframe-api/iframe-api-1-adim
//   iFrame API step 2 (notification): https://dev.paytr.com/en/iframe-api/iframe-api-2-adim
//   Refund (iade) API:                https://dev.paytr.com/en/iade-api
//   Status inquiry (Durum Sorgu):     https://dev.paytr.com/durum-sorgu (read 2026-11-21), error codes: https://dev.paytr.com/hata-kodlari
//
// Host: https://www.paytr.com (PAYTR_BASE_URL overrides). Test mode is the request flag test_mode=1 on the
// same host (the panel's "Test modu").
//
// Step 1 — POST (form) /odeme/api/get-token, server-side:
//   merchant_id, user_ip (≤ 39), merchant_oid (unique per payment, alphanumeric only, ≤ 64), email (≤ 100),
//   payment_amount (amount × 100 as an integer: 34.56 → 3456), paytr_token, user_basket (base64 of the JSON
//   array [[name, unit price "18.00", quantity], …]), debug_on (0|1), no_installment (0|1), max_installment
//   (0 or 2–12), user_name (≤ 60), user_address (≤ 400), user_phone (≤ 20), merchant_ok_url,
//   merchant_fail_url (≤ 400 each; they only send the buyer back, they confirm nothing), timeout_limit
//   (minutes, default 30), currency (TL), test_mode (0|1), lang (tr|en).
//   hash_str   = merchant_id + user_ip + merchant_oid + email + payment_amount + user_basket + no_installment
//                + max_installment + currency + test_mode
//   paytr_token = base64( HMAC-SHA256( hash_str + merchant_salt, merchant_key ) )          (raw digest → base64)
//   Answer (JSON): { status: "success", token } | { status: "failed", reason }.
//   The iframe is https://www.paytr.com/odeme/guvenli/<token> with PayTR's iframeResizer
//   (https://www.paytr.com/js/iframeResizer.min.js, iFrameResize({}, '#paytriframe')).
//
// Step 2 — PayTR POSTs (form, server-to-server, no session) to the "Bildirim URL" set in the PayTR
//   merchant panel: merchant_oid, status (success|failed), total_amount (× 100; may exceed payment_amount
//   because of installment interest), hash, failed_reason_code, failed_reason_msg, test_mode, payment_type
//   (card|eft), currency, payment_amount.
//   hash = base64( HMAC-SHA256( merchant_oid + merchant_salt + status + total_amount, merchant_key ) )
//   Answer the plain text "OK" (nothing before or after it). Without "OK" PayTR shows the payment as "Devam
//   Ediyor" and repeats the notification, so the same merchant_oid can arrive several times: only the first
//   one changes the order, later ones just get "OK".
//
// Refund — POST (form) /odeme/iade: merchant_id, merchant_oid, return_amount ("11.97", dot decimal),
//   paytr_token, reference_no (optional, ≤ 64 alphanumeric, not in the token).
//   paytr_token = base64( HMAC-SHA256( merchant_id + merchant_oid + return_amount + merchant_salt, merchant_key ) )
//   Answer (JSON): { status: "success", is_test, merchant_oid, return_amount } | { status: "error", err_no, err_msg }.
//   Errors (dev.paytr.com/hata-kodlari, read 2026-11-21): 009 "Toplam iade tutari odeme tutarindan fazla olamaz" (the
//   iade page's own example shows 006 for it), 010 "Net bakiyeniz yetersiz", 007 notification not completed yet.
//   The PHP sample waits 90 s (CURLOPT_TIMEOUT / CURLOPT_CONNECTTIMEOUT 90), so we do too (PAYTR_REFUND_TIMEOUT_MS;
//   the panel order page, whose Server Action runs the refund, sets maxDuration above it).
//
// Status inquiry — POST (form) /odeme/durum-sorgu: merchant_id, merchant_oid, paytr_token (merchant_key and
//   merchant_salt are listed but only used for the token; the samples never send them).
//   paytr_token = base64( HMAC-SHA256( merchant_id + merchant_oid + merchant_salt, merchant_key ) )
//   Answer (JSON): { status: "success", payment_amount, payment_total, payment_date, currency, taksit, kart_marka,
//   masked_pan, auth_code, auth_date, odeme_tipi (KART|EFT), test_mode (0|1), net_tutar, kesinti_tutari, returns[] }
//   | { status: "error", err_no, err_msg }. The amounts are DECIMAL strings in currency units, not × 100 (the docs'
//   examples: payment_amount "10,8", net_tutar "9.76"; both a comma and a dot occur). Errors: 001 invalid request /
//   store not active, 002 invalid merchant_oid, 003 paytr_token missing or invalid, 004 "merchant_oid ile islem
//   bulunamadi" / "merchant_oid ile basarili odeme bulunamadi". No rate limit or IP rule is documented; the PHP
//   sample waits up to 90 s, we wait at most STATUS_TIMEOUT_MS (an unanswered inquiry only means "unknown").
//   Used by reconcile.ts: before the expiry job cancels a PayTR order, before a retry, and while the order pages
//   say "Ödemeniz doğrulanıyor" (a notification can be lost: PayTR documents no retry count, and stuck ones wait
//   for "Duran Bildirimleri Yeniden Başlat" in the merchant panel).
//
// Our choices: user_ip = paytrUserIp(client IP): IPv4 as is, IPv6 compressed (≤ 39), IPv4-mapped IPv6 as plain IPv4,
// never cut (paytr-crypto.ts). The get-token token is accepted in any form that fits into the iframe path
// (isUsablePaytrToken). merchant_oid = order number without "-" + "A" + attempt + 6 random characters (paytr-crypto.ts),
// kept in payments.raw.attempts[] with the iframe URL; providerRef = merchant_oid. The amount compared with
// orders.grandTotal is the payment_amount we requested when total_amount covers it (paytrChargedAmount).
// merchant_ok_url / merchant_fail_url point to /odeme/kart with a short-lived signed token (not the order's
// access token), where the page waits for the notification.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
import "server-only";
import { href, absoluteUrl } from "@/i18n/paths";
import { safeErrorInfo } from "@/lib/db-errors";
import { signToken } from "@/lib/signed-token";
import { clip } from "./basket";
import type { PaytrEnv } from "./config";
import { decimal2, paytrAmount } from "./money";
import {
  encodePaytrBasket,
  isUsablePaytrToken,
  paytrIframeToken,
  paytrInstallments,
  paytrMerchantOid,
  parsePaytrNotification,
  paytrChargedAmount,
  paytrRefundErrorMessage,
  paytrRefundToken,
  paytrStatusToken,
  paytrUserIp,
  parsePaytrStatusResponse,
  PAYTR_PATHS,
  PAYTR_TIMEOUT_MINUTES,
  type PaytrStatusResult,
} from "./paytr-crypto";
import { GatewayRefusedError } from "./refusal";
import type { GatewayCallback, GatewayOrder, GatewayRefundInput, GatewayRefundResult, PaymentGateway } from "./types";

export type PaytrGatewayConfig = PaytrEnv & {
  testMode: boolean;
  installments: boolean;
  maxInstallments: number;
  fetch?: typeof fetch;
};

const TIMEOUT_MS = 20_000;
/** Durum Sorgu answers fast; a slow one is "unknown", and the caller tries again later. */
export const STATUS_TIMEOUT_MS = 5_000;
/**
 * /odeme/iade only: PayTR's PHP sample waits 90 s. A slow refund that succeeds at PayTR must not be recorded as
 * failed (a retry would then get 009). Keep below the panel order page's maxDuration and refund.ts' PENDING_LOCK_MS.
 */
export const PAYTR_REFUND_TIMEOUT_MS = 90_000;
/** Purpose of the signed token in merchant_ok_url / merchant_fail_url (payload { o: orderId }). */
export const CARD_RETURN_PURPOSE = "card-return";
/** The return link stays valid a while after the payment form closes. */
const RETURN_TTL_SECONDS = (PAYTR_TIMEOUT_MINUTES + 90) * 60;

type Json = Record<string, unknown>;

async function paytrPost(config: Pick<PaytrGatewayConfig, "baseUrl" | "fetch">, path: string, fields: Record<string, string>, timeoutMs = TIMEOUT_MS): Promise<Json> {
  const response = await (config.fetch ?? fetch)(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  try {
    const data = JSON.parse(text) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Json;
  } catch {
    // fall through
  }
  throw new Error(`PayTR answered HTTP ${response.status} without JSON`);
}

/** /odeme/kart?r=<signed>&sonuc=ok|hata in the order's language (absolute). */
export function cardReturnUrl(order: Pick<GatewayOrder, "id" | "locale">, outcome: "ok" | "hata"): string {
  const r = signToken(CARD_RETURN_PURPOSE, { o: order.id }, RETURN_TTL_SECONDS);
  return absoluteUrl(`${href(order.locale, "cardPayment")}?${new URLSearchParams({ r, sonuc: outcome }).toString()}`);
}

/** The iframe URL for a get-token answer. */
export const paytrIframeUrl = (config: Pick<PaytrGatewayConfig, "baseUrl">, token: string) => `${config.baseUrl}${PAYTR_PATHS.iframe}${encodeURIComponent(token)}`;

async function refundPaytr(config: PaytrGatewayConfig, input: GatewayRefundInput): Promise<GatewayRefundResult> {
  const merchantOid = typeof input.raw.merchantOid === "string" ? input.raw.merchantOid : input.providerRef;
  const returnAmount = decimal2(input.amount);
  const referenceNo = `RF${input.orderId}T${Date.now().toString(36).toUpperCase()}`.slice(0, 64);
  try {
    const r = await paytrPost(
      config,
      PAYTR_PATHS.refund,
      {
        merchant_id: config.merchantId,
        merchant_oid: merchantOid,
        return_amount: returnAmount,
        paytr_token: paytrRefundToken(config, { merchantOid, returnAmount }),
        reference_no: referenceNo,
      },
      PAYTR_REFUND_TIMEOUT_MS,
    );
    if (r.status === "success") return { ok: true, ref: referenceNo, raw: { method: "iade", returnAmount, isTest: r.is_test === 1 || r.is_test === "1" } };
    const message = paytrRefundErrorMessage(r.err_no, r.err_msg);
    return { ok: false, error: message || (r.status === "failed" ? "PayTR bu işlemi bulamadı." : "PayTR iadeyi reddetti.") };
  } catch (error) {
    console.error(`[payments] paytr refund failed order=${input.orderId}`, safeErrorInfo(error));
    // No answer within 90 s: PayTR may still have refunded (a retry would then get 009).
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { ok: false, error: "PayTR 90 saniye içinde yanıt vermedi; iade yine de yapılmış olabilir. Tekrar denemeden önce PayTR panelinden kontrol edin." };
    }
    return { ok: false, error: "PayTR'ye ulaşılamadı. Bir süre sonra tekrar deneyin." };
  }
}

/**
 * Durum Sorgu for one merchant_oid (see the header): paid / not_paid / unknown. Never throws: a timeout, a
 * network error or an answer without JSON is { kind: "unknown", reason: "unreachable" }.
 */
export async function queryPaytrStatus(
  config: PaytrEnv & { fetch?: typeof fetch },
  merchantOid: string,
  options: { timeoutMs?: number } = {},
): Promise<PaytrStatusResult> {
  try {
    const data = await paytrPost(
      config,
      PAYTR_PATHS.status,
      { merchant_id: config.merchantId, merchant_oid: merchantOid, paytr_token: paytrStatusToken(config, { merchantOid }) },
      Math.max(500, Math.min(options.timeoutMs ?? STATUS_TIMEOUT_MS, STATUS_TIMEOUT_MS)),
    );
    return parsePaytrStatusResponse(merchantOid, data);
  } catch (error) {
    console.warn(`[payments] paytr status inquiry failed oid=${merchantOid.slice(0, 64)}`, safeErrorInfo(error));
    return { kind: "unknown", merchantOid, reason: "unreachable" };
  }
}

/** The PayTR gateway for one configuration. */
export function createPaytrGateway(config: PaytrGatewayConfig): PaymentGateway {
  return {
    provider: "paytr",
    isReady: () => true,
    async initiate(order: GatewayOrder) {
      const d = order.details;
      if (!d) throw new Error("PayTR needs the order details (buyer, addresses, basket)");
      const merchantOid = paytrMerchantOid(order.orderNumber, d.attempt);
      const userBasket = encodePaytrBasket(d.lines);
      const { noInstallment, maxInstallment } = paytrInstallments(config.installments, config.maxInstallments);
      const testMode = config.testMode ? "1" : "0";
      const fields = {
        userIp: paytrUserIp(d.clientIp),
        merchantOid,
        email: clip(d.buyer.email, 100),
        paymentAmount: paytrAmount(order.amount),
        userBasket,
        noInstallment,
        maxInstallment,
        currency: "TL",
        testMode,
      } as const;
      const data = await paytrPost(config, PAYTR_PATHS.getToken, {
        merchant_id: config.merchantId,
        user_ip: fields.userIp,
        merchant_oid: merchantOid,
        email: fields.email,
        payment_amount: fields.paymentAmount,
        paytr_token: paytrIframeToken(config, fields),
        user_basket: userBasket,
        debug_on: config.testMode ? "1" : "0",
        no_installment: noInstallment,
        max_installment: maxInstallment,
        user_name: clip(d.buyer.fullName, 60),
        user_address: clip(d.billingAddress.line, 400),
        user_phone: clip(d.buyer.phone, 20),
        merchant_ok_url: cardReturnUrl(order, "ok"),
        merchant_fail_url: cardReturnUrl(order, "hata"),
        timeout_limit: String(PAYTR_TIMEOUT_MINUTES),
        currency: "TL",
        test_mode: testMode,
        lang: order.locale === "tr" ? "tr" : "en",
      });
      if (data.status !== "success") {
        // `reason` is PayTR's text about our request (no card data). Go-live CF-12: carried as the refusal
        // reason (masked, at most 200 characters), which initiateCardPayment logs and keeps in payments.raw.lastError.
        throw new GatewayRefusedError("paytr", typeof data.reason === "string" && data.reason.trim() ? data.reason : `status ${String(data.status)}`);
      }
      if (!isUsablePaytrToken(data.token)) {
        // PayTR-fix C13c: "success" without a token we can put into the iframe path. Never the token itself in the log.
        const token: unknown = data.token;
        console.error(`[payments] paytr get-token: unexpected token format order=${order.id}`, {
          type: typeof token,
          length: typeof token === "string" ? token.length : null,
        });
        throw new GatewayRefusedError("paytr", "PayTR ödeme formu anahtarını (token) beklenmeyen biçimde döndürdü; ödeme formu açılmadı.");
      }
      const iframeUrl = paytrIframeUrl(config, data.token);
      return { iframeUrl, attempt: { ref: merchantOid, testMode: config.testMode, raw: { iframeUrl, paymentAmount: order.amount } } };
    },
    async handleCallback(payload: unknown): Promise<GatewayCallback | null> {
      const p = (payload ?? {}) as { fields?: Record<string, string | undefined>; order?: { id?: unknown; orderNumber?: unknown }; requestedAmount?: unknown };
      if (!p.fields || typeof p.order?.id !== "number" || typeof p.order.orderNumber !== "string") return null;
      const parsed = parsePaytrNotification(p.fields, config);
      if (!parsed.ok || parsed.notification.orderNumber !== p.order.orderNumber) return null;
      const n = parsed.notification;
      const requested = typeof p.requestedAmount === "number" ? p.requestedAmount : null;
      return {
        orderId: p.order.id,
        providerRef: n.merchantOid,
        success: n.success,
        amount: n.success ? paytrChargedAmount(n.totalAmount, requested) : (requested ?? n.totalAmount),
        raw: { ...n.raw, testMode: config.testMode, requestedAmount: requested },
      };
    },
    refund: (input) => refundPaytr(config, input),
  };
}
