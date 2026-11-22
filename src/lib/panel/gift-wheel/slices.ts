// Editing helpers for the wheel's slices in the panel (Ayarlar tab). Pure: the client editor uses them
// live and the unit tests pin them. Nothing here decides a spin: the server picks with the stored weights.
//
// What they do for a non-technical owner:
//   - stable slice keys without typing one (a new slice's key follows its Turkish label until it is
//     saved; a saved key stays while the slice's prize stays, so spins and statistics keep pointing at the
//     right slice; a saved slice whose prize changes gets a new key when it is saved: rekeyChangedSlices);
//   - ready labels in tr/en/ar from the prize type and value ("%10 indirim" / "10% off" / "خصم 10%");
//   - weights that read as percentages ("Toplamı 100 yap");
//   - plain-language warnings for settings that are allowed but probably unintended.
import { fitWheelLabels } from "@/components/store/wheel/wheel-geometry";
import { slugify } from "@/lib/panel/format";
import {
  WHEEL_LIMITS,
  WHEEL_SLICE_KEY_PATTERN,
  WHEEL_TONES,
  type GiftWheelSlice,
  type WheelPrizeType,
  type WheelTone,
} from "@/lib/settings/types";
import type { Locale, LocalizedText } from "@/i18n/locales";

const KEY_MAX = 24;
const FALLBACK_KEY = "dilim";

// ---------------------------------------------------------------------------------------------------
// Labels

const trAmount = (kurus: number) => {
  const lira = Math.floor(kurus / 100);
  const rest = kurus % 100;
  const whole = lira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return rest === 0 ? whole : `${whole},${rest.toString().padStart(2, "0")}`;
};
const latinAmount = (kurus: number) => {
  const lira = Math.floor(kurus / 100);
  const rest = kurus % 100;
  const whole = lira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest === 0 ? whole : `${whole}.${rest.toString().padStart(2, "0")}`;
};

/**
 * The label a slice gets from its prize, in the three storefront languages (same wording as the default
 * slices: "%10 indirim" · "10% off" · "خصم 10%", "50 TL indirim" · "₺50 off" · "خصم 50 ليرة").
 */
export function suggestSliceLabel(type: WheelPrizeType, value: number): LocalizedText {
  if (type === "percent") return { tr: `%${value} indirim`, en: `${value}% off`, ar: `خصم ${value}%` };
  if (type === "fixed") return { tr: `${trAmount(value)} TL indirim`, en: `₺${latinAmount(value)} off`, ar: `خصم ${latinAmount(value)} ليرة` };
  return { tr: "Ücretsiz kargo", en: "Free shipping", ar: "شحن مجاني" };
}

const sameLabel = (a: LocalizedText, b: LocalizedText) =>
  (a.tr ?? "").trim() === (b.tr ?? "").trim() && (a.en ?? "").trim() === (b.en ?? "").trim() && (a.ar ?? "").trim() === (b.ar ?? "").trim();

/** True when the label is empty or still exactly the suggestion for this prize (so it may follow prize edits). */
export function isAutoLabel(label: LocalizedText, type: WheelPrizeType, value: number): boolean {
  const empty = !label.tr?.trim() && !label.en?.trim() && !label.ar?.trim();
  return empty || sameLabel(label, suggestSliceLabel(type, value));
}

/** A sensible value when the prize type changes (the old value rarely fits the new type). */
export function defaultValueFor(type: WheelPrizeType): number {
  if (type === "percent") return 10;
  if (type === "fixed") return 5000;
  return 0;
}

/**
 * Applies a prize change (type and/or value) to a slice. The label follows when it was the automatic
 * one; a label the owner wrote is kept.
 */
export function withPrize(slice: GiftWheelSlice, patch: { type?: WheelPrizeType; value?: number }): GiftWheelSlice {
  const type = patch.type ?? slice.type;
  const value = patch.type && patch.type !== slice.type && patch.value === undefined ? defaultValueFor(type) : (patch.value ?? slice.value);
  const nextValue = type === "free_shipping" ? 0 : value;
  const label = isAutoLabel(slice.label, slice.type, slice.value) ? suggestSliceLabel(type, nextValue) : slice.label;
  return { ...slice, type, value: nextValue, label };
}

// ---------------------------------------------------------------------------------------------------
// Keys

/** "%10 indirim" → "10-indirim"; at most 24 characters of a–z, 0–9 and inner hyphens. */
export function sliceKeyFromLabel(label: string | null | undefined): string {
  const key = slugify(label ?? "", KEY_MAX);
  return key && WHEEL_SLICE_KEY_PATTERN.test(key) ? key : FALLBACK_KEY;
}

function uniqueKey(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, KEY_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Gives every slice a unique, valid key. A slice whose key was saved before (`lockedKeys`) keeps it
 * (the first one, if a copy shares it); every other slice gets a key from its Turkish label that no other
 * slice uses and that no saved slice ever used (so a new slice never inherits a removed slice's history).
 * Returns the same array when nothing changed.
 */
export function withSliceKeys<T extends Pick<GiftWheelSlice, "key" | "label">>(slices: readonly T[], lockedKeys: ReadonlySet<string>): T[] {
  const kept = new Set<string>();
  const keep = slices.map((s) => {
    if (lockedKeys.has(s.key) && !kept.has(s.key)) {
      kept.add(s.key);
      return true;
    }
    return false;
  });
  const used = new Set<string>([...lockedKeys, ...kept]);
  let changed = false;
  const next = slices.map((s, i) => {
    if (keep[i]) return s;
    const key = uniqueKey(sliceKeyFromLabel(s.label.tr), used);
    used.add(key);
    if (key === s.key) return s;
    changed = true;
    return { ...s, key };
  });
  return changed ? next : (slices as T[]);
}

/** What a slice gives (type, value, minimum basket): the statistics of a key are about this prize. */
export function slicePrizeSignature(slice: Pick<GiftWheelSlice, "type" | "value" | "minOrderTotal">): string {
  return `${slice.type}:${slice.type === "free_shipping" ? 0 : slice.value}:${slice.minOrderTotal}`;
}

/** The saved slice with this key gives a different prize than `slice` does now. */
export function slicePrizeChanged(
  saved: readonly Pick<GiftWheelSlice, "key" | "type" | "value" | "minOrderTotal">[],
  slice: Pick<GiftWheelSlice, "key" | "type" | "value" | "minOrderTotal">,
): boolean {
  const before = saved.find((s) => s.key === slice.key);
  return before !== undefined && slicePrizeSignature(before) !== slicePrizeSignature(slice);
}

/**
 * At save time (FIX SEO-4): a saved slice whose prize (type, value or minimum basket) changed gets a new
 * key from its Turkish label, unused by every saved and current slice. Its spins, claims and revenue so far
 * stay under the old key (shown under "Artık çarkta yok" with the prize they really were), so the
 * statistics never report an old prize's results under the new one. Labels, weights and tones may change
 * freely. Returns the same array when nothing changed.
 */
export function rekeyChangedSlices<T extends Pick<GiftWheelSlice, "key" | "label" | "type" | "value" | "minOrderTotal">>(
  saved: readonly Pick<GiftWheelSlice, "key" | "type" | "value" | "minOrderTotal">[],
  slices: readonly T[],
): T[] {
  const used = new Set<string>([...saved.map((s) => s.key), ...slices.map((s) => s.key)]);
  let changed = false;
  const next = slices.map((s) => {
    if (!slicePrizeChanged(saved, s)) return s;
    const key = uniqueKey(sliceKeyFromLabel(s.label.tr), used);
    used.add(key);
    changed = true;
    return { ...s, key };
  });
  return changed ? next : (slices as T[]);
}

/**
 * Below this font size (wheel viewBox units, 200 wide) a slice label is hard to read on a phone: the
 * wheel is about 210-250 px wide there, so 8 units are about 8.5-10 px.
 */
export const SLICE_LABEL_MIN_FONT = 8;

/**
 * For each slice, the languages in which the wheel would draw its label too small to read on a phone (or
 * not at all: one word too long for the wedge), with the same fitting as the storefront wheel (FIX UX-7).
 * `labels` = the labels as the wheel shows them, per language, in slice order.
 */
export function tinySliceLabels(labels: Partial<Record<Locale, readonly string[]>>, minFont = SLICE_LABEL_MIN_FONT): Locale[][] {
  const count = Math.max(0, ...Object.values(labels).map((l) => l?.length ?? 0));
  const out: Locale[][] = Array.from({ length: count }, () => []);
  for (const [locale, list] of Object.entries(labels) as [Locale, readonly string[] | undefined][]) {
    if (!list || list.length === 0) continue;
    fitWheelLabels(list).forEach((layout, i) => {
      if (layout.lines.length === 0 || layout.fontSize < minFont) out[i]?.push(locale);
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// New slices, colours

/** The tone for a new slice: one that differs from both neighbours it will have (the last and the first slice). */
export function nextTone(slices: readonly Pick<GiftWheelSlice, "tone">[]): WheelTone {
  const last = slices[slices.length - 1]?.tone;
  const first = slices[0]?.tone;
  const counts = new Map<WheelTone, number>(WHEEL_TONES.map((t) => [t, 0]));
  for (const s of slices) counts.set(s.tone, (counts.get(s.tone) ?? 0) + 1);
  const candidates = WHEEL_TONES.filter((t) => t !== last && t !== first);
  const pool = candidates.length > 0 ? candidates : [...WHEEL_TONES];
  return pool.reduce((best, t) => ((counts.get(t) ?? 0) < (counts.get(best) ?? 0) ? t : best), pool[0]);
}

/** A new slice for the editor (key filled in by withSliceKeys). */
export function newSlice(slices: readonly GiftWheelSlice[]): GiftWheelSlice {
  return { key: "", label: suggestSliceLabel("percent", 5), type: "percent", value: 5, minOrderTotal: 0, weight: 10, tone: nextTone(slices) };
}

/** Index pairs of neighbouring slices (including last ↔ first) that share a colour. */
export function adjacentSameTone(slices: readonly Pick<GiftWheelSlice, "tone">[]): [number, number][] {
  if (slices.length < 2) return [];
  const pairs: [number, number][] = [];
  for (let i = 0; i < slices.length; i++) {
    const j = (i + 1) % slices.length;
    if (j === i || (slices.length === 2 && i === 1)) continue;
    if (slices[i].tone === slices[j].tone) pairs.push([i, j]);
  }
  return pairs;
}

// ---------------------------------------------------------------------------------------------------
// Weights

export const weightTotal = (slices: readonly Pick<GiftWheelSlice, "weight">[]): number =>
  slices.reduce((sum, s) => sum + Math.max(0, Number.isFinite(s.weight) ? s.weight : 0), 0);

/**
 * Rescales weights so they add up to exactly 100 (each at least 1, shares kept as close as possible:
 * largest remainder). After this every weight reads as "% olasılık". Needs 1–100 weights.
 */
export function normalizeWeightsTo100(weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0 || n > 100) return [...weights];
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 1));
  const total = clean.reduce((a, b) => a + b, 0);
  const raw = clean.map((w) => (w / total) * 100);
  const out = raw.map((r) => Math.max(1, Math.floor(r)));
  let diff = 100 - out.reduce((a, b) => a + b, 0);
  const byRemainder = raw.map((r, i) => ({ i, rest: r - Math.floor(r) }));
  if (diff > 0) {
    byRemainder.sort((a, b) => b.rest - a.rest || a.i - b.i);
    for (let k = 0; diff > 0; k = (k + 1) % n, diff--) out[byRemainder[k].i] += 1;
  } else if (diff < 0) {
    // Only when the "at least 1" floor pushed the total over 100: take from the largest weights first.
    const byWeight = out.map((w, i) => ({ i, w })).sort((a, b) => b.w - a.w || a.i - b.i);
    for (let k = 0; diff < 0; k = (k + 1) % n) {
      const item = byWeight[k];
      if (out[item.i] > 1) {
        out[item.i] -= 1;
        diff++;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Advice (shown under a slice; allowed by the rules, but probably not what the owner wants)

export function sliceWarnings(slice: Pick<GiftWheelSlice, "type" | "value" | "minOrderTotal">): string[] {
  const out: string[] = [];
  if (slice.type === "fixed") {
    if (slice.minOrderTotal <= 0) {
      out.push("En düşük sepet tutarı yok: tutar indirimi küçük sepetlerde de kullanılabilir. Bir alt sınır koymanız önerilir (ör. 300 TL).");
    } else if (slice.value >= slice.minOrderTotal) {
      out.push("İndirim tutarı en düşük sepet tutarına eşit ya da ondan büyük. En düşük sepeti indirimden yüksek tutun.");
    }
  } else if (slice.type === "percent" && slice.value >= 30 && slice.minOrderTotal <= 0) {
    out.push(`%${slice.value} yüksek bir oran: bir en düşük sepet tutarı koymanız önerilir.`);
  }
  return out;
}

/** Locales without their own label (the storefront then shows the Turkish text). */
export function missingLabelLocales(label: LocalizedText): ("en" | "ar")[] {
  return (["en", "ar"] as const).filter((l) => !label[l]?.trim());
}

export const SLICE_LIMITS = { min: WHEEL_LIMITS.slices.min, max: WHEEL_LIMITS.slices.max, labelMax: WHEEL_LIMITS.labelMax } as const;
