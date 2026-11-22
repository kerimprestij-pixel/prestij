// Turkish identity, tax, phone and IBAN validators plus the 81 provinces. Pure; safe on the client.

const digitsOf = (value: string): number[] => [...value].map((c) => c.charCodeAt(0) - 48);

/**
 * T.C. kimlik numarası: 11 digits, first digit not 0, two check digits.
 * Note: the e-Arşiv placeholder 11111111111 is NOT a valid TCKN (fails the checksum); the invoice
 * code uses it when the buyer leaves the field empty.
 */
export function isValidTckn(value: unknown): boolean {
  if (typeof value !== "string" || !/^[1-9]\d{10}$/.test(value)) return false;
  const d = digitsOf(value);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  if (tenth !== d[9]) return false;
  const eleventh = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return eleventh === d[10];
}

/** Vergi kimlik numarası (companies): 10 digits with the GİB check digit. */
export function isValidVkn(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{10}$/.test(value)) return false;
  const d = digitsOf(value);
  let total = 0;
  for (let i = 0; i < 9; i++) {
    const tmp = (d[i] + 9 - i) % 10;
    let part = (tmp * 2 ** (9 - i)) % 9;
    if (tmp !== 0 && part === 0) part = 9;
    total += part;
  }
  return (10 - (total % 10)) % 10 === d[9];
}

/**
 * A Turkish mobile number in any common spelling (0532 123 45 67, 532-123-4567, +90 532 123 45 67,
 * 0090…, 90…) → "+905321234567". Landlines and anything else → null.
 */
export function normalizeTrPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\+?[\d\s().-]{10,20}$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(4);
  else if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? `+90${digits}` : null;
}

/** Turkish IBAN (TR + 24 characters, 26 total) with the ISO 13616 mod-97 check. Spaces are ignored. */
export function isValidIban(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (!/^TR\d{24}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return remainder === 1;
}

/**
 * A havale account a customer can actually pay to: a valid TR IBAN and an account holder (sales-ready: the
 * go-live sales profile refuses havale without one; the panel launch checklist counts them).
 */
export function isUsableBankAccount(account: { iban?: unknown; holder?: unknown } | null | undefined): boolean {
  return Boolean(account) && isValidIban(account?.iban) && typeof account?.holder === "string" && account.holder.trim() !== "";
}

/** "TR33 0006 1005 1978 6457 8413 26" (groups of four) for display. */
export function formatIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
}

export type Province = { code: number; name: string };

/** The 81 provinces with their plate codes, in plate order (Turkish names). */
export const TR_PROVINCES: readonly Province[] = Object.freeze(
  [
    "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Amasya", "Ankara", "Antalya", "Artvin", "Aydın", "Balıkesir",
    "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum", "Denizli",
    "Diyarbakır", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkâri",
    "Hatay", "Isparta", "Mersin", "İstanbul", "İzmir", "Kars", "Kastamonu", "Kayseri", "Kırklareli", "Kırşehir",
    "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Kahramanmaraş", "Mardin", "Muğla", "Muş", "Nevşehir",
    "Niğde", "Ordu", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas", "Tekirdağ", "Tokat",
    "Trabzon", "Tunceli", "Şanlıurfa", "Uşak", "Van", "Yozgat", "Zonguldak", "Aksaray", "Bayburt", "Karaman",
    "Kırıkkale", "Batman", "Şırnak", "Bartın", "Ardahan", "Iğdır", "Yalova", "Karabük", "Kilis", "Osmaniye",
    "Düzce",
  ].map((name, i) => Object.freeze({ code: i + 1, name })),
);

/** Province names in Turkish alphabetical order (every select lists them like this). */
export const TR_PROVINCE_NAMES: readonly string[] = Object.freeze(TR_PROVINCES.map((p) => p.name).sort((a, b) => a.localeCompare(b, "tr")));

const ASCII_FOLD: Record<string, string> = { ı: "i", ğ: "g", ş: "s", ç: "c", ö: "o", ü: "u", â: "a", î: "i", û: "u" };

/** Lower-cases with Turkish rules, then folds Turkish letters to ASCII ("İZMİR", "Izmir", "izmir" → "izmir"). */
const foldTr = (s: string) =>
  s
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/[ığşçöüâîû]/g, (c) => ASCII_FOLD[c] ?? c)
    .replace(/\s+/g, " ");

/** Province by name (case- and Turkish-letter-insensitive: "Şanlıurfa", "sanliurfa") or plate code ("38", 38, "06"). */
export function findProvince(value: unknown): Province | null {
  if (typeof value === "number" || (typeof value === "string" && /^\d{1,2}$/.test(value.trim()))) {
    const code = Number(value);
    return TR_PROVINCES[code - 1] ?? null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const wanted = foldTr(value);
  return TR_PROVINCES.find((p) => foldTr(p.name) === wanted) ?? null;
}
