// Day 6 (CONTENT): the gift wheel (Hediye Çarkı) configuration stored for the client's database
// (contract docs/DAY6-WHEEL-VIDEO.md §1.1 "Defaults" and §5.7). The code default in
// src/lib/settings/types.ts keeps the wheel switched off, which is right for a database nobody has
// configured yet; the seed (buildSettings in ./site.ts) and scripts/content-day6.ts (giftWheelConfig)
// store this live value instead: the wheel switched on with the six default slices
// (GIFT_WHEEL_DEFAULT_SLICES: %5 · %10 · Ücretsiz kargo · %15 · 50 TL with a 300 TL minimum · %20 with a
// 750 TL minimum). The owner reviews the slices before launch (launch checklist on /panel/seo).
// Pure: no database, no Next APIs (unit-tested in tests/unit/day6-content-wheel.test.ts).
import { defaultGiftWheelSlices, settingsSchemas, type GiftWheelSlice, type Settings } from "@/lib/settings/types";

type GiftWheelSettings = Settings<"giftWheel">;

/** What the seed writes before parsing: only the fields that differ from the code defaults. */
export function giftWheelSeedInput(): { enabled: true; slices: GiftWheelSlice[] } {
  return { enabled: true, slices: defaultGiftWheelSlices() };
}

/**
 * The complete stored document (every field filled in by the shared schema, as the panel saves it):
 * the wheel on, no schedule, audience new customers, the six default slices, prizes valid 72 hours,
 * unclaimed spins kept 7 days, round 1, the dictionary texts. A fresh object on every call.
 */
export function giftWheelLiveSettings(): GiftWheelSettings {
  return settingsSchemas.giftWheel.parse(giftWheelSeedInput());
}

const kurus = (value: number) => `${(value / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} TL`;

/** One slice for a report line: "%10 indirim", "50 TL indirim (en az 300 TL)", with its weight. */
export function describeSlice(slice: GiftWheelSlice): string {
  const minimum = slice.minOrderTotal > 0 ? ` (en az ${kurus(slice.minOrderTotal)})` : "";
  return `${slice.label.tr}${minimum} ×${slice.weight}`;
}

/** The content script's report line for a giftWheel document (Turkish labels; no personal data). */
export function describeGiftWheel(value: GiftWheelSettings): string {
  const state = value.enabled ? "on" : "off";
  const slices = value.slices.map(describeSlice).join(" · ");
  return `gift wheel ${state}, ${value.slices.length} slices (${slices}), prize valid ${value.validityHours} h, unclaimed spin kept ${value.holdDays} d, audience ${value.audience}, round ${value.round}`;
}
