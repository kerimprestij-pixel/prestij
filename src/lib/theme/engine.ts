// Theme engine: pure color math (OKLCH via culori), no server or React runtime dependencies.
// Safe to import from server and client components and from plain Node scripts.
import type { CSSProperties } from "react";
import {
  clampChroma,
  formatHex,
  modeLrgb,
  modeOklab,
  modeOklch,
  modeRgb,
  parse,
  useMode as registerMode,
  wcagContrast,
} from "culori/fn";
import type { ThemeTokens } from "@/db/schema";
import { DEFAULT_THEME_TOKENS } from "./defaults";

// culori/fn is tree-shakeable: register only the color spaces the engine needs.
registerMode(modeRgb);
registerMode(modeLrgb);
const toOklab = registerMode(modeOklab);
const toOklch = registerMode(modeOklch);

export const PALETTE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type PaletteStep = (typeof PALETTE_STEPS)[number];
export type Palette = Record<PaletteStep, string>;

export const LIGHT_TEXT = "#ffffff";
export const DARK_TEXT = "#0b1630";
export type ContrastText = typeof LIGHT_TEXT | typeof DARK_TEXT;

/** WCAG AA for normal text. Generated pairs aim slightly higher so hex rounding never drops below it. */
export const AA = 4.5;
const AA_TARGET = 4.6;
/** WCAG 1.4.11 non-text contrast (focus rings, input borders). */
const UI_TARGET = 3.2;
/** Secondary text is often small and light-weight: keep it comfortably above AA. */
const MUTED_TARGET = 5;

// Perceptual lightness ladder (OKLCH L) and relative chroma per step (1 = most saturated).
// 500/600 sit on either side of the band (L≈0.57–0.60) where neither white nor navy text reaches AA.
const LIGHTNESS = [0.975, 0.935, 0.875, 0.795, 0.705, 0.62, 0.53, 0.445, 0.365, 0.285, 0.205];
const CHROMA = [0.12, 0.25, 0.48, 0.72, 0.9, 1, 1, 0.92, 0.8, 0.68, 0.55];
/** Light/dark seeds may be desaturated by the ladder; boost their mid-tones, but only a little. */
const MAX_CHROMA_BOOST = 1.25;
/** Generated steps stay below the sRGB edge: edge-clipped tones look garish (mustard golds, cyan blues). */
const GAMUT_HEADROOM = 0.88;

type Lch = { l: number; c: number; h: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function toLch(input: string | null | undefined): Lch | null {
  if (typeof input !== "string" || input.length > 64) return null;
  const parsed = parse(input.trim());
  if (!parsed) return null;
  const o = toOklch(parsed);
  if (!o || !Number.isFinite(o.l)) return null;
  const c = Number.isFinite(o.c) ? o.c : 0;
  const achromatic = c < 0.002 || o.h === undefined || !Number.isFinite(o.h);
  return { l: clamp(o.l, 0, 1), c: achromatic ? 0 : c, h: achromatic ? 0 : (o.h as number) };
}

/** OKLCH → sRGB hex, reducing chroma (never lightness or hue) until the color fits the sRGB gamut. */
function hexOf({ l, c, h }: Lch): string {
  const fitted = clampChroma({ mode: "oklch", l: clamp(l, 0, 1), c: Math.max(0, c), h }, "oklch");
  return formatHex(fitted) ?? "#000000";
}

/** Largest chroma that fits sRGB at this lightness and hue. */
function maxChroma(l: number, h: number): number {
  const fitted = clampChroma({ mode: "oklch", l: clamp(l, 0, 1), c: 0.4, h }, "oklch");
  return fitted.c ?? 0;
}

/** Normalizes any CSS color to a lowercase #rrggbb, or null when invalid (keeps DB input out of raw CSS). */
export function normalizeHex(input: string | null | undefined): string | null {
  if (typeof input !== "string" || input.length > 64) return null;
  const parsed = parse(input.trim());
  return parsed ? (formatHex(parsed) ?? null) : null;
}

export function contrastRatio(a: string, b: string): number {
  const ca = parse(a);
  const cb = parse(b);
  if (!ca || !cb) return 1;
  return wcagContrast(ca, cb);
}

/** White or deep navy, whichever reads better on `hex` (the higher WCAG ratio). */
export function contrastText(hex: string): ContrastText {
  return contrastRatio(hex, LIGHT_TEXT) >= contrastRatio(hex, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

function bestTextContrast(hex: string): number {
  return Math.max(contrastRatio(hex, LIGHT_TEXT), contrastRatio(hex, DARK_TEXT));
}

/** Nudges lightness the shortest way out of the "no readable text" band, so every step has an AA text color. */
function fitForText(color: Lch): string {
  const hex = hexOf(color);
  if (bestTextContrast(hex) >= AA_TARGET) return hex;
  for (let d = 0.004; d <= 0.12; d += 0.004) {
    const lighter = hexOf({ ...color, l: color.l + d });
    if (contrastRatio(lighter, DARK_TEXT) >= AA_TARGET) return lighter;
    const darker = hexOf({ ...color, l: color.l - d });
    if (contrastRatio(darker, LIGHT_TEXT) >= AA_TARGET) return darker;
  }
  return hex;
}

/** The color itself unless no text color reaches AA on it; then the nearest color that does. */
function fitted(hex: string): string {
  const lch = toLch(hex);
  return lch ? fitForText(lch) : hex;
}

/**
 * Moves `fg` lightness (keeping hue) the shortest distance needed to reach `target` against every
 * background. Falls back to white/navy if no lightness works.
 */
export function ensureContrast(fg: string, backgrounds: string[], target = AA_TARGET): string {
  const lch = toLch(fg);
  const normalized = normalizeHex(fg);
  if (!lch || !normalized) return contrastText(backgrounds[0] ?? LIGHT_TEXT);
  const minRatio = (hex: string) => Math.min(...backgrounds.map((bg) => contrastRatio(hex, bg)));
  if (minRatio(normalized) >= target) return normalized;
  for (let d = 0.01; d <= 1; d += 0.01) {
    for (const l of [lch.l - d, lch.l + d]) {
      if (l < 0 || l > 1) continue;
      const candidate = hexOf({ ...lch, l });
      if (minRatio(candidate) >= target) return candidate;
    }
  }
  return minRatio(LIGHT_TEXT) >= minRatio(DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

/** Same hue family, shifted lightness/chroma (used for surfaces and hairlines). */
function shift(hex: string, { dl = 0, cMul = 1, dc = 0 }: { dl?: number; cMul?: number; dc?: number }): string {
  const lch = toLch(hex);
  if (!lch) return hex;
  return hexOf({ l: lch.l + dl, c: lch.c * cMul + (lch.c > 0 ? dc : 0), h: lch.h });
}

/** Linear mix in OKLab: t = 0 → a, t = 1 → b. */
function mix(a: string, b: string, t: number): string {
  const ca = toOklab(parse(a) ?? LIGHT_TEXT);
  const cb = toOklab(parse(b) ?? LIGHT_TEXT);
  if (!ca || !cb) return a;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return (
    formatHex({ mode: "oklab", l: lerp(ca.l, cb.l), a: lerp(ca.a, cb.a), b: lerp(ca.b, cb.b) }) ?? a
  );
}

/** The softest mix of `fg` toward `toward` that still reaches `target` on every background. */
function softest(fg: string, toward: string, backgrounds: string[], target: number, maxT = 0.6): string {
  for (let t = maxT; t > 0; t -= 0.02) {
    const candidate = mix(fg, toward, t);
    if (backgrounds.every((bg) => contrastRatio(candidate, bg) >= target)) return candidate;
  }
  return ensureContrast(fg, backgrounds, target);
}

/** First palette step (in the given order) that reaches `target` on every background. */
function pickStep(palette: Palette, steps: PaletteStep[], backgrounds: string[], target = AA_TARGET): string {
  for (const step of steps) {
    if (backgrounds.every((bg) => contrastRatio(palette[step], bg) >= target)) return palette[step];
  }
  return ensureContrast(palette[steps[steps.length - 1]], backgrounds, target);
}

const DARKER_STEPS: PaletteStep[] = [400, 500, 600, 700, 800, 900];
const LIGHTER_STEPS: PaletteStep[] = [300, 200, 100, 50];

// ---------------------------------------------------------------------------------------------
// Palettes

type Analysis = { palette: Palette; seedStep: PaletteStep };

function analyse(seed: Lch): Analysis {
  // The seed's "natural" step is the ladder entry closest to it in lightness.
  let k = 0;
  LIGHTNESS.forEach((l, i) => {
    if (Math.abs(l - seed.l) < Math.abs(LIGHTNESS[k] - seed.l)) k = i;
  });
  const delta = seed.l - LIGHTNESS[k];
  const peak = seed.c * Math.min(1 / CHROMA[k], MAX_CHROMA_BOOST);
  const palette = {} as Palette;
  PALETTE_STEPS.forEach((step, i) => {
    // Bend the ladder through the seed; the bend fades out over four steps.
    const l = LIGHTNESS[i] + delta * Math.max(0, 1 - Math.abs(i - k) / 4);
    const c = i === k ? seed.c : Math.min(peak * CHROMA[i], GAMUT_HEADROOM * maxChroma(l, seed.h));
    palette[step] = fitForText({ l, c, h: seed.h });
  });
  return { palette, seedStep: PALETTE_STEPS[k] };
}

const FALLBACK_SEED: Lch = toLch(DEFAULT_THEME_TOKENS.colors.accent) ?? { l: 0.76, c: 0.14, h: 80 };

/** 50…950 sRGB hex ramp that keeps the seed's hue; the seed lands on (or very near) its natural step. */
export function buildPalette(hex: string): Palette {
  return analyse(toLch(hex) ?? FALLBACK_SEED).palette;
}

/** The step a seed color naturally belongs to (e.g. #03265F → 900, #DDA82A → 300). */
export function seedStep(hex: string): PaletteStep {
  return analyse(toLch(hex) ?? FALLBACK_SEED).seedStep;
}

// ---------------------------------------------------------------------------------------------
// Theme tokens → CSS variables

type ThemeColors = ThemeTokens["colors"];
type Radius = NonNullable<ThemeTokens["radius"]>;
export type ResolvedThemeTokens = ThemeTokens & { colors: Required<ThemeColors> };
export type ThemeVarMap = Record<`--${string}`, string>;

const RADIUS: Record<Radius, string> = {
  none: "0px",
  sm: "0.25rem",
  md: "0.5rem",
  lg: "0.875rem",
  full: "1.25rem",
};

const FONT_STACKS: Record<string, string> = {
  // Inner fallbacks keep the declaration valid where the next/font variables are not defined.
  cormorant: 'var(--font-cormorant, Georgia), Georgia, "Times New Roman", serif',
  manrope: "var(--font-manrope, ui-sans-serif), ui-sans-serif, system-ui, sans-serif",
  naskh: "var(--font-naskh, serif), serif",
  "plex-arabic": "var(--font-plex-arabic, sans-serif), sans-serif",
  serif: 'Georgia, "Times New Roman", serif',
  sans: "ui-sans-serif, system-ui, sans-serif",
};

/**
 * The same stacks for italic text: Cormorant italic is its own next/font face (src/lib/fonts.ts, not
 * preloaded), so italic heading text names it first. globals.css puts this stack in --font-heading on
 * italic elements. Fonts without a separate italic face keep their stack.
 */
const ITALIC_FONT_STACKS: Record<string, string> = {
  ...FONT_STACKS,
  cormorant: 'var(--font-cormorant-italic, var(--font-cormorant, Georgia)), Georgia, "Times New Roman", serif',
};

/** Known stack key, or a sanitized family name placed in front of the default stack. */
function fontStack(value: string | undefined, fallbackKey: "cormorant" | "manrope", stacks = FONT_STACKS): string {
  const fallback = stacks[fallbackKey];
  if (!value) return fallback;
  const key = value.trim().toLowerCase();
  if (Object.hasOwn(stacks, key)) return stacks[key];
  return /^[\p{L}\p{N} -]{1,60}$/u.test(value.trim()) ? `"${value.trim()}", ${fallback}` : fallback;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Merges possibly partial/invalid DB tokens over the defaults; every color comes out as a valid hex. */
export function resolveThemeTokens(input: unknown): ResolvedThemeTokens {
  const t = isRecord(input) ? input : {};
  const colors = isRecord(t.colors) ? t.colors : {};
  const d = DEFAULT_THEME_TOKENS.colors;
  const pick = (key: keyof ThemeColors, fallback: string) => normalizeHex(str(colors[key])) ?? normalizeHex(fallback)!;

  let dark: ThemeTokens["dark"];
  if (isRecord(t.dark)) {
    const darkColors: Partial<ThemeColors> = {};
    for (const key of ["brand", "accent", "background", "surface", "text"] as const) {
      const hex = normalizeHex(str(t.dark[key]));
      if (hex) darkColors[key] = hex;
    }
    dark = darkColors;
  }

  const radius = str(t.radius);
  const fonts = isRecord(t.fonts) ? { heading: str(t.fonts.heading), body: str(t.fonts.body) } : undefined;
  const decor = isRecord(t.decor) ? { pattern: str(t.decor.pattern), heroOverlay: str(t.decor.heroOverlay) } : undefined;

  return {
    colors: {
      brand: pick("brand", d.brand),
      accent: pick("accent", d.accent),
      background: pick("background", d.background ?? "#F9F8F5"),
      surface: pick("surface", d.surface ?? "#FFFFFF"),
      text: pick("text", d.text ?? "#14284B"),
    },
    dark,
    radius: radius && Object.hasOwn(RADIUS, radius) ? (radius as Radius) : (DEFAULT_THEME_TOKENS.radius ?? "md"),
    fonts,
    decor,
  };
}

function paletteVars(prefix: string, palette: Palette): ThemeVarMap {
  const vars: ThemeVarMap = {};
  for (const step of PALETTE_STEPS) vars[`--${prefix}-${step}`] = palette[step];
  return vars;
}

/** All theme CSS variables for light (`:root`) and dark (`.dark`). */
export function themeVars(input: ThemeTokens | unknown): { light: ThemeVarMap; dark: ThemeVarMap } {
  const tokens = resolveThemeTokens(input);
  const { brand, accent, background: bg, surface, text: textSeed } = tokens.colors;
  const brandPalette = buildPalette(brand);
  const goldPalette = buildPalette(accent);
  const brandLch = toLch(brand) ?? { l: 0.29, c: 0.11, h: 262 };
  const accentLch = toLch(accent) ?? FALLBACK_SEED;

  // Light ---------------------------------------------------------------------------------
  const surface2 = shift(bg, { dl: -0.03, cMul: 1.4, dc: 0.002 });
  const lightSurfaces = [bg, surface, surface2];
  const text = ensureContrast(textSeed, lightSurfaces);
  const productSoft = goldPalette[100];
  // Brand/accent are used as-is unless no text color could reach AA on them (then nudged slightly).
  const brandFill = fitted(brand);
  const goldFill = fitted(accent);

  const light: ThemeVarMap = {
    "--bg": bg,
    "--surface": surface,
    "--surface-2": surface2,
    "--text": text,
    "--text-muted": softest(text, bg, lightSurfaces, MUTED_TARGET),
    "--border": shift(bg, { dl: -0.068, cMul: 2.2, dc: 0.003 }),
    "--border-strong": softest(text, bg, lightSurfaces, UI_TARGET, 0.8),
    "--ring": pickStep(goldPalette, DARKER_STEPS, lightSurfaces, UI_TARGET),
    ...paletteVars("brand", brandPalette),
    "--brand": brandFill,
    "--brand-contrast": contrastText(brandFill),
    ...paletteVars("gold", goldPalette),
    "--gold": goldFill,
    "--gold-contrast": contrastText(goldFill),
    "--gold-text": pickStep(goldPalette, DARKER_STEPS, lightSurfaces),
    "--product": "var(--gold)",
    "--product-soft": productSoft,
    "--product-strong": pickStep(goldPalette, DARKER_STEPS.slice(3), [...lightSurfaces, productSoft]),
    "--product-contrast": "var(--gold-contrast)",
    "--radius": RADIUS[tokens.radius ?? "md"],
    "--control-radius": tokens.radius === "full" ? "9999px" : RADIUS[tokens.radius ?? "md"],
    "--font-heading": fontStack(tokens.fonts?.heading, "cormorant"),
    "--font-heading-italic": fontStack(tokens.fonts?.heading, "cormorant", ITALIC_FONT_STACKS),
    "--font-body": fontStack(tokens.fonts?.body, "manrope"),
  };

  // Dark: deep navy-black derived from the brand hue, ivory text, slightly lifted gold --------
  const dk = tokens.dark ?? {};
  const darkBg = dk.background ?? hexOf({ l: 0.175, c: Math.min(brandLch.c * 0.3, 0.03), h: brandLch.h });
  const darkSurface = dk.surface ?? shift(darkBg, { dl: 0.035 });
  const darkSurface2 = shift(darkBg, { dl: 0.075 });
  const darkSurfaces = [darkBg, darkSurface, darkSurface2];
  const darkText = ensureContrast(dk.text ?? bg, darkSurfaces);
  // A pale, ivory-leaning brand tint stands in for navy on the dark background.
  const darkBrand = fitted(dk.brand ?? ensureContrast(mix(brandPalette[200], bg, 0.3), darkSurfaces));
  const liftedGold = hexOf({ l: Math.max(accentLch.l, 0.76), c: accentLch.c * 0.92, h: accentLch.h });
  const darkGold = fitted(dk.accent ?? ensureContrast(liftedGold, darkSurfaces));
  const darkProductSoft = goldPalette[950];

  const dark: ThemeVarMap = {
    "--bg": darkBg,
    "--surface": darkSurface,
    "--surface-2": darkSurface2,
    "--text": darkText,
    "--text-muted": softest(darkText, darkBg, darkSurfaces, MUTED_TARGET),
    "--border": shift(darkBg, { dl: 0.12, cMul: 1.2 }),
    "--border-strong": softest(darkText, darkBg, darkSurfaces, UI_TARGET, 0.8),
    "--ring": ensureContrast(darkGold, darkSurfaces, UI_TARGET),
    "--brand": darkBrand,
    "--brand-contrast": contrastText(darkBrand),
    "--gold": darkGold,
    "--gold-contrast": contrastText(darkGold),
    "--gold-text": ensureContrast(darkGold, darkSurfaces),
    "--product": "var(--gold)",
    "--product-soft": darkProductSoft,
    "--product-strong": pickStep(goldPalette, LIGHTER_STEPS, [...darkSurfaces, darkProductSoft]),
    "--product-contrast": "var(--gold-contrast)",
  };

  return { light, dark };
}

function cssBlock(selector: string, declarations: Record<string, string>, pretty: boolean): string {
  const entries = Object.entries(declarations);
  if (!pretty) return `${selector}{${entries.map(([k, v]) => `${k}:${v}`).join(";")}}`;
  return `${selector} {\n${entries.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;
}

/** CSS text for `:root` (light) and `.dark`. Every value is engine-generated, so it is safe inside <style>. */
export function buildThemeCss(tokens: ThemeTokens | unknown, options: { pretty?: boolean } = {}): string {
  const { light, dark } = themeVars(tokens);
  const pretty = options.pretty ?? false;
  return [
    cssBlock(":root", { "color-scheme": "light", ...light }, pretty),
    cssBlock(".dark", { "color-scheme": "dark", ...dark }, pretty),
  ].join(pretty ? "\n" : "");
}

// ---------------------------------------------------------------------------------------------
// Per-product scope

export type ProductThemeOverrides = { tint?: string | null; dark?: string | null } | null | undefined;

const STEP_ORDER = PALETTE_STEPS as readonly PaletteStep[];
const clampStep = (step: PaletteStep, min: PaletteStep, max: PaletteStep): PaletteStep =>
  STEP_ORDER[clamp(STEP_ORDER.indexOf(step), STEP_ORDER.indexOf(min), STEP_ORDER.indexOf(max))];

let referenceSurfaces: { light: string[]; dark: string[] } | null = null;
/** Surfaces of the default theme: product text colors are checked against these. */
function getReferenceSurfaces() {
  if (!referenceSurfaces) {
    const { light, dark } = themeVars(DEFAULT_THEME_TOKENS);
    referenceSurfaces = {
      light: [light["--bg"], light["--surface"], light["--surface-2"]],
      dark: [dark["--bg"], dark["--surface"], dark["--surface-2"]],
    };
  }
  return referenceSurfaces;
}

/** Every --p-* variable for a product accent color (exported for scripts and tests). */
export function productScopeVars(hex: string, overrides?: ProductThemeOverrides): ThemeVarMap {
  const { palette, seedStep: natural } = analyse(toLch(hex) ?? FALLBACK_SEED);
  const ref = getReferenceSurfaces();
  // The product color itself (as on the label) stays in a usable mid range in each mode.
  const base = palette[clampStep(natural, 300, 600)];
  const baseDark = palette[clampStep(natural, 300, 500)];
  const soft = normalizeHex(overrides?.tint) ?? palette[100];
  const softDark = normalizeHex(overrides?.dark) ?? palette[950];
  return {
    ...paletteVars("p", palette),
    "--p-base": base,
    "--p-contrast": contrastText(base),
    "--p-base-dark": baseDark,
    "--p-contrast-dark": contrastText(baseDark),
    "--p-soft": soft,
    "--p-soft-dark": softDark,
    "--p-strong": pickStep(palette, DARKER_STEPS.slice(3), [...ref.light, soft]),
    "--p-strong-dark": pickStep(palette, LIGHTER_STEPS, [...ref.dark, softDark]),
  };
}

const scopeCache = new Map<string, CSSProperties>();

/**
 * Inline style for `<div className="product-scope">`: sets --p-50…--p-950, --p-contrast and the
 * helpers globals.css maps to --product / --product-soft / --product-strong / --product-contrast.
 */
export function productScopeStyle(hex: string, overrides?: ProductThemeOverrides): CSSProperties {
  const key = `${hex}|${overrides?.tint ?? ""}|${overrides?.dark ?? ""}`;
  let style = scopeCache.get(key);
  if (!style) {
    style = productScopeVars(hex, overrides) as CSSProperties;
    if (scopeCache.size > 256) scopeCache.clear();
    scopeCache.set(key, style);
  }
  return style;
}
