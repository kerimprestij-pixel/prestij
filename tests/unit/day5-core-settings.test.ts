// Day 5 CORE: the seoSettings extension (verification codes, return policy, Google product category).
// Rows stored before day 5 stay valid; bad values fall back field by field; the panel schema keeps them.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { seoSettingsInput } from "@/lib/panel/settings/schemas";
import { GOOGLE_PRODUCT_CATEGORIES, parseSettings, SEO_VERIFICATION_PATTERN, settingsSchemas } from "@/lib/settings/types";

/** The seo row as it is stored in the live database today (before day 5). */
const STORED_BEFORE_DAY5 = {
  ogImageId: 49,
  titleTemplate: "%s | PRESTİJ",
  defaultTitle: { tr: "PRESTİJ — Sıvı El Sabunu ve Duş Jeli", en: "PRESTİJ — Liquid Hand Soap & Shower Gel" },
  description: { tr: "Lavanta Latte, Lavanta, Portakal ve Okyanus." },
};

/** The distinct error paths (one field may get several messages; the panel shows the first). */
const fieldErrors = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) => [
  ...new Set((result.error?.issues ?? []).map((i) => i.path.map(String).join("."))),
];

describe("seo settings defaults", () => {
  test("a row from before day 5 keeps every stored value and gets the new defaults", () => {
    const seo = parseSettings("seo", STORED_BEFORE_DAY5);
    assert.equal(seo.ogImageId, 49);
    assert.deepEqual(seo.defaultTitle, STORED_BEFORE_DAY5.defaultTitle);
    assert.deepEqual(seo.verification, { google: "", bing: "", yandex: "" });
    assert.deepEqual(seo.returns, { days: 14, freeReturns: null });
    assert.equal(seo.merchantCategory, "3208");
    assert.equal(seo.merchantCategory, GOOGLE_PRODUCT_CATEGORIES.liquidHandSoap);
  });

  test("no row at all gives the same defaults", () => {
    const seo = parseSettings("seo", undefined);
    assert.deepEqual(seo.verification, { google: "", bing: "", yandex: "" });
    assert.deepEqual(seo.returns, { days: 14, freeReturns: null });
  });

  test("a partial nested value fills the missing keys", () => {
    const seo = parseSettings("seo", { ...STORED_BEFORE_DAY5, verification: { google: "abc_DEF-123" }, returns: { freeReturns: true } });
    assert.deepEqual(seo.verification, { google: "abc_DEF-123", bing: "", yandex: "" });
    assert.deepEqual(seo.returns, { days: 14, freeReturns: true });
  });

  test("an invalid new field falls back alone; the rest of the document is kept", () => {
    const seo = parseSettings("seo", { ...STORED_BEFORE_DAY5, verification: { google: '<meta name="x">' }, returns: { days: 999 } });
    assert.deepEqual(seo.verification, { google: "", bing: "", yandex: "" });
    assert.deepEqual(seo.returns, { days: 14, freeReturns: null });
    assert.equal(seo.ogImageId, 49);
  });
});

describe("validation rules", () => {
  const withFields = (fields: Record<string, unknown>) => ({ ...settingsSchemas.seo.parse(STORED_BEFORE_DAY5), ...fields });

  test("verification codes: the token only, trimmed, at most 100 characters", () => {
    assert.ok(SEO_VERIFICATION_PATTERN.test("Ab3_-:.=") && !SEO_VERIFICATION_PATTERN.test("a b"));
    const ok = seoSettingsInput.parse(withFields({ verification: { google: "  rXo-9_Abc:x.y=  ", bing: "0123ABCDEF", yandex: "" } }));
    assert.deepEqual(ok.verification, { google: "rXo-9_Abc:x.y=", bing: "0123ABCDEF", yandex: "" });
    // SEO-PANEL (day 5): the panel reduces a pasted meta tag to its content value before the rule applies.
    assert.equal(seoSettingsInput.parse(withFields({ verification: { google: '<meta name="google-site-verification" content="x">', bing: "", yandex: "" } })).verification.google, "x");
    for (const bad of ["a b", "x".repeat(101), "kod/../", 'a"b']) {
      const result = seoSettingsInput.safeParse(withFields({ verification: { google: bad, bing: "", yandex: "" } }));
      assert.deepEqual(fieldErrors(result), ["verification.google"], bad);
    }
  });

  test("return days: whole number 0–365; freeReturns true / false / null", () => {
    for (const days of [0, 14, 365]) assert.ok(seoSettingsInput.safeParse(withFields({ returns: { days, freeReturns: null } })).success, String(days));
    for (const days of [-1, 366, 1.5]) assert.deepEqual(fieldErrors(seoSettingsInput.safeParse(withFields({ returns: { days, freeReturns: null } }))), ["returns.days"], String(days));
    for (const freeReturns of [true, false, null]) assert.ok(seoSettingsInput.safeParse(withFields({ returns: { days: 14, freeReturns } })).success);
    assert.deepEqual(fieldErrors(seoSettingsInput.safeParse(withFields({ returns: { days: 14, freeReturns: "yes" } }))), ["returns.freeReturns"]);
  });

  test("merchant category: a taxonomy id, a full path, or empty", () => {
    for (const value of ["3208", "2747", "", "Health & Beauty > Personal Care > Cosmetics > Bath & Body > Liquid Hand Soap"]) {
      assert.ok(seoSettingsInput.safeParse(withFields({ merchantCategory: value })).success, value);
    }
    for (const value of ["sabun", "12345678", "<b>x</b> > y", "x".repeat(251)]) {
      assert.deepEqual(fieldErrors(seoSettingsInput.safeParse(withFields({ merchantCategory: value }))), ["merchantCategory"], value);
    }
  });

  test("the panel schema keeps the new fields (a save round-trips them) and defaults them when missing", () => {
    const value = withFields({ verification: { google: "g1", bing: "b2", yandex: "y3" }, returns: { days: 30, freeReturns: true }, merchantCategory: "2747" });
    const saved = seoSettingsInput.parse(value);
    assert.deepEqual(settingsSchemas.seo.parse(saved), saved);
    assert.deepEqual(saved.verification, { google: "g1", bing: "b2", yandex: "y3" });
    assert.deepEqual(saved.returns, { days: 30, freeReturns: true });
    assert.equal(saved.merchantCategory, "2747");
    const { verification: _v, returns: _r, merchantCategory: _m, ...old } = value;
    void _v;
    void _r;
    void _m;
    const fromOldForm = seoSettingsInput.parse(old);
    assert.deepEqual(fromOldForm.verification, { google: "", bing: "", yandex: "" });
    assert.equal(fromOldForm.merchantCategory, "3208");
  });
});
