// WCAG contrast report for a theme, computed from the same CSS variables the storefront gets
// (themeVars), so the panel shows exactly what visitors will see. Pure: client- and test-safe.
import type { ThemeTokens } from "@/db/schema";
import { AA, contrastRatio, normalizeHex, resolveThemeTokens, themeVars, type ThemeVarMap } from "./engine";

/** WCAG 1.4.11: focus rings and input borders need 3:1. */
export const UI_CONTRAST = 3;

export type ContrastCheck = {
  id: string;
  /** Turkish label for the panel. */
  label: string;
  /** Where the pair appears on the storefront. */
  usage: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  pass: boolean;
};

/** A seed color the engine changed so that text on/with it stays readable. */
export type ContrastAdjustment = { id: string; label: string; chosen: string; used: string };

export type ThemeModeReport = { checks: ContrastCheck[]; adjustments: ContrastAdjustment[] };
export type ThemeContrastReport = { light: ThemeModeReport; dark: ThemeModeReport; passed: number; total: number };

type PairSpec = { id: string; label: string; usage: string; fg: `--${string}`; bg: `--${string}`; min?: number };

const PAIRS: PairSpec[] = [
  { id: "text-bg", label: "Metin / arka plan", usage: "Sayfa metinleri", fg: "--text", bg: "--bg" },
  { id: "text-surface", label: "Metin / kart yüzeyi", usage: "Kartlar, sepet, formlar", fg: "--text", bg: "--surface" },
  { id: "muted-bg", label: "İkincil metin / arka plan", usage: "Açıklamalar, fiyat notları", fg: "--text-muted", bg: "--bg" },
  { id: "muted-surface2", label: "İkincil metin / ikincil yüzey", usage: "Gri kutular, duyuru (sade)", fg: "--text-muted", bg: "--surface-2" },
  { id: "gold-text-bg", label: "Vurgu yazısı / arka plan", usage: "Üst başlıklar (eyebrow)", fg: "--gold-text", bg: "--bg" },
  { id: "brand-button", label: "Ana buton yazısı / ana renk", usage: "Ana butonlar, duyuru şeridi", fg: "--brand-contrast", bg: "--brand" },
  { id: "gold-button", label: "Vurgu buton yazısı / vurgu rengi", usage: "Sepet sayacı, vurgulu duyuru", fg: "--gold-contrast", bg: "--gold" },
  { id: "product-strong", label: "Ürün koyu tonu / ürün zemini", usage: "Ürün sayfası rozetleri", fg: "--product-strong", bg: "--product-soft" },
  { id: "ring", label: "Odak halkası / arka plan", usage: "Klavyeyle gezinme", fg: "--ring", bg: "--bg", min: UI_CONTRAST },
  { id: "border-strong", label: "Belirgin kenarlık / kart yüzeyi", usage: "Form alanları", fg: "--border-strong", bg: "--surface", min: UI_CONTRAST },
];

const DARK_ONLY: PairSpec[] = [
  { id: "brand-text-dark", label: "Ana renk (yazı olarak) / arka plan", usage: "Logo ve bağlantılar (koyu)", fg: "--brand", bg: "--bg" },
];

function checksFor(vars: ThemeVarMap, pairs: PairSpec[]): ContrastCheck[] {
  return pairs.map((pair) => {
    const fg = vars[pair.fg];
    const bg = vars[pair.bg];
    const ratio = contrastRatio(fg, bg);
    const min = pair.min ?? AA;
    return { id: pair.id, label: pair.label, usage: pair.usage, fg, bg, ratio, min, pass: ratio >= min };
  });
}

function adjustment(id: string, label: string, chosen: string | undefined, used: string): ContrastAdjustment | null {
  const a = normalizeHex(chosen);
  const b = normalizeHex(used);
  return a && b && a !== b ? { id, label, chosen: a, used: b } : null;
}

/** Contrast checks for light and dark, plus the seed colors the engine had to adjust. */
export function themeContrastReport(input: ThemeTokens | unknown): ThemeContrastReport {
  const tokens = resolveThemeTokens(input);
  const { light, dark } = themeVars(tokens);
  const darkVars = { ...light, ...dark };

  const lightAdjust = [
    adjustment("text", "Metin rengi", tokens.colors.text, light["--text"]),
    adjustment("brand", "Ana renk", tokens.colors.brand, light["--brand"]),
    adjustment("accent", "Vurgu rengi", tokens.colors.accent, light["--gold"]),
  ].filter((a): a is ContrastAdjustment => a !== null);

  const d = tokens.dark ?? {};
  const darkAdjust = [
    d.text ? adjustment("text", "Metin rengi (koyu)", d.text, dark["--text"]) : null,
    d.brand ? adjustment("brand", "Ana renk (koyu)", d.brand, dark["--brand"]) : null,
    d.accent ? adjustment("accent", "Vurgu rengi (koyu)", d.accent, dark["--gold"]) : null,
  ].filter((a): a is ContrastAdjustment => a !== null);

  const lightChecks = checksFor(light, PAIRS);
  const darkChecks = checksFor(darkVars, [...PAIRS, ...DARK_ONLY]);
  const all = [...lightChecks, ...darkChecks];
  return {
    light: { checks: lightChecks, adjustments: lightAdjust },
    dark: { checks: darkChecks, adjustments: darkAdjust },
    passed: all.filter((c) => c.pass).length,
    total: all.length,
  };
}
