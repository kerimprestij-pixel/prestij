// Theme editor: contrast report (same variables as the storefront), payload schema and token mapping.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { tokensFromInput, themeSaveSchema } from "@/lib/panel/theme/schemas";
import { themeContrastReport } from "@/lib/theme/contrast-report";
import { DEFAULT_THEME_TOKENS } from "@/lib/theme/defaults";
import { buildThemeCss, themeVars } from "@/lib/theme/engine";

const VALID = {
  id: 2,
  name: " Kış 2026 ",
  colors: { brand: "#03265f", accent: "#DDA82A", background: "#F9F8F5", surface: "#fff", text: "#14284B" },
  dark: { brand: "", accent: null, background: "#0B1324", surface: "", text: "" },
  radius: "sm",
  fonts: { heading: "cormorant", body: "manrope" },
  isScheduled: false,
  schedule: { startsAt: null, endsAt: null },
  priority: 10,
  updatedAt: "2026-11-09T10:00:00.000Z",
};

describe("themeContrastReport", () => {
  test("the default theme passes every pair in light and dark", () => {
    const report = themeContrastReport(DEFAULT_THEME_TOKENS);
    assert.equal(report.total, report.light.checks.length + report.dark.checks.length);
    assert.equal(report.passed, report.total, JSON.stringify([...report.light.checks, ...report.dark.checks].filter((c) => !c.pass)));
    assert.deepEqual(report.light.adjustments, []);
  });

  test("checks use the storefront's generated variables", () => {
    const { light, dark } = themeVars(DEFAULT_THEME_TOKENS);
    const report = themeContrastReport(DEFAULT_THEME_TOKENS);
    const textBg = report.light.checks.find((c) => c.id === "text-bg")!;
    assert.equal(textBg.fg, light["--text"]);
    assert.equal(textBg.bg, light["--bg"]);
    const darkText = report.dark.checks.find((c) => c.id === "text-bg")!;
    assert.equal(darkText.fg, dark["--text"]);
    assert.equal(darkText.bg, dark["--bg"]);
    // Same values the <style> tag gets.
    assert.ok(buildThemeCss(DEFAULT_THEME_TOKENS).includes(`--text:${light["--text"]}`));
  });

  test("a careless text color is adjusted by the engine and reported as such; pairs still pass", () => {
    const report = themeContrastReport({ colors: { ...DEFAULT_THEME_TOKENS.colors, text: "#B0B0B0" }, radius: "md" });
    const adjusted = report.light.adjustments.find((a) => a.id === "text");
    assert.ok(adjusted, "text adjustment reported");
    assert.equal(adjusted.chosen, "#b0b0b0");
    assert.notEqual(adjusted.used, "#b0b0b0");
    assert.ok(report.light.checks.find((c) => c.id === "text-bg")!.pass);
  });

  test("a dark override that cannot work is visible in the dark checks", () => {
    // Dark background as light as the text: the engine moves the text, the brand tint stays readable.
    const report = themeContrastReport({ ...DEFAULT_THEME_TOKENS, dark: { background: "#F0F0F0", text: "#FFFFFF" } });
    const darkText = report.dark.checks.find((c) => c.id === "text-bg")!;
    assert.equal(darkText.pass, true);
    assert.ok(report.dark.adjustments.some((a) => a.id === "text"));
  });
});

describe("themeSaveSchema", () => {
  test("normalizes colors, trims the name and drops empty dark colors", () => {
    const parsed = themeSaveSchema.parse(VALID);
    assert.equal(parsed.name, "Kış 2026");
    assert.equal(parsed.colors.brand, "#03265F");
    assert.equal(parsed.colors.surface, "#FFFFFF");
    assert.equal(parsed.dark.brand, null);
    assert.equal(parsed.dark.accent, null);
    assert.equal(parsed.dark.background, "#0B1324");
    assert.ok(parsed.updatedAt instanceof Date);
  });

  test("a scheduled theme needs both start and end, and the end after the start", () => {
    const missing = themeSaveSchema.safeParse({ ...VALID, isScheduled: true });
    assert.equal(missing.success, false);
    const paths = missing.error!.issues.map((i) => i.path.join("."));
    assert.ok(paths.includes("schedule.startsAt") && paths.includes("schedule.endsAt"), paths.join(","));
    const reversed = themeSaveSchema.safeParse({
      ...VALID,
      isScheduled: true,
      schedule: { startsAt: "2026-12-20T10:00", endsAt: "2026-12-10T10:00" },
    });
    assert.equal(reversed.success, false);
    assert.equal(reversed.error!.issues[0].path.join("."), "schedule.endsAt");
    const ok = themeSaveSchema.safeParse({ ...VALID, isScheduled: true, schedule: { startsAt: "2026-12-14T00:00", endsAt: "2027-01-02T23:59" } });
    assert.equal(ok.success, true);
    // datetime-local values are Istanbul time (UTC+3).
    assert.equal(ok.data!.schedule.startsAt!.toISOString(), "2026-12-13T21:00:00.000Z");
  });

  test("rejects unknown fonts and radii, bad colors and out-of-range priorities", () => {
    for (const bad of [
      { fonts: { heading: "Comic Sans", body: "manrope" } },
      { radius: "huge" },
      { colors: { ...VALID.colors, brand: "navy" } },
      { colors: { ...VALID.colors, text: "#12345" } },
      { priority: 101 },
      { priority: -1 },
      { priority: 1.5 },
      { name: "   " },
      { updatedAt: undefined },
    ]) {
      assert.equal(themeSaveSchema.safeParse({ ...VALID, ...bad }).success, false, JSON.stringify(bad));
    }
  });
});

describe("tokensFromInput", () => {
  test("keeps only set dark colors and the decor the panel does not edit", () => {
    const parsed = themeSaveSchema.parse(VALID);
    const tokens = tokensFromInput(parsed, { decor: { pattern: "snowflakes" } });
    assert.deepEqual(tokens.dark, { background: "#0B1324" });
    assert.deepEqual(tokens.decor, { pattern: "snowflakes" });
    assert.deepEqual(tokens.fonts, { heading: "cormorant", body: "manrope" });
    assert.equal(tokens.radius, "sm");
    const noDark = tokensFromInput({ ...parsed, dark: { brand: null, accent: null, background: null, surface: null, text: null } });
    assert.equal("dark" in noDark, false);
  });
});
