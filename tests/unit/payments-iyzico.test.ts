// iyzico (src/lib/payments/iyzico-crypto.ts, money.ts, basket.ts): IYZWSv2 request signing, response
// signatures with iyzico's published vector, the trailing-zero rule, price formatting, the Checkout Form
// body, and forged / replayed / tampered retrieve answers.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, test } from "node:test";
import { buildBasketLines, gatewayAddress, splitName } from "@/lib/payments/basket";
import {
  buildCheckoutFormBody,
  cfRetrieveSignatureParams,
  enabledInstallments,
  iyzicoAuthorization,
  iyzicoResponseSignature,
  iyzicoSignature,
  parseCheckoutInitialize,
  parseCheckoutRetrieve,
  parseIyzicoAuthorization,
  PLACEHOLDER_IDENTITY_NUMBER,
  verifyIyzicoResponseSignature,
} from "@/lib/payments/iyzico-crypto";
import { iyzicoPrice, parseDecimalAmount, trimTrailingZeros } from "@/lib/payments/money";
import type { GatewayOrder } from "@/lib/payments/types";

const SECRET = "sandbox-qaIiLIxhjMgx3LSKIVvp6j17NunHOFtD";

describe("iyzico response signature", () => {
  test("matches the vector published in docs.iyzico.com/en/advanced/response-signature-validation", () => {
    const params = ["22416032", "TRY", "basketId", "conversationId", "10.5", "10.5"];
    assert.equal(iyzicoResponseSignature(SECRET, params), "836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173");
    assert.equal(verifyIyzicoResponseSignature(SECRET, params, "836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173"), true);
    assert.equal(verifyIyzicoResponseSignature(SECRET, params, "836C3A6C8DB86C81043F2CA74EDB13518B54A813F454F8DD762F0DD658610173"), true);
  });

  test("any changed param, a wrong secret or a malformed signature fails", () => {
    const params = ["22416032", "TRY", "basketId", "conversationId", "10.5", "10.5"];
    const good = iyzicoResponseSignature(SECRET, params);
    assert.equal(verifyIyzicoResponseSignature(SECRET, ["22416032", "TRY", "basketId", "conversationId", "10.4", "10.5"], good), false);
    assert.equal(verifyIyzicoResponseSignature("other-secret", params, good), false);
    for (const bad of [undefined, null, 42, "", "xyz", good.slice(0, 63)]) assert.equal(verifyIyzicoResponseSignature(SECRET, params, bad), false);
  });

  test("null and undefined params join as empty strings (Array.join, like the SDK)", () => {
    assert.equal(iyzicoResponseSignature(SECRET, ["FAILURE", undefined, "TRY"]), iyzicoResponseSignature(SECRET, ["FAILURE", "", "TRY"]));
    assert.equal(iyzicoResponseSignature(SECRET, ["a", null]), createHmac("sha256", SECRET).update("a:").digest("hex"));
  });

  test("trailing zeros are trimmed exactly like the docs' examples", () => {
    const cases: [string, string][] = [
      ["10", "10"],
      ["10.0", "10"],
      ["10.5", "10.5"],
      ["10.50", "10.5"],
      ["10.510", "10.51"],
      ["10.5105", "10.5105"],
      ["10.51050", "10.5105"],
    ];
    for (const [input, out] of cases) assert.equal(trimTrailingZeros(input), out, input);
    assert.equal(trimTrailingZeros(10.5), "10.5");
    assert.equal(trimTrailingZeros(100), "100");
  });
});

describe("IYZWSv2 request authentication", () => {
  test("signature = hex(HMAC-SHA256(randomKey + path + body, secret)); header = IYZWSv2 base64(apiKey:..&randomKey:..&signature:..)", () => {
    const body = JSON.stringify({ locale: "tr", conversationId: "docsTest-v1", binNumber: "535805" });
    const expected = createHmac("sha256", "secret-1").update(`123456789/payment/bin/check${body}`).digest("hex");
    assert.equal(iyzicoSignature("secret-1", "123456789", "/payment/bin/check", body), expected);
    const header = iyzicoAuthorization({ apiKey: "sandbox-apikey", secretKey: "secret-1", randomKey: "123456789", uriPath: "/payment/bin/check", body });
    assert.match(header, /^IYZWSv2 [A-Za-z0-9+/=]+$/);
    assert.equal(header.split(" ").length, 2, "exactly one space after IYZWSv2");
    assert.equal(Buffer.from(header.slice(8), "base64").toString("utf8"), `apiKey:sandbox-apikey&randomKey:123456789&signature:${expected}`);
    assert.deepEqual(parseIyzicoAuthorization(header), { apiKey: "sandbox-apikey", randomKey: "123456789", signature: expected });
    // The base64 starts like the docs' sample header ("IYZWSv2 YXBpS2V5…" = "apiKey…").
    assert.ok(header.startsWith("IYZWSv2 YXBpS2V5"));
  });

  test("malformed headers are not parsed", () => {
    for (const h of [null, undefined, "", "IYZWS abc", "IYZWSv2  YWJj", `IYZWSv2 ${Buffer.from("apiKey:a&randomKey:b").toString("base64")}`]) {
      assert.equal(parseIyzicoAuthorization(h), null);
    }
  });
});

describe("amounts", () => {
  test("kuruş → iyzico decimal string (iyzipay-node formatPrice)", () => {
    assert.equal(iyzicoPrice(12990), "129.9");
    assert.equal(iyzicoPrice(13000), "130.0");
    assert.equal(iyzicoPrice(12995), "129.95");
    assert.equal(iyzicoPrice(12905), "129.05");
    assert.equal(iyzicoPrice(1), "0.01");
    assert.equal(iyzicoPrice(0), "0.0");
    assert.throws(() => iyzicoPrice(1.5));
    assert.throws(() => iyzicoPrice(-1));
  });

  test("provider decimals → kuruş; anything ambiguous is refused", () => {
    assert.equal(parseDecimalAmount("129.90"), 12990);
    assert.equal(parseDecimalAmount("129.9"), 12990);
    assert.equal(parseDecimalAmount(129.9), 12990);
    assert.equal(parseDecimalAmount("130"), 13000);
    assert.equal(parseDecimalAmount("1.00000000"), 100);
    assert.equal(parseDecimalAmount(0.1 + 0.2), 30);
    for (const bad of ["1.234", "-5", "abc", "", "1,5", NaN, -1, Infinity, null, undefined, {}]) assert.equal(parseDecimalAmount(bad), null, String(bad));
  });
});

const ORDER: GatewayOrder = {
  id: 7,
  orderNumber: "PR-261001",
  accessToken: "00000000-0000-4000-8000-000000000000",
  amount: 39970,
  locale: "ar",
  email: "ayse@example.com",
  details: {
    buyer: { id: "guest-PR-261001", fullName: "Ayşe Nur Yılmaz", email: "ayse@example.com", phone: "+905321234567", identityNumber: null, registeredAt: null },
    shippingAddress: gatewayAddress({ fullName: "Ayşe Nur Yılmaz", phone: "", city: "38", district: "Kocasinan", line1: "Cumhuriyet Mah. 1", postalCode: "38010" }, "x"),
    billingAddress: gatewayAddress({ fullName: "Ayşe Nur Yılmaz", phone: "", city: "Kayseri", district: "Melikgazi", line1: "Sok. 2" }, "x"),
    lines: buildBasketLines({
      orderNumber: "PR-261001",
      amount: 39970,
      shippingTotal: 9990,
      paymentFee: 0,
      items: [
        { id: 1, name: "Lavanta · 500 ml", quantity: 2, lineTotal: 29980, isSample: false },
        { id: 2, name: "Numune", quantity: 1, lineTotal: 0, isSample: true },
      ],
    }),
    clientIp: "85.34.78.112",
    attempt: 2,
  },
};

describe("Checkout Form initialize body", () => {
  test("price = paidPrice = total, basket items add up exactly, samples left out, shipping as a VIRTUAL item", () => {
    const body = buildCheckoutFormBody(ORDER, { conversationId: "PR-261001-2", callbackUrl: "https://prestij.com.tr/api/payments/iyzico/callback?o=PR-261001", installments: true, maxInstallments: 3 });
    assert.equal(body.price, "399.7");
    assert.equal(body.paidPrice, "399.7");
    assert.equal(body.currency, "TRY");
    assert.equal(body.basketId, "PR-261001");
    assert.equal(body.locale, "en", "iyzico has tr/en only");
    assert.deepEqual(body.enabledInstallments, [1, 2, 3]);
    const items = body.basketItems as { id: string; price: string; itemType: string; category1: string }[];
    assert.deepEqual(
      items.map((i) => [i.id, i.price, i.itemType]),
      [
        ["item-1", "299.8", "PHYSICAL"],
        ["shipping", "99.9", "VIRTUAL"],
      ],
    );
    const sum = items.reduce((s, i) => s + (parseDecimalAmount(i.price) ?? NaN), 0);
    assert.equal(sum, ORDER.amount);
    const buyer = body.buyer as Record<string, string>;
    assert.equal(buyer.name, "Ayşe Nur");
    assert.equal(buyer.surname, "Yılmaz");
    assert.equal(buyer.identityNumber, PLACEHOLDER_IDENTITY_NUMBER);
    assert.equal(buyer.ip, "85.34.78.112");
    assert.equal(buyer.city, "Kayseri");
    assert.equal((body.shippingAddress as Record<string, string>).city, "Kayseri", "plate 38 → Kayseri");
    assert.equal((body.shippingAddress as Record<string, string>).country, "Turkey");
  });

  test("a basket that does not add up falls back to one line for the exact amount", () => {
    const lines = buildBasketLines({ orderNumber: "PR-261001", amount: 10000, shippingTotal: 0, paymentFee: 0, items: [{ id: 1, name: "X", quantity: 1, lineTotal: 9999, isSample: false }] });
    assert.deepEqual(lines, [{ id: "order", name: "Sipariş PR-261001", quantity: 1, total: 10000, kind: "item" }]);
  });

  test("installments off → single payment only; names split sensibly", () => {
    assert.deepEqual(enabledInstallments(false, 9), [1]);
    assert.deepEqual(enabledInstallments(true, 1), [1]);
    assert.deepEqual(enabledInstallments(true, 99).length, 12);
    assert.deepEqual(splitName("Cher"), { name: "Cher", surname: "Cher" });
    assert.deepEqual(splitName("  "), { name: "Müşteri", surname: "Müşteri" });
  });

  test("initialize answer: signature over conversationId:token is required", () => {
    const ok = { status: "success", conversationId: "PR-261001-2", token: "tok-123456", paymentPageUrl: "https://sandbox-cpp.iyzipay.com?token=tok" };
    const signed = { ...ok, signature: iyzicoResponseSignature("k", [ok.conversationId, ok.token]) };
    assert.deepEqual(parseCheckoutInitialize(signed, "k"), { ok: true, token: "tok-123456", paymentPageUrl: ok.paymentPageUrl });
    assert.deepEqual(parseCheckoutInitialize(ok, "k"), { ok: false, reason: "bad_signature" });
    assert.deepEqual(parseCheckoutInitialize({ status: "failure", errorCode: "5003" }, "k"), { ok: false, reason: "failure", errorCode: "5003" });
  });
});

/** A retrieve answer as the iyzico sandbox (and scripts/payment-mock.mjs) returns it. */
function retrieveAnswer(over: Record<string, unknown> = {}, secret = "k") {
  const r: Record<string, unknown> = {
    status: "success",
    paymentStatus: "SUCCESS",
    paymentId: "22416032",
    conversationId: "PR-261001-2",
    basketId: "PR-261001",
    currency: "TRY",
    price: 399.7,
    paidPrice: 399.7,
    fraudStatus: 1,
    token: "tok-123456",
    itemTransactions: [{ paymentTransactionId: "1", itemId: "item-1", price: 299.8, paidPrice: 299.8, transactionStatus: 2, merchantPayoutAmount: 290 }],
    ...over,
  };
  r.signature = iyzicoResponseSignature(secret, cfRetrieveSignatureParams(r));
  return r;
}

const RETRIEVE = { secretKey: "k", token: "tok-123456", orderNumber: "PR-261001", testMode: true };

describe("Checkout Form retrieve", () => {
  test("a signed SUCCESS for our basket and token → success with paymentId and the charged amount", () => {
    const r = parseCheckoutRetrieve(retrieveAnswer(), RETRIEVE);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.success, true);
    assert.equal(r.providerRef, "22416032");
    assert.equal(r.amount, 39970);
    assert.equal(r.raw.testMode, true);
    assert.deepEqual(r.raw.itemTransactions, [{ paymentTransactionId: "1", itemId: "item-1", price: 299.8, paidPrice: 299.8, transactionStatus: 2 }]);
  });

  test("the signature covers price fields after trimming (\"399.70\" as a string verifies too)", () => {
    const r = parseCheckoutRetrieve(retrieveAnswer({ price: "399.70", paidPrice: "399.70" }), RETRIEVE);
    assert.equal(r.ok && r.amount, 39970);
  });

  test("forged answers are refused: wrong secret, edited amount, missing signature", () => {
    assert.deepEqual(parseCheckoutRetrieve(retrieveAnswer({}, "attacker"), RETRIEVE), { ok: false, reason: "bad_signature" });
    const edited = { ...retrieveAnswer(), price: 1, paidPrice: 1 };
    assert.deepEqual(parseCheckoutRetrieve(edited, RETRIEVE), { ok: false, reason: "bad_signature" });
    const unsigned = retrieveAnswer();
    delete unsigned.signature;
    assert.deepEqual(parseCheckoutRetrieve(unsigned, RETRIEVE), { ok: false, reason: "bad_signature" });
  });

  test("another order's or another token's (correctly signed) payment is refused", () => {
    assert.deepEqual(parseCheckoutRetrieve(retrieveAnswer({ basketId: "PR-261002" }), RETRIEVE), { ok: false, reason: "order_mismatch" });
    assert.deepEqual(parseCheckoutRetrieve(retrieveAnswer({ token: "tok-other" }), RETRIEVE), { ok: false, reason: "token_mismatch" });
  });

  test("a lower paidPrice is reported (→ amount mismatch later); another currency reports 0", () => {
    const short = parseCheckoutRetrieve(retrieveAnswer({ paidPrice: 398.7 }), RETRIEVE);
    assert.equal(short.ok && short.amount, 39870);
    const interest = parseCheckoutRetrieve(retrieveAnswer({ paidPrice: 420.1 }), RETRIEVE);
    assert.equal(interest.ok && interest.amount, 39970, "installment interest on top does not change the compared amount");
    const usd = parseCheckoutRetrieve(retrieveAnswer({ currency: "USD" }), RETRIEVE);
    assert.equal(usd.ok && usd.amount, 0);
  });

  test("FAILURE → failed attempt keyed by token (replays give the same ref); fraud rejection is a failure", () => {
    const failure = retrieveAnswer({ status: "failure", paymentStatus: "FAILURE", paymentId: undefined, errorCode: "10051", errorMessage: "Kart limiti yetersiz" });
    const a = parseCheckoutRetrieve(failure, RETRIEVE);
    const b = parseCheckoutRetrieve(failure, RETRIEVE);
    assert.equal(a.ok && a.success, false);
    assert.equal(a.ok && a.providerRef, "FAIL-tok-123456");
    assert.deepEqual(a, b);
    const fraud = parseCheckoutRetrieve(retrieveAnswer({ fraudStatus: -1 }), RETRIEVE);
    assert.equal(fraud.ok && fraud.success, false);
  });

  test("unfinished 3-D Secure or an API error changes nothing", () => {
    assert.deepEqual(parseCheckoutRetrieve(retrieveAnswer({ paymentStatus: "INIT_THREEDS", paymentId: undefined }), RETRIEVE), { ok: false, reason: "pending", errorCode: undefined });
    assert.deepEqual(parseCheckoutRetrieve({ status: "failure", errorCode: "5149", errorMessage: "Geçersiz token" }, RETRIEVE), { ok: false, reason: "retrieve_failed", errorCode: "5149" });
  });
});
