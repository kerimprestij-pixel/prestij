// PayTR-fix IMPL-A2, pure parts:
//   C8   user_ip: IPv4 as is, IPv6 compressed (never longer than 39), IPv4-mapped IPv6 as plain IPv4, never cut in
//        the middle; everything unusable becomes the old fallback 127.0.0.1; the get-token hash uses the same value.
//   C13c the get-token token: any non-empty value without "/", "?", "#", whitespace or control characters, ≤ 512.
//   C10  the iade error texts (006 / 009 "already refunded?", 010 "balance"), the 90 s timeout, the page maxDuration.
//   C7   the card page CSP: frame-ancestors 'self' + the PayTR origin; X-Frame-Options stays SAMEORIGIN.
//   Panel: the dashboard lines and the /panel/ayarlar/odeme banner ("PayTR bildirimleri reddediliyor", last time,
//        count), the C5 / C13a lines, the audit log labels of the refusal rows.
// The DB halves (C5 refusal, refusal records and their rate limit, C13a event, C13b body, gateway with stubbed
// HTTP and the payment mock): tests/db/paytr-fix-a2.test.ts.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardTodo } from "@/app/panel/_lib/dashboard";
import { actionInfo, entityHref, entityLabel, fieldLabel } from "@/components/panel/audit/labels";
import TodoCard from "@/components/panel/dashboard/TodoCard";
import PaymentReadiness from "@/components/panel/settings/PaymentReadiness";
import { formatIstanbul } from "@/lib/panel/format";
import type { NotifyRefusalSummary } from "@/lib/payments/alerts";
import {
  isUsablePaytrToken,
  paytrIframeToken,
  paytrRefundErrorMessage,
  paytrUserIp,
  PAYTR_FALLBACK_USER_IP,
  PAYTR_TOKEN_MAX,
  PAYTR_USER_IP_MAX,
  TEST_PAYMENT_ON_LIVE,
} from "@/lib/payments/paytr-crypto";
import type { PaymentReadiness as Readiness } from "@/lib/payments/readiness";
import { cardPageCsp, cardPageHeaders } from "@/lib/security/card-page-csp";

const read = (path: string) => readFileSync(path, "utf8");

describe("C8: user_ip", () => {
  test("IPv4 unchanged (trimmed); IPv4-mapped IPv6 in any spelling becomes the plain IPv4", () => {
    assert.equal(paytrUserIp("85.34.78.112"), "85.34.78.112");
    assert.equal(paytrUserIp("  85.34.78.112 "), "85.34.78.112");
    assert.equal(paytrUserIp("::ffff:203.0.113.9"), "203.0.113.9");
    assert.equal(paytrUserIp("::FFFF:203.0.113.9"), "203.0.113.9");
    assert.equal(paytrUserIp("0:0:0:0:0:ffff:c0a8:0101"), "192.168.1.1", "hex spelling");
    const longest = "0000:0000:0000:0000:0000:ffff:255.255.255.255";
    assert.equal(longest.length, 45, "longer than PayTR's 39: the old clip cut this one in the middle");
    assert.equal(paytrUserIp(longest), "255.255.255.255");
  });

  test("IPv6 in its canonical compressed form, never longer than 39 and never a cut-off prefix", () => {
    assert.equal(paytrUserIp("2a02:e0:1234:5678:9abc:def0:1234:5678"), "2a02:e0:1234:5678:9abc:def0:1234:5678");
    assert.equal(paytrUserIp("2001:0DB8:0000:0000:0000:0000:0000:0001"), "2001:db8::1");
    assert.equal(paytrUserIp("::1"), "::1");
    const full = "2a02:ffff:abcd:ef01:2345:6789:abcd:ef01";
    assert.equal(full.length, PAYTR_USER_IP_MAX);
    assert.equal(paytrUserIp(full), full);
    assert.equal(paytrUserIp("::1.2.3.4"), "::102:304", "IPv4-compatible (not mapped) stays IPv6");
    for (const ip of ["2a02:e0:1234:5678:9abc:def0:1234:5678", "fd00::1:2:3:4", "0000:0000:0000:0000:0000:ffff:255.255.255.255", "2001:0db8:85a3:0000:0000:8a2e:0370:7334"]) {
      const out = paytrUserIp(ip);
      assert.ok(out.length <= PAYTR_USER_IP_MAX, out);
      assert.notEqual(out, ip.slice(0, PAYTR_USER_IP_MAX) === ip ? "" : ip.slice(0, PAYTR_USER_IP_MAX), `${ip}: not the old 39-character cut`);
    }
    assert.equal(paytrUserIp("2001:0db8:85a3:0000:0000:8a2e:0370:7334"), "2001:db8:85a3::8a2e:370:7334");
  });

  test("unknown or unusable values fall back to 127.0.0.1 (as before for an unknown address)", () => {
    for (const v of [null, undefined, "", "unknown", "fe80::1%eth0", "1.2.3", "256.1.1.1", "not-an-ip", "1.2.3.4, 5.6.7.8", "::ffff:1.2.3.4:80", "[::1]"]) {
      assert.equal(paytrUserIp(v), PAYTR_FALLBACK_USER_IP, String(v));
    }
  });

  test("the gateway sends paytrUserIp(clientIp) and hashes the same value; x-vercel-forwarded-for stays the source", () => {
    const gateway = read("src/lib/payments/paytr-gateway.ts");
    assert.match(gateway, /userIp: paytrUserIp\(d\.clientIp\),/);
    assert.match(gateway, /user_ip: fields\.userIp,/);
    assert.match(gateway, /paytr_token: paytrIframeToken\(config, fields\),/);
    assert.ok(!/clip\(d\.clientIp/.test(gateway), "no clipping of the address any more");
    assert.match(read("src/lib/rate-limit.ts"), /process\.env\.VERCEL \? last\(h\.get\("x-vercel-forwarded-for"\)\)/);
    // The hash over the converted value (PHP: base64_encode(hash_hmac('sha256', $hash_str.$merchant_salt, $merchant_key, true))).
    const keys = { merchantId: "123456", merchantKey: "KKKK", merchantSalt: "SSSS" };
    const f = { userIp: paytrUserIp("::ffff:203.0.113.9"), merchantOid: "PR261001A1ABCDEF", email: "a@test.local", paymentAmount: "3456", userBasket: "W10=", noInstallment: "1" as const, maxInstallment: "0", currency: "TL", testMode: "0" as const };
    const expected = createHmac("sha256", keys.merchantKey).update(`123456203.0.113.9PR261001A1ABCDEFa@test.local3456W10=10TL0SSSS`).digest("base64");
    assert.equal(paytrIframeToken(keys, f), expected);
  });
});

describe("C13c: get-token token format", () => {
  test("accepted: any non-empty token that fits the iframe path, up to 512 characters", () => {
    for (const t of ["a", "0123456789abcdef0123456789abcdef0123456789abcdef", "ab+cd==", "x".repeat(PAYTR_TOKEN_MAX), "tok%en", "ÜğŞ-ı", "a.b_c-d~e"]) {
      assert.equal(isUsablePaytrToken(t), true, t);
    }
  });
  test("refused: empty, too long, '/', '?', '#', whitespace, control characters, non-strings", () => {
    for (const t of ["", "x".repeat(PAYTR_TOKEN_MAX + 1), "a/b", "a?b", "a#b", "a b", "a\tb", "a\nb", "a\u0000b", "a\u007fb", 123, null, undefined, {}]) {
      assert.equal(isUsablePaytrToken(t), false, JSON.stringify(t));
    }
  });
  test("the gateway refuses another format with a clear reason and logs 'unexpected token format' (never the token)", () => {
    const gateway = read("src/lib/payments/paytr-gateway.ts");
    assert.match(gateway, /if \(!isUsablePaytrToken\(data\.token\)\)/);
    assert.match(gateway, /unexpected token format/);
    assert.match(gateway, /PayTR ödeme formu anahtarını \(token\) beklenmeyen biçimde döndürdü; ödeme formu açılmadı\./);
    assert.ok(!/\[A-Za-z0-9\._-\]\{8,200\}/.test(gateway), "the old narrow pattern is gone");
  });
});

describe("C10: refunds", () => {
  test("err 006 / 009 → maybe already refunded; 010 → balance; others keep PayTR's text", () => {
    const already = "Bu ödeme zaten iade edilmiş olabilir; PayTR panelinden kontrol edin.";
    const balance = "PayTR bakiyesi yetersiz; iadeyi daha sonra tekrar deneyin veya PayTR ile görüşün.";
    assert.equal(paytrRefundErrorMessage("009", "Toplam iade tutari odeme tutarindan fazla olamaz"), `${already} (PayTR 009)`);
    assert.equal(paytrRefundErrorMessage("006", "Toplam iade tutarı odeme tutarindan fazla olamaz"), `${already} (PayTR 006)`);
    assert.equal(paytrRefundErrorMessage(9, null), `${already} (PayTR 009)`, "a JSON number");
    assert.equal(paytrRefundErrorMessage("010", "Net bakiyeniz yetersiz"), `${balance} (PayTR 010)`);
    // PayTR-fix R6: 007 and 000 are explained (tests/unit/paytr-fix-r.test.ts); other codes keep PayTR's text.
    assert.equal(paytrRefundErrorMessage("011", "Bir yildan eski islemler icin iade islemi yapilamaz."), "PayTR 011: Bir yildan eski islemler icin iade islemi yapilamaz.");
    assert.equal(paytrRefundErrorMessage(undefined, undefined), "");
  });

  test("90 s for /odeme/iade only; the panel page running the Server Action allows more; the pending lock is longer", () => {
    const gateway = read("src/lib/payments/paytr-gateway.ts");
    assert.match(gateway, /export const PAYTR_REFUND_TIMEOUT_MS = 90_000;/);
    assert.match(gateway, /PAYTR_PATHS\.refund,[\s\S]{0,400}PAYTR_REFUND_TIMEOUT_MS,\s*\)/);
    const code = gateway.replace(/^\s*\/\/.*$/gm, "");
    assert.equal((code.match(/PAYTR_REFUND_TIMEOUT_MS/g) ?? []).length, 2, "defined once, used by the refund only");
    assert.match(gateway, /const TIMEOUT_MS = 20_000;/, "get-token keeps 20 s");
    assert.match(gateway, /TimeoutError[\s\S]{0,200}PayTR 90 saniye içinde yanıt vermedi; iade yine de yapılmış olabilir/);
    const page = read("src/app/panel/(dashboard)/siparisler/[id]/page.tsx");
    const maxDuration = Number(/export const maxDuration = (\d+);/.exec(page)?.[1]);
    assert.ok(maxDuration >= 100 && maxDuration <= 300, `maxDuration ${maxDuration}: above 90 s, within Vercel's 300 s default`);
    assert.match(page, /import CardRefundButton/);
    assert.match(read("src/components/panel/orders/CardRefundButton.tsx"), /refundCardAction/);
    const lock = Number(/const PENDING_LOCK_MS = (\d+) \* 60_000;/.exec(read("src/lib/payments/refund.ts"))?.[1]) * 60_000;
    assert.ok(lock > 90_000 + 10_000, "a second click cannot start a refund while the first may still be waiting");
  });
});

describe("C7: card page framing", () => {
  test("frame-ancestors 'self' + the PayTR origin (also the local mock's); X-Frame-Options SAMEORIGIN (CSP wins)", () => {
    assert.equal(cardPageCsp("https://www.paytr.com"), "frame-ancestors 'self' https://www.paytr.com; frame-src 'self' https://www.paytr.com https:");
    assert.deepEqual(cardPageHeaders({ NODE_ENV: "development", PAYTR_BASE_URL: "http://127.0.0.1:4411" }), [
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'self' http://127.0.0.1:4411; frame-src 'self' http://127.0.0.1:4411 https:" },
    ]);
    const live = cardPageHeaders({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.prestij.example", PAYTR_BASE_URL: "http://127.0.0.1:4411" });
    assert.match(live[1].value, /^frame-ancestors 'self' https:\/\/www\.paytr\.com;/, "a live site never lets a local origin frame it");
    assert.match(read("src/lib/security/card-page-csp.ts"), /ignores X-Frame-Options when the policy has frame-ancestors/);
    assert.match(read("next.config.ts"), /\.\.\.TOKEN_PAGES\.map\(\(source\) => \(\{ source, headers: \[\{ key: "Referrer-Policy", value: "no-referrer" \}\] \}\)\)/, "no-referrer stays");
  });
});

// ---------------------------------------------------------------------------------------------------
// Panel

const LAST = "2026-11-21T11:05:00.000Z";
const refused: NotifyRefusalSummary = { count: 37, windowHours: 72, firstAt: "2026-11-21T09:00:00.000Z", lastAt: LAST, kinds: ["bad_hash", "missing_fields"], merchantOid: "PR261001A1ABCDEF" };

function todo(extra: Partial<DashboardTodo> = {}): DashboardTodo {
  return {
    awaitingTransfer: 0,
    overdueTransfers: 0,
    toShip: 0,
    pendingPayment: 0,
    unreadMessages: 0,
    pendingSamples: 0,
    samplesToShip: 0,
    paidCancelled: 0,
    unverifiedCard: 0,
    paytrNotifyRefused: null,
    paytrTestOnLive: 0,
    paymentSuccessAfterFailure: 0,
    paytrTestOnLiveOrderId: null,
    paymentSuccessAfterFailureOrderId: null,
    pendingCompanies: 0,
    pendingQuotes: 0,
    pendingReviews: 0,
    lowStockVariants: 0,
    activeProducts: 3,
    ...extra,
  };
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("dashboard 'Yapılacaklar'", () => {
  test("refused notifications: the line with the last time and the count; admins go to the payment settings", () => {
    const html = renderToStaticMarkup(createElement(TodoCard, { todo: todo({ paytrNotifyRefused: refused }), canEditPayments: true }));
    const t = text(html);
    assert.match(t, /PayTR bildirimleri reddediliyor/);
    assert.ok(t.includes(`Bildirim URL'sini ve anahtarları kontrol edin · son: ${formatIstanbul(LAST)} · sahte bir istekten de olabilir; o durumda siparişler etkilenmez`), t);
    assert.match(t, / 37 /);
    assert.match(html, /href="\/panel\/ayarlar\/odeme"/);
    assert.match(t, /Bekleyen iş yok/, "a warning is not counted as order work");
    assert.ok(!t.includes("Siparişler, mesajlar ve stoklar güncel."), "never 'all good' while a payment warning is shown");
    const staff = renderToStaticMarkup(createElement(TodoCard, { todo: todo({ paytrNotifyRefused: refused }) }));
    assert.ok(!staff.includes('href="/panel/ayarlar/odeme"'), "non-admins are not sent to an admin page");
  });

  test("C5 and C13a lines appear only when non-zero", () => {
    const quiet = text(renderToStaticMarkup(createElement(TodoCard, { todo: todo(), canEditPayments: true })));
    for (const label of ["PayTR bildirimleri reddediliyor", "Canlı siparişe PayTR test ödemesi geldi", "Başarısız ödemeden sonra başarılı bildirim"]) assert.ok(!quiet.includes(label), label);
    assert.match(quiet, /Siparişler, mesajlar ve stoklar güncel\./);
    const t = text(renderToStaticMarkup(createElement(TodoCard, { todo: todo({ paytrTestOnLive: 2, paymentSuccessAfterFailure: 1 }), canEditPayments: true })));
    assert.match(
      t,
      /Canlı siparişe PayTR test ödemesi geldi Test modunu yeniden açıp kaydedin \(Ayarlar › Ödeme yöntemleri\); PayTR canlı mod onayını SMS\/e-postayla bildirene kadar açık tutun\. Para çekilmedi, sipariş ödendi sayılmadı 2/,
    );
    assert.match(t, /Başarısız ödemeden sonra başarılı bildirim PayTR panelinde kontrol edin: para çekildiyse “Ödeme alındı” ile onaylayın ya da tutarı iade edin 1/);
  });

  test("getDashboardTodo reads the three warnings with the request time", () => {
    const dashboard = read("src/app/panel/_lib/dashboard.ts");
    assert.match(dashboard, /notifyRefusalSummary\(db, now\.getTime\(\)\),\s*countPaymentEventAlerts\(db, now\.getTime\(\)\),/);
    assert.match(read("src/app/panel/(dashboard)/page.tsx"), /canEditPayments=\{hasRole\(staffRole, "admin"\)\}/);
  });
});

describe("/panel/ayarlar/odeme readiness block", () => {
  const readiness = (notifyRefusals: NotifyRefusalSummary | null): Readiness => ({
    cardEnabled: true,
    simulator: false,
    selected: "paytr",
    testMode: true,
    testModeStaffOnly: false,
    checkoutClosedByContracts: false,
    active: "paytr",
    providers: [],
    iyzicoKeyMismatch: null,
    notifyRefusals,
    urls: { siteOrigin: "https://www.prestij.example", siteOriginProblem: null, iyzicoCallback: "https://www.prestij.example/api/payments/iyzico/callback", paytrNotify: "https://www.prestij.example/api/payments/paytr/notify" },
  });

  test("the warning with the last time, the count, the reasons and the merchant_oid; nothing without refusals", () => {
    const t = text(renderToStaticMarkup(createElement(PaymentReadiness, { readiness: readiness(refused) })));
    assert.ok(t.includes("PayTR bildirimleri reddediliyor: Bildirim URL’sini ve anahtarları kontrol edin."), t);
    assert.ok(t.includes(`Son 72 saatte 37 kez reddedildi; son: ${formatIstanbul(LAST)}.`), t);
    assert.match(t, /imza \(hash\) tutmadı: sunucudaki PAYTR_MERCHANT_KEY ve PAYTR_MERCHANT_SALT/);
    assert.match(t, /eksik alanlar \(imza ya da tutar yok\)/);
    assert.match(t, /PR261001A1ABCDEF/);
    assert.match(t, /Mağaza Bildirimleri/);
    const none = text(renderToStaticMarkup(createElement(PaymentReadiness, { readiness: readiness(null) })));
    assert.ok(!none.includes("PayTR bildirimleri reddediliyor"));
  });

  test("card off: no green 'alınıyor' banner, a neutral 'Kartla ödeme kapalı' note instead (FINAL defect)", () => {
    const on = text(renderToStaticMarkup(createElement(PaymentReadiness, { readiness: { ...readiness(null), testMode: false } })));
    assert.match(on, /Yeni kart ödemeleri PayTR üzerinden alınıyor — canlı mod/);
    const off = text(renderToStaticMarkup(createElement(PaymentReadiness, { readiness: { ...readiness(null), testMode: false, cardEnabled: false } })));
    assert.doesNotMatch(off, /üzerinden alınıyor/);
    assert.match(off, /Kartla ödeme kapalı\. Müşteriler kart seçeneğini görmez\. Seçili kuruluş: PayTR \(anahtarlar hazır\)/);
    const offNoKeys = text(renderToStaticMarkup(createElement(PaymentReadiness, { readiness: { ...readiness(null), cardEnabled: false, active: null } })));
    assert.match(offNoKeys, /Seçili kuruluş: PayTR \(anahtarlar henüz tanımlı değil\)/);
    assert.doesNotMatch(offNoKeys, /için anahtarlar tanımlı değil\. Kart seçeneği ödeme sayfasında/);
  });
});

describe("panel texts and labels", () => {
  test("audit log rows of refused notifications are labelled and link to the payment settings", () => {
    assert.equal(entityLabel("payment_notification"), "PayTR bildirimi");
    assert.deepEqual(actionInfo("refused"), { label: "Reddetti", tone: "danger" });
    assert.equal(entityHref("payment_notification", "bad_hash"), "/panel/ayarlar/odeme");
    assert.deepEqual(["count", "firstAt", "lastAt", "merchantOid"].map(fieldLabel), ["Sayı", "İlk", "Son", "PayTR sipariş no"]);
  });

  test("order timeline and order page know the new events", () => {
    const events = read("src/components/panel/orders/OrderEventList.tsx");
    assert.match(events, /case "payment_refused":[\s\S]*PayTR test ödemesi reddedildi \(para çekilmedi\)/);
    assert.match(events, /case "payment_success_after_failure":[\s\S]*Başarısız ödemeden sonra başarılı bildirim geldi/);
    const page = read("src/app/panel/(dashboard)/siparisler/[id]/page.tsx");
    assert.match(page, /e\.type === PAYMENT_REFUSED_EVENT \|\|\s*e\.type === PAYMENT_SUCCESS_AFTER_FAILURE_EVENT/);
    assert.equal(TEST_PAYMENT_ON_LIVE, "test_payment_on_live");
  });

  test("the notify body without a Content-Type is read as a form (PayTR only)", () => {
    const http = read("src/lib/payments/http.ts");
    assert.match(http, /const fields = await formFields\(request, \{ untypedAsForm: true \}\);/);
    assert.equal((http.match(/untypedAsForm: true/g) ?? []).length, 1, "the iyzico callback is unchanged");
  });
});
