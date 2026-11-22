// The layout-level teaser data of the gift wheel (pure: unit-tested; the cached reader
// getActiveWheelTeaser in src/lib/data/wheel.ts calls it). Display-only: no weights, no prize values,
// nothing about the visitor. It is serialized into every storefront page, so it stays tiny (< 0.5 KB).
import type { Locale } from "@/i18n/config";
import type { GiftWheelSettings, WheelTeaser } from "@/lib/wheel/types";

/** The settings fields the teaser needs (the stored document has more: weights stay server-side). */
type TeaserSource = Pick<
  GiftWheelSettings,
  | "enabled"
  | "startsAt"
  | "endsAt"
  | "audience"
  | "showToBusiness"
  | "slices"
  | "teaserDelaySeconds"
  | "autoOpenSeconds"
  | "exitIntent"
  | "autoOpenCooldownDays"
  | "round"
  | "texts"
>;

const time = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** The wheel is switched on, has slices, and `now` is inside its schedule (startsAt ≤ now < endsAt). */
export function isWheelLive(settings: Pick<TeaserSource, "enabled" | "startsAt" | "endsAt" | "slices">, now: number): boolean {
  if (!settings.enabled || settings.slices.length === 0) return false;
  const start = time(settings.startsAt);
  const end = time(settings.endsAt);
  return (start === null || start <= now) && (end === null || now < end);
}

/** The schedule as Date bounds for campaignCacheProfile (empty when the wheel is off: nothing to wait for). */
export function wheelScheduleBounds(settings: Pick<TeaserSource, "enabled" | "startsAt" | "endsAt">): { startsAt: Date | null; endsAt: Date | null }[] {
  if (!settings.enabled) return [];
  const start = time(settings.startsAt);
  const end = time(settings.endsAt);
  return [{ startsAt: start === null ? null : new Date(start), endsAt: end === null ? null : new Date(end) }];
}

/** 32-bit FNV-1a, base 36 (stable across server and client; not a security hash). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Changes whenever what the visitor sees or how the teaser behaves changes: round, slices (key, label,
 * tone, order), texts, audience, schedule and triggers. Weights and prize values are left out on purpose
 * (a re-weighted wheel looks the same). Format "<round>.<hash>": the visitor's dismissal, auto-open cooldown
 * and closed chip follow the round part only (D14, parseWheelStore), the other hints the whole signature.
 */
export function wheelTeaserSignature(settings: Omit<TeaserSource, "enabled">): string {
  const shape = JSON.stringify([
    settings.round,
    settings.slices.map((s) => [s.key, s.label.tr, s.label.en ?? "", s.label.ar ?? "", s.tone]),
    settings.texts,
    settings.audience,
    settings.showToBusiness,
    settings.startsAt,
    settings.endsAt,
    settings.teaserDelaySeconds,
    settings.autoOpenSeconds,
    settings.exitIntent,
    settings.autoOpenCooldownDays,
  ]);
  return `${settings.round}.${fnv1a(shape)}`;
}

/** The panel's teaser text in `locale` (Turkish fallback), or null when none is set. */
function teaserTextFor(settings: Pick<TeaserSource, "texts">, locale: Locale): string | null {
  const text = settings.texts.teaser;
  if (!text) return null;
  return (text[locale] ?? "").trim() || text.tr.trim() || null;
}

/** The teaser for `locale` at `now`, or null when the wheel is off or outside its schedule. */
export function buildWheelTeaser(settings: TeaserSource, locale: Locale, now: number): WheelTeaser | null {
  if (!isWheelLive(settings, now)) return null;
  return {
    signature: wheelTeaserSignature(settings),
    startsAt: settings.startsAt,
    endsAt: settings.endsAt,
    audience: settings.audience,
    showToBusiness: settings.showToBusiness,
    teaserDelaySeconds: settings.teaserDelaySeconds,
    autoOpenSeconds: settings.autoOpenSeconds,
    exitIntent: settings.exitIntent,
    autoOpenCooldownDays: settings.autoOpenCooldownDays,
    teaserText: teaserTextFor(settings, locale),
  };
}

/** The teaser is still running at `now` (cached HTML can outlive the end by one cache interval). */
export function isTeaserInSchedule(teaser: Pick<WheelTeaser, "startsAt" | "endsAt">, now: number): boolean {
  const start = time(teaser.startsAt);
  const end = time(teaser.endsAt);
  return (start === null || start <= now) && (end === null || now < end);
}
