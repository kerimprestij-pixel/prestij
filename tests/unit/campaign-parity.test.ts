// Parity: the price a static storefront page shows (pickDisplayCampaign + campaignDisplayPrice) is the
// unit price the cart engine charges a retail buyer for one unit; and moving the campaign choice into
// src/lib/campaigns/pick.ts kept the engine's behaviour identical (checked against a frozen copy of
// the day-2 implementation, for retail and group buyers).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { campaignDisplayPrice, pickDisplayCampaign } from "@/lib/campaigns/pick";
import { computeCart } from "@/lib/cart/compute";
import type { CustomerContext, EngineCampaign, EngineLine } from "@/lib/cart/types";
import { BUSINESS, input, line, NOW, rng } from "./helpers";

/** Day-2 campaignFor from src/lib/cart/compute.ts, verbatim (the reference the refactor must match). */
function legacyCampaignFor(line: EngineLine, customer: CustomerContext, campaigns: readonly EngineCampaign[], now: number): number | null {
  const listed = (list: number[] | null | undefined) => Array.isArray(list) && list.length > 0;
  let best: EngineCampaign | null = null;
  for (const c of campaigns) {
    if (c.startsAt && now < c.startsAt.getTime()) continue;
    if (c.endsAt && now >= c.endsAt.getTime()) continue;
    if (listed(c.customerGroupIds) && (customer.groupId == null || !c.customerGroupIds!.includes(customer.groupId))) continue;
    const scoped = listed(c.productIds) || listed(c.categoryIds);
    const matches =
      !scoped ||
      (listed(c.productIds) && c.productIds!.includes(line.productId)) ||
      (listed(c.categoryIds) && line.categoryId != null && c.categoryIds!.includes(line.categoryId));
    if (!matches) continue;
    if (!best || c.priority > best.priority || (c.priority === best.priority && c.percent > best.percent)) best = c;
  }
  return best ? best.percent : null;
}

const HOUR = 3_600_000;
const pickFrom = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)];

function randomIds(r: () => number, pool: number[]): number[] | null {
  const roll = r();
  if (roll < 0.4) return null;
  if (roll < 0.5) return [];
  return pool.filter(() => r() < 0.4);
}

function randomCampaigns(r: () => number, n: number): EngineCampaign[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    percent: 1 + Math.floor(r() * 90),
    priority: Math.floor(r() * 3),
    productIds: randomIds(r, [1, 2, 3, 4]),
    categoryIds: randomIds(r, [10, 11, 12]),
    customerGroupIds: r() < 0.25 ? pickFrom(r, [[2], [3], [2, 3]]) : r() < 0.1 ? [] : null,
    startsAt: r() < 0.3 ? new Date(NOW.getTime() + (r() - 0.6) * 10 * HOUR) : null,
    endsAt: r() < 0.3 ? new Date(NOW.getTime() + (r() - 0.3) * 10 * HOUR) : null,
  }));
}

describe("display price == cart unit price (retail, quantity 1)", () => {
  test("a 15 % campaign on one product: card, product page and cart agree", () => {
    const campaigns: EngineCampaign[] = [
      { id: 1, percent: 15, priority: 0, productIds: [7], categoryIds: null, customerGroupIds: null, startsAt: null, endsAt: null },
    ];
    const variant = { price: 14990, compareAtPrice: null };
    const shown = campaignDisplayPrice(variant, pickDisplayCampaign(campaigns, { productId: 7, categoryId: 1 }, NOW.getTime())?.percent);
    const cart = computeCart(input([line({ productId: 7, categoryId: 1, basePrice: 14990 })], { campaigns }));
    assert.equal(shown.unitPrice, 12742);
    assert.equal(cart.lines[0].unitPrice, shown.unitPrice);
    assert.equal(cart.lines[0].compareAt, shown.compareAt);
    assert.equal(cart.subtotal, 12742);
  });

  test("randomized: every product × campaign mix, prices with odd kuruş and compare-at prices", () => {
    const r = rng(20261109);
    for (let round = 0; round < 400; round++) {
      const campaigns = randomCampaigns(r, Math.floor(r() * 5));
      const productId = 1 + Math.floor(r() * 4);
      const categoryId = r() < 0.15 ? null : pickFrom(r, [10, 11, 12]);
      const basePrice = 1 + Math.floor(r() * 2_000_000);
      const compareAtPrice = r() < 0.3 ? basePrice + Math.floor((r() - 0.3) * 50_000) : null;

      const hit = pickDisplayCampaign(campaigns, { productId, categoryId }, NOW.getTime());
      const shown = campaignDisplayPrice({ price: basePrice, compareAtPrice }, hit?.percent);
      const cart = computeCart(input([line({ productId, categoryId, basePrice, compareAtPrice, quantity: 1 })], { campaigns }));
      const cartLine = cart.lines[0];
      const context = `round ${round}: ${JSON.stringify({ productId, categoryId, basePrice, compareAtPrice, campaigns })}`;
      assert.equal(cartLine.unitPrice, shown.unitPrice, context);
      assert.equal(cartLine.compareAt, shown.compareAt ?? null, context);
      assert.deepEqual(cartLine.appliedRules, shown.appliedRules, context);
    }
  });

  test("a customer-group campaign changes the cart of that group only, never the display", () => {
    const campaigns: EngineCampaign[] = [
      { id: 1, percent: 20, priority: 5, productIds: null, categoryIds: null, customerGroupIds: [2], startsAt: null, endsAt: null },
      { id: 2, percent: 10, priority: 0, productIds: null, categoryIds: null, customerGroupIds: null, startsAt: null, endsAt: null },
    ];
    const shown = campaignDisplayPrice({ price: 10000 }, pickDisplayCampaign(campaigns, { productId: 1, categoryId: 10 }, NOW.getTime())?.percent);
    const retail = computeCart(input([line({ basePrice: 10000 })], { campaigns }));
    const business = computeCart(input([line({ basePrice: 10000 })], { campaigns, customer: BUSINESS }));
    assert.equal(shown.unitPrice, 9000);
    assert.equal(retail.lines[0].unitPrice, 9000);
    assert.equal(business.lines[0].unitPrice, 6800); // group 15 % then the group campaign 20 %
  });
});

describe("the extracted choice matches the day-2 engine exactly", () => {
  test("randomized: same campaign percent and unit price for retail and group buyers, any time", () => {
    const r = rng(42);
    for (let round = 0; round < 600; round++) {
      const campaigns = randomCampaigns(r, Math.floor(r() * 6));
      const customer = pickFrom(r, [input([]).customer, BUSINESS, { ...BUSINESS, groupId: 3, groupDiscountPercent: 22 }]);
      const now = new Date(NOW.getTime() + (r() - 0.5) * 12 * HOUR);
      const l = line({
        productId: 1 + Math.floor(r() * 4),
        categoryId: r() < 0.15 ? null : pickFrom(r, [10, 11, 12]),
        basePrice: 1 + Math.floor(r() * 500_000),
        quantity: 1 + Math.floor(r() * 30),
        tiers: r() < 0.3 ? [{ minQuantity: 6, discountPercent: 5, groupId: null }] : [],
      });
      const expectedPercent = legacyCampaignFor(l, customer, campaigns, now.getTime());
      const cart = computeCart(input([l], { campaigns, customer, now }));
      const applied = cart.lines[0].appliedRules.find((rule) => rule.kind === "campaign");
      assert.equal(applied?.kind === "campaign" ? applied.percent : null, expectedPercent && expectedPercent > 0 ? expectedPercent : null, `round ${round}`);
    }
  });
});
