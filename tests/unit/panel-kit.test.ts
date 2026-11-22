// Pure helpers behind the panel form kit: dotted paths and dirty checks (usePanelForm), Turkish
// number parsing (NumberInput/PercentInput), link feedback (LinkInput) and localized values.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hrefError, tidyHref } from "@/components/panel/form/href";
import { hasText, localeError, setLocale } from "@/components/panel/form/localized";
import { formatTrNumber, parseTrNumber } from "@/components/panel/form/number-format";
import { errorsUnder, getIn, looselyEqual, setIn, splitPath, withoutErrorsUnder } from "@/components/panel/form/paths";

describe("form paths", () => {
  test("splitPath turns numeric parts into indexes", () => {
    assert.deepEqual(splitPath("variants.2.price"), ["variants", 2, "price"]);
    assert.deepEqual(splitPath(""), []);
    assert.deepEqual(splitPath(["a", 1]), ["a", 1]);
  });

  test("getIn reads nested values and tolerates missing steps", () => {
    const state = { variants: [{ price: 100 }, { price: 200 }], title: { tr: "A" } };
    assert.equal(getIn(state, "variants.1.price"), 200);
    assert.equal(getIn(state, "title.en"), undefined);
    assert.equal(getIn(state, "missing.deep.path"), undefined);
  });

  test("setIn copies only the changed branch", () => {
    const state = { variants: [{ price: 100 }, { price: 200 }], title: { tr: "A" } };
    const next = setIn(state, "variants.1.price", 250);
    assert.equal(next.variants[1].price, 250);
    assert.equal(state.variants[1].price, 200, "original untouched");
    assert.notEqual(next.variants, state.variants);
    assert.equal(next.variants[0], state.variants[0], "siblings keep identity");
    assert.equal(next.title, state.title);
    assert.equal(setIn(state, "title.tr", "A"), state, "same value → same reference");
  });

  test("setIn creates missing containers (arrays for numeric keys)", () => {
    const next = setIn({} as Record<string, unknown>, "items.0.name", "x");
    assert.deepEqual(next, { items: [{ name: "x" }] });
  });

  test("looselyEqual treats undefined, null and empty string keys as equal", () => {
    assert.ok(looselyEqual({ tr: "A" }, { tr: "A", en: undefined }));
    assert.ok(looselyEqual({ a: null }, { a: "" }));
    assert.ok(looselyEqual({ list: [1, 2] }, { list: [1, 2] }));
    assert.ok(!looselyEqual({ list: [1, 2] }, { list: [2, 1] }));
    assert.ok(!looselyEqual({ tr: "A" }, { tr: "B" }));
    assert.ok(!looselyEqual({ a: 0 }, { a: null }), "0 is a value");
    assert.ok(!looselyEqual([""], []), "array lengths matter");
  });

  test("errorsUnder and withoutErrorsUnder use dotted prefixes", () => {
    const errors = { "title.en": "EN", title: "T", "variants.2.price": "P", titleX: "other" };
    assert.deepEqual(errorsUnder(errors, "title"), { "": "T", en: "EN" });
    assert.deepEqual(errorsUnder(errors, "variants.2"), { price: "P" });
    assert.deepEqual(withoutErrorsUnder(errors, "title"), { "variants.2.price": "P", titleX: "other" });
    assert.equal(withoutErrorsUnder(errors, "nothing"), errors, "unchanged → same reference");
  });
});

describe("Turkish number parsing", () => {
  test("parses Turkish and plain formats", () => {
    assert.equal(parseTrNumber("1.250"), 1250);
    assert.equal(parseTrNumber("12,5"), 12.5);
    assert.equal(parseTrNumber("12.5"), 12.5);
    assert.equal(parseTrNumber("1.234.567,89"), 1234567.89);
    assert.equal(parseTrNumber(" 15 % "), 15);
    assert.equal(parseTrNumber("-3"), -3);
    assert.equal(parseTrNumber(""), null);
    assert.equal(parseTrNumber("abc"), null);
    assert.equal(parseTrNumber("1,2,3"), null);
  });

  test("formats with Turkish grouping", () => {
    assert.equal(formatTrNumber(1250, 0), "1.250");
    assert.equal(formatTrNumber(12.5, 2), "12,5");
    assert.equal(formatTrNumber(null), "");
  });
});

describe("link feedback", () => {
  test("accepts the hrefInput formats", () => {
    for (const ok of ["/urunler/lavanta", "/", "#sss", "https://prestij.com.tr", "mailto:info@prestij.com.tr", "tel:+903523533070", ""]) {
      assert.equal(hrefError(ok), null, ok);
    }
  });

  test("explains common mistakes", () => {
    assert.match(hrefError("javascript:alert(1)") ?? "", /ile başlamalı/);
    assert.match(hrefError("http://prestij.com.tr") ?? "", /https/);
    assert.match(hrefError("//evil.example") ?? "", /\/\//);
    assert.match(hrefError("/a b") ?? "", /boşluk/);
  });

  test("tidyHref adds https:// to bare domains only", () => {
    assert.equal(tidyHref(" prestij.com.tr/urunler "), "https://prestij.com.tr/urunler");
    assert.equal(tidyHref("/urunler"), "/urunler");
    assert.equal(tidyHref("mailto:a@b.co"), "mailto:a@b.co");
  });
});

describe("localized values", () => {
  test("setLocale keeps tr and drops empty translations", () => {
    assert.deepEqual(setLocale({ tr: "A", en: "B" }, "en", ""), { tr: "A" });
    assert.deepEqual(setLocale({ tr: "A" }, "ar", "ب"), { tr: "A", ar: "ب" });
    assert.deepEqual(setLocale(null, "tr", "X"), { tr: "X" });
    assert.deepEqual(setLocale({ tr: "A" }, "tr", ""), { tr: "" });
  });

  test("hasText ignores markup in HTML mode", () => {
    assert.ok(!hasText("<p><br></p>", true));
    assert.ok(!hasText("<p>&nbsp;</p>", true));
    assert.ok(hasText("<p>Merhaba</p>", true));
    assert.ok(!hasText("   "));
  });

  test("localeError reads per-locale messages only", () => {
    assert.equal(localeError({ en: "x" }, "en"), "x");
    assert.equal(localeError("genel", "tr"), undefined);
  });
});
