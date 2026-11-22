// PayTR (src/lib/payments/paytr-crypto.ts, money.ts, attempts.ts): get-token / notification / refund
// hashes (field order from dev.paytr.com, re-derived here from the documented PHP lines), merchant_oid,
// the basket, kuruş formatting, and forged / replayed / tampered notifications.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, test } from "node:test";
import { attemptsOf, findAttempt, MAX_STORED_ATTEMPTS, withAttempt } from "@/lib/payments/attempts";
import { decimal2, paytrAmount, parseKurusInteger } from "@/lib/payments/money";
import {
  encodePaytrBasket,
  parsePaytrMerchantOid,
  parsePaytrNotification,
  paytrChargedAmount,
  paytrIframeToken,
  paytrInstallments,
  paytrMerchantOid,
  paytrNotifyHash,
  paytrRefundToken,
} from "@/lib/payments/paytr-crypto";

const KEYS = { merchantId: "123456", merchantKey: "YYYYYYYYYYYYYY", merchantSalt: "ZZZZZZZZZZZZZZ" };
/** PHP: base64_encode(hash_hmac('sha256', $data, $merchant_key, true)) */
const phpToken = (data: string, key = KEYS.merchantKey) => createHmac("sha256", key).update(data).digest("base64");

describe("PayTR hashes", () => {
  test("get-token: merchant_id+user_ip+merchant_oid+email+payment_amount+user_basket+no_installment+max_installment+currency+test_mode, + salt", () => {
    const f = {
      userIp: "85.34.78.112",
      merchantOid: "PR261001A1ABCDEF",
      email: "ayse@example.com",
      paymentAmount: "39970",
      userBasket: encodePaytrBasket([{ id: "1", name: "Örnek ürün", quantity: 1, total: 1800, kind: "item" }]),
      noInstallment: "1" as const,
      maxInstallment: "0",
      currency: "TL",
      testMode: "1" as const,
    };
    const hashStr = `123456${f.userIp}${f.merchantOid}${f.email}${f.paymentAmount}${f.userBasket}${f.noInstallment}${f.maxInstallment}${f.currency}${f.testMode}`;
    assert.equal(paytrIframeToken(KEYS, f), phpToken(hashStr + KEYS.merchantSalt));
    // Order matters: swapping two fields gives another token.
    assert.notEqual(paytrIframeToken(KEYS, { ...f, noInstallment: "0", maxInstallment: "1" }), paytrIframeToken(KEYS, f));
  });

  test("notification: merchant_oid + salt + status + total_amount", () => {
    const expected = phpToken(`PR261001A1ABCDEF${KEYS.merchantSalt}success39970`);
    assert.equal(paytrNotifyHash(KEYS, { merchantOid: "PR261001A1ABCDEF", status: "success", totalAmount: "39970" }), expected);
  });

  test("refund: merchant_id + merchant_oid + return_amount + salt", () => {
    const expected = phpToken(`123456PR261001A1ABCDEF399.70${KEYS.merchantSalt}`);
    assert.equal(paytrRefundToken(KEYS, { merchantOid: "PR261001A1ABCDEF", returnAmount: "399.70" }), expected);
  });
});

describe("PayTR formats", () => {
  test("payment_amount is the kuruş integer; basket prices and return_amount are 2-decimal strings", () => {
    assert.equal(paytrAmount(3456), "3456");
    assert.equal(paytrAmount(39970), "39970");
    assert.equal(decimal2(1800), "18.00");
    assert.equal(decimal2(1197), "11.97");
    assert.equal(decimal2(5), "0.05");
    assert.equal(parseKurusInteger("3456"), 3456);
    for (const bad of ["34.56", "-1", "", "1e3", null, 1.5]) assert.equal(parseKurusInteger(bad), null);
  });

  test("user_basket = base64 JSON [[name, unit price, quantity]]; uneven unit prices fall back to the line", () => {
    const basket = encodePaytrBasket([
      { id: "1", name: "Lavanta · 500 ml", quantity: 2, total: 29980, kind: "item" },
      { id: "2", name: "Okyanus", quantity: 3, total: 1000, kind: "item" },
      { id: "shipping", name: "Kargo", quantity: 1, total: 9990, kind: "shipping" },
    ]);
    assert.deepEqual(JSON.parse(Buffer.from(basket, "base64").toString("utf8")), [
      ["Lavanta · 500 ml", "149.90", 2],
      ["Okyanus", "10.00", 1],
      ["Kargo", "99.90", 1],
    ]);
  });

  test("installments: single payment → 1/0, otherwise 0/2..12", () => {
    assert.deepEqual(paytrInstallments(false, 6), { noInstallment: "1", maxInstallment: "0" });
    assert.deepEqual(paytrInstallments(true, 1), { noInstallment: "1", maxInstallment: "0" });
    assert.deepEqual(paytrInstallments(true, 6), { noInstallment: "0", maxInstallment: "6" });
    assert.deepEqual(paytrInstallments(true, 40), { noInstallment: "0", maxInstallment: "12" });
  });

  test("merchant_oid: alphanumeric, ≤ 64, unique per attempt, parses back to the order", () => {
    const oid = paytrMerchantOid("PR-261001", 2, "K7Q9ZB");
    assert.equal(oid, "PR261001A2K7Q9ZB");
    assert.match(paytrMerchantOid("PR-261001", 1), /^[A-Za-z0-9]{1,64}$/);
    assert.notEqual(paytrMerchantOid("PR-261001", 1), paytrMerchantOid("PR-261001", 1));
    assert.deepEqual(parsePaytrMerchantOid(oid), { orderNumber: "PR-261001", attempt: 2 });
    for (const bad of ["PR-261001", "PR261001", "X261001A1ABCDEF", "PR261001A1abcdef", 5, null]) assert.equal(parsePaytrMerchantOid(bad), null);
    assert.throws(() => paytrMerchantOid("261001", 1));
    assert.throws(() => paytrMerchantOid("PR-261001", 0));
  });
});

/** A notification as PayTR sends it (form fields), hashed with `keys`. */
function notification(over: Record<string, string> = {}, keys = KEYS) {
  const f: Record<string, string> = {
    merchant_oid: "PR261001A1ABCDEF",
    status: "success",
    total_amount: "39970",
    payment_type: "card",
    currency: "TL",
    payment_amount: "39970",
    test_mode: "1",
    ...over,
  };
  f.hash = over.hash ?? phpToken(f.merchant_oid + keys.merchantSalt + f.status + f.total_amount, keys.merchantKey);
  return f;
}

describe("PayTR notification", () => {
  test("a correctly hashed success → order number, amount and a raw record without the hash", () => {
    const r = parsePaytrNotification(notification(), KEYS);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.notification.orderNumber, "PR-261001");
    assert.equal(r.notification.success, true);
    assert.equal(r.notification.totalAmount, 39970);
    assert.equal("hash" in r.notification.raw, false);
    assert.equal(r.notification.raw.providerTestMode, true);
  });

  test("forged: wrong key, edited status or edited amount → bad_hash (timing-safe compare)", () => {
    assert.deepEqual(parsePaytrNotification(notification({}, { ...KEYS, merchantKey: "attacker" }), KEYS), { ok: false, reason: "bad_hash" });
    const good = notification({ status: "failed" });
    assert.deepEqual(parsePaytrNotification({ ...good, status: "success" }, KEYS), { ok: false, reason: "bad_hash" });
    const paid = notification();
    assert.deepEqual(parsePaytrNotification({ ...paid, total_amount: "1" }, KEYS), { ok: false, reason: "bad_hash" });
    assert.deepEqual(parsePaytrNotification({ ...paid, hash: "" }, KEYS), { ok: false, reason: "missing_fields" });
    assert.deepEqual(parsePaytrNotification({}, KEYS), { ok: false, reason: "missing_fields" });
  });

  test("payment_amount is not covered by the hash, so it is never trusted for the amount", () => {
    const r = parsePaytrNotification(notification({ payment_amount: "1" }), KEYS);
    assert.equal(r.ok && r.notification.totalAmount, 39970);
  });

  test("a genuine notification with a merchant_oid we never issued is recognised as unknown", () => {
    assert.deepEqual(parsePaytrNotification(notification({ merchant_oid: "SOMETHINGELSE1" }), KEYS), { ok: false, reason: "unknown_oid" });
  });

  test("replays parse identically (idempotency is completeCardPayment's providerRef = merchant_oid)", () => {
    assert.deepEqual(parsePaytrNotification(notification(), KEYS), parsePaytrNotification(notification(), KEYS));
  });

  test("charged amount: the requested amount when total_amount covers it (installment interest), else what was paid", () => {
    assert.equal(paytrChargedAmount(39970, 39970), 39970);
    assert.equal(paytrChargedAmount(42100, 39970), 39970);
    assert.equal(paytrChargedAmount(39870, 39970), 39870);
    assert.equal(paytrChargedAmount(42100, null), 42100);
  });
});

describe("stored attempts", () => {
  test("appended, capped, found by ref across rows", () => {
    let raw: Record<string, unknown> = { other: 1 };
    for (let n = 1; n <= MAX_STORED_ATTEMPTS + 2; n++) raw = withAttempt(raw, { n, ref: `R${n}`, testMode: true, at: new Date(0).toISOString() });
    assert.equal(raw.other, 1);
    assert.equal(attemptsOf(raw).length, MAX_STORED_ATTEMPTS);
    assert.equal(attemptsOf(raw)[0].ref, "R3");
    assert.equal(findAttempt([null, { attempts: "x" }, raw], "R12")?.n, 12);
    assert.equal(findAttempt([raw], "R1"), null);
    assert.deepEqual(attemptsOf({ attempts: [{ ref: 1 }, null, { n: 1, ref: "a", at: "t", testMode: false }] }), [{ n: 1, ref: "a", at: "t", testMode: false }]);
  });
});
