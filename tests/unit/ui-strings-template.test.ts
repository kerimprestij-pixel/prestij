// UI text overrides: placeholders and ICU plural syntax must match the built-in text per language.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flattenMessages, format } from "@/i18n/format";
import { defaultMessages } from "@/i18n/messages";
import { analyzeTemplate, describePlaceholders, pluralCategoriesOf, validateOverride } from "@/lib/panel/ui-strings/template";

const EN_CART = "Cart, {count, plural, one {# item} other {# items}}";

describe("analyzeTemplate", () => {
  test("finds plain placeholders, plural blocks and stray braces", () => {
    assert.deepEqual(analyzeTemplate("Sepet, {count} ürün"), { simple: ["count"], plurals: [], stray: false });
    assert.deepEqual(analyzeTemplate(EN_CART), { simple: [], plurals: [{ name: "count", selectors: ["one", "other"] }], stray: false });
    assert.equal(analyzeTemplate("{min}–{max} gün").simple.join(","), "max,min");
    assert.equal(analyzeTemplate("Sepet {count").stray, true);
    assert.equal(analyzeTemplate("Sepet } x").stray, true);
    assert.equal(analyzeTemplate("{count, plural, one {# item} other {# items}").stray, true, "unclosed plural");
    assert.equal(analyzeTemplate("{bad name}").stray, true);
    assert.equal(analyzeTemplate("%{percent} tasarruf").stray, false);
  });

  test("describePlaceholders marks plural variables", () => {
    assert.deepEqual(describePlaceholders("Son {count} adet, {amount}"), [
      { name: "amount", plural: false },
      { name: "count", plural: false },
    ]);
    assert.deepEqual(describePlaceholders(EN_CART), [{ name: "count", plural: true }]);
  });
});

describe("validateOverride", () => {
  test("accepts any wording that keeps the placeholders", () => {
    assert.equal(validateOverride("Sepet, {count} ürün", "Sepetim ({count})", "tr"), null);
    assert.equal(validateOverride("{min}–{max} iş günü", "{max} güne kadar (en erken {min})", "tr"), null);
    assert.equal(validateOverride("Sepet", "Alışveriş çantası", "tr"), null);
  });

  test("refuses missing, extra and renamed placeholders", () => {
    assert.match(validateOverride("Sepet, {count} ürün", "Sepetim", "tr")!, /eksik: \{count\}/);
    assert.match(validateOverride("Sepet", "Sepet {count}", "tr")!, /kullanılamayan.*\{count\}/);
    assert.match(validateOverride("Son {count} adet", "Son {adet} adet", "tr")!, /eksik/);
    assert.match(validateOverride("Sepet", "Sepet {x", "tr")!, /parantez/);
  });

  test("plural blocks: kept as plurals with every category of the default", () => {
    assert.equal(validateOverride(EN_CART, "Bag ({count, plural, one {# product} other {# products}})", "en"), null);
    assert.equal(validateOverride(EN_CART, "Bag, {count, plural, =0 {empty} one {# product} other {# products}}", "en"), null);
    assert.match(validateOverride(EN_CART, "Bag, {count} items", "en")!, /çoğul/);
    assert.match(validateOverride(EN_CART, "Bag, {count, plural, other {# items}}", "en")!, /eksik: one/);
    assert.match(validateOverride(EN_CART, "Bag, {count, plural, one {# item} few {# items} other {# items}}", "en")!, /geçerli bir çoğul/);
    assert.match(validateOverride("Sepet, {count} ürün", "Sepet, {count, plural, one {# ürün} other {# ürün}}", "tr")!, /düz yer tutucu/);
  });

  test("Arabic keeps all six categories of its default", () => {
    const ar = "{count, plural, one {عينة واحدة} two {عينتين} few {# عينات} many {# عينة} other {# عينة}}";
    assert.deepEqual([...pluralCategoriesOf("ar")].sort(), ["few", "many", "one", "other", "two", "zero"]);
    assert.equal(validateOverride(ar, "حتى {count, plural, one {عينة} two {عينتين} few {# عينات} many {# عينة} other {# عينة}}", "ar"), null);
    assert.match(validateOverride(ar, "{count, plural, one {عينة} other {# عينة}}", "ar")!, /eksik: two, few, many/);
  });

  test("every built-in text is valid as its own override, in every language", () => {
    for (const locale of ["tr", "en", "ar"] as const) {
      const flat = flattenMessages(defaultMessages[locale]);
      for (const [key, text] of Object.entries(flat)) {
        assert.equal(validateOverride(text, text, locale), null, `${locale}:${key}`);
      }
    }
  });

  test("a valid override formats without leftover braces", () => {
    const override = "Bag ({count, plural, one {# product} other {# products}})";
    assert.equal(validateOverride(EN_CART, override, "en"), null);
    assert.equal(format(override, { count: 1 }, "en"), "Bag (1 product)");
    assert.equal(format(override, { count: 3 }, "en"), "Bag (3 products)");
  });
});
