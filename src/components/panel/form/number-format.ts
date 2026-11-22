// Lenient Turkish number parsing/formatting for NumberInput/PercentInput. Pure (client-safe).
// "1.250" → 1250 · "12,5" → 12.5 · "12.5" → 12.5. Money uses parseTryAmount/formatTryAmount (src/lib/panel/format.ts).

const grouped = new Map<number, Intl.NumberFormat>();
function formatter(decimals: number, fixed: boolean): Intl.NumberFormat {
  const key = decimals * 2 + (fixed ? 1 : 0);
  let f = grouped.get(key);
  if (!f) {
    f = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: fixed ? decimals : 0, maximumFractionDigits: decimals });
    grouped.set(key, f);
  }
  return f;
}

/** Normalizes Turkish/English digit groups into "-1234.56" (or null when it is not a number). */
function normalize(input: string): string | null {
  let s = input.trim().replace(/\s| |₺|%|TL/gi, "");
  if (!s) return null;
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  if (s.includes(",")) {
    // Comma is the decimal separator; dots are thousands.
    if ((s.match(/,/g) ?? []).length > 1) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d*\.?\d*$/.test(s) || s === "." || s === "") return null;
  if (s.startsWith(".")) s = `0${s}`;
  if (s.endsWith(".")) s = s.slice(0, -1);
  return negative ? `-${s}` : s;
}

/** Parses a Turkish-formatted number; null when empty or invalid. */
export function parseTrNumber(input: string): number | null {
  const s = normalize(input);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 1499.5 → "1.499,5" (up to `decimals` fraction digits). */
export function formatTrNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "";
  return formatter(decimals, false).format(value);
}
