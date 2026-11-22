// E-mail colors and fonts (pure): the light palette of the storefront's default theme, computed by the
// same engine (so the client's theme edits show up in e-mails too). Mail clients get plain hex values.
import { DEFAULT_THEME_TOKENS } from "@/lib/theme/defaults";
import { themeVars } from "@/lib/theme/engine";

export type EmailTheme = {
  /** Outer background (ivory). */
  bg: string;
  /** The card. */
  surface: string;
  /** Tinted boxes (notices, bank accounts, totals). */
  surface2: string;
  text: string;
  muted: string;
  border: string;
  brand: string;
  brandContrast: string;
  gold: string;
  /** Gold dark enough for small text on light backgrounds (eyebrows). */
  goldText: string;
  success: string;
  warning: string;
  /** Red accent of "danger" notices (e.g. a test payment in the admin new-order mail). */
  danger: string;
  /** Font stacks: no web fonts (mail clients block them); a serif for headings. */
  fontBody: string;
  fontHeading: string;
};

// Single quotes only: these go inside style="…" attributes.
const FONT_BODY_LTR = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const FONT_HEADING_LTR = `Georgia, 'Times New Roman', Times, serif`;
const FONT_BODY_RTL = `Tahoma, 'Segoe UI', 'Geeza Pro', 'Noto Sans Arabic', Arial, sans-serif`;
const FONT_HEADING_RTL = `'Times New Roman', 'Geeza Pro', 'Noto Naskh Arabic', Tahoma, serif`;

/** Colors from theme tokens (a `themes.tokens` value); invalid or missing tokens fall back to PRESTİJ Klasik. */
export function emailTheme(tokens: unknown = DEFAULT_THEME_TOKENS, dir: "ltr" | "rtl" = "ltr"): EmailTheme {
  let light: Record<string, string>;
  try {
    light = themeVars(tokens ?? DEFAULT_THEME_TOKENS).light;
  } catch {
    light = themeVars(DEFAULT_THEME_TOKENS).light;
  }
  const pick = (key: string, fallback: string) => {
    const value = light[key];
    return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
  };
  return {
    bg: pick("--bg", "#F9F8F5"),
    surface: pick("--surface", "#FFFFFF"),
    surface2: pick("--surface-2", "#F3F0E9"),
    text: pick("--text", "#14284B"),
    muted: pick("--text-muted", "#5B6478"),
    border: pick("--border", "#E6E2DA"),
    brand: pick("--brand", "#03265F"),
    brandContrast: pick("--brand-contrast", "#FFFFFF"),
    gold: pick("--gold", "#DDA82A"),
    goldText: pick("--gold-text", "#8A6414"),
    success: "#2F6F4F",
    warning: "#9A5B13",
    danger: "#B42318",
    fontBody: dir === "rtl" ? FONT_BODY_RTL : FONT_BODY_LTR,
    fontHeading: dir === "rtl" ? FONT_HEADING_RTL : FONT_HEADING_LTR,
  };
}
