// Subscribe and save: the plan discount in the pure price resolver and the money engine, the
// campaign-vs-plan rule, checkout rules (account, allowed methods), display parity and the calendar.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { campaignDisplayPrice } from "@/lib/campaigns/pick";
import { computeCart } from "@/lib/cart/compute";
import { cartRevision } from "@/lib/cart/totals";
import { RETAIL_CUSTOMER, type EngineCampaign, type EngineLine, type EngineSettings } from "@/lib/cart/types";
import { resolveUnitPrice } from "@/lib/pricing/resolve";
import { advanceRunAt, anchorDayOf, firstRunAt, istanbulDay, nextRunAfter, reminderAt, startOfIstanbulDay } from "@/lib/subscriptions/schedule";
import { subscriptionDisplayPrice } from "@/lib/subscriptions/types";
import { BUSINESS, coupon, line, NOW, sample, settings } from "./helpers";

const MONTHLY = { id: 2, percent: 5, interval: "month" as const, intervalCount: 1 };
const SIGNED_IN = { ...RETAIL_CUSTOMER, userId: "user-1" };
const ALL_METHODS = ["card", "bank_transfer", "cash_on_delivery"] as const;

function subSettings(overrides: Partial<NonNullable<EngineSettings["subscriptions"]>> = {}): EngineSettings {
  return { ...settings(), subscriptions: { enabled: true, allowedMethods: [...ALL_METHODS], ...overrides } };
}

const subLine = (overrides: Partial<EngineLine> = {}) => line({ subscriptionPlanId: MONTHLY.id, subscriptionPlan: MONTHLY, ...overrides });

const campaign = (percent: number, overrides: Partial<EngineCampaign> = {}): EngineCampaign => ({
  id: 1,
  percent,
  priority: 0,
  productIds: null,
  categoryIds: null,
  customerGroupIds: null,
  startsAt: null,
  endsAt: null,
  ...overrides,
});

describe("resolveUnitPrice with a plan discount", () => {
  test("the plan discount applies to the resolved price", () => {
    assert.deepEqual(resolveUnitPrice({ basePrice: 14990, subscriptionPercent: 5, quantity: 1 }), {
      unitPrice: 14241, // 14990 × 0.95 = 14240.5 → 14241
      compareAt: 14990,
      appliedRules: [{ kind: "subscription", percent: 5 }],
    });
  });
  test("never stacks with a campaign: the larger percent wins, a tie goes to the plan", () => {
    const campaignWins = resolveUnitPrice({ basePrice: 10000, campaignPercent: 15, subscriptionPercent: 5, quantity: 1 });
    assert.equal(campaignWins.unitPrice, 8500);
    assert.deepEqual(campaignWins.appliedRules, [{ kind: "campaign", percent: 15 }]);
    const planWins = resolveUnitPrice({ basePrice: 10000, campaignPercent: 3, subscriptionPercent: 5, quantity: 1 });
    assert.equal(planWins.unitPrice, 9500);
    assert.deepEqual(planWins.appliedRules, [{ kind: "subscription", percent: 5 }]);
    const tie = resolveUnitPrice({ basePrice: 10000, campaignPercent: 5, subscriptionPercent: 5, quantity: 1 });
    assert.deepEqual(tie.appliedRules, [{ kind: "subscription", percent: 5 }]);
  });
  test("applies after group and tier steps (multiplicative), and a 0 % plan changes nothing", () => {
    const r = resolveUnitPrice({ basePrice: 10000, groupDiscountPercent: 10, tierDiscounts: [{ minQuantity: 3, discountPercent: 10 }], subscriptionPercent: 5, quantity: 3 });
    assert.equal(r.unitPrice, 7695); // 10000 → 9000 → 8100 → 7695
    assert.deepEqual(resolveUnitPrice({ basePrice: 10000, subscriptionPercent: 0, quantity: 1 }), { unitPrice: 10000, appliedRules: [] });
    // garbage percents are clamped like every other step
    assert.equal(resolveUnitPrice({ basePrice: 10000, subscriptionPercent: Number.NaN, quantity: 1 }).unitPrice, 10000);
    assert.equal(resolveUnitPrice({ basePrice: 10000, subscriptionPercent: 150, quantity: 1 }).unitPrice, 0);
  });
});

describe("money engine: subscription lines", () => {
  test("a subscribed line carries the plan discount; coupons apply on top as usual", () => {
    const t = computeCart({ lines: [subLine({ quantity: 2 })], customer: SIGNED_IN, coupon: coupon({ value: 10 }), settings: subSettings(), now: NOW });
    const l = t.lines[0];
    assert.equal(l.unitPrice, 14241);
    assert.deepEqual(l.subscription, { planId: 2, percent: 5, interval: "month", intervalCount: 1, discount: "subscription", campaignPercent: 0 });
    assert.equal(t.subtotal, 28482);
    assert.equal(t.discounts.coupon, 2848); // 10 % of the subscriber subtotal
    assert.equal(t.subscription.lineCount, 1);
    assert.equal(t.checkoutAllowed, true);
    assert.deepEqual(t.issues, []);
  });

  test("a better automatic campaign wins and the line says so", () => {
    const t = computeCart({ lines: [subLine()], customer: SIGNED_IN, coupon: null, campaigns: [campaign(15)], settings: subSettings(), now: NOW });
    const l = t.lines[0];
    assert.equal(l.unitPrice, 12742); // campaign 15 %, not 5 %
    assert.equal(l.subscription?.discount, "campaign");
    assert.equal(l.subscription?.campaignPercent, 15);
    // a weaker campaign loses to the plan
    const weaker = computeCart({ lines: [subLine()], customer: SIGNED_IN, coupon: null, campaigns: [campaign(3)], settings: subSettings(), now: NOW });
    assert.equal(weaker.lines[0].unitPrice, 14241);
    assert.equal(weaker.lines[0].subscription?.discount, "subscription");
  });

  test("one-time lines are unaffected", () => {
    const t = computeCart({ lines: [line()], customer: SIGNED_IN, coupon: null, settings: subSettings(), now: NOW });
    assert.equal(t.lines[0].unitPrice, 14990);
    assert.equal(t.lines[0].subscription, null);
    assert.equal(t.subscription.lineCount, 0);
  });

  test("a subscription needs a signed-in buyer (blocking cart issue)", () => {
    const t = computeCart({ lines: [subLine()], customer: RETAIL_CUSTOMER, coupon: null, settings: subSettings(), now: NOW });
    assert.ok(t.issues.some((i) => i.code === "subscription_sign_in" && i.blocking && i.lineId == null));
    assert.equal(t.subscription.signInRequired, true);
    assert.equal(t.checkoutAllowed, false);
  });

  test("only subscriptions.allowedMethods can pay a cart with a subscription line", () => {
    const t = computeCart({ lines: [subLine()], customer: SIGNED_IN, coupon: null, settings: subSettings({ allowedMethods: ["card"] }), now: NOW });
    const by = Object.fromEntries(t.paymentMethods.map((m) => [m.method, m]));
    assert.equal(by.card.available, true);
    assert.equal(by.bank_transfer.reason, "subscription");
    assert.equal(by.cash_on_delivery.reason, "subscription");
    // the method's own reason comes first (deferred stays hidden for retail buyers)
    assert.equal(by.deferred.reason, "not_eligible");
    // deferred is never a subscription method, even for approved companies
    const b2b = computeCart({ lines: [subLine()], customer: { ...BUSINESS, userId: "b1" }, coupon: null, settings: subSettings(), now: NOW });
    assert.equal(b2b.paymentMethods.find((m) => m.method === "deferred")?.reason, "subscription");
    // no allowed method at all → checkout blocked
    const none = computeCart({ lines: [subLine()], customer: SIGNED_IN, coupon: null, settings: subSettings({ allowedMethods: [] }), now: NOW });
    assert.equal(none.checkoutAllowed, false);
  });

  test("subscriptions off, an unusable plan or a sample: a one-time purchase with an informational issue", () => {
    const off = computeCart({ lines: [subLine()], customer: SIGNED_IN, coupon: null, settings: subSettings({ enabled: false }), now: NOW });
    assert.equal(off.lines[0].unitPrice, 14990);
    assert.equal(off.lines[0].subscription, null);
    assert.ok(off.issues.some((i) => i.code === "subscription_unavailable" && !i.blocking));
    assert.equal(off.checkoutAllowed, true);
    // engine settings without subscriptions = off
    const absent = computeCart({ lines: [subLine()], customer: SIGNED_IN, coupon: null, settings: settings(), now: NOW });
    assert.equal(absent.lines[0].subscription, null);
    // the stored plan is no longer usable (inactive plan / product stopped offering it)
    const gone = computeCart({ lines: [line({ subscriptionPlanId: 9, subscriptionPlan: null })], customer: SIGNED_IN, coupon: null, settings: subSettings(), now: NOW });
    assert.equal(gone.lines[0].subscription, null);
    assert.ok(gone.issues.some((i) => i.code === "subscription_unavailable"));
    // a plan for another id than the stored one is ignored
    const mismatch = computeCart({ lines: [line({ subscriptionPlanId: 3, subscriptionPlan: MONTHLY })], customer: SIGNED_IN, coupon: null, settings: subSettings(), now: NOW });
    assert.equal(mismatch.lines[0].subscription, null);
    // free samples are never subscribed
    const withSample = computeCart({ lines: [subLine(), sample({ subscriptionPlanId: MONTHLY.id, subscriptionPlan: MONTHLY })], customer: SIGNED_IN, coupon: null, settings: subSettings(), now: NOW });
    assert.equal(withSample.lines[1].subscription, null);
    assert.equal(withSample.subscription.lineCount, 1);
  });

  test("the cart revision names the plan (switching a line to a plan is another order)", () => {
    const once = computeCart({ lines: [line({ lineId: 1, variantId: 7, quantity: 2 })], customer: SIGNED_IN, coupon: null, settings: subSettings(), now: NOW });
    const sub = computeCart({ lines: [subLine({ lineId: 1, variantId: 7, quantity: 2 })], customer: SIGNED_IN, coupon: null, settings: subSettings(), now: NOW });
    assert.equal(cartRevision(once), "7:2|");
    assert.equal(cartRevision(sub), "7:2:s2|");
  });
});

describe("display parity: product page = cart = renewal", () => {
  test("subscriptionDisplayPrice equals the engine's unit price for one unit (retail)", () => {
    for (const price of [14990, 44990, 149990, 9999, 1]) {
      for (const camp of [null, 3, 5, 15]) {
        for (const plan of [0, 5, 10]) {
          const shown = subscriptionDisplayPrice({ price, compareAtPrice: null }, camp, plan);
          const t = computeCart({
            lines: [line({ basePrice: price, subscriptionPlanId: 1, subscriptionPlan: { ...MONTHLY, id: 1, percent: plan } })],
            customer: SIGNED_IN,
            coupon: null,
            campaigns: camp ? [campaign(camp)] : [],
            settings: subSettings(),
            now: NOW,
          });
          assert.equal(shown.unitPrice, t.lines[0].unitPrice, `price ${price}, campaign ${camp}, plan ${plan}`);
          assert.equal(shown.discount, t.lines[0].subscription?.discount);
        }
      }
    }
  });
  test("the one-time price next to it is the campaign display price", () => {
    assert.equal(campaignDisplayPrice({ price: 14990 }, 15).unitPrice, 12742);
    assert.equal(subscriptionDisplayPrice({ price: 14990 }, 15, 5).unitPrice, 12742);
    assert.equal(subscriptionDisplayPrice({ price: 14990 }, null, 5).unitPrice, 14241);
  });
});

describe("renewal calendar (Europe/Istanbul)", () => {
  const at = (iso: string) => new Date(iso);
  test("months keep the day of month, clamped to the month's length", () => {
    const monthly = { interval: "month" as const, intervalCount: 1 };
    assert.equal(advanceRunAt(at("2026-01-31T09:00:00+03:00"), monthly).toISOString(), "2026-02-28T06:00:00.000Z");
    assert.equal(advanceRunAt(at("2028-01-31T09:00:00+03:00"), monthly).toISOString(), "2028-02-29T06:00:00.000Z");
    assert.equal(advanceRunAt(at("2026-11-15T12:00:00+03:00"), { interval: "month", intervalCount: 2 }).toISOString(), "2027-01-15T09:00:00.000Z");
    // 00:30 Istanbul is still the previous day in UTC: the Istanbul calendar day decides
    assert.equal(advanceRunAt(at("2026-03-31T00:30:00+03:00"), monthly).toISOString(), "2026-04-29T21:30:00.000Z");
  });
  test("weeks add 7 × n days", () => {
    assert.equal(advanceRunAt(at("2026-11-10T10:00:00Z"), { interval: "week", intervalCount: 2 }).toISOString(), "2026-11-24T10:00:00.000Z");
  });
  test("renewals start at 00:00 Istanbul of the renewal day", () => {
    const first = firstRunAt(at("2026-11-10T15:42:00+03:00"), { interval: "month", intervalCount: 1 });
    assert.equal(first.toISOString(), "2026-12-09T21:00:00.000Z"); // 10 Dec 00:00 +03:00
    assert.equal(istanbulDay(first), "2026-12-10");
    assert.equal(startOfIstanbulDay(at("2026-11-10T22:30:00Z")).toISOString(), "2026-11-10T21:00:00.000Z");
  });
  test("monthly renewals return to the subscription's own day after a short month (anchor day)", () => {
    const monthly = { interval: "month" as const, intervalCount: 1 };
    const chain = (start: string, plan: { interval: "month"; intervalCount: number }, n: number) => {
      const created = at(start);
      const anchor = anchorDayOf(created);
      let run = firstRunAt(created, plan);
      const days = [istanbulDay(run)];
      for (let i = 1; i < n; i++) {
        run = nextRunAfter(run, plan, run, anchor);
        days.push(istanbulDay(run));
      }
      return days;
    };
    assert.deepEqual(chain("2027-01-31T15:00:00+03:00", monthly, 6), ["2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31", "2027-06-30", "2027-07-31"]);
    assert.deepEqual(chain("2026-12-31T10:00:00+03:00", { interval: "month", intervalCount: 2 }, 4), ["2027-02-28", "2027-04-30", "2027-06-30", "2027-08-31"]);
    assert.deepEqual(chain("2027-01-15T10:00:00+03:00", monthly, 3), ["2027-02-15", "2027-03-15", "2027-04-15"], "control: an ordinary day never moves");
    assert.equal(anchorDayOf(at("2027-01-31T22:30:00Z")), 1, "the Istanbul calendar day decides (01:30 on 1 Feb)");
    // A renewal on another day than the anchor (e.g. resumed on the 20th) keeps that day.
    assert.equal(istanbulDay(nextRunAfter(at("2027-03-19T21:00:00Z"), monthly, at("2027-03-19T21:00:00Z"), 31)), "2027-04-20");
    // Without an anchor the old behaviour stays (existing callers).
    assert.equal(istanbulDay(nextRunAfter(at("2027-02-27T21:00:00Z"), monthly, at("2027-02-27T21:00:00Z"))), "2027-03-28");
  });

  test("missed periods never produce several renewals: the next run moves past now", () => {
    const next = nextRunAfter(at("2026-01-10T21:00:00Z"), { interval: "month", intervalCount: 1 }, at("2026-05-20T12:00:00Z"));
    assert.equal(next.toISOString(), "2026-06-10T21:00:00.000Z");
    assert.equal(reminderAt(next, 3).toISOString(), "2026-06-07T21:00:00.000Z");
  });
});
