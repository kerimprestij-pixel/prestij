// Day 6 WHEEL-UI: the wheel geometry (slice angles, the landing rotation for a server-chosen slice, the
// label fitting that keeps every label inside its wedge, the spin easing and the pointer ticks) and the
// pure SVG wheel shared by the dialog and the panel preview.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WheelGraphic, { WHEEL_TONE_COLORS } from "@/components/store/wheel/WheelGraphic";
import {
  WHEEL_SPIN_EASING,
  WHEEL_TEXT_INNER,
  WHEEL_TEXT_OUTER,
  boundaryCrossings,
  cubicBezier,
  fitWheelLabels,
  landingRotation,
  pointerTickKeyframes,
  sliceAngle,
  sliceAtRotation,
  textWidthEm,
} from "@/components/store/wheel/wheel-geometry";
import { GIFT_WHEEL_DEFAULT_SLICES, WHEEL_TONES, wheelDisplaySlices } from "@/lib/wheel/types";

const LOCALES = ["tr", "en", "ar"] as const;

describe("slice angles and the landing rotation", () => {
  test("every slice count of the panel (4–8) divides the circle evenly", () => {
    for (let count = 4; count <= 8; count++) assert.equal(sliceAngle(count) * count, 360);
  });

  test("the wheel stops with the server's slice under the pointer, spinning forward 6 turns, from any start", () => {
    for (let count = 4; count <= 8; count++) {
      for (let index = 0; index < count; index++) {
        for (const from of [0, -10, 37.5, 2170, -725]) {
          const target = landingRotation(index, count, { from, turns: 6 });
          assert.equal(sliceAtRotation(target, count), index, `count ${count}, index ${index}, from ${from}`);
          assert.ok(target - from >= 6 * 360 && target - from < 7 * 360);
        }
      }
    }
  });

  test("the dialog's jitter (±28 % of a slice) never moves the stop into a neighbour", () => {
    for (let count = 4; count <= 8; count++) {
      const a = sliceAngle(count);
      for (let index = 0; index < count; index++) {
        const base = landingRotation(index, count, { from: -10, turns: 6 });
        for (const jitter of [-0.28 * a, 0.28 * a, 0]) assert.equal(sliceAtRotation(base + jitter, count), index);
      }
    }
  });
});

describe("label fitting", () => {
  /** Recomputes the geometric constraints for a placed label (corners inside the wedge sides and the text circle). */
  function assertInside(lines: { text: string; radius: number }[], fontSize: number, count: number) {
    const half = (sliceAngle(count) / 2) * (Math.PI / 180);
    const lh = fontSize * 1.16;
    for (const line of lines) {
      const hw = (textWidthEm(line.text) * fontSize) / 2;
      const inner = line.radius - lh / 2 + lh * 0.14;
      const outer = line.radius + lh / 2 - lh * 0.14;
      assert.ok(hw <= inner * Math.tan(half), `"${line.text}" fits between the slice edges`);
      assert.ok(hw * hw + outer * outer <= WHEEL_TEXT_OUTER * WHEEL_TEXT_OUTER + 1e-6, `"${line.text}" stays inside the rim`);
      assert.ok(line.radius - lh / 2 >= WHEEL_TEXT_INNER - 1e-6, `"${line.text}" stays outside the hub`);
    }
  }

  test("the six default slices fit in tr/en/ar at one shared size, two lines for two-word labels", () => {
    for (const locale of LOCALES) {
      const labels = wheelDisplaySlices(GIFT_WHEEL_DEFAULT_SLICES, locale).map((s) => s.label);
      const layouts = fitWheelLabels(labels);
      const sizes = new Set(layouts.map((l) => l.fontSize));
      assert.equal(sizes.size, 1, `${locale}: one size for all labels`);
      assert.ok([...sizes][0] >= 10, `${locale}: readable size`);
      layouts.forEach((layout, i) => {
        assert.equal(layout.lines.map((l) => l.text).join(" "), labels[i], "no text is lost");
        assert.ok(layout.lines.length >= 1 && layout.lines.length <= 2);
        assertInside(layout.lines, layout.fontSize, labels.length);
      });
    }
    const tr = fitWheelLabels(wheelDisplaySlices(GIFT_WHEEL_DEFAULT_SLICES, "tr").map((s) => s.label));
    assert.deepEqual(tr[2].lines.map((l) => l.text), ["Ücretsiz", "kargo"]);
    assert.deepEqual(tr[1].lines.map((l) => l.text), ["%10", "indirim"]);
  });

  test("a 40-character label on an 8-slice wheel shrinks on its own, up to three lines, still inside", () => {
    const labels = [...wheelDisplaySlices(GIFT_WHEEL_DEFAULT_SLICES, "tr").map((s) => s.label), "Sürpriz", "Numune seti ve ücretsiz kargo bir arada."];
    assert.equal(labels[7].length, 40, "the panel maximum");
    const layouts = fitWheelLabels(labels);
    const shared = layouts[0].fontSize;
    assert.ok(layouts[7].fontSize < shared, "the outlier is smaller");
    assert.ok(layouts.slice(0, 7).every((l) => l.fontSize === shared), "the others keep the shared size");
    assert.ok(layouts[7].lines.length <= 3 && layouts[7].lines.length > 1);
    layouts.forEach((l, i) => {
      assert.equal(l.lines.map((x) => x.text).join(" "), labels[i]);
      assertInside(l.lines, l.fontSize, 8);
    });
  });

  test("empty labels and odd counts from a half-edited panel form do not crash", () => {
    assert.deepEqual(fitWheelLabels([]), []);
    const layouts = fitWheelLabels(["", "  ", "A"]);
    assert.equal(layouts[0].lines.length, 0);
    assert.equal(layouts[2].lines[0].text, "A");
  });

  test("Arabic letters are measured narrower than Latin capitals (joined script)", () => {
    assert.ok(textWidthEm("خصم") < textWidthEm("KDV"));
    assert.ok(textWidthEm("%%") > textWidthEm("ii"));
  });
});

describe("spin easing and pointer ticks", () => {
  const ease = cubicBezier(...WHEEL_SPIN_EASING);

  test("the easing starts slowly, glides, and its inverse matches", () => {
    assert.equal(ease.progress(0), 0);
    assert.equal(ease.progress(1), 1);
    let last = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const p = ease.progress(t);
      assert.ok(p >= last, "monotonic");
      last = p;
      assert.ok(Math.abs(ease.timeAt(p) - t) < 1e-6, `inverse at ${t.toFixed(2)}`);
    }
    assert.ok(ease.progress(0.05) < 0.05, "a short push first (slower than linear)");
    assert.ok(ease.progress(0.75) > 0.94, "the last quarter of the time covers only the last few degrees");
  });

  test("boundary crossings: one per slice edge passed", () => {
    assert.deepEqual(boundaryCrossings(0, 360, 6), [30, 90, 150, 210, 270, 330]);
    assert.equal(boundaryCrossings(-10, -10 + 6 * 360 + 125, 6).length, 6 * 6 + 2);
    assert.deepEqual(boundaryCrossings(10, 10, 6), []);
    assert.deepEqual(boundaryCrossings(0, 360, 1), []);
  });

  test("pointer keyframes: ordered offsets in [0, 1], rest at both ends, counter-clockwise flicks", () => {
    const from = -10;
    const to = landingRotation(3, 6, { from, turns: 6 }) + 4;
    const frames = pointerTickKeyframes(from, to, 6);
    assert.equal(frames[0].offset, 0);
    assert.equal(frames.at(-1)?.offset, 1);
    assert.equal(frames[0].transform, "rotate(0deg)");
    assert.equal(frames.at(-1)?.transform, "rotate(0deg)");
    for (let i = 1; i < frames.length; i++) assert.ok(frames[i].offset >= frames[i - 1].offset);
    const angles = frames.map((f) => Number(/rotate\((-?[\d.]+)deg\)/.exec(f.transform)?.[1]));
    assert.ok(angles.every((a) => a <= 0 && a >= -16), "flicks go one way and stay small");
    const flicks = angles.filter((a) => a < 0).length;
    assert.ok(flicks >= 10 && flicks <= boundaryCrossings(from, to, 6).length, `${flicks} flicks`);
  });
});

describe("WheelGraphic", () => {
  const tr = wheelDisplaySlices(GIFT_WHEEL_DEFAULT_SLICES, "tr");

  test("decorative by default; a wedge and a label per slice; rotation and transition only on the face", () => {
    const html = renderToStaticMarkup(createElement(WheelGraphic, { slices: tr, rotation: 1234.5, spinDurationMs: 4600 }));
    assert.match(html, /^<div[^>]*aria-hidden="true"/);
    assert.equal((html.match(/<path d="M 100 100/g) ?? []).length, 6);
    assert.match(html, /transform:rotate\(1234.5deg\);transition:transform 4600ms cubic-bezier\(0\.3, 0\.1, 0\.1, 1\);will-change:transform/);
    for (const s of tr) for (const word of s.label.split(" ")) assert.ok(html.includes(`>${word}<`) || html.includes(` ${word}<`) || html.includes(`>${word} `), word);
    assert.ok(html.includes("data-wheel-pointer"));
    assert.ok(html.includes("PRESTİJ"));
    assert.ok(!/weight=|"weight"|minOrderTotal|value=/.test(html), "no prize data in the markup");
  });

  test("at rest: no transition and no will-change (the face is painted crisply)", () => {
    const html = renderToStaticMarkup(createElement(WheelGraphic, { slices: tr, rotation: 60 }));
    assert.match(html, /transition:none/);
    assert.ok(!html.includes("will-change"));
  });

  test("labelled → an image with that name; RTL labels get direction rtl and no letter spacing", () => {
    const html = renderToStaticMarkup(createElement(WheelGraphic, { slices: wheelDisplaySlices(GIFT_WHEEL_DEFAULT_SLICES, "ar"), dir: "rtl", label: "عجلة الهدايا" }));
    assert.match(html, /^<div[^>]*role="img"[^>]*aria-label="عجلة الهدايا"/);
    assert.equal((html.match(/direction="rtl"/g) ?? []).length, 6);
    assert.ok(!html.includes("letter-spacing:0.01em"));
  });

  test("the highlighted slice gets an outline; out-of-range highlights are ignored", () => {
    const one = renderToStaticMarkup(createElement(WheelGraphic, { slices: tr, highlightIndex: 2 }));
    const none = renderToStaticMarkup(createElement(WheelGraphic, { slices: tr, highlightIndex: 9 }));
    assert.equal((one.match(/<path d="M 100 100/g) ?? []).length, 7);
    assert.equal((none.match(/<path d="M 100 100/g) ?? []).length, 6);
  });

  test("two wheels on one page get distinct gradient ids", () => {
    const html = renderToStaticMarkup(createElement("div", null, createElement(WheelGraphic, { slices: tr }), createElement(WheelGraphic, { slices: tr })));
    const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("every tone has a fill and a text colour from the brand/gold scales (same in dark mode)", () => {
    for (const tone of WHEEL_TONES) {
      assert.match(WHEEL_TONE_COLORS[tone].fill, /^var\(--(brand|gold)-\d+\)$/);
      assert.match(WHEEL_TONE_COLORS[tone].text, /^var\(--(brand|gold)-\d+\)$/);
    }
  });
});
