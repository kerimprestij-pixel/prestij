// Day 6 CORE: the shared gift wheel pieces. Display helpers never expose weights, the spin request
// schema, the code format, the UI dictionary (`wheel.*` and `product.video*` complete in tr/en/ar with the
// same placeholders, Western digits in Arabic, a message for every error code, Turkish panel group
// names), the wheel geometry and the minimal SVG wheel, and the content-day6 skeleton.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { flattenMessages } from "@/i18n/format";
import { defaultMessages } from "@/i18n/messages";
import WheelGraphic from "@/components/store/wheel/WheelGraphic";
import { landingRotation, polar, sliceAngle, sliceAtRotation, slicePath } from "@/components/store/wheel/wheel-geometry";
import { listUiStrings, UI_STRING_GROUP_LABELS, UI_STRING_SUBGROUP_LABELS } from "@/lib/panel/ui-strings/catalog";
import { analyzeTemplate } from "@/lib/panel/ui-strings/template";
import {
  GIFT_WHEEL_DEFAULT_SLICES,
  WHEEL_CODE_ALPHABET,
  WHEEL_CODE_LENGTH,
  WHEEL_CODE_PATTERN,
  WHEEL_CODE_PREFIX,
  WHEEL_ELIGIBILITY_REASONS,
  WHEEL_ERROR_CODES,
  wheelDisplaySlices,
  wheelSliceShares,
  wheelSpinRequestSchema,
  wheelText,
  type WheelReasonsAreErrorCodes,
} from "@/lib/wheel/types";
import { STEPS } from "../../scripts/content-day6";

const LOCALES = ["tr", "en", "ar"] as const;

describe("display helpers", () => {
  test("display slices carry key, localized label and tone only (never the weight or the prize value)", () => {
    const en = wheelDisplaySlices(GIFT_WHEEL_DEFAULT_SLICES, "en");
    assert.deepEqual(en[0], { key: "indirim-5", label: "5% off", tone: "cream" });
    // FIX UX-5: the minimum basket is a condition shown before the spin (never the weight or the value).
    for (const s of en) assert.deepEqual(Object.keys(s).sort(), s.minOrderTotal ? ["key", "label", "minOrderTotal", "tone"] : ["key", "label", "tone"]);
    assert.deepEqual(en.map((s) => s.minOrderTotal ?? 0), [0, 0, 0, 0, 30000, 75000]);
    const fallback = wheelDisplaySlices([{ ...GIFT_WHEEL_DEFAULT_SLICES[1], label: { tr: "%10 indirim", ar: "  " } }], "ar");
    assert.equal(fallback[0].label, "%10 indirim", "blank translation, no generator → Turkish");
    // FIX COR-7: with the generator (as loadWheel and the panel preview pass it) a missing en/ar label gets the automatic name.
    const generated = wheelDisplaySlices([{ ...GIFT_WHEEL_DEFAULT_SLICES[1], label: { tr: "Sürpriz %10", ar: "  " } }], "ar", () => "خصم 10%");
    assert.equal(generated[0].label, "خصم 10%");
    assert.equal(wheelDisplaySlices([{ ...GIFT_WHEEL_DEFAULT_SLICES[1], label: { tr: "Sürpriz %10" } }], "tr", () => "x")[0].label, "Sürpriz %10");
  });

  test("configured shares in percent follow the weights", () => {
    assert.deepEqual(wheelSliceShares(GIFT_WHEEL_DEFAULT_SLICES), [35, 25, 20, 10, 7, 3]);
    assert.deepEqual(wheelSliceShares([{ weight: 1 }, { weight: 2 }]), [33.3, 66.7]);
    assert.deepEqual(wheelSliceShares([]), []);
  });

  test("wheelText: the override in the locale, else Turkish, else the dictionary default", () => {
    assert.equal(wheelText({ tr: "Kış Çarkı", en: "Winter Wheel" }, "en", "Gift Wheel"), "Winter Wheel");
    assert.equal(wheelText({ tr: "Kış Çarkı" }, "ar", "عجلة الهدايا"), "Kış Çarkı");
    assert.equal(wheelText(undefined, "tr", "Hediye Çarkı"), "Hediye Çarkı");
    assert.equal(wheelText({ tr: " " }, "tr", "Hediye Çarkı"), "Hediye Çarkı");
  });
});

describe("spin request and code format", () => {
  test("the spin body needs a known locale; the honeypot and the path are optional and bounded", () => {
    assert.ok(wheelSpinRequestSchema.safeParse({ locale: "ar", path: "/ar/products/lavanta" }).success);
    assert.ok(wheelSpinRequestSchema.safeParse({ locale: "tr", website: "" }).success);
    assert.equal(wheelSpinRequestSchema.safeParse({ locale: "de" }).success, false);
    assert.equal(wheelSpinRequestSchema.safeParse({ locale: "tr", path: "x".repeat(2001) }).success, false);
  });

  test("codes: CARK- + 6 characters without look-alikes, a valid panel coupon code", () => {
    assert.equal(WHEEL_CODE_ALPHABET.length, 31, "A–Z without I, L, O and 2–9");
    assert.ok(!/[01ILO]/.test(WHEEL_CODE_ALPHABET));
    assert.match(`${WHEEL_CODE_PREFIX}AB2C3D`, WHEEL_CODE_PATTERN);
    assert.doesNotMatch("CARK-AB1C3D", WHEEL_CODE_PATTERN);
    assert.equal(`${WHEEL_CODE_PREFIX}${"A".repeat(WHEEL_CODE_LENGTH)}`.length, 11);
    assert.match(`${WHEEL_CODE_PREFIX}AB2C3D`, /^[A-Z0-9](?:[A-Z0-9_-]*[A-Z0-9])?$/, "COUPON_CODE_PATTERN of the panel");
  });
});

describe("UI dictionary", () => {
  const flat = Object.fromEntries(LOCALES.map((l) => [l, flattenMessages(defaultMessages[l])])) as Record<(typeof LOCALES)[number], Record<string, string>>;
  const day6Keys = Object.keys(flat.tr).filter((k) => k.startsWith("wheel.") || /^product\.(video|playVideo|pauseVideo)$/.test(k) || k === "cart.errors.coupon_not_owner");

  test("the wheel group, the product video keys and the owner refusal exist in all three languages", () => {
    assert.ok(day6Keys.length > 80, String(day6Keys.length));
    for (const key of ["product.video", "product.playVideo", "product.pauseVideo", "wheel.dialog.title", "wheel.claim.registerCta", "wheel.chip.text"]) {
      assert.ok(day6Keys.includes(key), key);
    }
    for (const key of day6Keys) {
      for (const l of LOCALES) assert.ok(typeof flat[l][key] === "string" && flat[l][key].trim(), `${l}: ${key}`);
    }
    assert.equal(defaultMessages.tr.wheel.claim.claimCta, "Hediyemi al");
    // Lead decision D1: formal "siz" in Turkish; first-person buttons stay.
    assert.equal(defaultMessages.tr.wheel.claim.registerCta, "Hediyenizi almak için ücretsiz üye olun");
    assert.equal(defaultMessages.tr.wheel.claim.signInCta, "Zaten üye misiniz? Giriş yapın");
  });

  test("placeholders match across languages (plural forms may differ); Arabic uses Western digits", () => {
    for (const key of day6Keys) {
      const names = (l: (typeof LOCALES)[number]) => {
        const t = analyzeTemplate(flat[l][key]);
        assert.equal(t.stray, false, `${l}: ${key}`);
        return [...t.simple, ...t.plurals.map((p) => p.name)].sort().join(",");
      };
      assert.equal(names("en"), names("tr"), `en: ${key}`);
      assert.equal(names("ar"), names("tr"), `ar: ${key}`);
      assert.ok(!/[٠-٩]/.test(flat.ar[key]), `ar digits: ${key}`);
    }
  });

  test("every error code (and every refusal reason) has a message", () => {
    const covered: WheelReasonsAreErrorCodes = true;
    assert.equal(covered, true);
    for (const reason of WHEEL_ELIGIBILITY_REASONS) {
      if (reason !== "eligible") assert.ok((WHEEL_ERROR_CODES as readonly string[]).includes(reason), reason);
    }
    for (const code of WHEEL_ERROR_CODES) {
      for (const l of LOCALES) assert.ok(flat[l][`wheel.errors.${code}`], `${l}: wheel.errors.${code}`);
    }
  });

  test("the panel shows Turkish names for the wheel group and each of its sub-groups", () => {
    assert.equal(UI_STRING_GROUP_LABELS.wheel, "Hediye çarkı");
    const subgroups = new Set(listUiStrings().filter((e) => e.group === "wheel").map((e) => e.subgroup));
    assert.ok(subgroups.size >= 10);
    for (const sub of subgroups) assert.ok(sub && UI_STRING_SUBGROUP_LABELS[sub], String(sub));
  });
});

describe("wheel geometry", () => {
  test("slice angles and wedge paths", () => {
    assert.equal(sliceAngle(6), 60);
    assert.equal(sliceAngle(8), 45);
    assert.deepEqual(polar(100, 100, 50, 90), { x: 150, y: 100 });
    assert.match(slicePath(0, 4, 100, 100, 90), /^M 100 100 L [\d.]+ [\d.]+ A 90 90 0 0 1 [\d.]+ [\d.]+ Z$/);
  });

  test("landingRotation stops every slice under the pointer, spinning forward at least the asked turns", () => {
    for (let count = 4; count <= 8; count++) {
      for (let index = 0; index < count; index++) {
        for (const from of [0, 137, -45, 1800]) {
          const r = landingRotation(index, count, { from, turns: 5 });
          assert.equal(sliceAtRotation(r, count), index, `count ${count}, index ${index}, from ${from}`);
          assert.ok(r - from >= 5 * 360 && r - from < 6 * 360, `forward 5–6 turns (${r - from})`);
        }
      }
    }
    assert.equal(landingRotation(0, 6, { turns: 0 }), 0);
    assert.equal(landingRotation(1, 4, { turns: 0 }), 270);
  });
});

describe("WheelGraphic (minimal SVG)", () => {
  const slices = wheelDisplaySlices(GIFT_WHEEL_DEFAULT_SLICES, "tr");

  test("one wedge and one label per slice, decorative unless labelled, rotation as a transform", () => {
    const html = renderToStaticMarkup(createElement(WheelGraphic, { slices, rotation: 120, spinDurationMs: 4500 }));
    assert.equal((html.match(/<path d="M 100 100/g) ?? []).length, 6);
    // WHEEL-UI breaks labels into lines (<tspan>s); joined they read as the label.
    const joined = html.replace(/<\/tspan><tspan[^>]*>/g, " ");
    for (const s of slices) assert.ok(joined.includes(`>${s.label}<`), s.label);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /rotate\(120deg\)/);
    assert.match(html, /transition:transform 4500ms/);
    assert.ok(html.includes("PRESTİJ"));
    assert.ok(!/weight|35/.test(html.replace(/font-weight:\d+/g, "")), "no weights in the markup");
  });

  test("an accessible name makes it an image; RTL labels get direction rtl", () => {
    const html = renderToStaticMarkup(createElement(WheelGraphic, { slices: wheelDisplaySlices(GIFT_WHEEL_DEFAULT_SLICES, "ar"), dir: "rtl", label: "عجلة الهدايا" }));
    assert.match(html, /role="img"/);
    assert.match(html, /aria-label="عجلة الهدايا"/);
    assert.match(html, /direction="rtl"/);
    assert.match(html, /transition:none/);
  });
});

describe("content-day6 skeleton", () => {
  test("three CONTENT steps, importable without a database", async () => {
    assert.deepEqual(
      STEPS.map((s) => [s.key, s.owner]),
      [
        ["wheelTerms", "CONTENT"],
        ["giftWheelConfig", "CONTENT"],
        ["launchChecklist", "CONTENT"],
      ],
    );
    // CONTENT filled the steps in; they run against the database in tests/db/day6-content-steps.test.ts.
    for (const step of STEPS) assert.equal(typeof step.run, "function", step.key);
  });
});
