// Prints the theme engine's palettes and verifies every text/UI color pair it generates.
//   npx tsx scripts/check-theme.ts            → report; exits 1 if any pair fails
//   npx tsx scripts/check-theme.ts --write    → also refreshes the fallback block in src/app/globals.css
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AA,
  PALETTE_STEPS,
  buildPalette,
  buildThemeCss,
  contrastRatio,
  contrastText,
  productScopeVars,
  seedStep,
  themeVars,
} from "../src/lib/theme/engine";
import { DEFAULT_THEME_TOKENS } from "../src/lib/theme/defaults";

const SEEDS: Record<string, string> = {
  "Brand navy": "#03265F",
  "Logo gold": "#DDA82A",
  "Lavanta Latte": "#C2ADD1",
  Lavanta: "#8E61B6",
  Portakal: "#E9952E",
  Okyanus: "#329BC0",
};
const UI = 3;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
function swatch(hex: string): string {
  if (!color) return "";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `\x1b[48;2;${r};${g};${b}m    \x1b[0m `;
}
const fmt = (n: number) => n.toFixed(2).padStart(5);

let failures = 0;
function check(label: string, fg: string, bg: string, min = AA): void {
  const ratio = contrastRatio(fg, bg);
  const ok = ratio >= min;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${fmt(ratio)} ≥ ${min}  ${swatch(bg)}${label}  (${fg} on ${bg})`);
}

// 1. Palettes ------------------------------------------------------------------------------
for (const [name, hex] of Object.entries(SEEDS)) {
  const palette = buildPalette(hex);
  console.log(`\n${name} ${hex} → natural step ${seedStep(hex)}`);
  for (const step of PALETTE_STEPS) {
    const value = palette[step];
    const text = contrastText(value);
    console.log(
      `  ${String(step).padStart(3)} ${swatch(value)}${value}  text ${text === "#ffffff" ? "white" : "navy "} ${fmt(contrastRatio(text, value))}`,
    );
  }
  for (const step of [500, 600] as const) check(`contrastText on ${step}`, contrastText(palette[step]), palette[step]);
}

// 2. Default theme ---------------------------------------------------------------------------
const { light, dark } = themeVars(DEFAULT_THEME_TOKENS);
for (const [mode, v] of [
  ["light", light],
  ["dark", dark],
] as const) {
  console.log(`\nDefault theme (${mode})`);
  const surfaces = [v["--bg"], v["--surface"], v["--surface-2"]];
  for (const s of surfaces) {
    check("text", v["--text"], s);
    check("text-muted", v["--text-muted"], s);
    check("gold-text (eyebrows)", v["--gold-text"], s);
    check("product-strong", v["--product-strong"], s);
    check("ring", v["--ring"], s, UI);
    check("border-strong", v["--border-strong"], s, UI);
  }
  check("product-strong on product-soft", v["--product-strong"], v["--product-soft"]);
  check("brand-contrast on brand", v["--brand-contrast"], v["--brand"]);
  check("gold-contrast on gold (= product-contrast on product)", v["--gold-contrast"], v["--gold"]);
  if (mode === "dark") check("brand as text", v["--brand"], v["--bg"]);
}

// 3. Product scopes (light + dark) -----------------------------------------------------------
for (const [name, hex] of Object.entries(SEEDS)) {
  const p = productScopeVars(hex);
  console.log(`\nProduct scope ${name} ${hex}  base ${p["--p-base"]} / dark ${p["--p-base-dark"]}`);
  check("light: product-contrast on product", p["--p-contrast"], p["--p-base"]);
  check("dark:  product-contrast on product", p["--p-contrast-dark"], p["--p-base-dark"]);
  for (const bg of [light["--bg"], light["--surface"], light["--surface-2"], p["--p-soft"]])
    check("light: product-strong", p["--p-strong"], bg);
  for (const bg of [dark["--bg"], dark["--surface"], dark["--surface-2"], p["--p-soft-dark"]])
    check("dark:  product-strong", p["--p-strong-dark"], bg);
}

// 4. Random seeds and themes (deterministic): every step keeps an AA text color, ramps stay ordered,
//    and generated theme pairs pass even with careless admin input. -------------------------------
let rng = 20261106;
const random = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
const randomHex = (min = 0, max = 255) =>
  `#${[0, 0, 0].map(() => Math.floor(min + random() * (max - min)).toString(16).padStart(2, "0")).join("")}`;
const before = failures;
for (let i = 0; i < 300; i++) {
  const seed = randomHex();
  const palette = buildPalette(seed);
  PALETTE_STEPS.forEach((step, j) => {
    const value = palette[step];
    if (contrastRatio(contrastText(value), value) < AA) {
      failures++;
      console.log(`  FAIL seed ${seed}: step ${step} ${value} has no AA text color`);
    }
    const next = PALETTE_STEPS[j + 1];
    if (next && contrastRatio(value, "#000000") <= contrastRatio(palette[next], "#000000")) {
      failures++;
      console.log(`  FAIL seed ${seed}: step ${step} is not lighter than ${next}`);
    }
  });
}
for (let i = 0; i < 100; i++) {
  const tokens = {
    colors: { brand: randomHex(), accent: randomHex(), background: randomHex(225), surface: randomHex(235), text: randomHex() },
    radius: "md" as const,
  };
  const t = themeVars(tokens);
  for (const v of [t.light, t.dark]) {
    const pairs: [string, string, string, number][] = [];
    for (const s of [v["--bg"], v["--surface"], v["--surface-2"]]) {
      pairs.push(["text", v["--text"], s, AA], ["text-muted", v["--text-muted"], s, AA], ["gold-text", v["--gold-text"], s, AA]);
      pairs.push(["product-strong", v["--product-strong"], s, AA], ["ring", v["--ring"], s, UI]);
    }
    pairs.push(["brand-contrast", v["--brand-contrast"], v["--brand"], AA], ["gold-contrast", v["--gold-contrast"], v["--gold"], AA]);
    for (const [label, fg, bg, min] of pairs) {
      if (contrastRatio(fg, bg) < min) {
        failures++;
        console.log(`  FAIL random theme ${JSON.stringify(tokens.colors)}: ${label} ${fg} on ${bg}`);
      }
    }
  }
}
console.log(`\nRandom seeds/themes: ${failures === before ? "all passed" : `${failures - before} failure(s)`}`);

// 5. globals.css fallback (keeps pages without <ThemeStyle/> — e.g. the panel — on-brand) ------
const START = "/* @generated theme-fallback:start (npx tsx scripts/check-theme.ts --write) */";
const END = "/* @generated theme-fallback:end */";
const cssPath = join(process.cwd(), "src/app/globals.css");
const generated = buildThemeCss(DEFAULT_THEME_TOKENS, { pretty: true })
  .split("\n")
  .map((line) => (line ? `  ${line}` : line))
  .join("\n");
const css = readFileSync(cssPath, "utf8");
const start = css.indexOf(START);
const end = css.indexOf(END);
if (start === -1 || end === -1) {
  console.log("\nglobals.css: fallback markers not found");
  failures++;
} else {
  const current = css.slice(start + START.length, end).trim();
  if (current === generated.trim()) console.log("\nglobals.css fallback: up to date");
  else if (process.argv.includes("--write")) {
    writeFileSync(cssPath, `${css.slice(0, start + START.length)}\n${generated}\n  ${css.slice(end)}`);
    console.log("\nglobals.css fallback: rewritten");
  } else {
    console.log("\nglobals.css fallback: OUT OF DATE (run with --write)");
    failures++;
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll contrast checks passed");
process.exit(failures ? 1 : 0);
