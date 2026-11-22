// Day 6 WHEEL-PANEL: the slice editing helpers of Hediye Çarkı → Ayarlar and the payload the editor
// sends. Labels in tr/en/ar from the prize, automatic and stable keys, colours, "Toplamı 100 yap", the
// plain-language warnings, and the input schema as the form uses it: every state the editor can produce
// is accepted, and every refusal comes back at the path of the field that shows it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  adjacentSameTone,
  defaultValueFor,
  isAutoLabel,
  missingLabelLocales,
  newSlice,
  nextTone,
  normalizeWeightsTo100,
  sliceKeyFromLabel,
  sliceWarnings,
  suggestSliceLabel,
  weightTotal,
  withPrize,
  withSliceKeys,
} from "@/lib/panel/gift-wheel/slices";
import { settingsPayloadSchema } from "@/lib/panel/settings/schemas";
import { GIFT_WHEEL_DEFAULT_SLICES, settingsSchemas, WHEEL_SLICE_KEY_PATTERN, type GiftWheelSlice, type Settings } from "@/lib/settings/types";
import { wheelSliceShares } from "@/lib/wheel/types";

type Wheel = Settings<"giftWheel">;
const defaults = (): Wheel => settingsSchemas.giftWheel.parse({});
const fresh = (): GiftWheelSlice[] => defaults().slices;

describe("labels from the prize", () => {
  test("percent, fixed (whole and with kuruş) and free shipping, in the default slices' wording", () => {
    assert.deepEqual(suggestSliceLabel("percent", 10), { tr: "%10 indirim", en: "10% off", ar: "خصم 10%" });
    assert.deepEqual(suggestSliceLabel("fixed", 5000), { tr: "50 TL indirim", en: "₺50 off", ar: "خصم 50 ليرة" });
    assert.deepEqual(suggestSliceLabel("fixed", 4990), { tr: "49,90 TL indirim", en: "₺49.90 off", ar: "خصم 49.90 ليرة" });
    assert.deepEqual(suggestSliceLabel("fixed", 150000), { tr: "1.500 TL indirim", en: "₺1,500 off", ar: "خصم 1,500 ليرة" });
    assert.deepEqual(suggestSliceLabel("free_shipping", 0), { tr: "Ücretsiz kargo", en: "Free shipping", ar: "شحن مجاني" });
  });

  test("every default slice carries the automatic label, so editing its prize updates all three languages", () => {
    for (const s of GIFT_WHEEL_DEFAULT_SLICES) assert.ok(isAutoLabel(s.label, s.type, s.value), s.key);
  });

  test("labels fit the 40-character limit and use Western digits in Arabic", () => {
    for (const [type, value] of [["percent", 50], ["fixed", 99_999_999], ["free_shipping", 0]] as const) {
      const l = suggestSliceLabel(type, value);
      for (const text of [l.tr, l.en ?? "", l.ar ?? ""]) assert.ok(text.length <= 40, text);
      assert.ok(!/[٠-٩]/.test(l.ar ?? ""));
    }
  });

  test("withPrize: the automatic label follows, a written label is kept, a type change picks a fitting value", () => {
    const s = fresh()[1]; // %10 indirim
    const more = withPrize(s, { value: 12 });
    assert.equal(more.value, 12);
    assert.deepEqual(more.label, { tr: "%12 indirim", en: "12% off", ar: "خصم 12%" });

    const fixed = withPrize(s, { type: "fixed" });
    assert.equal(fixed.type, "fixed");
    assert.equal(fixed.value, defaultValueFor("fixed"));
    assert.equal(fixed.label.tr, "50 TL indirim");

    const shipping = withPrize(fixed, { type: "free_shipping" });
    assert.equal(shipping.value, 0);
    assert.equal(shipping.label.tr, "Ücretsiz kargo");

    const custom = { ...s, label: { tr: "Sürpriz %10", en: "Surprise 10%" } };
    const kept = withPrize(custom, { value: 15 });
    assert.equal(kept.value, 15);
    assert.deepEqual(kept.label, custom.label);

    const empty = withPrize({ ...s, label: { tr: "" } }, { value: 20 });
    assert.equal(empty.label.tr, "%20 indirim", "an empty label is filled in");
  });
});

describe("slice keys", () => {
  test("from the Turkish label: lower-case ASCII, hyphens, at most 24 characters, valid pattern", () => {
    assert.equal(sliceKeyFromLabel("%10 indirim"), "10-indirim");
    assert.equal(sliceKeyFromLabel("Ücretsiz Kargo"), "ucretsiz-kargo");
    assert.equal(sliceKeyFromLabel("50 TL İndirim & Hediye"), "50-tl-indirim-ve-hediye");
    assert.equal(sliceKeyFromLabel(""), "dilim");
    assert.equal(sliceKeyFromLabel("%%%"), "dilim");
    const long = sliceKeyFromLabel("Çok uzun bir dilim metni olabilir mi acaba");
    assert.ok(long.length <= 24 && WHEEL_SLICE_KEY_PATTERN.test(long), long);
  });

  test("saved keys never change; new slices follow their label; copies and clashes get a suffix", () => {
    const saved = fresh();
    const locked = new Set(saved.map((s) => s.key));
    assert.equal(withSliceKeys(saved, locked), saved, "nothing to change → the same array");

    const relabelled = saved.map((s, i) => (i === 0 ? { ...s, label: { tr: "Yeni metin" } } : s));
    assert.equal(withSliceKeys(relabelled, locked)[0].key, "indirim-5", "a saved slice keeps its key when relabelled");

    const added = withSliceKeys([...saved, { ...newSlice(saved), label: { tr: "%7 indirim" } }], locked);
    assert.equal(added[6].key, "7-indirim");

    const copy = withSliceKeys([saved[0], { ...saved[0] }, ...saved.slice(1)], locked);
    assert.equal(copy[0].key, "indirim-5");
    assert.notEqual(copy[1].key, "indirim-5", "a duplicated slice gets its own key");
    assert.equal(new Set(copy.map((s) => s.key)).size, copy.length);

    const twins = withSliceKeys(
      [{ key: "", label: { tr: "Hediye" } }, { key: "", label: { tr: "Hediye" } }, { key: "", label: { tr: "Hediye" } }],
      new Set(),
    );
    assert.deepEqual(twins.map((s) => s.key), ["hediye", "hediye-2", "hediye-3"]);
  });

  test("a new slice never inherits the key (and statistics) of a removed saved slice", () => {
    const locked = new Set(["10-indirim"]);
    const next = withSliceKeys([{ key: "", label: { tr: "%10 indirim" } }], locked);
    assert.equal(next[0].key, "10-indirim-2");
  });

  test("suffixes stay within 24 characters and the key pattern", () => {
    const label = { tr: "abcdefghijklmnopqrstuvwxyz" };
    const list = withSliceKeys([{ key: "", label }, { key: "", label }], new Set());
    for (const s of list) assert.ok(s.key.length <= 24 && WHEEL_SLICE_KEY_PATTERN.test(s.key), s.key);
    assert.notEqual(list[0].key, list[1].key);
  });
});

describe("colours", () => {
  test("a new slice gets a colour different from both future neighbours", () => {
    const slices = fresh(); // cream, brand, gold, ink, cream, brand
    const tone = nextTone(slices);
    assert.notEqual(tone, slices[slices.length - 1].tone);
    assert.notEqual(tone, slices[0].tone);
    assert.equal(adjacentSameTone([...slices, { ...newSlice(slices) }]).length, 0);
  });

  test("neighbours with the same colour are reported, including the last and the first slice", () => {
    assert.deepEqual(adjacentSameTone(fresh()), []);
    const tones = (list: GiftWheelSlice["tone"][]) => list.map((tone) => ({ tone }));
    assert.deepEqual(adjacentSameTone(tones(["brand", "brand", "gold", "ink"])), [[0, 1]]);
    assert.deepEqual(adjacentSameTone(tones(["brand", "gold", "ink", "brand"])), [[3, 0]]);
  });
});

describe("weights", () => {
  test("the defaults already add up to 100, so each weight reads as a percentage", () => {
    const slices = fresh();
    assert.equal(weightTotal(slices), 100);
    assert.deepEqual(wheelSliceShares(slices), slices.map((s) => s.weight));
    assert.deepEqual(normalizeWeightsTo100(slices.map((s) => s.weight)), slices.map((s) => s.weight));
  });

  test("Toplamı 100 yap: exact total, every weight at least 1, shares kept as closely as possible", () => {
    for (const weights of [[1, 1, 1], [2, 2, 2, 2, 2, 2, 2], [1000, 1, 1, 1], [70, 50, 30, 10], [3, 7, 11, 13, 17, 19, 23, 29], [999, 999, 1, 1]]) {
      const out = normalizeWeightsTo100(weights);
      assert.equal(out.reduce((a, b) => a + b, 0), 100, `${weights} → ${out}`);
      assert.ok(out.every((w) => Number.isInteger(w) && w >= 1), `${weights} → ${out}`);
      const total = weights.reduce((a, b) => a + b, 0);
      // Within one point per slice of the exact share (the "at least 1" floor may take a little from the largest).
      weights.forEach((w, i) => assert.ok(Math.abs(out[i] - (w / total) * 100) <= weights.length, `${weights} → ${out}`));
    }
    assert.deepEqual(normalizeWeightsTo100([1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(normalizeWeightsTo100([1000, 1, 1, 1]), [97, 1, 1, 1]);
    assert.deepEqual(normalizeWeightsTo100([]), []);
  });
});

describe("warnings and missing translations", () => {
  test("allowed but probably unintended prizes are explained; the defaults need no warning", () => {
    for (const s of GIFT_WHEEL_DEFAULT_SLICES) assert.deepEqual(sliceWarnings(s), [], s.key);
    assert.equal(sliceWarnings({ type: "fixed", value: 5000, minOrderTotal: 0 }).length, 1);
    assert.match(sliceWarnings({ type: "fixed", value: 5000, minOrderTotal: 5000 })[0], /eşit ya da ondan büyük/);
    assert.match(sliceWarnings({ type: "percent", value: 40, minOrderTotal: 0 })[0], /%40/);
    assert.deepEqual(sliceWarnings({ type: "percent", value: 40, minOrderTotal: 50000 }), []);
    assert.deepEqual(sliceWarnings({ type: "free_shipping", value: 0, minOrderTotal: 0 }), []);
  });

  test("missing English/Arabic labels are listed", () => {
    assert.deepEqual(missingLabelLocales({ tr: "x", en: "y", ar: "z" }), []);
    assert.deepEqual(missingLabelLocales({ tr: "x", en: " " }), ["en", "ar"]);
  });
});

describe("the editor's payload (settingsPayloadSchema('giftWheel'))", () => {
  const schema = settingsPayloadSchema("giftWheel");
  type Issue = { path: PropertyKey[]; message: string };
  const paths = (issues: Issue[]) => Object.fromEntries(issues.map((i) => [i.path.map(String).join("."), i.message]));
  const send = async (state: Record<string, unknown>) => schema.safeParseAsync({ ...state, updatedAt: null });

  test("the loaded state (defaults, no row yet) saves unchanged", async () => {
    const result = await send(defaults());
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(settingsSchemas.giftWheel.parse(result.data.value), result.data.value);
      assert.equal(result.data.updatedAt, null);
    }
  });

  test("states the helpers produce are accepted: new slice, prize change, copy, normalised weights, cleared texts", async () => {
    const base = defaults();
    const locked = new Set(base.slices.map((s) => s.key));
    let slices = withSliceKeys([...base.slices, newSlice(base.slices)], locked);
    slices = withSliceKeys(slices.map((s, i) => (i === 1 ? withPrize(s, { type: "fixed" }) : s)), locked);
    slices = withSliceKeys([...slices, { ...slices[2] }], locked);
    const weights = normalizeWeightsTo100(slices.map((s) => s.weight));
    slices = slices.map((s, i) => ({ ...s, weight: weights[i] }));
    const result = await send({
      ...base,
      enabled: true,
      startsAt: "2026-12-01T06:00:00.000Z",
      endsAt: null,
      slices,
      texts: { title: { tr: "Yılbaşı çarkı", en: "New Year wheel" }, subtitle: undefined, teaser: undefined },
    });
    assert.ok(result.success, JSON.stringify(result.success ? null : result.error.issues));
    if (result.success) {
      assert.equal(result.data.value.slices.length, 8);
      assert.equal(result.data.value.slices[1].value, 5000);
      assert.deepEqual(result.data.value.texts.title, { tr: "Yılbaşı çarkı", en: "New Year wheel" });
      assert.equal(result.data.value.texts.subtitle, undefined);
    }
  });

  test("refusals come back at the paths the form's fields use", async () => {
    const base = defaults();
    const slices = base.slices.map((s) => ({ ...s }));
    slices[0] = { ...slices[0], value: 70 };
    slices[1] = { ...slices[1], weight: 0 };
    slices[2] = { ...slices[2], label: { tr: "", en: "Free shipping" } };
    slices[3] = { ...slices[3], key: slices[4].key };
    slices[4] = { ...slices[4], type: "fixed", value: 50 };
    const result = await send({
      ...base,
      slices,
      validityHours: 10,
      texts: { teaser: { tr: "", en: "Spin me" } },
    });
    assert.equal(result.success, false);
    const errors = paths(result.success ? [] : (result.error.issues as Issue[]));
    for (const path of ["slices.0.value", "slices.1.weight", "slices.2.label.tr", "validityHours", "texts.teaser.tr"]) {
      assert.ok(errors[path], `${path} in ${JSON.stringify(errors)}`);
    }
    assert.ok(errors["slices.4.value"] || errors["slices.4.key"], "the fixed slice under 1 TL (or the duplicated key) is reported on slice 4");
    assert.match(errors["slices.0.value"], /1 ile 50/);
    assert.match(errors["texts.teaser.tr"], /Türkçe/);

    // Cross-field rule (checked once the fields themselves are valid): the end lands on the end field.
    const order = await send({ ...base, startsAt: "2026-12-10T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z" });
    assert.equal(order.success, false);
    assert.match(paths(order.success ? [] : (order.error.issues as Issue[])).endsAt, /Bitiş/);
  });

  test("fewer than 4 or more than 8 slices: one message on the list itself", async () => {
    const base = defaults();
    const few = await send({ ...base, slices: base.slices.slice(0, 3) });
    assert.equal(few.success, false);
    assert.match(paths(few.success ? [] : (few.error.issues as Issue[])).slices, /en az 4/);
    const many = await send({ ...base, slices: [...base.slices, ...base.slices.slice(0, 3)].map((s, i) => ({ ...s, key: `dilim-${i}` })) });
    assert.equal(many.success, false);
    assert.match(paths(many.success ? [] : (many.error.issues as Issue[])).slices, /en fazla 8/);
  });
});
