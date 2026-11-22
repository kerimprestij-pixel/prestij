// src/lib/campaigns/pick.ts and display.ts: the campaign choice, its schedule-aware cache lifetime and
// the badge wording.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { campaignBadgeText, formatPercentOff } from "@/lib/campaigns/display";
import {
  campaignAllowsGroup,
  campaignCacheProfile,
  campaignCovers,
  campaignDisplayPrice,
  hasCustomerGroups,
  isCampaignLive,
  nextCampaignChange,
  pickCampaign,
  pickDisplayCampaign,
  type CampaignRule,
} from "@/lib/campaigns/pick";
import type { EngineCampaign } from "@/lib/cart/types";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (offset: number) => new Date(NOW + offset);

let nextId = 1;
function campaign(overrides: Partial<EngineCampaign> = {}): EngineCampaign {
  return {
    id: nextId++,
    percent: 10,
    priority: 0,
    productIds: null,
    categoryIds: null,
    customerGroupIds: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

const LAVANTA = { productId: 1, categoryId: 10 };

describe("campaign window", () => {
  test("start is inclusive, end exclusive, missing bounds are open", () => {
    assert.equal(isCampaignLive(campaign(), NOW), true);
    assert.equal(isCampaignLive(campaign({ startsAt: at(0) }), NOW), true);
    assert.equal(isCampaignLive(campaign({ startsAt: at(1) }), NOW), false);
    assert.equal(isCampaignLive(campaign({ endsAt: at(0) }), NOW), false);
    assert.equal(isCampaignLive(campaign({ endsAt: at(1) }), NOW), true);
    assert.equal(isCampaignLive(campaign({ startsAt: at(-DAY), endsAt: at(DAY) }), NOW), true);
  });
});

describe("campaign scope", () => {
  test("no product and no category list covers every product (empty lists count as none)", () => {
    assert.equal(campaignCovers(campaign(), LAVANTA), true);
    assert.equal(campaignCovers(campaign({ productIds: [], categoryIds: [] }), LAVANTA), true);
    assert.equal(campaignCovers(campaign(), { productId: 5, categoryId: null }), true);
  });
  test("listed product OR listed (direct) category", () => {
    assert.equal(campaignCovers(campaign({ productIds: [1] }), LAVANTA), true);
    assert.equal(campaignCovers(campaign({ productIds: [2] }), LAVANTA), false);
    assert.equal(campaignCovers(campaign({ categoryIds: [10] }), LAVANTA), true);
    assert.equal(campaignCovers(campaign({ categoryIds: [11] }), LAVANTA), false);
    assert.equal(campaignCovers(campaign({ productIds: [2], categoryIds: [10] }), LAVANTA), true);
    assert.equal(campaignCovers(campaign({ productIds: [1], categoryIds: [11] }), LAVANTA), true);
    assert.equal(campaignCovers(campaign({ categoryIds: [10] }), { productId: 1, categoryId: null }), false);
  });
  test("customer groups: none = everyone; listed = members only", () => {
    assert.equal(campaignAllowsGroup(campaign(), null), true);
    assert.equal(campaignAllowsGroup(campaign({ customerGroupIds: [] }), null), true);
    assert.equal(campaignAllowsGroup(campaign({ customerGroupIds: [2] }), null), false);
    assert.equal(campaignAllowsGroup(campaign({ customerGroupIds: [2] }), 3), false);
    assert.equal(campaignAllowsGroup(campaign({ customerGroupIds: [2, 3] }), 3), true);
    assert.equal(hasCustomerGroups(campaign({ customerGroupIds: [2] })), true);
    assert.equal(hasCustomerGroups(campaign({ customerGroupIds: [] })), false);
  });
});

describe("pickCampaign", () => {
  test("highest priority wins, then highest percent, then the earlier one", () => {
    const low = campaign({ percent: 40, priority: 0 });
    const high = campaign({ percent: 5, priority: 2 });
    const highBigger = campaign({ percent: 15, priority: 2 });
    const highBiggerTwin = campaign({ percent: 15, priority: 2 });
    const ctx = { groupId: null, now: NOW };
    assert.equal(pickCampaign([low, high], LAVANTA, ctx), high);
    assert.equal(pickCampaign([low, high, highBigger], LAVANTA, ctx), highBigger);
    assert.equal(pickCampaign([highBigger, highBiggerTwin], LAVANTA, ctx), highBigger);
    assert.equal(pickCampaign([highBiggerTwin, highBigger], LAVANTA, ctx), highBiggerTwin);
  });
  test("skips campaigns outside their window, scope or group", () => {
    const ended = campaign({ percent: 50, priority: 9, endsAt: at(0) });
    const future = campaign({ percent: 50, priority: 9, startsAt: at(MIN) });
    const otherProduct = campaign({ percent: 50, priority: 9, productIds: [2] });
    const business = campaign({ percent: 50, priority: 9, customerGroupIds: [2] });
    const plain = campaign({ percent: 10 });
    const all = [ended, future, otherProduct, business, plain];
    assert.equal(pickCampaign(all, LAVANTA, { groupId: null, now: NOW }), plain);
    assert.equal(pickCampaign(all, LAVANTA, { groupId: 2, now: NOW }), business);
    assert.equal(pickCampaign([ended, future], LAVANTA, { groupId: null, now: NOW }), null);
    assert.equal(pickCampaign([], LAVANTA, { groupId: null, now: NOW }), null);
  });
  test("the storefront display never shows a customer-group campaign", () => {
    const business = campaign({ percent: 30, priority: 5, customerGroupIds: [2] });
    const retail = campaign({ percent: 10, priority: 0 });
    assert.equal(pickDisplayCampaign([business, retail], LAVANTA, NOW), retail);
    assert.equal(pickDisplayCampaign([business], LAVANTA, NOW), null);
  });
  test("works with any row shape that has the rule fields (StorefrontCampaign)", () => {
    const rows: (CampaignRule & { id: number; label: { tr: string } | null })[] = [
      { id: 7, label: { tr: "Bahar" }, percent: 15, priority: 1, productIds: [1], categoryIds: null, customerGroupIds: null, startsAt: null, endsAt: null },
    ];
    assert.equal(pickDisplayCampaign(rows, LAVANTA, NOW)?.id, 7);
  });
});

describe("campaignDisplayPrice", () => {
  test("percent off with the engine's rounding; struck price = max(regular, compare-at)", () => {
    assert.deepEqual(campaignDisplayPrice({ price: 14990 }, 15), {
      unitPrice: 12742, // 12741.5 → 12742
      compareAt: 14990,
      appliedRules: [{ kind: "campaign", percent: 15 }],
    });
    assert.equal(campaignDisplayPrice({ price: 14990, compareAtPrice: 17990 }, 10).compareAt, 17990);
    assert.equal(campaignDisplayPrice({ price: 14990, compareAtPrice: 9990 }, 10).compareAt, 14990);
  });
  test("no campaign: the regular price, compare-at only when higher", () => {
    assert.deepEqual(campaignDisplayPrice({ price: 14990 }, null), { unitPrice: 14990, appliedRules: [] });
    assert.deepEqual(campaignDisplayPrice({ price: 14990, compareAtPrice: 17990 }, undefined), {
      unitPrice: 14990,
      compareAt: 17990,
      appliedRules: [],
    });
    assert.equal(campaignDisplayPrice({ price: 14990, compareAtPrice: 14990 }, 0).compareAt, undefined);
  });
});

describe("schedule-aware cache lifetime", () => {
  test("nextCampaignChange: the nearest future start or end", () => {
    assert.equal(nextCampaignChange([], NOW), null);
    assert.equal(nextCampaignChange([campaign()], NOW), null);
    assert.equal(nextCampaignChange([campaign({ startsAt: at(-DAY), endsAt: at(-HOUR) })], NOW), null);
    assert.equal(nextCampaignChange([campaign({ startsAt: at(-DAY), endsAt: at(2 * DAY) }), campaign({ startsAt: at(3 * HOUR) })], NOW), NOW + 3 * HOUR);
    assert.equal(nextCampaignChange([campaign({ endsAt: at(0) })], NOW), null, "a bound exactly at now is not upcoming");
  });
  test("the longest profile whose revalidate interval ends before the change", () => {
    const profileFor = (offset: number) => campaignCacheProfile([campaign({ startsAt: at(offset) })], NOW);
    assert.equal(campaignCacheProfile([], NOW), "max");
    assert.equal(campaignCacheProfile([campaign()], NOW), "max");
    assert.equal(profileFor(10_000), "minutes");
    assert.equal(profileFor(30 * MIN), "minutes");
    assert.equal(profileFor(59 * MIN), "minutes");
    assert.equal(profileFor(HOUR), "hours");
    assert.equal(profileFor(23 * HOUR), "hours");
    assert.equal(profileFor(2 * DAY), "days");
    assert.equal(profileFor(10 * DAY), "weeks");
    assert.equal(profileFor(29 * DAY), "weeks");
    assert.equal(profileFor(40 * DAY), "max");
    assert.equal(campaignCacheProfile([campaign({ startsAt: at(-DAY), endsAt: at(20 * MIN) })], NOW), "minutes");
  });
});

describe("badge text", () => {
  test("the label in this locale, else the localized percent (never the Turkish label abroad)", () => {
    const c = { percent: 15, label: { tr: "Bahar İndirimi", en: "Spring Sale" } };
    assert.equal(campaignBadgeText(c, "tr"), "Bahar İndirimi");
    assert.equal(campaignBadgeText(c, "en"), "Spring Sale");
    assert.equal(campaignBadgeText(c, "ar"), formatPercentOff(15, "ar"));
    assert.equal(campaignBadgeText({ percent: 15, label: null }, "tr"), "−%15");
    assert.equal(campaignBadgeText({ percent: 15, label: { tr: "  " } }, "tr"), "−%15");
  });
  test("formatPercentOff uses a minus sign and the locale's percent pattern", () => {
    assert.equal(formatPercentOff(15, "tr"), "−%15");
    assert.equal(formatPercentOff(15, "en"), "−15%");
    assert.match(formatPercentOff(15, "ar"), /−15/);
  });
});
