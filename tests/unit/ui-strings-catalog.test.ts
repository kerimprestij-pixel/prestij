// UI text catalog (every message key, Turkish group names) and the override payload checks.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flattenMessages } from "@/i18n/format";
import { defaultMessages } from "@/i18n/messages";
import { findUiString, groupLabel, listUiStringGroups, listUiStrings, UI_STRING_GROUP_LABELS } from "@/lib/panel/ui-strings/catalog";
import { compactOverride, uiStringsSaveSchema, uiStringValueErrors, UI_STRING_MAX } from "@/lib/panel/ui-strings/schemas";

describe("catalog", () => {
  test("lists every leaf of the Turkish dictionary once, with all three defaults", () => {
    const flat = flattenMessages(defaultMessages.tr);
    const entries = listUiStrings();
    assert.equal(entries.length, Object.keys(flat).length);
    assert.equal(new Set(entries.map((e) => e.key)).size, entries.length);
    const cart = findUiString("header.cart");
    assert.deepEqual(cart && { tr: cart.tr, en: cart.en, ar: cart.ar }, {
      tr: defaultMessages.tr.header.cart,
      en: defaultMessages.en.header.cart,
      ar: defaultMessages.ar.header.cart,
    });
    assert.equal(cart?.group, "header");
    assert.equal(cart?.subgroup, null);
    assert.equal(findUiString("cart.errors.stock")?.subgroup ?? "cart.errors", "cart.errors");
  });

  test("unknown keys, branches and prototype names are not overridable", () => {
    for (const key of ["header", "nope.key", "__proto__", "constructor", "header.cart.x", ""]) {
      assert.equal(findUiString(key), undefined, key);
    }
  });

  test("groups follow the Turkish display order and have Turkish names", () => {
    const groups = listUiStringGroups();
    assert.equal(groups[0].key, "common");
    assert.equal(groups.reduce((n, g) => n + g.count, 0), listUiStrings().length);
    for (const key of ["common", "header", "product", "cart", "checkout", "order", "errors"]) {
      assert.equal(groupLabel(key), UI_STRING_GROUP_LABELS[key]);
    }
    assert.equal(groupLabel("yeniGrup"), "YeniGrup", "unknown groups fall back to their key");
  });
});

describe("override payloads", () => {
  test("texts are trimmed, line breaks become spaces, empty means not overridden", () => {
    const parsed = uiStringsSaveSchema.parse({
      items: [{ key: "header.cart", value: { tr: "  Sepetim \n", en: "", ar: null }, updatedAt: null }],
    });
    assert.deepEqual(parsed.items[0].value, { tr: "Sepetim", en: "", ar: "" });
    assert.equal(parsed.items[0].updatedAt, null);
    const twoLines = uiStringsSaveSchema.parse({ items: [{ key: "header.cart", value: { tr: "Alışveriş\r\n  çantası" } }] });
    assert.equal(twoLines.items[0].value.tr, "Alışveriş çantası");
  });

  test("limits: length, control characters, empty batch", () => {
    const long = uiStringsSaveSchema.safeParse({ items: [{ key: "header.cart", value: { tr: "x".repeat(UI_STRING_MAX + 1) } }] });
    assert.equal(long.success, false);
    const control = uiStringsSaveSchema.safeParse({ items: [{ key: "header.cart", value: { tr: "Sepet\u0007" } }] });
    assert.equal(control.success, false);
    assert.equal(uiStringsSaveSchema.safeParse({ items: [] }).success, false);
    const badVersion = uiStringsSaveSchema.safeParse({ items: [{ key: "header.cart", value: {}, updatedAt: "dün" }] });
    assert.equal(badVersion.success, false);
  });

  test("per-key errors check each language against its own default", () => {
    assert.deepEqual(uiStringValueErrors("header.cart", { tr: "Sepetim", ar: "السلة" }), {});
    const errors = uiStringValueErrors("header.cartWithCount", { tr: "Sepet", en: "Cart ({count})" });
    assert.match(errors.tr ?? "", /eksik: \{count\}/);
    assert.match(errors.en ?? "", /çoğul/, "en default pluralizes {count}");
    assert.equal(errors.ar, undefined);
    assert.ok(uiStringValueErrors("no.such.key", { tr: "x" }).key);
  });

  test("compactOverride keeps only non-empty locales", () => {
    assert.deepEqual(compactOverride({ tr: " ", en: "Bag", ar: "" }), { en: "Bag" });
    assert.deepEqual(compactOverride(null), {});
  });
});
