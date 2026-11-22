// Order numbers: "PR-" + two-digit year (Türkiye time) + sequence padded to 4, e.g. PR-261001.
// The sequence is global (order_number_seq, starts at 1001), so numbers never repeat across years.

/** Shape check for user-typed order numbers (lookup form, URLs). */
export const ORDER_NUMBER_PATTERN = /^PR-\d{6,12}$/;

export function isOrderNumber(value: unknown): value is string {
  return typeof value === "string" && ORDER_NUMBER_PATTERN.test(value);
}

/** Trims and upper-cases a typed order number ("pr-261001 " → "PR-261001"); null if malformed. */
export function normalizeOrderNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase().replace(/\s+/g, "");
  const withPrefix = /^\d{6,12}$/.test(v) ? `PR-${v}` : v.replace(/^PR(?=\d)/, "PR-");
  return isOrderNumber(withPrefix) ? withPrefix : null;
}

const yearFormat = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Istanbul", year: "2-digit" });

export function formatOrderNumber(sequence: number, now: Date): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new RangeError(`Invalid order sequence: ${sequence}`);
  return `PR-${yearFormat.format(now)}${String(sequence).padStart(4, "0")}`;
}
