// Panel formatting/parsing helpers: Turkish slugs, TRY amounts ↔ kuruş, EAN-13, Europe/Istanbul times
// for <input type="datetime-local">, Turkish-insensitive search folding. Pure: safe on the client.
// IBAN, TCKN, VKN and phone validation live in src/lib/validation/tr.ts (reuse, do not duplicate).

// ---------------------------------------------------------------------------------------------------
// Slugs

const TURKISH_ASCII: Record<string, string> = {
  ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", I: "i", İ: "i", ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u",
};

export const SLUG_MAX_LENGTH = 80;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * URL slug from Turkish (or any Latin) text: ç→c ğ→g ı/İ→i ö→o ş→s ü→u, other accents stripped,
 * "&" → "ve", everything else non-alphanumeric → "-". slugify("Lavanta Latte Şişe & Jel") →
 * "lavanta-latte-sise-ve-jel". Returns "" when nothing usable is left.
 */
export function slugify(text: string | null | undefined, maxLength = SLUG_MAX_LENGTH): string {
  if (!text) return "";
  const ascii = text
    .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (ch) => TURKISH_ASCII[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/&/g, " ve ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii.slice(0, maxLength).replace(/-+$/g, "");
}

// ---------------------------------------------------------------------------------------------------
// Money (TRY, integer kuruş)

/**
 * Parses a Turkish-formatted lira amount into kuruş: "1.499,90" → 149990, "149,9" → 14990, "149" →
 * 14900, "1.499" → 149900 (dot = thousands), "149.90" → 14990 (a dot followed by 1–2 digits is read as
 * decimals). "₺", "TL" and spaces are ignored. Negative, malformed or more than 2 decimals → null.
 * A number is read as lira (149.9 → 14990).
 */
export function parseTryAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    const kurus = Math.round(input * 100);
    return Number.isSafeInteger(kurus) ? kurus : null;
  }
  const s = input.replace(/₺|TL|TRY/gi, "").replace(/[\s\u00A0\u202F]/g, "");
  if (!s) return null;
  let lira: string;
  let decimals = "";
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/))) {
    lira = m[1].replace(/\./g, "");
    decimals = m[2] ?? "";
  } else if ((m = s.match(/^(\d+)(?:,(\d{1,2}))?$/))) {
    lira = m[1];
    decimals = m[2] ?? "";
  } else if ((m = s.match(/^(\d+)\.(\d{1,2})$/))) {
    lira = m[1];
    decimals = m[2];
  } else {
    return null;
  }
  const kurus = Number(lira) * 100 + Number(decimals.padEnd(2, "0") || "0");
  return Number.isSafeInteger(kurus) ? kurus : null;
}

/** Kuruş → "1.499,90" (Turkish grouping, always 2 decimals); `symbol: true` → "1.499,90 ₺". "" for null. */
export function formatTryAmount(kurus: number | null | undefined, { symbol = false }: { symbol?: boolean } = {}): string {
  if (kurus === null || kurus === undefined || !Number.isFinite(kurus)) return "";
  const value = Math.round(kurus);
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const lira = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const text = `${sign}${lira},${(abs % 100).toString().padStart(2, "0")}`;
  return symbol ? `${text}\u00A0₺` : text;
}

// ---------------------------------------------------------------------------------------------------
// Barcodes

/** EAN-13 / GTIN-13 with a valid check digit (13 digits; weights 1,3,1,3… over the first 12). */
export function isValidEan13(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (value.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === value.charCodeAt(12) - 48;
}

// ---------------------------------------------------------------------------------------------------
// Europe/Istanbul date-times (panel times are always shown and entered in Istanbul time)

export const PANEL_TIME_ZONE = "Europe/Istanbul";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PANEL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function istanbulParts(date: Date): Record<"year" | "month" | "day" | "hour" | "minute" | "second", number> {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type in out) out[p.type as keyof typeof out] = Number(p.value);
  }
  return out;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number, width = 2) => n.toString().padStart(width, "0");

/** Instant → "YYYY-MM-DDTHH:mm" in Istanbul time, the value format of <input type="datetime-local">. "" for null. */
export function istanbulDateTimeLocal(value: Date | string | number | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const p = istanbulParts(date);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Offset of Istanbul from UTC at an instant, in minutes (+180 since 2016). */
function istanbulOffsetMinutes(at: number): number {
  const p = istanbulParts(new Date(at));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
}

/**
 * "YYYY-MM-DDTHH:mm" (or with ":ss") entered as Istanbul time → the instant (Date). Null for empty or
 * malformed input or impossible dates (e.g. 2026-02-30).
 */
export function parseIstanbulDateTimeLocal(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let at = naive - istanbulOffsetMinutes(naive) * 60000;
  at = naive - istanbulOffsetMinutes(at) * 60000;
  const back = istanbulParts(new Date(at));
  if (back.year !== y || back.month !== mo || back.day !== d || back.hour !== h || back.minute !== mi) return null;
  return new Date(at);
}

const displayFormatter = new Intl.DateTimeFormat("tr-TR", { timeZone: PANEL_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
const dateOnlyFormatter = new Intl.DateTimeFormat("tr-TR", { timeZone: PANEL_TIME_ZONE, dateStyle: "medium" });

/** "9 Kas 2026 14:30" (Istanbul time); `time: false` → "9 Kas 2026". "" for null. */
export function formatIstanbul(value: Date | string | number | null | undefined, { time = true }: { time?: boolean } = {}): string {
  const date = toDate(value);
  if (!date) return "";
  return (time ? displayFormatter : dateOnlyFormatter).format(date);
}

// ---------------------------------------------------------------------------------------------------
// Search

/** Characters folded for Turkish-insensitive search ("ozturk" finds "Öztürk", "ISIK" finds "Işık"). */
export const FOLD_FROM = "İIıŞşĞğÜüÖöÇç";
export const FOLD_TO = "iiissgguuoocc";

export function foldText(value: string): string {
  let out = "";
  for (const ch of value) {
    const i = FOLD_FROM.indexOf(ch);
    out += i >= 0 ? FOLD_TO[i] : ch;
  }
  return out.toLowerCase();
}

/** Escapes LIKE wildcards (use with the default "\" escape character). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
