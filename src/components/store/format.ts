// Tiny pure helpers for store UI strings (safe in server and client components).

/** Replaces {name} placeholders; unknown placeholders are left as written. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

export type StockStatus = "in" | "low" | "out";

export function stockStatus(v: {
  stock: number;
  trackStock: boolean;
  allowBackorder: boolean;
  lowStockThreshold: number;
}): StockStatus {
  if (!v.trackStock || v.allowBackorder) return "in";
  if (v.stock <= 0) return "out";
  return v.stock <= v.lowStockThreshold ? "low" : "in";
}

/** "5 L", "20 L", "500 ml" */
export function formatVolume(ml: number | null | undefined, numberLocale: string): string | null {
  if (!ml || ml <= 0) return null;
  if (ml >= 1000) return `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1 }).format(ml / 1000)} L`;
  return `${ml} ml`;
}

/** Serializes JSON-LD safely for an inline <script>. */
export function jsonLd(data: unknown): string {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const BS = String.fromCharCode(92);
  return JSON.stringify(data).split("<").join(BS + "u003c").split(LS).join(BS + "u2028").split(PS).join(BS + "u2029");
}
