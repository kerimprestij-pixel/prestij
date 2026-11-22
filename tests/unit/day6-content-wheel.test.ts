// Day 6 CONTENT: the live giftWheel document (scripts/seed-data/gift-wheel.ts) that the seed (buildSettings)
// and scripts/content-day6.ts (giftWheelConfig) store for the client's database, and the registration of the
// three CONTENT steps. The code default stays off (contract §1.1 "Defaults").
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { launchChecklist as launchSteps } from "@/lib/panel/seo/launch";
import { giftWheelSettingsInput } from "@/lib/panel/settings/schemas";
import { GIFT_WHEEL_DEFAULT_SLICES, parseSettings, settingsSchemas } from "@/lib/settings/types";
import { DAY6_LAUNCH_STEP_KEYS, launchChecklist, STEPS } from "../../scripts/content-day6";
import { describeGiftWheel, describeSlice, giftWheelLiveSettings, giftWheelSeedInput } from "../../scripts/seed-data/gift-wheel";
import { buildSettings } from "../../scripts/seed-data/site";

describe("live giftWheel document", () => {
  test("the wheel on with the six default slices; every other field is the code default", () => {
    const live = giftWheelLiveSettings();
    const defaults = settingsSchemas.giftWheel.parse({});
    assert.equal(defaults.enabled, false, "the code default (no row) keeps the wheel off");
    assert.equal(live.enabled, true);
    assert.deepEqual(live.slices, GIFT_WHEEL_DEFAULT_SLICES);
    assert.deepEqual({ ...live, enabled: defaults.enabled }, defaults, "only `enabled` differs from the code defaults");
    assert.deepEqual(
      { startsAt: live.startsAt, endsAt: live.endsAt, audience: live.audience, showToBusiness: live.showToBusiness, validityHours: live.validityHours, holdDays: live.holdDays, round: live.round, texts: live.texts },
      { startsAt: null, endsAt: null, audience: "new_customers", showToBusiness: false, validityHours: 72, holdDays: 7, round: 1, texts: {} },
    );
  });

  test("the slices are contract §1.1 'Defaults': every slice wins, weights 35/25/20/10/7/3", () => {
    const slices = giftWheelLiveSettings().slices;
    assert.deepEqual(
      slices.map((s) => [s.type, s.value, s.minOrderTotal, s.weight]),
      [
        ["percent", 5, 0, 35],
        ["percent", 10, 0, 25],
        ["free_shipping", 0, 0, 20],
        ["percent", 15, 0, 10],
        ["fixed", 5000, 30000, 7],
        ["percent", 20, 75000, 3],
      ],
    );
    for (const s of slices) {
      assert.ok(s.weight >= 1, `${s.key}: can land`);
      assert.ok(s.label.tr && s.label.en && s.label.ar, `${s.key}: labelled in tr/en/ar`);
    }
  });

  test("stored as a complete document the storefront reads back unchanged and the panel editor accepts", () => {
    const live = giftWheelLiveSettings();
    assert.deepEqual(parseSettings("giftWheel", JSON.parse(JSON.stringify(live))), live, "a jsonb round trip changes nothing");
    const edited = giftWheelSettingsInput.safeParse(live);
    assert.ok(edited.success, JSON.stringify(edited.error?.issues));
    assert.deepEqual(settingsSchemas.giftWheel.parse(edited.data), live, "saving it unchanged in the panel stores the same document");
  });

  test("the seed stores the same document as the content script (a fresh database matches the client's)", () => {
    const seeded = buildSettings({ logoLightId: 1, logoDarkId: 2, ogImageId: null }).giftWheel;
    assert.deepEqual(seeded, giftWheelLiveSettings());
    assert.deepEqual(settingsSchemas.giftWheel.parse(giftWheelSeedInput()), seeded);
  });

  test("a fresh copy per call (the default slices are never shared or mutated)", () => {
    const a = giftWheelLiveSettings();
    a.slices[0].label.tr = "değişti";
    a.slices.pop();
    const b = giftWheelLiveSettings();
    assert.equal(b.slices.length, 6);
    assert.equal(b.slices[0].label.tr, "%5 indirim");
    assert.equal(GIFT_WHEEL_DEFAULT_SLICES[0].label.tr, "%5 indirim");
  });

  test("the report line names the state, every slice with its minimum and weight, validity and round", () => {
    const line = describeGiftWheel(giftWheelLiveSettings());
    assert.match(line, /^gift wheel on, 6 slices \(/);
    assert.ok(line.includes("50 TL indirim (en az 300 TL) ×7"), line);
    assert.ok(line.includes("%20 indirim (en az 750 TL) ×3"), line);
    assert.ok(line.includes("prize valid 72 h") && line.includes("round 1"), line);
    assert.equal(describeSlice(GIFT_WHEEL_DEFAULT_SLICES[2]), "Ücretsiz kargo ×20");
    assert.match(describeGiftWheel({ ...giftWheelLiveSettings(), enabled: false }), /^gift wheel off/);
  });
});

describe("content-day6 CONTENT steps", () => {
  test("registered in run order: the terms page exists before the wheel links to it", () => {
    assert.deepEqual(
      STEPS.map((s) => [s.key, s.owner]),
      [
        ["wheelTerms", "CONTENT"],
        ["giftWheelConfig", "CONTENT"],
        ["launchChecklist", "CONTENT"],
      ],
    );
  });

  test("launchChecklist stores nothing and names the day-6 checklist steps that exist in code", async () => {
    const report = await launchChecklist(undefined as never);
    assert.deepEqual([report.inserted, report.updated], [[], []]);
    assert.equal(report.skipped.length, 1);
    const keys = launchSteps({ origin: "https://prestij.com.tr", verification: { google: "", bing: "", yandex: "" }, socialLinks: 0, indexNow: "missing", address: "" }).map((s) => s.key);
    for (const key of DAY6_LAUNCH_STEP_KEYS) {
      assert.ok(keys.includes(key), key);
      assert.ok(report.skipped[0].includes(key), key);
    }
  });
});
