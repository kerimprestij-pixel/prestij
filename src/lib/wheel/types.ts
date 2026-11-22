// Gift wheel (Hediye Çarkı, day 6): the types and zod schemas every wheel area compiles against
// (WHEEL-SERVER, WHEEL-CART, WHEEL-UI, WHEEL-PANEL). Pure: zod, types, constants and a few tiny helpers,
// safe in client components and unit tests. API reference: docs/DAY6-CORE-API.md §4.
// Owner: CORE. Nobody else edits this file; request changes in your report.
//
// Rules that shape these types (contract §1.1):
//   - display data never carries a slice weight (WheelDisplaySlice, WheelTeaser): the server alone picks;
//   - every countdown is a real expiry (ISO instants from the server, never a client guess);
//   - messages come from the UI dictionary (`wheel.*`) unless the panel overrides a text (giftWheel.texts).
import { z } from "zod";
import type { Locale, LocalizedText } from "@/i18n/locales";
import { LOCALES } from "@/i18n/locales";
import type { CartView } from "@/lib/cart/view";
import {
  giftWheelSettings,
  giftWheelSlice,
  giftWheelTexts,
  GIFT_WHEEL_DEFAULT_SLICES,
  WHEEL_AUDIENCES,
  WHEEL_LIMITS,
  WHEEL_PRIZE_TYPES,
  WHEEL_SLICE_KEY_PATTERN,
  WHEEL_TONES,
  defaultGiftWheelSlices,
  type GiftWheelSlice,
  type GiftWheelTextKey,
  type WheelAudience,
  type WheelPrizeType,
  type WheelTone,
} from "@/lib/settings/types";

// ---------------------------------------------------------------------------------------------------
// Settings (re-exported from src/lib/settings/types.ts, where `settingsSchemas.giftWheel` lives)

export {
  giftWheelSettings,
  giftWheelSlice,
  giftWheelTexts,
  GIFT_WHEEL_DEFAULT_SLICES,
  WHEEL_AUDIENCES,
  WHEEL_LIMITS,
  WHEEL_PRIZE_TYPES,
  WHEEL_SLICE_KEY_PATTERN,
  WHEEL_TONES,
  defaultGiftWheelSlices,
  type GiftWheelSlice,
  type GiftWheelTextKey,
  type WheelAudience,
  type WheelPrizeType,
  type WheelTone,
};
export type { WheelBoundVia, WheelPrizeSnapshot, WheelSpinStatus } from "@/db/schema/wheel";

/** The stored `giftWheel` settings document (= Settings<"giftWheel">). Server-side only: it holds the weights. */
export type GiftWheelSettings = z.infer<typeof giftWheelSettings>;

// ---------------------------------------------------------------------------------------------------
// Cookie, limits, code format (WHEEL-SERVER implements them; the names are shared)

/** httpOnly cookie holding `signToken(WHEEL_SPIN_TOKEN_PURPOSE, { id }, holdDays * 86400)`. */
export const WHEEL_COOKIE = "prestij_wheel";
export const WHEEL_SPIN_TOKEN_PURPOSE = "wheel-spin";
/**
 * localStorage key of the island's per-device hints, stored with `WheelTeaser.signature`: dismissal ("Bir daha
 * gösterme"), the auto-open cooldown and the closed chip last for the round; the minimized icon and the held-prize
 * hint for the exact signature (D14, src/components/store/wheel/wheel-storage.ts parseWheelStore).
 */
export const WHEEL_STORAGE_KEY = "prestij:wheel";
/** "Bir daha gösterme" hides the teaser this long. */
export const WHEEL_NEVER_SHOW_DAYS = 30;
/**
 * Durable rate limits (src/lib/rate-limit-store.ts). Keys: `wheel:ip:<address>` (spins), `wheel-claim:ip:<address>`,
 * where <address> is the IPv4 address or the IPv6 /64 prefix (src/lib/wheel/limit-address.ts). Spins: 3 per 24 h
 * (lead decision D13, was 10), so a guest who drops the cookie cannot spin on and on.
 */
export const WHEEL_RATE_LIMITS = {
  spinsPerIp: { limit: 3, windowMs: 24 * 60 * 60_000 },
  claimsPerIp: { limit: 3, windowMs: 24 * 60 * 60_000 },
} as const;
/** Prize coupon codes: "CARK-" + 6 characters of this alphabet (no 0/O, 1/I/L), unique on upper(code). */
export const WHEEL_CODE_PREFIX = "CARK-";
export const WHEEL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const WHEEL_CODE_LENGTH = 6;
export const WHEEL_CODE_PATTERN = /^CARK-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
/** Unclaimed spins older than this are purged by the daily job (contract §1.1 KVKK). */
export const WHEEL_PURGE_AFTER_DAYS = 30;
/** Legal document key of "Hediye Çarkı Kampanya Koşulları" (scripts/seed-data/legal.ts WHEEL_TERMS_KEY). */
export const WHEEL_TERMS_LEGAL_KEY = "wheel_terms";
/** Slug of its page (/sayfa/<slug>), linked from the wheel dialog (scripts/seed-data/site.ts LEGAL_PAGES). */
export const WHEEL_TERMS_PAGE_SLUG = "hediye-carki-kampanya-kosullari";
/** Hidden honeypot field of the spin request: a filled value means a bot (answer as if not eligible). */
export const WHEEL_HONEYPOT_FIELD = "website";

// ---------------------------------------------------------------------------------------------------
// Display (storefront + panel preview): never weights

/** One slice as the wheel draws it. */
export type WheelDisplaySlice = {
  /** `giftWheel.slices[].key` (stable; React key, stats). */
  key: string;
  /** Localized label, at most 40 characters (see wheelDisplaySlices for a missing translation). */
  label: string;
  tone: WheelTone;
  /** Minimum basket in kuruş when the slice has one (shown before the spin: prize texts state their conditions). */
  minOrderTotal?: number;
};

/**
 * Slices for display in `locale`: labels localized, weights dropped; the minimum basket kept (a condition,
 * not a secret). A slice without a label in en/ar gets `generated(slice)` (the automatic prize name, the
 * same rule as the result screen, the cart and the e-mails: never Turkish text in another language);
 * without `generated` the Turkish label is the fallback.
 */
export function wheelDisplaySlices(
  slices: readonly GiftWheelSlice[],
  locale: Locale,
  generated?: (slice: GiftWheelSlice) => string,
): WheelDisplaySlice[] {
  return slices.map((s) => {
    const own = (s.label[locale] ?? "").trim();
    const label = own || (locale !== "tr" && generated ? generated(s) : pickText(s.label, locale));
    return { key: s.key, label, tone: s.tone, ...(s.minOrderTotal > 0 ? { minOrderTotal: s.minOrderTotal } : {}) };
  });
}

/**
 * Configured share of each slice in percent (panel preview "olasılık %"), rounded to one decimal; the
 * values add up to about 100. Server/panel only: it is derived from the weights.
 */
export function wheelSliceShares(slices: readonly Pick<GiftWheelSlice, "weight">[]): number[] {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  return slices.map((s) => (total > 0 ? Math.round((Math.max(0, s.weight) / total) * 1000) / 10 : 0));
}

/**
 * A panel override when it has text in `locale` or Turkish, else the dictionary default (`fallback`,
 * e.g. messages.wheel.dialog.title). Never returns "".
 */
export function wheelText(override: LocalizedText | null | undefined, locale: Locale, fallback: string): string {
  return pickText(override, locale) || fallback;
}

/**
 * Layout-level teaser data (serialized into every storefront page's RSC payload: keep it under 0.5 KB).
 * Display-only: no weights, no prize values, no personal state. Built by WHEEL-UI's cached reader
 * `getActiveWheelTeaser(locale)` (src/lib/data/wheel.ts); null when the wheel is off or out of schedule.
 */
export type WheelTeaser = {
  /** Changes whenever the configuration changes (round, slices, texts, triggers): local dismissals reset. */
  signature: string;
  /** ISO schedule bounds (null = open); the island re-checks them on the client (cached HTML may outlive them). */
  startsAt: string | null;
  endsAt: string | null;
  audience: WheelAudience;
  showToBusiness: boolean;
  teaserDelaySeconds: number;
  /** Desktop only; 0 = never opens by itself. */
  autoOpenSeconds: number;
  exitIntent: boolean;
  autoOpenCooldownDays: number;
  /** The panel's teaser text in this locale, or null (then the dictionary's `wheel.teaser.label`). */
  teaserText: string | null;
};

// ---------------------------------------------------------------------------------------------------
// Eligibility, errors

/** Why a visitor may or may not spin/claim now (WheelState.reason, spin/claim refusals). */
export const WHEEL_ELIGIBILITY_REASONS = [
  "eligible",
  /** Switched off in the panel. */
  "disabled",
  "not_started",
  "ended",
  /** Any staff role. */
  "staff",
  /** Approved business customer while showToBusiness is off. */
  "business",
  /** audience "new_customers" and a counted order by user id or lower(e-mail). */
  "has_ordered",
  /** The account already has a prize (bound or claimed spin) this round. */
  "already_claimed",
  /** `wheel:ip` spin limit reached. */
  "spin_limit",
  /** `wheel-claim:ip` claim limit reached. */
  "claim_limit",
  /** Temporary server problem. */
  "unavailable",
] as const;
export type WheelEligibilityReason = (typeof WHEEL_ELIGIBILITY_REASONS)[number];

/** Every refusal code of the spin route and the actions; each has a message `wheel.errors.<code>` (tr/en/ar). */
export const WHEEL_ERROR_CODES = [
  "disabled",
  "not_started",
  "ended",
  "staff",
  "business",
  "has_ordered",
  "already_claimed",
  "spin_limit",
  "claim_limit",
  "unavailable",
  "rate_limited",
  "invalid_request",
  "no_spin",
  "spin_expired",
  "sign_in_required",
  /** Client-side only: the request did not reach the server. */
  "network",
] as const;
export type WheelErrorCode = (typeof WHEEL_ERROR_CODES)[number];
/** Compile-time guard: every refusal reason is also an error code (so it has a message). */
export type WheelReasonsAreErrorCodes = Exclude<WheelEligibilityReason, "eligible"> extends WheelErrorCode ? true : never;

// ---------------------------------------------------------------------------------------------------
// Spin (POST /api/wheel/spin), loadWheel, claimWheel

/** How the result screen lets the visitor claim: signed in → "claim" (claimWheel), guest → "register" (sign up or sign in). */
export type WheelClaimMode = "claim" | "register";

/** A won prize as the dialog shows it (already localized and formatted by the server). */
export type WheelPrizeView = {
  /** Slice label, e.g. "%10 indirim". */
  label: string;
  /** Conditions in one line: minimum basket, validity after claim, heavy-parcel note for free shipping. */
  summary: string;
};

/** A spin the visitor already has (idempotent: the same result again, never a re-spin). */
export type WheelSpinView = {
  /** Index into `WheelState.slices` / the current slices; -1 when that slice was removed since (show the result without spinning). */
  sliceIndex: number;
  prize: WheelPrizeView;
  /** ISO end of the unclaimed hold (frozen at spin time: spin time + the holdDays of then). */
  holdUntil: string;
  claim: WheelClaimMode;
  /** A guest whose spin is already bound to a new account: the prize waits for the e-mail verification. */
  pending?: boolean;
};

/** The account's issued, still usable prize (reminder chip, cart, account card). */
export type WheelActivePrize = {
  code: string;
  /** Localized slice label. */
  label: string;
  /** ISO expiry (coupon ends_at): the countdown's real end. */
  endsAt: string;
};

/** Every text the dialog shows that the panel can override, resolved (override or dictionary default). */
export type WheelTexts = Record<GiftWheelTextKey, string>;

/** Output of `loadWheel({ locale })` (called lazily by the island when a trigger fires or the dialog opens). */
export type WheelState = {
  /** The visitor may spin now (or holds a spin to claim). */
  eligible: boolean;
  reason: WheelEligibilityReason;
  signedIn: boolean;
  /** The visitor's live unclaimed spin, or null. */
  spin: WheelSpinView | null;
  /** The account's issued, unused, unexpired prize, or null. */
  activePrize: WheelActivePrize | null;
  /** Empty when the wheel is off. */
  slices: WheelDisplaySlice[];
  texts: WheelTexts;
  /** Localized paths of the campaign terms and the KVKK notice (null when the page does not exist). */
  links: { terms: string | null; privacy: string | null };
  /** Prize validity after claim, for "72 saat geçerli" before a spin. */
  validityHours: number;
};

/** Body of POST /api/wheel/spin (JSON). */
export const wheelSpinRequestSchema = z.object({
  locale: z.enum(LOCALES),
  /** Current pathname (canonicalized to the Turkish path and cut to 200 characters by the server). */
  path: z.string().max(2000).optional(),
  /** Honeypot: must be empty or absent. */
  [WHEEL_HONEYPOT_FIELD]: z.string().max(200).optional(),
});
export type WheelSpinRequest = z.infer<typeof wheelSpinRequestSchema>;

/** JSON answer of POST /api/wheel/spin. 200 with ok: true; 4xx/5xx with ok: false. */
export type WheelSpinResponse =
  | {
      ok: true;
      sliceIndex: number;
      prize: WheelPrizeView;
      holdUntil: string;
      claim: WheelClaimMode;
      /** See WheelSpinView.pending. */
      pending?: boolean;
      /** The visitor already had this live spin (the same result came back). */
      repeated: boolean;
    }
  | { ok: false; error: WheelErrorCode; message: string; retryAfterSeconds?: number };

/** Result of `claimWheel({ locale })` (signed-in visitors with a spin). */
export type WheelClaimResult =
  | {
      ok: true;
      prize: WheelActivePrize & { summary: string };
      /** The code went onto the cart right away (auto-apply); false = kept for later. */
      applied: boolean;
      /** The fresh cart when the claim changed it (the island calls publishCartView). */
      cart?: CartView;
    }
  | { ok: false; error: WheelErrorCode; message: string };

// ---------------------------------------------------------------------------------------------------
// The SVG wheel (src/components/store/wheel/WheelGraphic.tsx; shared by the dialog and the panel preview)

export type WheelGraphicProps = {
  slices: readonly WheelDisplaySlice[];
  /** Clockwise rotation in degrees; 0 = slice 0 centred under the pointer (top). */
  rotation?: number;
  /** Transition time of a rotation change in ms (0 = none: reduced motion, the panel preview). */
  spinDurationMs?: number;
  /** Slice to highlight after the spin, or null. */
  highlightIndex?: number | null;
  /** Text direction of the labels ("rtl" on /ar). */
  dir?: "ltr" | "rtl";
  /** Accessible name; when omitted the SVG is decorative (aria-hidden) and the dialog lists the prizes as text. */
  label?: string;
  /** Text in the centre disc (default "PRESTİJ"). */
  centerLabel?: string;
  className?: string;
};

// ---------------------------------------------------------------------------------------------------

function pickText(text: LocalizedText | null | undefined, locale: Locale): string {
  if (!text) return "";
  return (text[locale] ?? "").trim() || (text.tr ?? "").trim();
}
