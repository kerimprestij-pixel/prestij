// PayTR-fix IMPL-A1, pure parts (C3, C2 + X2, C4):
//   Durum Sorgu: the paytr_token against a value derived here from the documented PHP line, the answer mapping
//     (status success = paid with kuruş read from PayTR's DECIMAL strings, comma or dot; err 004 = not paid;
//     001-003, refunds, other currencies, bad amounts, garbage = unknown), the C5 test-mode rule shared with
//     the notification path.
//   The PayTR window (paytr-window.ts): 45 minutes from the latest attempt, settled vs unsettled attempts, the
//     reusable form, the 24 h to-do threshold.
//   The new UI strings exist in tr, en and ar with the same placeholders.
// The DB halves (reconcile, expiry, retry refusal): tests/db/paytr-fix-a1.test.ts.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import ar from "@/i18n/messages/ar";
import en from "@/i18n/messages/en";
import tr from "@/i18n/messages/tr";
import { withAttempt } from "@/lib/payments/attempts";
import { parsePaytrDecimal } from "@/lib/payments/money";
import { PAYTR_PATHS, PAYTR_TIMEOUT_MINUTES, parsePaytrStatusResponse, paytrStatusToken, paytrTestResultForLiveAttempt } from "@/lib/payments/paytr-crypto";
import {
  PAYTR_FORM_USABLE_MS,
  PAYTR_UNVERIFIED_ALERT_HOURS,
  PAYTR_VERIFY_WINDOW_MINUTES,
  paytrAttemptState,
  paytrUnverifiedAlertDue,
  paytrWindowPassed,
  type PaymentRowLike,
} from "@/lib/payments/paytr-window";

const KEYS = { merchantId: "123456", merchantKey: "YYYYYYYYYYYYYY", merchantSalt: "ZZZZZZZZZZZZZZ" };
const MIN = 60_000;

describe("Durum Sorgu request", () => {
  test("paytr_token = base64(HMAC-SHA256(merchant_id + merchant_oid + merchant_salt, merchant_key)), raw digest", () => {
    const oid = "PR261001A1ABCDEF";
    // PHP sample: base64_encode(hash_hmac('sha256', $merchant_id.$merchant_oid.$merchant_salt, $merchant_key, true))
    const expected = createHmac("sha256", KEYS.merchantKey).update(`${KEYS.merchantId}${oid}${KEYS.merchantSalt}`).digest("base64");
    assert.equal(paytrStatusToken(KEYS, { merchantOid: oid }), expected);
    assert.notEqual(paytrStatusToken(KEYS, { merchantOid: "PR261001A2ABCDEF" }), expected, "bound to the merchant_oid");
    assert.notEqual(paytrStatusToken({ ...KEYS, merchantSalt: "other" }, { merchantOid: oid }), expected, "bound to the salt");
    // Not the hex digest, not the refund token's field order.
    assert.notEqual(expected, createHmac("sha256", KEYS.merchantKey).update(`${KEYS.merchantId}${oid}${KEYS.merchantSalt}`).digest("hex"));
    assert.equal(PAYTR_PATHS.status, "/odeme/durum-sorgu");
  });
});

describe("Durum Sorgu amounts are decimal currency units (not × 100)", () => {
  test("comma or dot as the decimal mark, thousands separators, rounding never guessed", () => {
    assert.equal(parsePaytrDecimal("10,8"), 1080, "the docs' payment_amount example");
    assert.equal(parsePaytrDecimal("9.76"), 976, "the docs' net_tutar example");
    assert.equal(parsePaytrDecimal("0.24"), 24);
    assert.equal(parsePaytrDecimal("399,70"), 39970);
    assert.equal(parsePaytrDecimal("399"), 39900, "a whole amount is lira, never kuruş");
    assert.equal(parsePaytrDecimal("1.234,56"), 123456);
    assert.equal(parsePaytrDecimal("1,234.56"), 123456);
    assert.equal(parsePaytrDecimal(12.5), 1250);
    for (const bad of ["", "abc", "-5", "1.234", "1,234,5", "1.2.3", "10,123", "12,34.5", "1e3", " ", null, undefined, {}]) {
      assert.equal(parsePaytrDecimal(bad), null, JSON.stringify(bad));
    }
  });
});

describe("Durum Sorgu answer mapping", () => {
  const oid = "PR261001A1ABCDEF";
  test("success: paid, kuruş from payment_total (incl. installment interest), test_mode, odeme_tipi", () => {
    const r = parsePaytrStatusResponse(oid, {
      status: "success",
      payment_amount: "399,7",
      payment_total: "412,10",
      currency: "TL",
      taksit: "3",
      odeme_tipi: "KART",
      test_mode: "0",
      net_tutar: "401.84",
      kesinti_tutari: "10.26",
      returns: [],
    });
    assert.equal(r.kind, "paid");
    assert.ok(r.kind === "paid");
    assert.equal(r.totalAmount, 41210);
    assert.equal(r.paymentAmount, 39970);
    assert.equal(r.testMode, false);
    assert.deepEqual(r.raw, {
      provider: "paytr",
      source: "durum-sorgu",
      merchantOid: oid,
      status: "success",
      totalAmount: 41210,
      paymentAmount: 39970,
      paymentType: "KART",
      currency: "TL",
      installmentCount: 3,
      providerTestMode: false,
    });
    const test = parsePaytrStatusResponse(oid, { status: "success", payment_amount: "10,8", test_mode: "1", currency: "TRY" });
    assert.ok(test.kind === "paid" && test.testMode === true && test.totalAmount === 1080, "payment_amount when payment_total is missing");
    assert.ok(test.kind === "paid" && test.raw.providerTestMode === true);
  });

  test("err 004 (both texts) is 'not paid'; every other answer is 'unknown'", () => {
    assert.deepEqual(parsePaytrStatusResponse(oid, { status: "error", err_no: "004", err_msg: "merchant_oid ile basarili odeme bulunamadi" }), { kind: "not_paid", merchantOid: oid, errNo: "004" });
    assert.equal(parsePaytrStatusResponse(oid, { status: "error", err_no: "004", err_msg: "merchant_oid ile islem bulunamadi" }).kind, "not_paid");
    assert.equal(parsePaytrStatusResponse(oid, { status: "failed", err_no: "004" }).kind, "not_paid", "the page also says 'failed'");
    const unknown = (data: unknown) => {
      const r = parsePaytrStatusResponse(oid, data);
      assert.equal(r.kind, "unknown", JSON.stringify(data));
      return r.kind === "unknown" ? r.reason : "";
    };
    assert.equal(unknown({ status: "error", err_no: "001", err_msg: "Gecersiz istek veya magaza aktif degil" }), "err_001");
    assert.equal(unknown({ status: "error", err_no: "002" }), "err_002");
    assert.equal(unknown({ status: "error", err_no: "003", err_msg: "paytr_token gonderilmedi veya gecersiz" }), "err_003");
    assert.equal(unknown({ status: "error" }), "error");
    assert.equal(unknown({ status: "success", payment_amount: "1.234" }), "bad_amount", "an ambiguous amount is never guessed");
    assert.equal(unknown({ status: "success", payment_amount: "0" }), "bad_amount");
    assert.equal(unknown({ status: "success", payment_amount: "10,8", currency: "USD" }), "currency");
    assert.equal(unknown({ status: "success", payment_amount: "10,8", returns: [{ return_amount: "10.80" }] }), "has_returns", "refunded at PayTR: a person decides");
    assert.equal(unknown({ status: "pending" }), "malformed");
    assert.equal(unknown([]), "malformed");
    assert.equal(unknown(null), "malformed");
    assert.equal(unknown("OK"), "malformed");
  });
});

describe("C5 rule (one helper for notifications and Durum Sorgu)", () => {
  const LIVE = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.prestij.example" };
  test("a test result for an attempt sent live, on a public origin, is refused; everything else passes", () => {
    assert.equal(paytrTestResultForLiveAttempt(false, true, LIVE), true);
    assert.equal(paytrTestResultForLiveAttempt(true, true, LIVE), false, "a test attempt may get a test result");
    assert.equal(paytrTestResultForLiveAttempt(false, false, LIVE), false, "a live result");
    assert.equal(paytrTestResultForLiveAttempt(null, true, LIVE), false, "no stored attempt: unchanged behaviour");
    assert.equal(paytrTestResultForLiveAttempt(false, true, { NODE_ENV: "development" }), false, "local development");
    assert.equal(paytrTestResultForLiveAttempt(false, true, { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://localhost:3411" }), false, "next start on a local origin");
  });
});

describe("the PayTR window (paytr-window.ts)", () => {
  const NOW = Date.parse("2026-11-21T12:00:00Z");
  const at = (minutesAgo: number) => new Date(NOW - minutesAgo * MIN).toISOString();
  const attempt = (n: number, minutesAgo: number, testMode = false) => ({ n, ref: `PR261001A${n}ABCDEF`, testMode, at: at(minutesAgo), iframeUrl: `https://www.paytr.com/odeme/guvenli/t${n}`, paymentAmount: 39970 });
  const initiated = (...attempts: ReturnType<typeof attempt>[]): PaymentRowLike => ({
    provider: "paytr",
    status: "initiated",
    providerRef: null,
    raw: attempts.reduce<unknown>((raw, a) => withAttempt(raw, a), {}),
  });

  test("45 minutes = timeout_limit 30 + margin; the form is offered until 2 minutes before PayTR closes it", () => {
    assert.equal(PAYTR_TIMEOUT_MINUTES, 30);
    assert.equal(PAYTR_VERIFY_WINDOW_MINUTES, 45);
    assert.equal(PAYTR_FORM_USABLE_MS, 28 * MIN);
    assert.equal(PAYTR_UNVERIFIED_ALERT_HOURS, 24);
  });

  test("an open attempt is 'verifying' for 45 minutes, its form reusable for 28", () => {
    const fresh = paytrAttemptState([initiated(attempt(1, 5))], NOW);
    assert.equal(fresh.verifying, true);
    assert.equal(fresh.formOpen, true);
    assert.equal(fresh.verifyUntil, NOW + 40 * MIN);
    assert.equal(fresh.latestResult, null);
    assert.deepEqual(fresh.unsettled.map((a) => a.n), [1]);
    assert.equal(paytrWindowPassed(fresh, NOW), false);

    const closedForm = paytrAttemptState([initiated(attempt(1, 30))], NOW);
    assert.equal(closedForm.verifying, true, "the form is closed but its payment may still be confirmed");
    assert.equal(closedForm.formOpen, false);

    const passed = paytrAttemptState([initiated(attempt(1, 45))], NOW);
    assert.equal(passed.verifying, false);
    assert.equal(passed.verifyUntil, null);
    assert.equal(paytrWindowPassed(passed, NOW), true);
    assert.deepEqual(passed.unsettled.map((a) => a.n), [1], "still unsettled: the expiry job asks PayTR before cancelling");
  });

  test("a recorded result settles an attempt; only the latest attempt decides 'verifying'", () => {
    const failedLatest: PaymentRowLike[] = [
      { provider: "paytr", status: "failed", providerRef: "PR261001A2ABCDEF", raw: withAttempt(withAttempt({}, attempt(1, 90)), attempt(2, 3)) },
    ];
    const s = paytrAttemptState(failedLatest, NOW);
    assert.equal(s.latest?.n, 2);
    assert.equal(s.latestResult, "failed");
    assert.equal(s.verifying, false, "a declined attempt may be retried at once");
    assert.deepEqual(s.unsettled.map((a) => a.n), [1], "the older attempt never got a result");

    // A superseded late failure of attempt 1 on its own row, attempt 2 open.
    const rows: PaymentRowLike[] = [
      { provider: "paytr", status: "failed", providerRef: "PR261001A1ABCDEF", raw: { superseded: true } },
      initiated(attempt(1, 20), attempt(2, 10)),
    ];
    const open = paytrAttemptState(rows, NOW);
    assert.equal(open.latest?.n, 2);
    assert.equal(open.verifying, true);
    assert.deepEqual(open.unsettled.map((a) => a.n), [2]);

    const paid = paytrAttemptState([{ provider: "paytr", status: "succeeded", providerRef: "PR261001A1ABCDEF", raw: withAttempt({}, attempt(1, 2)) }], NOW);
    assert.equal(paid.latestResult, "succeeded");
    assert.equal(paid.verifying, false);
    assert.equal(paid.unsettled.length, 0);
  });

  test("iyzico rows and orders without PayTR attempts are ignored; an unknown start time counts as just started", () => {
    const iyzico = paytrAttemptState([{ provider: "iyzico", status: "initiated", providerRef: null, raw: withAttempt({}, attempt(1, 1)) }], NOW);
    assert.equal(iyzico.latest, null);
    assert.equal(iyzico.verifying, false);
    assert.equal(paytrWindowPassed(iyzico, NOW), true);
    assert.equal(paytrAttemptState([], NOW).verifying, false);

    const noTime = paytrAttemptState([{ provider: "paytr", status: "initiated", providerRef: null, raw: { attempts: [{ n: 1, ref: "PR261001A1ABCDEF", testMode: false, at: "not a date" }] } }], NOW);
    assert.equal(noTime.verifying, true, "better a wait than a second charge");
    const fromRow = paytrAttemptState(
      [{ provider: "paytr", status: "initiated", providerRef: null, updatedAt: new Date(NOW - 50 * MIN), raw: { attempts: [{ n: 1, ref: "PR261001A1ABCDEF", testMode: false, at: "not a date" }] } }],
      NOW,
    );
    assert.equal(fromRow.verifying, false, "falls back to the row's updated_at");
  });

  test("the 24 h to-do threshold counts from the latest attempt", () => {
    assert.equal(paytrUnverifiedAlertDue(paytrAttemptState([initiated(attempt(1, 23 * 60 + 59))], NOW), NOW), false);
    assert.equal(paytrUnverifiedAlertDue(paytrAttemptState([initiated(attempt(1, 24 * 60))], NOW), NOW), true);
  });
});

describe("UI strings (tr, en, ar)", () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  test("every new string exists in all three languages with the same placeholders", () => {
    const keys = [
      ["order", "payment", "verifyingText"],
      ["order", "payment", "verifyingSlowText"],
      ["order", "payment", "verifyingRetryAt"],
      ["order", "payment", "resumeText"],
      ["order", "payment", "resumeButton"],
      ["order", "payment", "retryErrors", "verifying"],
      ["checkout", "cardPayment", "verifyingTitle"],
      ["checkout", "cardPayment", "verifyingText"],
      ["checkout", "cardPayment", "verifyingFormText"],
    ];
    const get = (tree: unknown, path: string[]) => path.reduce<unknown>((node, k) => (node as Record<string, unknown>)?.[k], tree);
    for (const path of keys) {
      const values = [tr, en, ar].map((m) => get(m, path));
      for (const v of values) assert.equal(typeof v, "string", path.join("."));
      assert.deepEqual(new Set(values.map((v) => placeholders(v as string).join(","))).size, 1, `placeholders of ${path.join(".")}`);
    }
    assert.deepEqual(placeholders(tr.order.payment.verifyingRetryAt), ["time"]);
    assert.deepEqual(placeholders(tr.checkout.cardPayment.verifyingFormText), ["time"]);
    assert.match(tr.checkout.cardPayment.verifyingTitle, /Ödemeniz doğrulanıyor/);
  });

  test("the reconcile comment no longer claims PayTR retries until OK", () => {
    const text = readFileSync("src/lib/payments/reconcile.ts", "utf8");
    assert.ok(!/PayTR needs none of this/.test(text));
    assert.match(text, /documents no retry count/);
  });
});
