// PayTR-fix FIX stage (review findings R1, R2, R4-R7, R-UX1-R-UX8), pure parts:
//   R1    parsePaytrDecimal never reads "1.500" / "1,500" / "2.000" / "1.250" / "10.000" (tr-TR thousands or decimal):
//         null, so a Durum Sorgu answer like that is "unknown", never a short payment.
//   R6    the iade texts for 007 (restart the stuck notifications) and 000 (try again later).
//   R-UX2 the "Yapılacaklar" header never says "her şey yolunda" above a warning line.
//   R-UX3 the C5 hint starts with "switch the test mode back on".
//   R-UX8 the C5 / C13a lines open the affected order (one) or the orders list filtered by the warning (several).
//   R-UX5 / R-UX6 the storefront strings (tr, en, ar): the cancellation after {time}; the resume link's text; the
//         poller's failure-specific slow text; the resume link is a secondary button.
//   R-UX7 the "Kart ödemesi doğrulanamadı" notice prints the merchant_oids and the buyer's e-mail.
//   R2, R4, R5 wiring checks (the behaviour is in tests/db/paytr-fix-r.test.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardTodo } from "@/app/panel/_lib/dashboard";
import TodoCard from "@/components/panel/dashboard/TodoCard";
import { orderAlertFromParam, ORDER_ALERTS, ordersListHref } from "@/components/panel/orders/labels";
import ar from "@/i18n/messages/ar";
import en from "@/i18n/messages/en";
import tr from "@/i18n/messages/tr";
import { parsePaytrDecimal } from "@/lib/payments/money";
import { parsePaytrStatusResponse, paytrRefundErrorMessage } from "@/lib/payments/paytr-crypto";

const read = (path: string) => readFileSync(path, "utf8");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("R1: Durum Sorgu amounts", () => {
  test("a single '.' or ',' followed by exactly three digits is never read (any digits)", () => {
    for (const ambiguous of ["1.500", "1,500", "2.000", "1.250", "10.000", "1.234", "999,999", "0.500", "15.000"]) {
      assert.equal(parsePaytrDecimal(ambiguous), null, ambiguous);
    }
  });

  test("unambiguous forms still read as before", () => {
    assert.equal(parsePaytrDecimal("10,8"), 1080, "the docs' example");
    assert.equal(parsePaytrDecimal("9.76"), 976);
    assert.equal(parsePaytrDecimal("1500"), 150_000);
    assert.equal(parsePaytrDecimal("1500,5"), 150_050);
    assert.equal(parsePaytrDecimal("1500.00"), 150_000);
    assert.equal(parsePaytrDecimal("1.500,00"), 150_000, "tr-TR with decimals");
    assert.equal(parsePaytrDecimal("1,500.00"), 150_000, "en-US with decimals");
    assert.equal(parsePaytrDecimal("1.500,5"), 150_050);
    assert.equal(parsePaytrDecimal(1500), 150_000, "a JSON number has no grouping");
  });

  test("a 'success' answer with such an amount is unknown, never paid", () => {
    const oid = "PR261001A1ABCDEF";
    assert.deepEqual(parsePaytrStatusResponse(oid, { status: "success", payment_amount: "1.500", payment_total: "1.500", currency: "TL", returns: [] }), {
      kind: "unknown",
      merchantOid: oid,
      reason: "bad_amount",
    });
    const clear = parsePaytrStatusResponse(oid, { status: "success", payment_amount: "1500", payment_total: "1.500,00", currency: "TL", returns: [] });
    assert.ok(clear.kind === "paid" && clear.totalAmount === 150_000, JSON.stringify(clear));
  });

  test("reconcile writes nothing for an amount that does not give the order total; the notification may upgrade an inquiry's mismatch", () => {
    const reconcile = read("src/lib/payments/reconcile.ts");
    assert.match(reconcile, /if \(paytrChargedAmount\(answer\.totalAmount, requested\) !== order\.grandTotal\) \{[\s\S]{0,300}paytr\.unknown\+\+;\s*continue;/);
    assert.ok(!/completion\.code === "amount_mismatch"\) paytr\.notPaid\+\+/.test(reconcile), "an inquiry never counts a mismatch as 'not paid'");
    const complete = read("src/lib/payments/complete.ts");
    assert.match(complete, /seenRaw\.source === "durum-sorgu" &&\s*seenRaw\.reason === "amount_mismatch" &&\s*input\.success &&\s*raw\.source !== "durum-sorgu" &&\s*input\.amount === order\.grandTotal/);
  });
});

describe("R6: iade error texts", () => {
  test("007: restart the stuck notifications in Mağaza Bildirimleri, then retry; 000: try again later", () => {
    const stuck =
      "PayTR bu ödemenin bildirimini tamamlanmış saymıyor; PayTR Mağaza Paneli › Mağaza Bildirimleri sayfasında duran bildirimleri yeniden başlatın, sonra iadeyi tekrar deneyin. (PayTR 007)";
    assert.equal(paytrRefundErrorMessage("007", "merchant_oid bulundu ancak odeme henuz siteye bildirilmemis"), stuck);
    assert.equal(paytrRefundErrorMessage(7, null), stuck, "a JSON number");
    const later = "PayTR iadeyi şu an yapamıyor; birkaç dakika sonra tekrar deneyin. (PayTR 000)";
    assert.equal(paytrRefundErrorMessage("000", "iade yapilamiyor, daha sonra tekrar deneyin"), later);
    assert.equal(paytrRefundErrorMessage(0, null), later);
  });
});

// ---------------------------------------------------------------------------------------------------
// Dashboard

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

const render = (t: DashboardTodo, canEditPayments = false) => renderToStaticMarkup(createElement(TodoCard, { todo: t, canEditPayments }));
const refused = { count: 1, windowHours: 72, firstAt: "2026-11-21T09:00:00.000Z", lastAt: "2026-11-21T09:00:00.000Z", kinds: ["bad_hash" as const], merchantOid: null };

describe("R-UX2: the 'Yapılacaklar' header", () => {
  test("never 'her şey yolunda' above a warning line", () => {
    assert.match(text(render(todo())), /Bekleyen iş yok, her şey yolunda/);
    for (const extra of [{ paytrNotifyRefused: refused }, { paytrTestOnLive: 1 }, { paymentSuccessAfterFailure: 1 }] as Partial<DashboardTodo>[]) {
      const t = text(render(todo(extra)));
      assert.match(t, /Bekleyen iş yok; ödeme uyarılarını kontrol edin/, JSON.stringify(extra));
      assert.ok(!t.includes("her şey yolunda"), JSON.stringify(extra));
    }
    const lowStock = text(render(todo({ lowStockVariants: 2 })));
    assert.match(lowStock, /Bekleyen iş yok; düşük stoklu varyantlara göz atın/);
    assert.ok(!lowStock.includes("her şey yolunda"));
    assert.match(text(render(todo({ pendingPayment: 2, paytrTestOnLive: 1 }))), /2 iş sizi bekliyor/, "order work wins");
  });

  test("the refused-notification hint says a single refusal can be a forgery that leaves orders alone (R5)", () => {
    assert.match(text(render(todo({ paytrNotifyRefused: refused }))), /sahte bir istekten de olabilir; o durumda siparişler etkilenmez/);
  });
});

describe("R-UX3 + R-UX8: the C5 and C13a lines", () => {
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

  test("one affected order: the lines open it; admins keep the settings link on the C5 line and get an order line", () => {
    const admin = render(todo({ paytrTestOnLive: 1, paytrTestOnLiveOrderId: 42, paymentSuccessAfterFailure: 1, paymentSuccessAfterFailureOrderId: 43 }), true);
    const t = text(admin);
    assert.match(t, /Canlı siparişe PayTR test ödemesi geldi Test modunu yeniden açıp kaydedin \(Ayarlar › Ödeme yöntemleri\)/, "the action comes first");
    assert.match(t, /Test ödemesi gelen sipariş Siparişi açın ve müşteriyle görüşün: ödeme alınmadı 1/);
    const links = hrefs(admin);
    assert.ok(links.includes("/panel/ayarlar/odeme"));
    assert.ok(links.includes("/panel/siparisler/42"), links.join(" "));
    assert.ok(links.includes("/panel/siparisler/43"), links.join(" "));
    assert.ok(!links.includes("/panel/siparisler"), "never the unfiltered list");

    const staff = render(todo({ paytrTestOnLive: 1, paytrTestOnLiveOrderId: 42 }));
    assert.ok(hrefs(staff).includes("/panel/siparisler/42"), "staff: the C5 line itself opens the order");
    assert.ok(!text(staff).includes("Test ödemesi gelen sipariş"), "no second line for staff");
  });

  test("several orders: the list filtered by the warning", () => {
    const links = hrefs(render(todo({ paytrTestOnLive: 3, paymentSuccessAfterFailure: 2 }), true));
    assert.ok(links.includes("/panel/siparisler?uyari=test-odeme"), links.join(" "));
    assert.ok(links.includes("/panel/siparisler?uyari=basarisiz-sonra-basarili"), links.join(" "));
  });

  test("the list filter's URL value round-trips; the filter counts like the dashboard", () => {
    for (const key of ["testOnLive", "successAfterFailure"] as const) {
      const href = ordersListHref({ alert: key, q: "x", page: 2 });
      const params = new URL(href, "https://panel.test").searchParams;
      assert.equal(orderAlertFromParam(params.get("uyari")), key);
      assert.equal(params.get("ara"), "x");
      assert.equal(params.get("sayfa"), "2");
      assert.ok(ORDER_ALERTS[key].label.length > 0);
    }
    assert.equal(orderAlertFromParam("baska"), null);
    const orders = read("src/app/panel/_lib/orders.ts");
    assert.match(orders, /input\.alert \? paymentEventAlertWhere\(input\.alert, input\.overdueAt\.now\.getTime\(\)\) : undefined/);
    const page = read("src/app/panel/(dashboard)/siparisler/page.tsx");
    assert.match(page, /const alert = orderAlertFromParam\(first\(params\[ORDER_ALERT_PARAM\]\)\);/);
    assert.match(page, /ordersListHref\(\{ tab, q, overdue, alert, page: list\.page \+ 1 \}\)/, "pagination keeps the filter");
    assert.match(page, /name=\{ORDER_ALERT_PARAM\}/, "the search keeps the filter");
  });
});

describe("R-UX5 + R-UX6: storefront strings (tr, en, ar)", () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  test("the retry time also says the order is cancelled shortly after it; {time} is kept", () => {
    for (const [m, word] of [
      [tr, /otomatik iptal edilir/],
      [en, /cancelled automatically/],
      [ar, /سيُلغى الطلب تلقائيًا/],
    ] as const) {
      assert.match(m.checkout.cardPayment.verifyingFormText, word);
      assert.match(m.order.payment.verifyingRetryAt, word);
      assert.deepEqual(placeholders(m.checkout.cardPayment.verifyingFormText), ["time"]);
      assert.deepEqual(placeholders(m.order.payment.verifyingRetryAt), ["time"]);
    }
  });

  test("the poller's failure text never says 'do not pay again'; the resume text names who may go back", () => {
    for (const m of [tr, en, ar]) {
      assert.equal(typeof m.checkout.cardPayment.verifyingFailedText, "string");
      assert.equal(placeholders(m.checkout.cardPayment.verifyingFailedText).length, 0);
    }
    assert.ok(!/tekrar ödeme yapmayın/.test(tr.checkout.cardPayment.verifyingFailedText));
    assert.ok(!/don't pay again/i.test(en.checkout.cardPayment.verifyingFailedText));
    assert.ok(!/عدم الدفع مرة أخرى/.test(ar.checkout.cardPayment.verifyingFailedText));
    assert.match(tr.order.payment.resumeText, /kartınız reddedildiyse[\s\S]*iki kez çekim yapılmaz/);
    assert.match(en.order.payment.resumeText, /declined[\s\S]*won't be charged twice/);
    assert.match(ar.order.payment.resumeText, /رُفضت بطاقتك[\s\S]*مرتين/);

    const poller = read("src/components/checkout/CardReturnPoller.tsx");
    assert.match(poller, /verifying \? \(failed \? labels\.verifyingFailedText : labels\.verifyingText\) : labels\.slowText/);
    assert.match(read("src/app/[locale]/odeme/kart/page.tsx"), /verifyingFailedText: t\.verifyingFailedText,/);
    const panel = read("src/components/order/OrderPaymentPanel.tsx");
    assert.match(panel, /<Link href=\{formHref\} prefetch=\{false\} className=\{buttonClass\("secondary"/, "the resume link is secondary");
  });
});

describe("R-UX3 + R-UX7: panel order texts", () => {
  test("the unverified notice prints the merchant_oids and the e-mail; never the order number as PayTR's key", () => {
    const page = read("src/app/panel/(dashboard)/siparisler/[id]/page.tsx");
    assert.match(page, /order\.paytrUnsettledRefs\.map\(\(ref, i\) =>/);
    assert.match(page, /müşterinin e-postasıyla \(<bdi>\{order\.email\}<\/bdi>\)/);
    assert.ok(!page.includes("sipariş numarasıyla kontrol edin"));
    assert.ok(!page.includes("İşlem &amp; Döküm"), "the menu above İşlemler is named neutrally");
    assert.match(read("src/lib/orders/read.ts"), /paytrUnsettledRefs: paytrAttemptState\(payments, 0\)\.unsettled\.map\(\(a\) => a\.ref\)/);
    const events = read("src/components/panel/orders/OrderEventList.tsx");
    assert.ok(!events.includes("İşlem & Döküm"));
    assert.match(events, /test modunu yeniden açıp kaydedin; PayTR canlı mod onayını SMS\/e-postayla bildirene kadar açık tutun/);
    assert.ok(!events.includes("test modunu açık tutun ve müşteriyle görüşün"));
  });
});

describe("R2, R4, R5 wiring", () => {
  test("R2: the starting marker is checked under the lock and cleared after the start", () => {
    const complete = read("src/lib/payments/complete.ts");
    assert.match(complete, /\.for\("update"\)[\s\S]*options\.notWhileVerifying && \(paytrAttemptState\(rows, now\)\.verifying \|\| attemptStarting\(rows, now\)\)/);
    assert.match(complete, /export const ATTEMPT_STARTING_MS = 60_000;/);
    assert.match(complete, /await recordInitiateRefusal\(prepared\.paymentId, refusal\?\.message \?\? null\);/, "a failed start clears the marker");
  });

  test("R4: the expiry bounds iyzico retrieves by its run deadline, a shorter timeout and a breaker", () => {
    const status = read("src/lib/orders/status.ts");
    assert.match(status, /iyzicoTimeoutMs: 10_000/);
    assert.match(status, /paytrBudget: budget, iyzicoBudget, now/);
    assert.match(read("src/lib/payments/iyzico-gateway.ts"), /signal: AbortSignal\.timeout\(config\.timeoutMs !== undefined && config\.timeoutMs > 0 \? Math\.min\(config\.timeoutMs, TIMEOUT_MS\) : TIMEOUT_MS\)/);
  });

  test("R5: an unreadable notify body is logged, not recorded", () => {
    const http = read("src/lib/payments/http.ts");
    assert.ok(!http.includes("notePaytrNotifyRefusal("), "no refusal record from the HTTP layer");
    assert.match(http, /paytr notify refused: unreadable body/);
    assert.match(read("src/lib/payments/callbacks.ts"), /if \(!\(await isStoredPaytrAttempt\(merchantOid, exec\)\)\) \{/);
  });
});
