// PayTR tokens and hashes, merchant_oid, the notification check and the Durum Sorgu answer (pure:
// node:crypto only, no secrets read here). The algorithms and their sources are documented at the top of
// ./paytr-gateway.ts; scripts/payment-mock.mjs re-implements the same rules independently.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { localPaymentMockAllowedIn } from "@/lib/security/card-page-csp";
import { clip } from "./basket";
import { decimal2, parseKurusInteger, parsePaytrDecimal } from "./money";
import type { GatewayLine } from "./types";

export const PAYTR_DEFAULT_URL = "https://www.paytr.com";
export const PAYTR_PATHS = {
  getToken: "/odeme/api/get-token",
  iframe: "/odeme/guvenli/",
  refund: "/odeme/iade",
  status: "/odeme/durum-sorgu",
  resizer: "/js/iframeResizer.min.js",
} as const;
/** Minutes the PayTR payment form stays usable (timeout_limit; PayTR's default is 30). */
export const PAYTR_TIMEOUT_MINUTES = 30;

export type PaytrKeys = { merchantId: string; merchantKey: string; merchantSalt: string };

const hmacBase64 = (key: string, data: string) => createHmac("sha256", key).update(data, "utf8").digest("base64");

const base64Equal = (a: string, b: string) => {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The fields of the get-token hash, in PayTR's order. */
export type PaytrTokenFields = {
  userIp: string;
  merchantOid: string;
  email: string;
  /** Kuruş integer string ("3456"). */
  paymentAmount: string;
  /** base64(JSON) basket. */
  userBasket: string;
  noInstallment: "0" | "1";
  maxInstallment: string;
  currency: string;
  testMode: "0" | "1";
};

/**
 * get-token paytr_token: base64(HMAC-SHA256(merchant_id + user_ip + merchant_oid + email + payment_amount
 * + user_basket + no_installment + max_installment + currency + test_mode + merchant_salt, merchant_key)).
 */
export function paytrIframeToken(keys: PaytrKeys, f: PaytrTokenFields): string {
  const hashStr = keys.merchantId + f.userIp + f.merchantOid + f.email + f.paymentAmount + f.userBasket + f.noInstallment + f.maxInstallment + f.currency + f.testMode;
  return hmacBase64(keys.merchantKey, hashStr + keys.merchantSalt);
}

/** Notification hash: base64(HMAC-SHA256(merchant_oid + merchant_salt + status + total_amount, merchant_key)). */
export function paytrNotifyHash(keys: Pick<PaytrKeys, "merchantKey" | "merchantSalt">, f: { merchantOid: string; status: string; totalAmount: string }): string {
  return hmacBase64(keys.merchantKey, f.merchantOid + keys.merchantSalt + f.status + f.totalAmount);
}

/** Refund (iade) paytr_token: base64(HMAC-SHA256(merchant_id + merchant_oid + return_amount + merchant_salt, merchant_key)). */
export function paytrRefundToken(keys: PaytrKeys, f: { merchantOid: string; returnAmount: string }): string {
  return hmacBase64(keys.merchantKey, keys.merchantId + f.merchantOid + f.returnAmount + keys.merchantSalt);
}

/** Durum Sorgu paytr_token: base64(HMAC-SHA256(merchant_id + merchant_oid + merchant_salt, merchant_key)). */
export function paytrStatusToken(keys: PaytrKeys, f: { merchantOid: string }): string {
  return hmacBase64(keys.merchantKey, keys.merchantId + f.merchantOid + keys.merchantSalt);
}

/** user_basket: base64 of the JSON array [[name, unit price "18.00", quantity], …]. */
export function encodePaytrBasket(lines: readonly GatewayLine[]): string {
  const rows = lines.map((l) => {
    const exact = l.quantity > 0 && l.total % l.quantity === 0;
    return [clip(l.name, 100), decimal2(exact ? l.total / l.quantity : l.total), exact ? l.quantity : 1];
  });
  return Buffer.from(JSON.stringify(rows), "utf8").toString("base64");
}

/** no_installment / max_installment: single payment → "1" / "0"; otherwise "0" / "2"…"12". */
export function paytrInstallments(installments: boolean, maxInstallments: number): { noInstallment: "0" | "1"; maxInstallment: string } {
  const max = Math.min(12, Math.max(1, Math.floor(maxInstallments)));
  return installments && max >= 2 ? { noInstallment: "0", maxInstallment: String(max) } : { noInstallment: "1", maxInstallment: "0" };
}

const OID = /^PR(\d{6,12})A(\d{1,4})([A-Z0-9]{6})$/;

/**
 * merchant_oid (alphanumeric, ≤ 64): the order number without "-", "A", the attempt number and 6 random
 * characters, so every attempt is unique at PayTR even if order numbers ever repeat (e.g. a reseeded test
 * database): PR-261001, attempt 2 → "PR261001A2K7Q9ZB".
 */
export function paytrMerchantOid(orderNumber: string, attempt: number, random: string = randomOidSuffix()): string {
  const digits = /^PR-(\d{6,12})$/.exec(orderNumber)?.[1];
  if (!digits) throw new Error("Invalid order number for merchant_oid");
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 9999) throw new RangeError("Invalid attempt");
  if (!/^[A-Z0-9]{6}$/.test(random)) throw new Error("Invalid merchant_oid suffix");
  return `PR${digits}A${attempt}${random}`;
}

/** The order number and attempt of a merchant_oid we issued; null for anything else. */
export function parsePaytrMerchantOid(value: unknown): { orderNumber: string; attempt: number } | null {
  if (typeof value !== "string") return null;
  const m = OID.exec(value);
  return m ? { orderNumber: `PR-${m[1]}`, attempt: Number(m[2]) } : null;
}

function randomOidSuffix(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join("");
}

export type PaytrNotification = {
  merchantOid: string;
  orderNumber: string;
  success: boolean;
  /** total_amount (kuruş): what the buyer paid, incl. installment interest. */
  totalAmount: number;
  raw: Record<string, unknown>;
};

export type PaytrNotificationResult = { ok: true; notification: PaytrNotification } | { ok: false; reason: "missing_fields" | "bad_hash" | "unknown_oid" | "bad_amount" };

/**
 * Verifies a notification POST (fields as received): the hash first (timing-safe), then the shape. A
 * valid hash proves merchant_oid, status and total_amount; nothing else in the POST is signed.
 */
export function parsePaytrNotification(fields: Record<string, string | undefined>, keys: Pick<PaytrKeys, "merchantKey" | "merchantSalt">): PaytrNotificationResult {
  const merchantOid = fields.merchant_oid ?? "";
  const status = fields.status ?? "";
  const totalAmount = fields.total_amount ?? "";
  const hash = fields.hash ?? "";
  if (!merchantOid || !status || !totalAmount || !hash || merchantOid.length > 64 || hash.length > 200) return { ok: false, reason: "missing_fields" };
  if (!base64Equal(paytrNotifyHash(keys, { merchantOid, status, totalAmount }), hash)) return { ok: false, reason: "bad_hash" };
  const parsed = parsePaytrMerchantOid(merchantOid);
  if (!parsed) return { ok: false, reason: "unknown_oid" };
  const total = parseKurusInteger(totalAmount);
  if (total === null) return { ok: false, reason: "bad_amount" };
  const raw: Record<string, unknown> = {
    provider: "paytr",
    merchantOid,
    status,
    totalAmount: total,
    paymentAmount: parseKurusInteger(fields.payment_amount ?? "") ?? null,
    paymentType: clip(fields.payment_type, 20) || null,
    currency: clip(fields.currency, 8) || null,
    installmentCount: parseKurusInteger(fields.installment_count ?? "") ?? null,
    providerTestMode: fields.test_mode === "1",
    ...(status !== "success"
      ? { failedReasonCode: clip(fields.failed_reason_code, 20) || null, failedReasonMsg: clip(fields.failed_reason_msg, 200) || null }
      : {}),
  };
  return { ok: true, notification: { merchantOid, orderNumber: parsed.orderNumber, success: status === "success", totalAmount: total, raw } };
}

/**
 * The amount compared with grandTotal for a verified notification: the amount we asked for at get-token
 * (`requested`) when the buyer paid at least that much (total_amount may include installment interest),
 * otherwise what was actually paid, so a short payment is refused as a mismatch.
 */
export function paytrChargedAmount(totalAmount: number, requested: number | null): number {
  if (requested === null) return totalAmount;
  return totalAmount >= requested ? requested : totalAmount;
}

// ---------------------------------------------------------------------------------------------------
// Durum Sorgu (status inquiry) answers

/**
 * What a Durum Sorgu answer means for one merchant_oid:
 *   paid      status "success": PayTR holds a successful payment. Amounts are kuruş, read from PayTR's decimal
 *             strings (payment_amount / payment_total are currency units, not × 100); totalAmount = payment_total,
 *             what the buyer paid incl. installment interest (payment_amount when payment_total is missing).
 *   not_paid  err_no 004 ("merchant_oid ile islem bulunamadi" / "… basarili odeme bulunamadi"): no successful payment.
 *   unknown   anything else: 001–003 (store, merchant_oid or token problems), an unreadable amount, a currency
 *             other than TL, refunds already made at PayTR (a person decides), a malformed answer; the gateway
 *             adds "no answer" (timeout, network error, HTTP error without JSON) as unknown too.
 */
export type PaytrStatusResult =
  | {
      kind: "paid";
      merchantOid: string;
      totalAmount: number;
      paymentAmount: number | null;
      /** test_mode "1": a test transaction (PayTR store in test mode, or a test transaction in live mode). */
      testMode: boolean;
      /** payments.raw for the result, the same keys as a notification's (plus source: "durum-sorgu"). */
      raw: Record<string, unknown>;
    }
  | { kind: "not_paid"; merchantOid: string; errNo: string }
  | { kind: "unknown"; merchantOid: string; reason: string };

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** Maps a parsed Durum Sorgu JSON answer (see PaytrStatusResult). Never throws. */
export function parsePaytrStatusResponse(merchantOid: string, data: unknown): PaytrStatusResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { kind: "unknown", merchantOid, reason: "malformed" };
  const r = data as Record<string, unknown>;
  const status = text(r.status).toLowerCase();
  if (status === "success") {
    const paymentAmount = parsePaytrDecimal(r.payment_amount);
    const paymentTotal = parsePaytrDecimal(r.payment_total);
    const totalAmount = paymentTotal ?? paymentAmount;
    if (totalAmount === null || totalAmount <= 0) return { kind: "unknown", merchantOid, reason: "bad_amount" };
    const currency = text(r.currency).toUpperCase();
    if (currency && currency !== "TL" && currency !== "TRY") return { kind: "unknown", merchantOid, reason: "currency" };
    const returns = r.returns;
    if (Array.isArray(returns) ? returns.length > 0 : returns != null && text(returns) !== "" && text(returns) !== "[]") {
      return { kind: "unknown", merchantOid, reason: "has_returns" };
    }
    const testMode = text(r.test_mode) === "1";
    return {
      kind: "paid",
      merchantOid,
      totalAmount,
      paymentAmount,
      testMode,
      raw: {
        provider: "paytr",
        source: "durum-sorgu",
        merchantOid,
        status: "success",
        totalAmount,
        paymentAmount,
        paymentType: clip(text(r.odeme_tipi), 20) || null,
        currency: clip(currency, 8) || null,
        installmentCount: parseKurusInteger(text(r.taksit)) ?? null,
        providerTestMode: testMode,
      },
    };
  }
  if (status === "error" || status === "failed") {
    const errNo = clip(text(r.err_no), 8);
    if (errNo === "004") return { kind: "not_paid", merchantOid, errNo };
    return { kind: "unknown", merchantOid, reason: errNo ? `err_${errNo}` : "error" };
  }
  return { kind: "unknown", merchantOid, reason: "malformed" };
}

/**
 * PayTR-fix C5 rule, ONE helper for the notification and the Durum Sorgu paths: a PayTR result that says
 * test_mode=1 for an attempt we sent LIVE (attempt.testMode === false) on a public origin moved no money (PayTR
 * step 2: test_mode is 1 "Mağazanız test modunda iken veya canlı modda yapılan test işlemlerde"), so it must
 * never mark the order paid. Locally (outside production, or a production build on a local origin, where the
 * payment mock answers) nothing changes. `env` is for tests.
 */
export function paytrTestResultForLiveAttempt(
  attemptTestMode: boolean | null | undefined,
  providerTestMode: boolean,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return providerTestMode && attemptTestMode === false && !localPaymentMockAllowedIn(env);
}

/** payments.raw.refused and order_events "payment_refused" data.reason of a C5 refusal (test payment for a live attempt). */
export const TEST_PAYMENT_ON_LIVE = "test_payment_on_live";

// ---------------------------------------------------------------------------------------------------
// get-token: user_ip and the token (PayTR-fix C8, C13c)

/** user_ip when the buyer's address is unknown or unusable (unchanged from before: on Vercel it is always known). */
export const PAYTR_FALLBACK_USER_IP = "127.0.0.1";
/** PayTR's limit for user_ip: "En fazla 39 karakter (ipv4)", exactly the longest written-out IPv6 address. */
export const PAYTR_USER_IP_MAX = 39;

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * user_ip for get-token from the trusted client IP (clientIpFrom: x-vercel-forwarded-for on Vercel). Never cut in
 * the middle:
 *   - IPv4 as is;
 *   - IPv6 in its canonical compressed form (WHATWG URL serialisation: lower case, longest zero run as "::"), which is
 *     never longer than 39 characters; an IPv4-mapped address (::ffff:a.b.c.d, any spelling) becomes the plain IPv4;
 *   - anything else (empty, "unknown", a zone id such as fe80::1%eth0, garbage) and, defensively, a result longer than
 *     39 characters: PAYTR_FALLBACK_USER_IP, the value already sent when the address was unknown.
 * Pure; the same value goes into the request and the paytr_token.
 */
export function paytrUserIp(value: string | null | undefined): string {
  const ip = typeof value === "string" ? value.trim() : "";
  if (!ip || ip === "unknown") return PAYTR_FALLBACK_USER_IP;
  if (IPV4.test(ip)) return ip;
  if (!ip.includes(":") || /[^0-9A-Fa-f:.]/.test(ip)) return PAYTR_FALLBACK_USER_IP;
  let canonical: string;
  try {
    const host = new URL(`http://[${ip}]/`).hostname;
    canonical = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : "";
  } catch {
    return PAYTR_FALLBACK_USER_IP;
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return canonical && canonical.length <= PAYTR_USER_IP_MAX ? canonical : PAYTR_FALLBACK_USER_IP;
}

/** Longest get-token token accepted (PayTR documents no format; today's tokens are far shorter). */
export const PAYTR_TOKEN_MAX = 512;

/**
 * A get-token token we can put into the iframe path /odeme/guvenli/<token>: non-empty, at most PAYTR_TOKEN_MAX
 * characters, without "/", "?", "#", whitespace or control characters (anything else is URL-encoded by
 * paytrIframeUrl). The format is not documented, so nothing narrower is assumed.
 */
export function isUsablePaytrToken(token: unknown): token is string {
  return typeof token === "string" && token.length > 0 && token.length <= PAYTR_TOKEN_MAX && !/[\s/?#\u0000-\u001F\u007F]/.test(token);
}

// ---------------------------------------------------------------------------------------------------
// Refund (iade) answers (PayTR-fix C10)

/**
 * The panel's text for an iade error answer (dev.paytr.com/hata-kodlari, İade API): 009 "Toplam iade tutari odeme
 * tutarindan fazla olamaz" (also shown as 006 in the iade page's own example) usually means an earlier refund went
 * through, e.g. one whose answer timed out; 010 "Net bakiyeniz yetersiz". PayTR-fix R6: 007 "merchant_oid bulundu ancak
 * odeme henuz siteye bildirilmemis" (the notification of that payment never got our "OK", e.g. an order paid through
 * Durum Sorgu while the notify URL failed: PayTR's remedy is restarting the stuck notifications in Mağaza Bildirimleri)
 * and 000 "iade yapilamiyor, daha sonra tekrar deneyin" (a temporary lock). Other codes keep PayTR's own message.
 */
export function paytrRefundErrorMessage(errNo: unknown, errMsg: unknown): string {
  const raw = typeof errNo === "string" || typeof errNo === "number" ? clip(String(errNo), 8) : "";
  // The docs write three digits ("009"); a JSON number 9 means the same code.
  const code = /^\d{1,2}$/.test(raw) ? raw.padStart(3, "0") : raw;
  if (code === "006" || code === "009") return `Bu ödeme zaten iade edilmiş olabilir; PayTR panelinden kontrol edin. (PayTR ${code})`;
  if (code === "010") return `PayTR bakiyesi yetersiz; iadeyi daha sonra tekrar deneyin veya PayTR ile görüşün. (PayTR ${code})`;
  if (code === "007") {
    return `PayTR bu ödemenin bildirimini tamamlanmış saymıyor; PayTR Mağaza Paneli › Mağaza Bildirimleri sayfasında duran bildirimleri yeniden başlatın, sonra iadeyi tekrar deneyin. (PayTR ${code})`;
  }
  if (code === "000") return `PayTR iadeyi şu an yapamıyor; birkaç dakika sonra tekrar deneyin. (PayTR ${code})`;
  return [code ? `PayTR ${code}` : "", typeof errMsg === "string" ? clip(errMsg, 160) : ""].filter(Boolean).join(": ");
}
