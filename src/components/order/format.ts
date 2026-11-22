// Pure display helpers for the order pages (dates, masked IDs, addresses, phone and contact links).
import type { AddressData } from "@/db/schema/commerce";
import { intlLocale, type Locale } from "@/i18n/config";

const dateFormats = new Map<Locale, Intl.DateTimeFormat>();

/** "6 Kasım 2026 23:14" in Türkiye time (orders are placed and handled there). */
export function formatOrderDate(iso: string, locale: Locale): string {
  let f = dateFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(locale), {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Istanbul",
    });
    dateFormats.set(locale, f);
  }
  return f.format(new Date(iso));
}

const dayFormats = new Map<Locale, Intl.DateTimeFormat>();

/** "13 Kasım 2026" in Türkiye time (the havale payment deadline is a whole day). */
export function formatOrderDay(iso: string, locale: Locale): string {
  let f = dayFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
    dayFormats.set(locale, f);
  }
  return f.format(new Date(iso));
}

/** Customer-side masking of TCKN/VKN: every digit but the last two becomes "•". */
export function maskId(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, "");
  if (!v) return null;
  return v.length <= 2 ? "••" : `${"•".repeat(v.length - 2)}${v.slice(-2)}`;
}

/** "+905321234567" → "+90 532 123 45 67" (other shapes are returned as stored). */
export function formatPhone(phone: string | null | undefined): string {
  const v = (phone ?? "").trim();
  const m = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(v);
  return m ? `+90 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : v;
}

/** Address as display lines: street, district / city (+ postal code). Name and phone are separate. */
export function addressLines(a: AddressData): string[] {
  const street = [a.neighbourhood, a.line1].filter(Boolean).join(", ");
  const area = [a.postalCode, [a.district, a.city].filter(Boolean).join(" / ")].filter(Boolean).join(" ");
  const country = a.country && a.country.toUpperCase() !== "TR" ? a.country : "";
  return [street, area, country].filter(Boolean);
}

/** True when two addresses describe the same place (invoice "same as delivery"). */
export function sameAddress(a: AddressData | undefined, b: AddressData): boolean {
  if (!a) return true;
  const keys = ["fullName", "city", "district", "neighbourhood", "line1", "postalCode"] as const;
  return keys.every((k) => (a[k] ?? "").trim() === (b[k] ?? "").trim());
}

/** "0352 353 30 70" → "tel:+903523533070" (Turkish trunk prefix becomes +90). */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `tel:${digits}`;
  if (digits.startsWith("00")) return `tel:+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `tel:+90${digits.slice(1)}`;
  return `tel:${digits}`;
}

/** WhatsApp chat link with a prefilled message, or null when the number is unusable. */
export function whatsappHref(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
