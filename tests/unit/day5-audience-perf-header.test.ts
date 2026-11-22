// AUDIENCE-PERF (day 5): the header's account link reserves the signed-in greeting width before first
// paint (no layout shift when the viewer loads). Pure helpers plus the inline script, run against a
// fake document/localStorage.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ACCOUNT_WIDTH_ATTR,
  ACCOUNT_WIDTH_STORAGE_KEY,
  ACCOUNT_WIDTH_VAR,
  accountWidthKey,
  accountWidthPrePaintScript,
  accountWidthToStore,
  parseAccountWidth,
} from "@/components/store/account/account-link-width";

type FakeRoot = { vars: Map<string, string>; attrs: Map<string, string> };

/** Runs the pre-paint script on a <html lang> page with `stored` saved for `storedFor` (or a throwing storage). */
function runScript(stored: string | null | "throws", lang = "tr", storedFor = "tr"): FakeRoot {
  const root: FakeRoot = { vars: new Map(), attrs: new Map() };
  const documentElement = {
    lang,
    style: { setProperty: (name: string, value: string) => root.vars.set(name, value) },
    setAttribute: (name: string, value: string) => root.attrs.set(name, value),
  };
  const localStorage = {
    getItem: (key: string) => {
      if (stored === "throws") throw new Error("SecurityError");
      return key === accountWidthKey(storedFor) ? stored : null;
    },
  };
  new Function("localStorage", "document", accountWidthPrePaintScript())(localStorage, { documentElement });
  return root;
}

describe("account link width", () => {
  test("parseAccountWidth accepts whole pixels between the icon size and the greeting maximum", () => {
    assert.equal(parseAccountWidth("112"), 112);
    assert.equal(parseAccountWidth("41"), 41);
    assert.equal(parseAccountWidth("240"), 240);
    for (const raw of [null, undefined, "", "40", "241", "12.5", "-90", "112px", " 112", "1e2", "abc"]) {
      assert.equal(parseAccountWidth(raw), null, String(raw));
    }
  });

  test("accountWidthToStore rounds up and rejects implausible measurements", () => {
    assert.equal(accountWidthToStore(106.2), 107);
    assert.equal(accountWidthToStore(44), 44);
    assert.equal(accountWidthToStore(40), null); // the plain icon button: nothing to reserve
    assert.equal(accountWidthToStore(500), null);
    assert.equal(accountWidthToStore(Number.NaN), null);
    assert.equal(accountWidthToStore(Number.POSITIVE_INFINITY), null);
  });

  test("the pre-paint script reserves a stored width on <html>", () => {
    const root = runScript("112");
    assert.equal(root.vars.get(ACCOUNT_WIDTH_VAR), "112px");
    assert.equal(root.attrs.get(ACCOUNT_WIDTH_ATTR), "");
  });

  test("widths are kept per language (the greeting differs: 'Merhaba, …' vs 'Hello, …')", () => {
    assert.equal(accountWidthKey("tr"), `${ACCOUNT_WIDTH_STORAGE_KEY}:tr`);
    assert.notEqual(accountWidthKey("tr"), accountWidthKey("en"));
    assert.equal(runScript("144", "tr", "tr").vars.get(ACCOUNT_WIDTH_VAR), "144px");
    // An English page does not borrow the Turkish width.
    assert.equal(runScript("144", "en", "tr").vars.size, 0);
    assert.equal(runScript("119", "en", "en").vars.get(ACCOUNT_WIDTH_VAR), "119px");
    // Leading zeros are normalized ("0041" → 41px).
    assert.equal(runScript("0041").vars.get(ACCOUNT_WIDTH_VAR), "41px");
  });

  test("the pre-paint script does nothing without a valid width, and never throws", () => {
    for (const stored of [null, "", "40", "999", "12px", "<b>", "throws"] as const) {
      const root = runScript(stored);
      assert.equal(root.vars.size, 0, String(stored));
      assert.equal(root.attrs.size, 0, String(stored));
    }
  });

  test("the script agrees with parseAccountWidth on every boundary", () => {
    for (const raw of ["40", "41", "100", "240", "241", "0041"]) {
      const applied = runScript(raw).vars.has(ACCOUNT_WIDTH_VAR);
      assert.equal(applied, parseAccountWidth(raw) != null, raw);
    }
  });

  test("the script only names constants (no markup that could end the <script> early)", () => {
    const script = accountWidthPrePaintScript();
    assert.ok(!script.includes("</"), "no closing tag sequence");
    assert.ok(script.startsWith("try{") && script.endsWith("catch(e){}"));
  });
});
