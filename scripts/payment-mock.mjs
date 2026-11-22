#!/usr/bin/env node
// Local payment provider mock: emulates the iyzico Checkout Form and PayTR iFrame endpoints with the SAME
// signature algorithms as the real services (implemented here independently of src/lib/payments, so a
// mistake on one side shows up as a refused request). Never talks to iyzico or PayTR.
//
//   node scripts/payment-mock.mjs [--port 4411] [--paytr-notify-url http://localhost:3411/api/payments/paytr/notify]
//
// Keys come from the same variables the site reads (IYZICO_API_KEY, IYZICO_SECRET_KEY, PAYTR_MERCHANT_ID,
// PAYTR_MERCHANT_KEY, PAYTR_MERCHANT_SALT); without them made-up defaults ("mock-…") are used. Point the
// site at it with IYZICO_BASE_URL / PAYTR_BASE_URL = http://127.0.0.1:4411 (and PAYMENT_SIMULATOR unset).
//
// iyzico:  POST /payment/iyzipos/checkoutform/initialize/auth/ecom · GET|POST /iyzico/odeme/<token> (fake
//          hosted page; the browser then POSTs `token` to callbackUrl) · POST /payment/iyzipos/checkoutform/
//          auth/ecom/detail · POST /payment/cancel · POST /payment/refund · POST /v2/payment/refund
// PayTR:   POST /odeme/api/get-token · GET|POST /odeme/guvenli/<token> (fake iframe; sends the server-to-
//          server notification, then sends the browser to merchant_ok_url / merchant_fail_url) ·
//          POST /odeme/iade · POST /odeme/durum-sorgu (status inquiry) · GET /js/iframeResizer.min.js (a small
//          stand-in for PayTR's resizer)
// Test controls (JSON): POST /_mock/iyzico/complete { token, outcome, tamper? } · POST /_mock/paytr/complete
//          { token, outcome, tamper?, notifyUrl? } · POST /_mock/paytr/replay { merchantOid, notifyUrl? } ·
//          POST /_mock/config { iyzicoCancel: "allow" | "refuse", iyzicoRetrieve: "ok" | "down", paytrNotifyUrl,
//          paytrStatus: "auto" | "paid" | "not_paid" | "error" | "down", paytrStoreTestMode: boolean,
//          paytrRefund: "ok" | "err009" | "err010", paytrRefundDelayMs: number, paytrToken: "hex" | "base64" | "slash" }
//          · GET /_mock/state   (iyzicoRetrieve "down": the Checkout Form result lookup answers HTTP 503, like an
//          iyzico outage right after a payment)
//   paytrStoreTestMode (PayTR-fix C5): the PayTR store is not live yet, so every notification and Durum Sorgu answer
//          says test_mode "1", whatever the request's test_mode was ("Mağazanız test modunda iken ... 1 olarak gönderilir").
//   paytrRefund: "err009" answers err 009 "Toplam iade tutari odeme tutarindan fazla olamaz", "err010" err 010 "Net
//          bakiyeniz yetersiz" (dev.paytr.com/hata-kodlari); paytrRefundDelayMs delays the iade answer (≤ 120 s).
//   paytrToken: the get-token token's form: "hex" (default, 48 hex digits), "base64" (with "+" and "=", the iframe
//          path takes it URL-encoded), "slash" (contains "/", which no iframe path can carry).
//   /_mock/paytr/complete and /_mock/paytr/replay take contentType: "none" to POST the notification without a
//          Content-Type header (the form body unchanged).
//   paytrStatus (Durum Sorgu): "auto" (default) answers from the session: success after a successful payment
//          (amount × the tamper rule, refunds in returns[]), else err 004; "paid" answers success for any
//          merchant_oid that got a token, even without a completed payment (a payment whose notification was
//          lost); "not_paid" always err 004; "error" err 001; "down" HTTP 503 without JSON (an outage).
//   tamper: "amount" (charged amount 1 TL lower, correctly signed), "signature" / "hash" (wrong signature).
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const MAX_BODY = 64 * 1024;

const hmacHex = (key, data) => createHmac("sha256", key).update(data, "utf8").digest("hex");
const hmacB64 = (key, data) => createHmac("sha256", key).update(data, "utf8").digest("base64");
const same = (a, b) => {
  const x = Buffer.from(String(a), "utf8");
  const y = Buffer.from(String(b), "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** "129.9" | "129.90" | 129.9 → 12990 (kuruş); NaN when malformed. */
function kurus(value) {
  const text = typeof value === "number" ? value.toFixed(2) : String(value ?? "");
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(text);
  if (!m) return NaN;
  const dec = (m[2] ?? "").padEnd(2, "0");
  if (/[1-9]/.test(dec.slice(2))) return NaN;
  return Number(m[1]) * 100 + Number(dec.slice(0, 2));
}
/** iyzico answers prices as numbers (129.9). */
const lira = (k) => Math.round(k) / 100;
/** iyzico signature rule: trailing zeros trimmed ("10.50" → "10.5", "10.0" → "10"). */
const trimZeros = (v) => {
  const s = String(v);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};
const sig = (secret, params) => hmacHex(secret, params.map((p) => (p === undefined || p === null ? "" : String(p))).join(":"));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const send = (res, status, body, type = "application/json; charset=utf-8", extra = {}) => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

function page(title, body, { frameable = false } = {}) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">${frameable ? "" : '<meta name="viewport" content="width=device-width,initial-scale=1">'}<title>${esc(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:${frameable ? "transparent" : "#f3f4f6"};color:#1f2937}
.wrap{max-width:460px;margin:${frameable ? "0 auto" : "40px auto"};padding:16px}
.card{background:#fff;border:1px solid #d1d5db;border-radius:10px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.badge{display:inline-block;border:2px dashed #b91c1c;color:#b91c1c;font-weight:700;letter-spacing:.15em;font-size:12px;padding:2px 8px;border-radius:4px}
h1{font-size:20px;margin:12px 0 4px}p{margin:6px 0;color:#4b5563}dl{margin:16px 0;display:grid;grid-template-columns:auto 1fr;gap:6px 12px}dt{color:#6b7280}dd{margin:0;text-align:right;font-weight:600;word-break:break-all}
button{display:block;width:100%;min-height:44px;margin-top:10px;border-radius:8px;border:1px solid #d1d5db;background:#fff;font:inherit;font-weight:600;cursor:pointer}
button.ok{background:#15803d;border-color:#15803d;color:#fff}button.no{background:#b91c1c;border-color:#b91c1c;color:#fff}small{color:#6b7280}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

// Reports the content height (not the viewport height, which would feed back into the frame size).
const resizeScript = `<script>(function(){var last=0;function post(){var w=document.querySelector(".wrap");var h=Math.ceil(w?w.getBoundingClientRect().height:document.body.scrollHeight);if(h===last)return;last=h;try{parent.postMessage({type:"paytr-mock-height",height:h},"*")}catch(e){}}addEventListener("load",post);addEventListener("resize",post);setTimeout(post,50)})();</script>`;

const RESIZER_JS = `/* payment-mock stand-in for PayTR's iframeResizer: sizes #paytriframe from the mock page's postMessage. */
window.iFrameResize=function(opts,selector){var el=document.querySelector(selector||"#paytriframe");if(!el)return;
window.addEventListener("message",function(e){var d=e.data;if(!d||d.type!=="paytr-mock-height"||e.source!==el.contentWindow)return;var h=Number(d.height);if(h>0&&h<5000)el.style.height=h+"px";});};`;

/**
 * Starts the mock. Returns { url, server, state, close() }.
 * options: { port = 4411, host = "127.0.0.1", iyzico: { apiKey, secretKey }, paytr: { merchantId, merchantKey, merchantSalt },
 *            paytrNotifyUrl, iyzicoCancel = "allow", iyzicoRetrieve = "ok", paytrStatus = "auto", paytrStoreTestMode = false,
 *            paytrRefund = "ok", paytrRefundDelayMs = 0, paytrToken = "hex", log = console.log }
 */
export async function startPaymentMock(options = {}) {
  const env = process.env;
  const cfg = {
    port: options.port ?? 4411,
    host: options.host ?? "127.0.0.1",
    iyzico: { apiKey: options.iyzico?.apiKey ?? env.IYZICO_API_KEY ?? "mock-iyzico-api-key", secretKey: options.iyzico?.secretKey ?? env.IYZICO_SECRET_KEY ?? "mock-iyzico-secret" },
    paytr: {
      merchantId: options.paytr?.merchantId ?? env.PAYTR_MERCHANT_ID ?? "100001",
      merchantKey: options.paytr?.merchantKey ?? env.PAYTR_MERCHANT_KEY ?? "mock-paytr-key",
      merchantSalt: options.paytr?.merchantSalt ?? env.PAYTR_MERCHANT_SALT ?? "mock-paytr-salt",
    },
    paytrNotifyUrl: options.paytrNotifyUrl ?? env.PAYMENT_MOCK_PAYTR_NOTIFY_URL ?? null,
    iyzicoCancel: options.iyzicoCancel ?? "allow",
    iyzicoRetrieve: options.iyzicoRetrieve ?? "ok",
    paytrStatus: options.paytrStatus ?? "auto",
    paytrStoreTestMode: options.paytrStoreTestMode === true,
    paytrRefund: options.paytrRefund ?? "ok",
    paytrRefundDelayMs: options.paytrRefundDelayMs ?? 0,
    paytrToken: options.paytrToken ?? "hex",
    log: options.log ?? ((...a) => console.log("[payment-mock]", ...a)),
  };
  const state = {
    iyzico: new Map(), // token → session
    iyzicoPayments: new Map(), // paymentId → payment
    paytr: new Map(), // iframe token → session
    paytrByOid: new Map(), // merchant_oid → session
    requests: [],
  };
  let base = "";
  // Seeded from the clock so a restarted mock never reuses a paymentId the site already stored for another
  // order (the site refuses a provider reference that belongs to a different order).
  let paymentSeq = Math.floor(Date.now() / 1000) * 100;

  // ---------------------------------------------------------------- iyzico
  const iyzicoFail = (code, message, extra = {}) => ({ status: "failure", errorCode: code, errorMessage: message, locale: "tr", systemTime: Date.now(), ...extra });

  function iyzicoAuth(req, path, raw) {
    const header = req.headers.authorization ?? "";
    const m = /^IYZWSv2 ([A-Za-z0-9+/=]+)$/.exec(header);
    if (!m) return "Authorization IYZWSv2 değil";
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const p = /^apiKey:([^&]+)&randomKey:([^&]+)&signature:([0-9a-f]{64})$/.exec(decoded);
    if (!p) return "Authorization biçimi hatalı";
    if (p[1] !== cfg.iyzico.apiKey) return "apiKey hatalı";
    if (req.headers["x-iyzi-rnd"] !== p[2]) return "x-iyzi-rnd randomKey ile aynı değil";
    if (!same(hmacHex(cfg.iyzico.secretKey, p[2] + path + raw), p[3])) return "imza hatalı";
    return null;
  }

  function iyzicoInitialize(body) {
    const required = ["price", "paidPrice", "currency", "basketId", "callbackUrl", "buyer", "billingAddress", "basketItems", "conversationId"];
    for (const k of required) if (body[k] === undefined || body[k] === null || body[k] === "") return iyzicoFail("11", `${k} zorunlu`);
    if (body.currency !== "TRY") return iyzicoFail("5068", "Para birimi TRY olmalı");
    const price = kurus(body.price);
    const paid = kurus(body.paidPrice);
    if (!Number.isFinite(price) || !Number.isFinite(paid) || price <= 0) return iyzicoFail("5000", "Tutar hatalı");
    if (!Array.isArray(body.basketItems) || body.basketItems.length === 0) return iyzicoFail("5001", "Sepet boş");
    let sum = 0;
    for (const item of body.basketItems) {
      const p = kurus(item.price);
      if (!item.id || !item.name || !item.category1 || !["PHYSICAL", "VIRTUAL"].includes(item.itemType) || !Number.isFinite(p) || p <= 0) return iyzicoFail("5002", "Sepet kalemi hatalı");
      sum += p;
    }
    if (sum !== price) return iyzicoFail("5003", "Sepet kalemlerinin toplamı price ile eşit olmalı");
    const b = body.buyer;
    for (const k of ["id", "name", "surname", "email", "identityNumber", "registrationAddress", "city", "country"]) if (!b[k]) return iyzicoFail("12", `buyer.${k} zorunlu`);
    if (body.basketItems.some((i) => i.itemType === "PHYSICAL") && !body.shippingAddress?.address) return iyzicoFail("13", "shippingAddress zorunlu");
    let callback;
    try {
      callback = new URL(body.callbackUrl);
    } catch {
      return iyzicoFail("14", "callbackUrl hatalı");
    }
    const token = randomUUID();
    state.iyzico.set(token, {
      token,
      conversationId: String(body.conversationId),
      basketId: String(body.basketId),
      price,
      paid,
      callbackUrl: callback.toString(),
      items: body.basketItems.map((i) => ({ id: i.id, name: i.name, price: kurus(i.price) })),
      installments: body.enabledInstallments ?? [1],
      locale: body.locale ?? "tr",
      result: null,
      createdAt: Date.now(),
    });
    cfg.log(`iyzico initialize basket=${body.basketId} token=${token.slice(0, 8)}…`);
    return {
      status: "success",
      locale: body.locale ?? "tr",
      systemTime: Date.now(),
      conversationId: String(body.conversationId),
      token,
      tokenExpireTime: 1800,
      paymentPageUrl: `${base}/iyzico/odeme/${token}`,
      checkoutFormContent: "",
      signature: sig(cfg.iyzico.secretKey, [String(body.conversationId), token]),
    };
  }

  function iyzicoComplete(session, outcome, tamper) {
    if (outcome === "success") {
      const paymentId = String(++paymentSeq);
      const charged = tamper === "amount" ? Math.max(1, session.price - 100) : session.price;
      const items = session.items.map((i, n) => ({ paymentTransactionId: String(paymentSeq * 100 + n), itemId: i.id, price: i.price, paidPrice: i.price, refunded: 0 }));
      session.result = { outcome, tamper, paymentId, charged, items };
      state.iyzicoPayments.set(paymentId, { paymentId, total: session.price, items, cancelled: false, conversationId: session.conversationId });
    } else {
      session.result = { outcome: "failure", tamper };
    }
    cfg.log(`iyzico ${outcome}${tamper ? ` (${tamper})` : ""} basket=${session.basketId}`);
  }

  function iyzicoRetrieve(body) {
    const session = state.iyzico.get(body.token);
    if (!session) return iyzicoFail("5149", "Geçersiz token");
    const conversationId = body.conversationId ?? session.conversationId;
    const r = session.result;
    if (!r) return { status: "success", locale: "tr", systemTime: Date.now(), conversationId, token: session.token, basketId: session.basketId, paymentStatus: "INIT_THREEDS" };
    let res;
    if (r.outcome === "success") {
      res = {
        status: "success",
        locale: "tr",
        systemTime: Date.now(),
        conversationId,
        price: lira(r.charged),
        paidPrice: lira(r.charged),
        installment: 1,
        paymentId: r.paymentId,
        fraudStatus: 1,
        basketId: session.basketId,
        currency: "TRY",
        cardType: "CREDIT_CARD",
        cardAssociation: "MASTER_CARD",
        cardFamily: "Test",
        binNumber: "55287900",
        lastFourDigits: "0008",
        token: session.token,
        callbackUrl: session.callbackUrl,
        paymentStatus: "SUCCESS",
        itemTransactions: r.items.map((i) => ({ paymentTransactionId: i.paymentTransactionId, itemId: i.itemId, price: lira(i.price), paidPrice: lira(i.paidPrice), transactionStatus: 2 })),
      };
    } else {
      res = {
        status: "failure",
        errorCode: "10051",
        errorMessage: "Kart limiti yetersiz, yetersiz bakiye",
        locale: "tr",
        systemTime: Date.now(),
        conversationId,
        basketId: session.basketId,
        currency: "TRY",
        price: lira(session.price),
        paidPrice: lira(session.paid),
        token: session.token,
        paymentStatus: "FAILURE",
      };
    }
    res.signature = sig(cfg.iyzico.secretKey, [res.paymentStatus, res.paymentId, res.currency, res.basketId, res.conversationId, trimZeros(res.paidPrice), trimZeros(res.price), res.token]);
    if (r.tamper === "signature") res.signature = hmacHex("wrong-secret", res.signature);
    return res;
  }

  function iyzicoCancel(body) {
    const p = state.iyzicoPayments.get(String(body.paymentId));
    if (!p) return iyzicoFail("5092", "Ödeme bulunamadı");
    if (cfg.iyzicoCancel !== "allow") return iyzicoFail("5093", "İptal süresi geçmiş; iade yapın");
    if (p.cancelled || p.items.some((i) => i.refunded > 0)) return iyzicoFail("5094", "Ödeme zaten iptal ya da iade edilmiş");
    p.cancelled = true;
    cfg.log(`iyzico cancel paymentId=${p.paymentId}`);
    return { status: "success", locale: "tr", systemTime: Date.now(), conversationId: body.conversationId, paymentId: p.paymentId, price: lira(p.total), currency: "TRY", authCode: "123456", hostReference: "mock" };
  }

  function iyzicoRefund(body, v2) {
    let p;
    let item;
    if (v2) p = state.iyzicoPayments.get(String(body.paymentId));
    else for (const pay of state.iyzicoPayments.values()) if ((item = pay.items.find((i) => i.paymentTransactionId === String(body.paymentTransactionId)))) { p = pay; break; }
    if (!p) return iyzicoFail("5092", "Ödeme bulunamadı");
    if (p.cancelled) return iyzicoFail("5094", "Ödeme iptal edilmiş");
    const amount = kurus(body.price);
    if (!Number.isFinite(amount) || amount <= 0) return iyzicoFail("5000", "Tutar hatalı");
    if (v2) {
      const left = p.items.reduce((s, i) => s + i.paidPrice - i.refunded, 0);
      if (amount > left) return iyzicoFail("5095", "İade tutarı kalan tutardan büyük");
      let rest = amount;
      for (const i of p.items) {
        const take = Math.min(rest, i.paidPrice - i.refunded);
        i.refunded += take;
        rest -= take;
      }
    } else {
      if (amount > item.paidPrice - item.refunded) return iyzicoFail("5095", "İade tutarı kalan tutardan büyük");
      item.refunded += amount;
    }
    cfg.log(`iyzico refund paymentId=${p.paymentId} amount=${amount}`);
    const res = {
      status: "success",
      locale: "tr",
      systemTime: Date.now(),
      conversationId: body.conversationId,
      paymentId: p.paymentId,
      ...(v2 ? {} : { paymentTransactionId: item.paymentTransactionId }),
      price: lira(amount),
      currency: "TRY",
      authCode: "654321",
      hostReference: "mock",
    };
    res.signature = sig(cfg.iyzico.secretKey, [res.paymentId, trimZeros(res.price), res.currency, res.conversationId]);
    return res;
  }

  function iyzicoPage(session) {
    if (session.result) return page("Ödeme tamamlandı", `<div class="card"><span class="badge">TEST</span><h1>Bu ödeme oturumu kapandı</h1><p>Sonuç: ${esc(session.result.outcome)}</p></div>`);
    const tl = (k) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";
    return page(
      "iyzico test ödeme sayfası",
      `<div class="card"><span class="badge">TEST</span> <small>iyzico · sahte ödeme sayfası (payment-mock)</small>
<h1>Ödemeyi tamamlayın</h1><p>Gerçek bir ödeme alınmaz; kart bilgisi istenmez.</p>
<dl><dt>Sepet</dt><dd>${esc(session.basketId)}</dd><dt>Tutar</dt><dd>${esc(tl(session.paid))}</dd><dt>Taksit</dt><dd>${esc(session.installments.join(", "))}</dd></dl>
<form method="post"><button class="ok" name="outcome" value="success">Başarılı</button><button class="no" name="outcome" value="failure">Başarısız</button>
<button name="outcome" value="success:amount">Başarılı, tutar 1 TL eksik (test)</button><button name="outcome" value="success:signature">Başarılı, imza bozuk (test)</button></form></div>`,
    );
  }

  /** What iyzico's page does after a payment: the browser POSTs the token to callbackUrl. */
  const callbackForm = (session) =>
    page(
      "Yönlendiriliyor",
      `<form id="f" method="post" action="${esc(session.callbackUrl)}"><input type="hidden" name="token" value="${esc(session.token)}"><p>Mağazaya dönülüyor…</p><button>Devam et</button></form><script>document.getElementById("f").submit()</script>`,
    );

  // ---------------------------------------------------------------- PayTR
  function paytrGetToken(f) {
    const need = ["merchant_id", "user_ip", "merchant_oid", "email", "payment_amount", "paytr_token", "user_basket", "no_installment", "max_installment", "user_name", "user_address", "user_phone", "merchant_ok_url", "merchant_fail_url"];
    for (const k of need) if (!f[k]) return { status: "failed", reason: `${k} gönderilmedi` };
    if (f.merchant_id !== cfg.paytr.merchantId) return { status: "failed", reason: "merchant_id hatalı" };
    if (!/^[A-Za-z0-9]{1,64}$/.test(f.merchant_oid)) return { status: "failed", reason: "merchant_oid yalnızca harf ve rakam içermeli (en fazla 64)" };
    if (state.paytrByOid.has(f.merchant_oid)) return { status: "failed", reason: "merchant_oid daha önce kullanılmış" };
    if (!/^\d+$/.test(f.payment_amount) || Number(f.payment_amount) <= 0) return { status: "failed", reason: "payment_amount tam sayı olmalı (tutar × 100)" };
    const currency = f.currency ?? "TL";
    const testMode = f.test_mode ?? "0";
    const hashStr = cfg.paytr.merchantId + f.user_ip + f.merchant_oid + f.email + f.payment_amount + f.user_basket + f.no_installment + f.max_installment + currency + testMode;
    if (!same(hmacB64(cfg.paytr.merchantKey, hashStr + cfg.paytr.merchantSalt), f.paytr_token)) return { status: "failed", reason: "paytr_token geçersiz" };
    let basket;
    try {
      basket = JSON.parse(Buffer.from(f.user_basket, "base64").toString("utf8"));
      if (!Array.isArray(basket) || basket.some((r) => !Array.isArray(r) || r.length !== 3)) throw new Error();
    } catch {
      return { status: "failed", reason: "user_basket hatalı" };
    }
    if (!["0", "1"].includes(f.no_installment) || !/^(0|[2-9]|1[0-2])$/.test(f.max_installment)) return { status: "failed", reason: "taksit alanları hatalı" };
    const token =
      cfg.paytrToken === "base64"
        ? `${randomBytes(25).toString("base64").replace(/\//g, "+")}` // ends in "==", may contain "+"
        : cfg.paytrToken === "slash"
          ? `${randomBytes(12).toString("hex")}/${randomBytes(12).toString("hex")}`
          : randomBytes(24).toString("hex");
    const session = {
      token,
      merchantOid: f.merchant_oid,
      amount: Number(f.payment_amount),
      okUrl: f.merchant_ok_url,
      failUrl: f.merchant_fail_url,
      testMode,
      basket,
      result: null,
      notifications: [],
      refunded: 0,
      lang: f.lang ?? "tr",
    };
    state.paytr.set(token, session);
    state.paytrByOid.set(f.merchant_oid, session);
    cfg.log(`paytr get-token oid=${f.merchant_oid} amount=${f.payment_amount}`);
    return { status: "success", token };
  }

  /** test_mode as PayTR reports it: "1" while the store is not live yet (paytrStoreTestMode), else the request's. */
  const reportedTestMode = (session) => (cfg.paytrStoreTestMode ? "1" : session.testMode);

  async function paytrNotify(session, notifyUrl, { contentType = "form" } = {}) {
    const url = notifyUrl ?? cfg.paytrNotifyUrl;
    const r = session.result;
    if (!url) return { status: 0, body: "PAYMENT_MOCK_PAYTR_NOTIFY_URL / --paytr-notify-url tanımlı değil" };
    const status = r.outcome === "success" ? "success" : "failed";
    const total = r.outcome === "success" ? String(r.tamper === "amount" ? Math.max(1, session.amount - 100) : session.amount) : String(session.amount);
    let hash = hmacB64(cfg.paytr.merchantKey, session.merchantOid + cfg.paytr.merchantSalt + status + total);
    if (r.tamper === "hash") hash = hmacB64("wrong-key", hash);
    const fields = {
      merchant_oid: session.merchantOid,
      status,
      total_amount: total,
      hash,
      payment_type: "card",
      currency: "TL",
      payment_amount: String(session.amount),
      test_mode: reportedTestMode(session),
      ...(status === "failed" ? { failed_reason_code: "2", failed_reason_msg: "Ödeme onaylanmadı (test)" } : { installment_count: "1" }),
    };
    try {
      const encoded = new URLSearchParams(fields).toString();
      // contentType "none": a byte body, for which fetch adds no Content-Type either.
      const response =
        contentType === "none"
          ? await fetch(url, { method: "POST", body: new TextEncoder().encode(encoded) })
          : await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: encoded });
      const body = await response.text();
      session.notifications.push({ at: Date.now(), status: response.status, body: body.slice(0, 200) });
      cfg.log(`paytr notify oid=${session.merchantOid} → HTTP ${response.status} ${JSON.stringify(body.slice(0, 60))}`);
      return { status: response.status, body, fields };
    } catch (error) {
      cfg.log(`paytr notify failed: ${error?.message ?? error}`);
      return { status: 0, body: String(error?.message ?? error), fields };
    }
  }

  async function paytrComplete(session, outcome, tamper, notifyUrl, notifyOptions = {}) {
    session.result = { outcome: outcome === "success" ? "success" : "failure", tamper };
    const notify = await paytrNotify(session, notifyUrl, notifyOptions);
    return { notify, redirectUrl: session.result.outcome === "success" ? session.okUrl : session.failUrl };
  }

  function paytrRefund(f) {
    for (const k of ["merchant_id", "merchant_oid", "return_amount", "paytr_token"]) if (!f[k]) return { status: "error", err_no: "001", err_msg: `${k} gönderilmedi` };
    if (f.merchant_id !== cfg.paytr.merchantId) return { status: "error", err_no: "002", err_msg: "merchant_id hatalı" };
    const token = hmacB64(cfg.paytr.merchantKey, cfg.paytr.merchantId + f.merchant_oid + f.return_amount + cfg.paytr.merchantSalt);
    if (!same(token, f.paytr_token)) return { status: "error", err_no: "003", err_msg: "paytr_token geçersiz" };
    const session = state.paytrByOid.get(f.merchant_oid);
    if (!session || session.result?.outcome !== "success") return { status: "failed" };
    if (!/^\d+\.\d{2}$/.test(f.return_amount)) return { status: "error", err_no: "005", err_msg: "return_amount 11.97 biçiminde olmalı" };
    const amount = kurus(f.return_amount);
    if (cfg.paytrRefund === "err009") return { status: "error", err_no: "009", err_msg: "Toplam iade tutari odeme tutarindan fazla olamaz" };
    if (cfg.paytrRefund === "err010") return { status: "error", err_no: "010", err_msg: "Net bakiyeniz yetersiz" };
    if (session.refunded + amount > session.amount) return { status: "error", err_no: "006", err_msg: "Toplam iade tutarı ödeme tutarından fazla olamaz" };
    session.refunded += amount;
    cfg.log(`paytr iade oid=${f.merchant_oid} amount=${f.return_amount}`);
    return { status: "success", is_test: 1, merchant_oid: f.merchant_oid, return_amount: f.return_amount, ...(f.reference_no ? { reference_no: f.reference_no } : {}) };
  }

  /** Durum Sorgu amounts are decimal currency units with a comma, like the docs' example "10,8" (not × 100). */
  const trDecimal = (k) => {
    const rest = k % 100;
    return rest === 0 ? String(Math.floor(k / 100)) : `${Math.floor(k / 100)},${String(rest).padStart(2, "0").replace(/0$/, "")}`;
  };
  const dotDecimal = (k) => `${Math.floor(k / 100)}.${String(k % 100).padStart(2, "0")}`;

  function paytrStatus(f) {
    const notFound = { status: "error", err_no: "004", err_msg: "merchant_oid ile basarili odeme bulunamadi" };
    for (const k of ["merchant_id", "merchant_oid", "paytr_token"]) if (!f[k]) return { status: "error", err_no: k === "merchant_oid" ? "002" : k === "paytr_token" ? "003" : "001", err_msg: `${k} gonderilmedi` };
    if (f.merchant_id !== cfg.paytr.merchantId) return { status: "error", err_no: "001", err_msg: "Gecersiz istek veya magaza aktif degil" };
    // paytr_token = base64(HMAC-SHA256(merchant_id + merchant_oid + merchant_salt, merchant_key)) (dev.paytr.com/durum-sorgu)
    const token = hmacB64(cfg.paytr.merchantKey, cfg.paytr.merchantId + f.merchant_oid + cfg.paytr.merchantSalt);
    if (!same(token, f.paytr_token)) return { status: "error", err_no: "003", err_msg: "paytr_token gonderilmedi veya gecersiz" };
    if (cfg.paytrStatus === "error") return { status: "error", err_no: "001", err_msg: "Gecersiz istek veya magaza aktif degil" };
    if (cfg.paytrStatus === "not_paid") return notFound;
    const session = state.paytrByOid.get(f.merchant_oid);
    if (!session) return { status: "error", err_no: "004", err_msg: "merchant_oid ile islem bulunamadi" };
    const paid = cfg.paytrStatus === "paid" || session.result?.outcome === "success";
    if (!paid) return notFound;
    const total = session.result?.tamper === "amount" ? Math.max(1, session.amount - 100) : session.amount;
    const fee = Math.round(total * 0.0249);
    cfg.log(`paytr durum-sorgu oid=${f.merchant_oid} → success`);
    return {
      status: "success",
      payment_amount: trDecimal(session.amount),
      payment_total: trDecimal(total),
      payment_date: new Date().toISOString().slice(0, 19).replace("T", " "),
      currency: "TL",
      taksit: "0",
      kart_marka: "MOCK",
      masked_pan: "455359******6747",
      auth_code: "123456",
      auth_date: new Date().toISOString().slice(0, 19).replace("T", " "),
      odeme_tipi: "KART",
      test_mode: reportedTestMode(session),
      net_tutar: dotDecimal(total - fee),
      kesinti_tutari: dotDecimal(fee),
      returns: session.refunded > 0 ? [{ return_amount: dotDecimal(session.refunded), return_date: new Date().toISOString().slice(0, 10), return_type: "iade" }] : [],
    };
  }

  function paytrPage(session) {
    if (session.result) return page("Ödeme tamamlandı", `<div class="card"><span class="badge">TEST</span><h1>Bu ödeme formu kapandı</h1></div>${resizeScript}`, { frameable: true });
    const tl = (k) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";
    return page(
      "PayTR test ödeme formu",
      `<div class="card"><span class="badge">TEST</span> <small>PayTR · sahte iframe (payment-mock)</small>
<h1>Kart ile öde</h1><p>Gerçek bir ödeme alınmaz; kart bilgisi istenmez.</p>
<dl><dt>Sipariş</dt><dd>${esc(session.merchantOid)}</dd><dt>Tutar</dt><dd>${esc(tl(session.amount))}</dd><dt>Test modu</dt><dd>${session.testMode === "1" ? "Açık" : "Kapalı"}</dd></dl>
<form method="post"><button class="ok" name="outcome" value="success">Başarılı</button><button class="no" name="outcome" value="failure">Başarısız</button>
<button name="outcome" value="success:amount">Başarılı, tutar 1 TL eksik (test)</button><button name="outcome" value="success:hash">Başarılı, hash bozuk (test)</button></form></div>${resizeScript}`,
      { frameable: true },
    );
  }

  /** After the notification PayTR sends the buyer back; the page may be inside our iframe, so leave it. */
  const paytrRedirect = (url, notify) =>
    page(
      "Yönlendiriliyor",
      `<div class="card"><p>Bildirim: HTTP ${esc(notify.status)} ${esc(String(notify.body).slice(0, 40))}</p><p><a id="go" href="${esc(url)}" target="_top">Mağazaya dön</a></p></div>
<script>try{window.top.location.href=${JSON.stringify(url)}}catch(e){location.href=${JSON.stringify(url)}}</script>`,
      { frameable: true },
    );

  // ---------------------------------------------------------------- server
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base || "http://127.0.0.1");
    const path = url.pathname;
    let raw = "";
    try {
      raw = req.method === "POST" ? await readBody(req) : "";
    } catch {
      return send(res, 413, { status: "failure", errorMessage: "too large" });
    }
    state.requests.push({ at: Date.now(), method: req.method, path });
    if (state.requests.length > 200) state.requests.shift();
    const form = () => Object.fromEntries(new URLSearchParams(raw));
    const json = () => {
      try {
        return JSON.parse(raw || "{}");
      } catch {
        return null;
      }
    };
    try {
      // iyzico API
      const iyzicoRoutes = {
        "/payment/iyzipos/checkoutform/initialize/auth/ecom": iyzicoInitialize,
        "/payment/iyzipos/checkoutform/auth/ecom/detail": iyzicoRetrieve,
        "/payment/cancel": iyzicoCancel,
        "/payment/refund": (b) => iyzicoRefund(b, false),
        "/v2/payment/refund": (b) => iyzicoRefund(b, true),
      };
      if (req.method === "POST" && iyzicoRoutes[path]) {
        const problem = iyzicoAuth(req, path, raw);
        if (problem) return send(res, 401, iyzicoFail("1001", `Kimlik doğrulama başarısız: ${problem}`));
        if (path === "/payment/iyzipos/checkoutform/auth/ecom/detail" && cfg.iyzicoRetrieve === "down") return send(res, 503, iyzicoFail("1", "Sistem hatası"));
        const body = json();
        if (!body) return send(res, 400, iyzicoFail("1002", "JSON hatalı"));
        return send(res, 200, iyzicoRoutes[path](body));
      }
      let m = /^\/iyzico\/odeme\/([0-9a-f-]{36})$/.exec(path);
      if (m) {
        const session = state.iyzico.get(m[1]);
        if (!session) return send(res, 404, page("Bulunamadı", "<p>Ödeme oturumu bulunamadı.</p>"), "text/html; charset=utf-8");
        if (req.method === "GET") return send(res, 200, iyzicoPage(session), "text/html; charset=utf-8");
        if (session.result) return send(res, 409, iyzicoPage(session), "text/html; charset=utf-8");
        const [outcome, tamper] = String(form().outcome ?? "").split(":");
        iyzicoComplete(session, outcome === "success" ? "success" : "failure", tamper || undefined);
        return send(res, 200, callbackForm(session), "text/html; charset=utf-8");
      }

      // PayTR API
      if (req.method === "POST" && path === "/odeme/api/get-token") return send(res, 200, paytrGetToken(form()));
      if (req.method === "POST" && path === "/odeme/iade") {
        const answer = paytrRefund(form());
        if (cfg.paytrRefundDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, cfg.paytrRefundDelayMs));
        return send(res, 200, answer);
      }
      if (req.method === "POST" && path === "/odeme/durum-sorgu") {
        if (cfg.paytrStatus === "down") return send(res, 503, "<html><body>Service Unavailable</body></html>", "text/html; charset=utf-8");
        return send(res, 200, paytrStatus(form()));
      }
      if (req.method === "GET" && path === "/js/iframeResizer.min.js") return send(res, 200, RESIZER_JS, "application/javascript; charset=utf-8");
      m = /^\/odeme\/guvenli\/([^/]{1,1600})$/.exec(path);
      if (m) {
        let token = "";
        try {
          token = decodeURIComponent(m[1]);
        } catch {
          token = "";
        }
        const session = state.paytr.get(token);
        if (!session) return send(res, 404, page("Bulunamadı", "<p>Ödeme formu bulunamadı.</p>", { frameable: true }), "text/html; charset=utf-8");
        if (req.method === "GET") return send(res, 200, paytrPage(session), "text/html; charset=utf-8");
        if (session.result) return send(res, 409, paytrPage(session), "text/html; charset=utf-8");
        const [outcome, tamper] = String(form().outcome ?? "").split(":");
        const done = await paytrComplete(session, outcome, tamper || undefined);
        return send(res, 200, paytrRedirect(done.redirectUrl, done.notify), "text/html; charset=utf-8");
      }

      // Test controls
      if (path.startsWith("/_mock/")) {
        if (req.method === "GET" && path === "/_mock/state") {
          return send(res, 200, {
            iyzico: [...state.iyzico.values()].map((s) => ({ token: s.token, basketId: s.basketId, price: s.price, result: s.result?.outcome ?? null })),
            iyzicoPayments: [...state.iyzicoPayments.values()].map((p) => ({ paymentId: p.paymentId, cancelled: p.cancelled, refunded: p.items.reduce((s, i) => s + i.refunded, 0) })),
            paytr: [...state.paytr.values()].map((s) => ({ merchantOid: s.merchantOid, amount: s.amount, result: s.result?.outcome ?? null, refunded: s.refunded, notifications: s.notifications })),
            config: {
              iyzicoCancel: cfg.iyzicoCancel,
              iyzicoRetrieve: cfg.iyzicoRetrieve,
              paytrNotifyUrl: cfg.paytrNotifyUrl,
              paytrStatus: cfg.paytrStatus,
              paytrStoreTestMode: cfg.paytrStoreTestMode,
              paytrRefund: cfg.paytrRefund,
              paytrRefundDelayMs: cfg.paytrRefundDelayMs,
              paytrToken: cfg.paytrToken,
            },
          });
        }
        const body = json() ?? {};
        if (req.method === "POST" && path === "/_mock/config") {
          if (body.iyzicoCancel === "allow" || body.iyzicoCancel === "refuse") cfg.iyzicoCancel = body.iyzicoCancel;
          if (body.iyzicoRetrieve === "ok" || body.iyzicoRetrieve === "down") cfg.iyzicoRetrieve = body.iyzicoRetrieve;
          if (typeof body.paytrNotifyUrl === "string") cfg.paytrNotifyUrl = body.paytrNotifyUrl;
          if (["auto", "paid", "not_paid", "error", "down"].includes(body.paytrStatus)) cfg.paytrStatus = body.paytrStatus;
          if (typeof body.paytrStoreTestMode === "boolean") cfg.paytrStoreTestMode = body.paytrStoreTestMode;
          if (["ok", "err009", "err010"].includes(body.paytrRefund)) cfg.paytrRefund = body.paytrRefund;
          if (Number.isSafeInteger(body.paytrRefundDelayMs) && body.paytrRefundDelayMs >= 0 && body.paytrRefundDelayMs <= 120_000) cfg.paytrRefundDelayMs = body.paytrRefundDelayMs;
          if (["hex", "base64", "slash"].includes(body.paytrToken)) cfg.paytrToken = body.paytrToken;
          return send(res, 200, {
            ok: true,
            iyzicoCancel: cfg.iyzicoCancel,
            iyzicoRetrieve: cfg.iyzicoRetrieve,
            paytrNotifyUrl: cfg.paytrNotifyUrl,
            paytrStatus: cfg.paytrStatus,
            paytrStoreTestMode: cfg.paytrStoreTestMode,
            paytrRefund: cfg.paytrRefund,
            paytrRefundDelayMs: cfg.paytrRefundDelayMs,
            paytrToken: cfg.paytrToken,
          });
        }
        if (req.method === "POST" && path === "/_mock/iyzico/complete") {
          const session = state.iyzico.get(body.token);
          if (!session) return send(res, 404, { ok: false, error: "unknown token" });
          if (session.result) return send(res, 409, { ok: false, error: "already completed" });
          iyzicoComplete(session, body.outcome === "success" ? "success" : "failure", body.tamper);
          return send(res, 200, { ok: true, callbackUrl: session.callbackUrl, token: session.token });
        }
        if (req.method === "POST" && path === "/_mock/paytr/complete") {
          const session = state.paytr.get(body.token) ?? state.paytrByOid.get(body.merchantOid);
          if (!session) return send(res, 404, { ok: false, error: "unknown token" });
          if (session.result) return send(res, 409, { ok: false, error: "already completed" });
          const done = await paytrComplete(session, body.outcome, body.tamper, body.notifyUrl, { contentType: body.contentType === "none" ? "none" : "form" });
          return send(res, 200, { ok: true, merchantOid: session.merchantOid, ...done });
        }
        if (req.method === "POST" && path === "/_mock/paytr/replay") {
          const session = state.paytrByOid.get(body.merchantOid);
          if (!session?.result) return send(res, 404, { ok: false, error: "no completed payment for this merchant_oid" });
          return send(res, 200, { ok: true, notify: await paytrNotify(session, body.notifyUrl, { contentType: body.contentType === "none" ? "none" : "form" }) });
        }
      }
      if (req.method === "GET" && path === "/") return send(res, 200, page("payment-mock", "<div class=card><h1>payment-mock</h1><p>iyzico + PayTR yerel test sunucusu.</p></div>"), "text/html; charset=utf-8");
      return send(res, 404, { status: "failure", errorMessage: "not found" });
    } catch (error) {
      cfg.log(`error ${path}: ${error?.message ?? error}`);
      return send(res, 500, { status: "failure", errorMessage: "mock error" });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, cfg.host, resolve);
  });
  const address = server.address();
  base = `http://${cfg.host}:${typeof address === "object" && address ? address.port : cfg.port}`;
  cfg.log(`listening on ${base} (PayTR notify → ${cfg.paytrNotifyUrl ?? "not set"})`);
  return {
    url: base,
    server,
    state,
    config: cfg,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// CLI (no top-level await: tests import this file through a CommonJS transform)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  startPaymentMock({ port: Number(arg("--port") ?? 4411), paytrNotifyUrl: arg("--paytr-notify-url") }).then(
    (mock) => {
      const stop = () => mock.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    },
    (error) => {
      console.error("[payment-mock]", error?.message ?? error);
      process.exit(1);
    },
  );
}
