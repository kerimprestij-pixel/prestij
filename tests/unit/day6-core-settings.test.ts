// Day 6 CORE: the `giftWheel` settings document. Storefront schema defaults (wheel off, the six default
// slices of contract §1.1), the panel schema's range rules with Turkish messages at the field paths,
// datetime handling (Istanbul input → ISO), text overrides, and the per-field repair of stored documents.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { giftWheelSettingsInput, settingsPayloadSchema, SETTINGS_INPUTS } from "@/lib/panel/settings/schemas";
import {
  GIFT_WHEEL_DEFAULT_SLICES,
  defaultGiftWheelSlices,
  parseSettings,
  settingsSchemas,
  WHEEL_LIMITS,
  type Settings,
} from "@/lib/settings/types";

type Wheel = Settings<"giftWheel">;
const defaults = (): Wheel => settingsSchemas.giftWheel.parse({});

function issues(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of result.error?.issues ?? []) out[i.path.map(String).join(".")] ??= i.message;
  return out;
}

const withSlices = (slices: unknown[]) => ({ ...defaults(), slices });
const slice = (over: Record<string, unknown> = {}) => ({
  key: "test",
  label: { tr: "%10 indirim" },
  type: "percent",
  value: 10,
  minOrderTotal: 0,
  weight: 10,
  tone: "brand",
  ...over,
});
const fourSlices = (first: Record<string, unknown>) => [slice({ key: "a", ...first }), slice({ key: "b" }), slice({ key: "c" }), slice({ key: "d" })];

describe("giftWheel storefront defaults", () => {
  test("off by default, with the six slices, weights and minimums of the contract", () => {
    const d = defaults();
    assert.equal(d.enabled, false);
    assert.equal(d.startsAt, null);
    assert.equal(d.endsAt, null);
    assert.equal(d.audience, "new_customers");
    assert.equal(d.showToBusiness, false);
    assert.deepEqual(
      d.slices.map((s) => [s.label.tr, s.type, s.value, s.minOrderTotal, s.weight]),
      [
        ["%5 indirim", "percent", 5, 0, 35],
        ["%10 indirim", "percent", 10, 0, 25],
        ["Ücretsiz kargo", "free_shipping", 0, 0, 20],
        ["%15 indirim", "percent", 15, 0, 10],
        ["50 TL indirim", "fixed", 5000, 30000, 7],
        ["%20 indirim", "percent", 20, 75000, 3],
      ],
    );
    assert.deepEqual(
      { validityHours: d.validityHours, holdDays: d.holdDays, teaserDelaySeconds: d.teaserDelaySeconds, autoOpenSeconds: d.autoOpenSeconds },
      { validityHours: 72, holdDays: 7, teaserDelaySeconds: 6, autoOpenSeconds: 25 },
    );
    assert.equal(d.exitIntent, true);
    assert.equal(d.autoOpenCooldownDays, 7);
    assert.equal(d.round, 1);
    assert.deepEqual(d.texts, {});
    assert.equal(d.reminderEnabled, true);
  });

  test("every default slice has en and ar labels, a unique key and no two equal tones side by side", () => {
    const keys = new Set(GIFT_WHEEL_DEFAULT_SLICES.map((s) => s.key));
    assert.equal(keys.size, GIFT_WHEEL_DEFAULT_SLICES.length);
    for (const s of GIFT_WHEEL_DEFAULT_SLICES) {
      assert.ok(s.label.en && s.label.ar, s.key);
      assert.ok(s.label.tr.length <= WHEEL_LIMITS.labelMax && s.weight >= 1, s.key);
      assert.ok(!/[٠-٩]/.test(s.label.ar ?? ""), `${s.key}: Western digits in Arabic`);
    }
    GIFT_WHEEL_DEFAULT_SLICES.forEach((s, i) => {
      const next = GIFT_WHEEL_DEFAULT_SLICES[(i + 1) % GIFT_WHEEL_DEFAULT_SLICES.length];
      assert.notEqual(s.tone, next.tone, `${s.key} / ${next.key}`);
    });
  });

  test("defaults are fresh copies (editing one parse never changes the next)", () => {
    const a = defaults();
    a.slices[0].label.tr = "değişti";
    assert.equal(defaults().slices[0].label.tr, "%5 indirim");
    assert.equal(GIFT_WHEEL_DEFAULT_SLICES[0].label.tr, "%5 indirim");
    assert.notEqual(defaultGiftWheelSlices()[0], defaultGiftWheelSlices()[0]);
  });

  test("a broken stored field falls back on its own; the rest of the document is kept", () => {
    const stored = { ...defaults(), enabled: true, round: 4, slices: [{ ...GIFT_WHEEL_DEFAULT_SLICES[0], weight: 0 }] };
    const parsed = parseSettings("giftWheel", stored);
    assert.equal(parsed.enabled, true);
    assert.equal(parsed.round, 4);
    assert.equal(parsed.slices.length, 6, "invalid slices → the default slices");
    const wrongValue = parseSettings("giftWheel", { ...defaults(), slices: fourSlices({ type: "free_shipping", value: 500 }) });
    assert.equal(wrongValue.slices.length, 6, "a free-shipping slice with a value is invalid");
    const badDate = parseSettings("giftWheel", { ...defaults(), enabled: true, startsAt: "yarın" });
    assert.equal(badDate.startsAt, null);
    assert.equal(badDate.enabled, true);
  });
});

describe("giftWheel panel schema", () => {
  test("is registered and its output parses unchanged with the storefront schema", () => {
    assert.equal(SETTINGS_INPUTS.giftWheel, giftWheelSettingsInput);
    const parsed = giftWheelSettingsInput.parse(defaults());
    assert.deepEqual(settingsSchemas.giftWheel.parse(parsed), parsed);
  });

  test("4–8 slices; duplicate and malformed keys are refused on the slice", () => {
    const three = issues(giftWheelSettingsInput.safeParse(withSlices([slice({ key: "a" }), slice({ key: "b" }), slice({ key: "c" })])));
    assert.match(three.slices, /en az 4 dilim/);
    const nine = issues(giftWheelSettingsInput.safeParse(withSlices(Array.from({ length: 9 }, (_, i) => slice({ key: `k${i}` })))));
    assert.match(nine.slices, /en fazla 8 dilim/);
    const dup = issues(giftWheelSettingsInput.safeParse(withSlices([slice({ key: "a" }), slice({ key: "b" }), slice({ key: "A " }), slice({ key: "d" })])));
    assert.match(dup["slices.2.key"], /başka bir dilimde/);
    const bad = issues(giftWheelSettingsInput.safeParse(withSlices(fourSlices({ key: "yüzde 10" }))));
    assert.match(bad["slices.0.key"], /küçük harf/);
  });

  test("prize values: percent 1–50, fixed ≥ 1 TL (kuruş or a TL amount), free shipping stored as 0", () => {
    const value = (first: Record<string, unknown>) => giftWheelSettingsInput.safeParse(withSlices(fourSlices(first)));
    assert.match(issues(value({ value: 0 }))["slices.0.value"], /1 ile 50/);
    assert.match(issues(value({ value: 51 }))["slices.0.value"], /1 ile 50/);
    assert.match(issues(value({ value: 12.5 }))["slices.0.value"], /1 ile 50/);
    assert.equal(value({ value: 50 }).data?.slices[0].value, 50);
    assert.match(issues(value({ type: "fixed", value: 99 }))["slices.0.value"], /en az 1 TL/);
    assert.equal(value({ type: "fixed", value: 5000 }).data?.slices[0].value, 5000);
    assert.equal(value({ type: "fixed", value: "50,00" }).data?.slices[0].value, 5000);
    assert.equal(value({ type: "free_shipping", value: 1234 }).data?.slices[0].value, 0);
    assert.ok(issues(value({ type: "spin_again" }))["slices.0.type"], "only the three prize types (every slice wins)");
  });

  test("weights 1–1000, labels: Turkish required, at most 40 characters, tone from the four", () => {
    const one = (first: Record<string, unknown>) => issues(giftWheelSettingsInput.safeParse(withSlices(fourSlices(first))));
    assert.match(one({ weight: 0 })["slices.0.weight"], /en az 1/);
    assert.match(one({ weight: 1001 })["slices.0.weight"], /en fazla 1000/);
    assert.match(one({ label: { tr: "", en: "10% off" } })["slices.0.label.tr"], /Türkçe metnini/);
    assert.match(one({ label: { tr: "x".repeat(41) } })["slices.0.label.tr"], /En fazla 40/);
    assert.ok(one({ tone: "red" })["slices.0.tone"]);
    const ok = giftWheelSettingsInput.parse(withSlices(fourSlices({ label: { tr: "  %10 indirim ", en: "", ar: "خصم 10%" } })));
    assert.deepEqual(ok.slices[0].label, { tr: "%10 indirim", ar: "خصم 10%" });
  });

  test("ranges of the numeric fields", () => {
    const field = (over: Record<string, unknown>) => issues(giftWheelSettingsInput.safeParse({ ...defaults(), ...over }));
    assert.match(field({ validityHours: 23 }).validityHours, /en az 24/);
    assert.match(field({ validityHours: 721 }).validityHours, /en fazla 720/);
    assert.match(field({ holdDays: 0 }).holdDays, /en az 1/);
    assert.match(field({ holdDays: 31 }).holdDays, /en fazla 30/);
    assert.match(field({ teaserDelaySeconds: 121 }).teaserDelaySeconds, /en fazla 120/);
    assert.match(field({ autoOpenSeconds: 301 }).autoOpenSeconds, /en fazla 300/);
    assert.equal(field({ autoOpenSeconds: 0 }).autoOpenSeconds, undefined, "0 = never opens by itself");
    assert.match(field({ autoOpenCooldownDays: 0 }).autoOpenCooldownDays, /en az 1/);
    assert.match(field({ round: 0 }).round, /en az 1/);
    assert.ok(field({ audience: "guests" }).audience);
  });

  test("schedule: Istanbul datetime-local or ISO → ISO strings; the end must be after the start", () => {
    const parsed = giftWheelSettingsInput.parse({ ...defaults(), startsAt: "2026-12-01T09:00", endsAt: "2026-12-31T23:59:00.000Z" });
    assert.equal(parsed.startsAt, "2026-12-01T06:00:00.000Z");
    assert.equal(parsed.endsAt, "2026-12-31T23:59:00.000Z");
    assert.equal(giftWheelSettingsInput.parse({ ...defaults(), startsAt: "", endsAt: null }).startsAt, null);
    const reversed = issues(giftWheelSettingsInput.safeParse({ ...defaults(), startsAt: "2026-12-02T09:00", endsAt: "2026-12-01T09:00" }));
    assert.match(reversed.endsAt, /başlangıçtan sonra/);
    assert.ok(settingsSchemas.giftWheel.safeParse(parsed).success);
  });

  test("text overrides: empty means the dictionary default; a translation needs Turkish first", () => {
    const parsed = giftWheelSettingsInput.parse({
      ...defaults(),
      texts: { title: { tr: " Kış Çarkı ", en: "Winter Wheel" }, subtitle: { tr: "", en: "", ar: "" }, teaser: null },
    });
    assert.deepEqual(parsed.texts.title, { tr: "Kış Çarkı", en: "Winter Wheel" });
    assert.equal(parsed.texts.subtitle, undefined);
    assert.equal(parsed.texts.teaser, undefined);
    const noTr = issues(giftWheelSettingsInput.safeParse({ ...defaults(), texts: { claimCta: { tr: "", en: "Claim" } } }));
    assert.match(noTr["texts.claimCta.tr"], /Önce Türkçe/);
    const long = issues(giftWheelSettingsInput.safeParse({ ...defaults(), texts: { teaser: { tr: "x".repeat(61) } } }));
    assert.match(long["texts.teaser.tr"], /En fazla 60/);
    const missing = giftWheelSettingsInput.parse({ ...defaults(), texts: undefined });
    assert.deepEqual(JSON.parse(JSON.stringify(missing.texts)), {});
  });

  test("the action payload keeps error paths at the top level", async () => {
    const result = await settingsPayloadSchema("giftWheel").safeParseAsync({ ...defaults(), holdDays: 99, updatedAt: null });
    assert.equal(result.success, false);
    assert.ok(issues(result).holdDays);
    const ok = await settingsPayloadSchema("giftWheel").parseAsync({ ...defaults(), enabled: true, updatedAt: null });
    assert.equal(ok.value.enabled, true);
    assert.equal(ok.updatedAt, null);
  });
});
