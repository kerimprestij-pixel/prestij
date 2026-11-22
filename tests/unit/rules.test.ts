// Coupons (pure rules), TR validators, customer context, order numbers and the status machine.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { couponEligibility, eligibleCouponLines, normalizeCouponCode } from "@/lib/coupons/eligibility";
import { resolveCustomerContext } from "@/lib/customer/resolve";
import { RETAIL_CUSTOMER } from "@/lib/cart/types";
import { formatOrderNumber, isOrderNumber, normalizeOrderNumber } from "@/lib/orders/number";
import { allowedActions, buildTimeline, checkTransition, ORDER_ACTIONS, ORDER_STATUSES, ORDER_TRANSITIONS } from "@/lib/orders/status-machine";
import { findProvince, formatIban, isValidIban, isValidTckn, isValidVkn, normalizeTrPhone, TR_PROVINCES } from "@/lib/validation/tr";
import { coupon, NOW } from "./helpers";

describe("coupon rules", () => {
  const lines = [
    { lineId: 1, productId: 1, categoryId: 1, isSample: false, lineSubtotal: 14990 },
    { lineId: 2, productId: 2, categoryId: 2, isSample: false, lineSubtotal: 44990 },
    { lineId: 3, productId: 90, categoryId: 4, isSample: true, lineSubtotal: 0 },
  ];

  test("codes are trimmed, de-spaced and upper-cased", () => {
    assert.equal(normalizeCouponCode("  hos geldin 10 "), "HOSGELDIN10");
    assert.equal(normalizeCouponCode(42), "");
    assert.equal(normalizeCouponCode("x".repeat(100)).length, 64);
  });

  test("eligible lines: products OR categories, never samples", () => {
    assert.deepEqual(
      eligibleCouponLines(coupon(), lines).map((l) => l.lineId),
      [1, 2],
    );
    assert.deepEqual(
      eligibleCouponLines(coupon({ productIds: [2] }), lines).map((l) => l.lineId),
      [2],
    );
    assert.deepEqual(
      eligibleCouponLines(coupon({ productIds: [2], categoryIds: [1] }), lines).map((l) => l.lineId),
      [1, 2],
    );
    assert.deepEqual(eligibleCouponLines(coupon({ productIds: [90] }), lines), []);
    assert.deepEqual(eligibleCouponLines(coupon({ productIds: [], categoryIds: [] }), lines).length, 2, "empty lists mean all");
  });

  test("reasons are reported in a fixed order", () => {
    const ctx = { lines, subtotal: 59980, customer: RETAIL_CUSTOMER, now: NOW };
    const reason = (c: Parameters<typeof coupon>[0]) => {
      const r = couponEligibility(coupon(c), ctx);
      return r.valid ? "valid" : r.reason;
    };
    assert.equal(reason({}), "valid");
    assert.equal(reason({ isActive: false, endsAt: NOW }), "inactive");
    assert.equal(reason({ startsAt: new Date(NOW.getTime() + 60_000), maxUses: 0 }), "not_started");
    assert.equal(reason({ endsAt: new Date(NOW.getTime() - 1), maxUses: 0 }), "expired");
    assert.equal(reason({ maxUses: 3, usedCount: 3, customerGroupIds: [2] }), "exhausted");
    assert.equal(reason({ customerGroupIds: [2], minOrderTotal: 999999 }), "group_not_allowed");
    assert.equal(reason({ minOrderTotal: 59981, productIds: [77] }), "min_order");
    assert.equal(reason({ productIds: [77] }), "no_eligible_items");
    const r = couponEligibility(coupon({ productIds: [1] }), ctx);
    assert.equal(r.eligibleSubtotal, 14990);
  });
});

describe("TR validators", () => {
  test("TCKN checksum", () => {
    assert.equal(isValidTckn("10000000146"), true);
    assert.equal(isValidTckn("10000000147"), false);
    assert.equal(isValidTckn("11111111111"), false, "the e-Arşiv placeholder is not a real TCKN");
    assert.equal(isValidTckn("01234567890"), false, "cannot start with 0");
    assert.equal(isValidTckn("1000000014"), false);
    assert.equal(isValidTckn("1000000014a"), false);
    assert.equal(isValidTckn(10000000146), false);
  });

  test("VKN check digit", () => {
    for (const ok of ["1234567890", "0000000001", "9999999994", "4829173050"]) assert.equal(isValidVkn(ok), true, ok);
    for (const bad of ["1234567891", "123456789", "12345678901", "abcdefghij", ""]) assert.equal(isValidVkn(bad), false, bad);
  });

  test("phone normalization to +905xxxxxxxxx", () => {
    for (const v of ["0532 123 45 67", "05321234567", "5321234567", "+90 532 123 45 67", "+905321234567", "905321234567", "0090 532 123 4567", "(0532) 123-45-67"]) {
      assert.equal(normalizeTrPhone(v), "+905321234567", v);
    }
    for (const v of ["0352 353 30 70", "123", "+1 202 555 0100", "05321234", "053212345678", "abc5321234567", "", null]) {
      assert.equal(normalizeTrPhone(v), null, String(v));
    }
  });

  test("IBAN (TR, mod-97)", () => {
    assert.equal(isValidIban("TR330006100519786457841326"), true);
    assert.equal(isValidIban("tr33 0006 1005 1978 6457 8413 26"), true);
    assert.equal(isValidIban("TR330006100519786457841327"), false);
    assert.equal(isValidIban("DE89370400440532013000"), false, "valid German IBAN, but not TR");
    assert.equal(isValidIban("TR33000610051978645784132"), false);
    assert.equal(formatIban("tr330006100519786457841326"), "TR33 0006 1005 1978 6457 8413 26");
  });

  test("81 provinces with plate codes; lookup is case and Turkish-letter insensitive", () => {
    assert.equal(TR_PROVINCES.length, 81);
    assert.deepEqual(
      TR_PROVINCES.map((p) => p.code),
      Array.from({ length: 81 }, (_, i) => i + 1),
    );
    assert.equal(new Set(TR_PROVINCES.map((p) => p.name)).size, 81);
    assert.equal(findProvince("Kayseri")?.code, 38);
    assert.equal(findProvince("38")?.name, "Kayseri");
    assert.equal(findProvince(6)?.name, "Ankara");
    assert.equal(findProvince("06")?.name, "Ankara");
    assert.equal(findProvince("İSTANBUL")?.code, 34);
    assert.equal(findProvince("istanbul")?.code, 34);
    assert.equal(findProvince("Izmir")?.code, 35);
    assert.equal(findProvince("sanliurfa")?.name, "Şanlıurfa");
    assert.equal(findProvince("Hakkari")?.name, "Hakkâri");
    assert.equal(findProvince("ISPARTA")?.code, 32);
    assert.equal(findProvince("Atlantis"), null);
    assert.equal(findProvince("82"), null);
    assert.equal(findProvince(""), null);
  });
});

describe("customer context", () => {
  const user = { id: "u1", customerGroupId: null, companyId: 7 };
  const company = { id: 7, status: "approved" as const, groupId: 2, paymentTerms: { allowDeferred: true, days: 30 } };
  const group = { id: 2, slug: "kurumsal", discountPercent: 15, isBusiness: true, showPricesExVat: true };
  const b2b = { enabled: true, requireApproval: true };

  test("no session → retail", () => {
    assert.deepEqual(resolveCustomerContext({ user: null, company: null, group: null, b2b }), RETAIL_CUSTOMER);
  });
  test("approved company gets its group and deferred terms", () => {
    const c = resolveCustomerContext({ user, company, group, b2b });
    assert.equal(c.groupId, 2);
    assert.equal(c.groupDiscountPercent, 15);
    assert.equal(c.isBusiness, true);
    assert.equal(c.allowDeferred, true);
    assert.equal(c.deferredDays, 30);
  });
  test("requireApproval: pending company → no group, no deferred", () => {
    const c = resolveCustomerContext({ user, company: { ...company, status: "pending" }, group, b2b });
    assert.equal(c.groupId, null);
    assert.equal(c.groupDiscountPercent, 0);
    assert.equal(c.allowDeferred, false);
  });
  test("without requireApproval the user's group applies; B2B disabled → none", () => {
    const solo = { id: "u2", customerGroupId: 2, companyId: null };
    assert.equal(resolveCustomerContext({ user: solo, company: null, group, b2b: { enabled: true, requireApproval: false } }).groupId, 2);
    assert.equal(resolveCustomerContext({ user: solo, company: null, group, b2b: { enabled: true, requireApproval: true } }).groupId, null);
    assert.equal(resolveCustomerContext({ user, company, group, b2b: { enabled: false, requireApproval: false } }).groupId, null);
  });
  test("a company row that is not the user's is ignored", () => {
    assert.equal(resolveCustomerContext({ user: { ...user, companyId: 8 }, company, group, b2b }).companyApproved, false);
  });
});

describe("order numbers", () => {
  test("PR-YY + sequence padded to 4 (Türkiye year)", () => {
    assert.equal(formatOrderNumber(1001, new Date("2026-06-01T00:00:00Z")), "PR-261001");
    assert.equal(formatOrderNumber(7, new Date("2026-06-01T00:00:00Z")), "PR-260007");
    assert.equal(formatOrderNumber(12345, new Date("2026-06-01T00:00:00Z")), "PR-2612345");
    // 31 Dec 22:30 UTC is already 1 Jan in Istanbul (UTC+3).
    assert.equal(formatOrderNumber(1001, new Date("2026-12-31T22:30:00Z")), "PR-271001");
    assert.throws(() => formatOrderNumber(0, NOW));
  });
  test("normalization of typed numbers", () => {
    assert.equal(normalizeOrderNumber(" pr-261001 "), "PR-261001");
    assert.equal(normalizeOrderNumber("PR261001"), "PR-261001");
    assert.equal(normalizeOrderNumber("261001"), "PR-261001");
    assert.equal(normalizeOrderNumber("PR-26"), null);
    assert.equal(normalizeOrderNumber("'; drop table orders;--"), null);
    assert.equal(isOrderNumber("PR-261001"), true);
  });
});

describe("status machine", () => {
  const order = (status: (typeof ORDER_STATUSES)[number], paidAt: string | null = null) => ({ status, paidAt });

  test("every action has a rule; refunds need admin", () => {
    for (const a of ORDER_ACTIONS) assert.ok(ORDER_TRANSITIONS[a]);
    assert.equal(ORDER_TRANSITIONS.mark_refunded.minRole, "admin");
  });

  test("vadeli (deferred): the invoice payment is recorded later without a status change, once", () => {
    const deferred = (status: (typeof ORDER_STATUSES)[number], paidAt: string | null = null) => ({ status, paidAt, paymentMethod: "deferred" as const });
    for (const status of ["processing", "shipped", "delivered"] as const) {
      assert.deepEqual(checkTransition(deferred(status), "mark_paid", "staff"), { ok: true, to: status, restock: false }, status);
      assert.deepEqual(checkTransition(deferred(status, "2026-12-10T10:00:00Z"), "mark_paid", "staff"), { ok: false, code: "invalid_transition" }, `${status}: already paid`);
    }
    assert.ok(allowedActions(deferred("delivered"), "staff").includes("mark_paid"));
    // Once paid, a return can be recorded (refund needs paidAt).
    assert.deepEqual(checkTransition(deferred("delivered", "2026-12-10T10:00:00Z"), "mark_refunded", "admin"), { ok: true, to: "refunded", restock: false });
    assert.equal(checkTransition(deferred("cancelled"), "mark_paid", "staff").ok, false);
    // Other methods keep the strict rule.
    assert.equal(checkTransition({ status: "delivered", paidAt: null, paymentMethod: "cash_on_delivery" as const }, "mark_paid", "staff").ok, false);
    assert.equal(checkTransition({ status: "processing", paidAt: null, paymentMethod: "card" as const }, "mark_paid", "admin").ok, false);
  });

  test("happy paths", () => {
    assert.deepEqual(checkTransition(order("awaiting_transfer"), "mark_paid", "staff"), { ok: true, to: "paid", restock: false });
    assert.deepEqual(checkTransition(order("pending_payment"), "mark_paid", "staff"), { ok: true, to: "paid", restock: false });
    assert.deepEqual(checkTransition(order("paid"), "start_processing", "staff"), { ok: true, to: "processing", restock: false });
    assert.deepEqual(checkTransition(order("processing"), "ship", "staff"), { ok: true, to: "shipped", restock: false });
    assert.deepEqual(checkTransition(order("paid"), "ship", "editor"), { ok: true, to: "shipped", restock: false });
    assert.deepEqual(checkTransition(order("shipped"), "deliver", "staff"), { ok: true, to: "delivered", restock: false });
    assert.deepEqual(checkTransition(order("delivered"), "add_note", "staff"), { ok: true, to: "delivered", restock: false });
  });

  test("cancel restocks from every cancellable status; after shipping only an unpaid parcel that came back", () => {
    for (const s of ["pending_payment", "awaiting_transfer", "paid", "processing"] as const) {
      assert.deepEqual(checkTransition(order(s), "cancel", "staff"), { ok: true, to: "cancelled", restock: true }, s);
    }
    // Kapıda ödeme refused at the door: unpaid, shipped → cancel puts the goods back.
    assert.deepEqual(checkTransition(order("shipped"), "cancel", "staff"), { ok: true, to: "cancelled", restock: true });
    assert.deepEqual(checkTransition(order("shipped", NOW.toISOString()), "cancel", "admin"), { ok: false, code: "invalid_transition" });
    for (const s of ["delivered", "cancelled", "refunded"] as const) {
      assert.deepEqual(checkTransition(order(s), "cancel", "admin"), { ok: false, code: "invalid_transition" }, s);
    }
  });

  test("refunds need money that was received: unpaid kapıda ödeme / deferred orders are never 'refunded'", () => {
    for (const s of ["paid", "processing", "shipped", "delivered", "cancelled"] as const) {
      assert.deepEqual(checkTransition(order(s), "mark_refunded", "admin"), { ok: false, code: "not_paid" }, s);
      assert.equal(checkTransition(order(s, NOW.toISOString()), "mark_refunded", "admin").ok, true, s);
    }
    assert.deepEqual(allowedActions(order("shipped"), "admin"), ["deliver", "cancel", "add_note"]);
    assert.deepEqual(allowedActions(order("shipped", NOW.toISOString()), "admin"), ["deliver", "mark_refunded", "add_note"]);
  });

  test("refunds: admin only; restock only when the goods never left; cancelled needs a payment", () => {
    assert.deepEqual(checkTransition(order("delivered", NOW.toISOString()), "mark_refunded", "staff"), { ok: false, code: "forbidden" });
    assert.deepEqual(checkTransition(order("delivered", NOW.toISOString()), "mark_refunded", "editor"), { ok: false, code: "forbidden" });
    assert.deepEqual(checkTransition(order("delivered", NOW.toISOString()), "mark_refunded", "admin"), { ok: true, to: "refunded", restock: false });
    assert.deepEqual(checkTransition(order("paid", NOW.toISOString()), "mark_refunded", "admin"), { ok: true, to: "refunded", restock: true });
    assert.deepEqual(checkTransition(order("cancelled"), "mark_refunded", "admin"), { ok: false, code: "not_paid" });
    assert.deepEqual(checkTransition(order("cancelled", NOW.toISOString()), "mark_refunded", "admin"), { ok: true, to: "refunded", restock: false });
    assert.deepEqual(checkTransition(order("pending_payment"), "mark_refunded", "admin"), { ok: false, code: "invalid_transition" });
  });

  test("invalid jumps", () => {
    assert.equal(checkTransition(order("awaiting_transfer"), "ship", "admin").ok, false);
    assert.equal(checkTransition(order("pending_payment"), "deliver", "admin").ok, false);
    assert.equal(checkTransition(order("refunded"), "mark_paid", "admin").ok, false);
    assert.equal(checkTransition(order("paid"), "mark_paid", "admin").ok, false);
  });

  test("allowed actions per role", () => {
    assert.deepEqual(allowedActions(order("awaiting_transfer"), "staff"), ["mark_paid", "cancel", "add_note"]);
    assert.deepEqual(allowedActions(order("processing"), "staff"), ["ship", "cancel", "add_note"]);
    assert.deepEqual(allowedActions(order("processing"), "admin"), ["ship", "cancel", "add_note"], "unpaid (kapıda ödeme): no refund");
    assert.deepEqual(allowedActions(order("processing", NOW.toISOString()), "admin"), ["ship", "cancel", "mark_refunded", "add_note"]);
    assert.deepEqual(allowedActions(order("cancelled"), "admin"), ["add_note"]);
    assert.deepEqual(allowedActions(order("cancelled", NOW.toISOString()), "admin"), ["mark_refunded", "add_note"]);
  });

  test("timeline for a card order in progress and a cancelled one", () => {
    const base = { paymentMethod: "card" as const, createdAt: "2026-11-06T10:00:00.000Z", paidAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null };
    const pending = buildTimeline({ ...base, status: "pending_payment" });
    assert.deepEqual(
      pending.map((s) => `${s.key}:${s.state}`),
      ["placed:done", "paid:current", "processing:upcoming", "shipped:upcoming", "delivered:upcoming"],
    );
    const shipped = buildTimeline({ ...base, status: "shipped", paidAt: "2026-11-06T10:05:00.000Z", shippedAt: "2026-11-07T09:00:00.000Z" }, [
      { type: "status_changed", data: { to: "processing" }, createdAt: "2026-11-06T12:00:00.000Z" },
    ]);
    assert.deepEqual(
      shipped.map((s) => `${s.key}:${s.state}`),
      ["placed:done", "paid:done", "processing:done", "shipped:done", "delivered:current"],
    );
    assert.equal(shipped[2].at, "2026-11-06T12:00:00.000Z");
    const cod = buildTimeline({ ...base, paymentMethod: "cash_on_delivery", status: "processing" });
    assert.deepEqual(
      cod.map((s) => `${s.key}:${s.state}`),
      ["placed:done", "processing:done", "shipped:current", "delivered:upcoming"],
    );
    const cancelled = buildTimeline({ ...base, status: "cancelled", cancelledAt: "2026-11-06T10:40:00.000Z" });
    assert.deepEqual(
      cancelled.map((s) => `${s.key}:${s.state}`),
      ["placed:done", "paid:skipped", "processing:skipped", "shipped:skipped", "delivered:skipped", "cancelled:done"],
    );
  });
});
