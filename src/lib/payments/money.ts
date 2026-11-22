// Amount formats the card providers expect (pure: safe in unit tests). Money is integer kuruş everywhere
// else in the project; these helpers are the only place where it becomes a provider's string format.
//   iyzico: decimal strings, formatted like iyzipay-node's utils.formatPrice ("129.9", "130.0").
//   PayTR:  payment_amount / total_amount are kuruş integers (34.56 TL → 3456); basket prices and
//           return_amount are decimal strings with a dot ("18.00", "11.97").

function assertKurus(kurus: number): void {
  if (!Number.isSafeInteger(kurus) || kurus < 0) throw new RangeError(`Invalid kuruş amount: ${kurus}`);
}

/** 12990 → "129.9", 13000 → "130.0", 12995 → "129.95" (iyzipay-node utils.formatPrice). */
export function iyzicoPrice(kurus: number): string {
  assertKurus(kurus);
  const lira = Math.floor(kurus / 100);
  const rest = kurus % 100;
  if (rest === 0) return `${lira}.0`;
  return `${lira}.${String(rest).padStart(2, "0")}`.replace(/0$/, "");
}

/** Two-decimal string with a dot: 1800 → "18.00", 1197 → "11.97" (PayTR basket prices, return_amount). */
export function decimal2(kurus: number): string {
  assertKurus(kurus);
  return `${Math.floor(kurus / 100)}.${String(kurus % 100).padStart(2, "0")}`;
}

/** PayTR payment_amount: the amount × 100 as an integer string, i.e. the kuruş value itself. */
export function paytrAmount(kurus: number): string {
  assertKurus(kurus);
  return String(kurus);
}

/**
 * iyzico's signature rule for price fields ("Trailing Zero", docs.iyzico.com/en/advanced/response-signature-validation):
 * "10" → "10", "10.0" → "10", "10.50" → "10.5", "10.5105" → "10.5105". Numbers are stringified first.
 */
export function trimTrailingZeros(value: string | number): string {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * A provider's decimal amount ("129.90", "129.9", 129.9, "130") → kuruş. Null for anything that is not a
 * non-negative amount with at most two significant decimals (e.g. "1.234", "-5", "abc", NaN).
 */
export function parseDecimalAmount(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const kurus = Math.round(value * 100);
    return Math.abs(kurus - value * 100) < 1e-6 && Number.isSafeInteger(kurus) ? kurus : null;
  }
  if (typeof value !== "string") return null;
  const match = /^(\d{1,12})(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const decimals = match[2] ?? "";
  if (/[1-9]/.test(decimals.slice(2))) return null;
  return Number(match[1]) * 100 + Number(decimals.slice(0, 2).padEnd(2, "0"));
}

/**
 * PayTR Durum Sorgu amounts (payment_amount, payment_total, net_tutar): decimal currency units, NOT × 100. The
 * docs' examples mix a comma and a dot ("10,8", "9.76"), so both are read as the decimal mark; with both present
 * the last one is the decimal mark and the other a thousands separator ("1.234,56" / "1,234.56" → 123456).
 * Anything with more than two significant decimals, a sign or other characters is null (never guessed).
 * PayTR-fix R1: a single "." or "," followed by exactly three digits is null too, whatever the digits: "1.500" is
 * 1500 TL in a tr-TR thousands format (Intl.NumberFormat("tr-TR") prints 1500 as "1.500" and 10.8 as "10,8", the
 * docs' example) but 1,50 TL as a decimal, and the lower reading must never be taken for a paid amount.
 */
export function parsePaytrDecimal(value: unknown): number | null {
  if (typeof value === "number") return parseDecimalAmount(value);
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (!/^[\d.,]{1,20}$/.test(text)) return null;
  if (/^\d+[.,]\d{3}$/.test(text)) return null; // ambiguous (see above)
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimalMark = comma > dot ? "," : ".";
    const thousands = decimalMark === "," ? "." : ",";
    const [whole, ...rest] = text.split(decimalMark);
    if (rest.length !== 1 || !/^\d{1,3}(?:[.,]\d{3})*$/.test(whole) || whole.includes(decimalMark)) return null;
    text = `${whole.split(thousands).join("")}.${rest[0]}`;
  } else if (comma >= 0) {
    if (text.indexOf(",") !== comma) return null;
    text = text.replace(",", ".");
  } else if (dot >= 0 && text.indexOf(".") !== dot) {
    return null;
  }
  return parseDecimalAmount(text);
}

/** A PayTR kuruş integer string ("3456") → 3456; null when not a plain non-negative integer. */
export function parseKurusInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value.trim())) return null;
  return Number(value.trim());
}
