// Gift wheel prizes (pure): the snapshot stored with a spin, its localized label and the one-line
// conditions the result screen shows. A won prize is the snapshot (the slice as it was when the wheel
// stopped): a later edit of the slices never changes it.
import type { LocalizedText } from "@/i18n/locales";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { formatPrice } from "@/lib/pricing/money";
import type { GiftWheelSlice, WheelPrizeSnapshot, WheelPrizeView } from "./types";

type WheelMessages = Messages["wheel"];

/** The prize a slice gives, frozen at spin time (stored in wheel_spins.prize). */
export function prizeSnapshot(slice: GiftWheelSlice): WheelPrizeSnapshot {
  const label: LocalizedText = { tr: slice.label.tr };
  if (slice.label.en?.trim()) label.en = slice.label.en.trim();
  if (slice.label.ar?.trim()) label.ar = slice.label.ar.trim();
  return { type: slice.type, value: slice.type === "free_shipping" ? 0 : slice.value, label, minOrderTotal: Math.max(0, slice.minOrderTotal) };
}

/** A generated name for the prize ("%10 indirim", "₺50.00 off", "شحن مجاني"): for labels without a translation. */
export function generatedPrizeLabel(prize: Pick<WheelPrizeSnapshot, "type" | "value">, locale: Locale, m: WheelMessages): string {
  if (prize.type === "free_shipping") return m.prize.freeShipping;
  if (prize.type === "fixed") return format(m.prize.fixed, { amount: formatPrice(prize.value, locale) }, locale);
  return format(m.prize.percent, { value: prize.value }, locale);
}

/**
 * The prize name in `locale`: the slice label in that language; Turkish readers get the Turkish label;
 * en/ar readers without a translation get a generated name (never Turkish text in another language).
 */
export function prizeLabel(prize: Pick<WheelPrizeSnapshot, "type" | "value"> & { label?: LocalizedText | null }, locale: Locale, m: WheelMessages): string {
  const own = (prize.label?.[locale] ?? "").trim();
  if (own) return own;
  if (locale === "tr" && prize.label?.tr?.trim()) return prize.label.tr.trim();
  return generatedPrizeLabel(prize, locale, m);
}

/**
 * "72 saat geçerli", or in days when the validity is two or more whole days ("3 gün geçerli" instead of
 * "72 saat"; the panel allows up to 720 hours).
 */
export function validityText(hours: number, locale: Locale, m: Pick<WheelMessages["result"], "validity" | "validityDays">): string {
  return hours >= 48 && hours % 24 === 0 ? format(m.validityDays, { days: hours / 24 }, locale) : format(m.validity, { hours }, locale);
}

/**
 * The conditions in one line: minimum basket (when set), validity after claim, and for free shipping
 * the heavy-parcel note (only when the heavy surcharge is switched on in the shipping settings).
 */
export function prizeSummary(
  prize: Pick<WheelPrizeSnapshot, "type" | "minOrderTotal">,
  options: { validityHours: number; heavySurcharge: boolean },
  locale: Locale,
  m: WheelMessages,
): string {
  const parts: string[] = [];
  if (prize.minOrderTotal > 0) parts.push(format(m.result.minOrder, { amount: formatPrice(prize.minOrderTotal, locale) }, locale));
  parts.push(validityText(options.validityHours, locale, m.result));
  if (prize.type === "free_shipping" && options.heavySurcharge) parts.push(m.result.freeShippingHeavy);
  return parts.join(" ");
}

/** Label + summary as the dialog shows them. */
export function prizeView(prize: WheelPrizeSnapshot, options: { validityHours: number; heavySurcharge: boolean }, locale: Locale, m: WheelMessages): WheelPrizeView {
  return { label: prizeLabel(prize, locale, m), summary: prizeSummary(prize, options, locale, m) };
}

/** Turkish note stored in coupons.description (panel coupon list and editor): "Hediye çarkı · %10 indirim · 1. tur". */
export function prizeCouponDescription(prize: WheelPrizeSnapshot, round: number): string {
  return `Hediye çarkı · ${prize.label.tr || "ödül"} · ${round}. tur`.slice(0, 200);
}
