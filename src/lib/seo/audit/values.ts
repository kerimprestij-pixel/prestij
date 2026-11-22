// Value checks shared by the JSON-LD and merchant feed rules. Pure.

/** GTIN-8/12/13/14 with a correct check digit (GS1 mod-10). `length` restricts it (13 for gtin13). */
export function isValidGtin(value: string, length?: 8 | 12 | 13 | 14): boolean {
  if (!/^\d+$/.test(value)) return false;
  if (length ? value.length !== length : ![8, 12, 13, 14].includes(value.length)) return false;
  const digits = value.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  digits.reverse().forEach((digit, i) => {
    sum += digit * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}

/** A JSON number, or a string that is a plain decimal ("149.90"; no currency sign, thousands separator or space). */
export function toPlainNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** ISO 4217 code shape ("TRY"). */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

/** ISO 3166-1 alpha-2 shape ("TR"). */
export function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
}

/** ISO 8601 date or date-time that Date can read ("2026-11-10", "2026-11-10T09:00:00+03:00"). */
export function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value.trim()) &&
    !Number.isNaN(Date.parse(value.trim()))
  );
}

/** True when an ISO date-time carries a time zone (a bare date has none to carry). */
export function hasTimeZone(value: string): boolean {
  return !/T|\s\d{2}:/.test(value) || /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
}

/** Unicode-aware length (an emoji or "İ" counts as one character). */
export function charLength(value: string): number {
  return Array.from(value).length;
}
