// The gift wheel's per-device hints (localStorage `prestij:wheel`) and the per-tab cache of the last
// loadWheel answer (sessionStorage). Hints only, never the truth: the server decides who may spin and
// claim. The hints are stored with the teaser signature (WheelTeaser.signature, "<round>.<hash>"). The
// visitor's own choices ("Bir daha gösterme", the auto-open cooldown, the closed chip) last as long as the
// ROUND does, so an edit in the panel never brings the wheel back to someone who asked not to see it;
// only "Yeni tur başlat" starts them over (lead decision D14). The minimized icon and the held-prize
// hint follow the full signature (an edited wheel shows its new face). No personal data: flags,
// timestamps and a prize label.
// The decision helpers are pure (unit-tested); the storage glue swallows private-mode errors.
import type { WheelActivePrize, WheelState } from "@/lib/wheel/types";
import type { WheelDialogLabels } from "./labels";

// Copies of WHEEL_STORAGE_KEY / WHEEL_NEVER_SHOW_DAYS from src/lib/wheel/types.ts: importing a value from
// there would pull zod and the settings schemas into the storefront bundle. A unit test keeps them equal.
export const WHEEL_STORAGE_KEY = "prestij:wheel";
export const WHEEL_NEVER_SHOW_DAYS = 30;
const DAY_MS = 86_400_000;

export type WheelStore = {
  /** The teaser signature these hints belong to. */
  sig: string;
  /** The visitor closed the dialog or minimized the teaser: show the small gift icon only. */
  collapsed?: boolean;
  /** "Bir daha gösterme": no teaser until then (epoch ms). */
  hiddenUntil?: number;
  /** Last time the dialog opened (by itself or by a click): the auto-open cooldown counts from here. */
  promptedAt?: number;
  /** A guest's won but unclaimed prize (the teaser shows it until the hold ends). */
  prize?: { label: string; holdUntil: string };
  /** The reminder chip was closed: hidden until then (epoch ms). */
  chipHiddenUntil?: number;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The round part of a teaser signature ("3.k2j9xq" → "3"), or null when the value has no round prefix. */
export function wheelSignatureRound(signature: unknown): string | null {
  if (typeof signature !== "string") return null;
  const m = /^(\d+)\./.exec(signature);
  return m ? m[1] : null;
}

/**
 * Parses the stored hints for the current `signature`; anything unreadable yields a fresh store. Hints
 * saved under the same signature are kept whole. Hints saved under another signature of the SAME round (the
 * wheel was edited in the panel) keep the visitor's choices: "Bir daha gösterme" (hiddenUntil), the
 * auto-open cooldown (promptedAt) and the closed chip (chipHiddenUntil); the minimized icon and the
 * held-prize hint start over. Another round ("Yeni tur başlat") starts everything over (D14). The store
 * returned carries the current signature, so the next write saves the kept hints under it.
 */
export function parseWheelStore(raw: string | null | undefined, signature: string): WheelStore {
  const fresh: WheelStore = { sig: signature };
  if (!raw) return fresh;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fresh;
  }
  if (!value || typeof value !== "object") return fresh;
  const v = value as Record<string, unknown>;
  const sameSignature = v.sig === signature;
  const round = wheelSignatureRound(signature);
  if (!sameSignature && (round === null || wheelSignatureRound(v.sig) !== round)) return fresh;
  const store: WheelStore = { sig: signature };
  if (isNum(v.hiddenUntil)) store.hiddenUntil = v.hiddenUntil;
  if (isNum(v.promptedAt)) store.promptedAt = v.promptedAt;
  if (isNum(v.chipHiddenUntil)) store.chipHiddenUntil = v.chipHiddenUntil;
  if (!sameSignature) return store;
  if (v.collapsed === true) store.collapsed = true;
  const prize = v.prize as Record<string, unknown> | undefined;
  if (prize && typeof prize.label === "string" && typeof prize.holdUntil === "string" && prize.label.length <= 80) {
    store.prize = { label: prize.label, holdUntil: prize.holdUntil };
  }
  return store;
}

/** "Bir daha gösterme" is in force. */
export function isTeaserHidden(store: WheelStore, now: number): boolean {
  return isNum(store.hiddenUntil) && store.hiddenUntil > now;
}

/** The guest's held prize, while its hold lasts. */
export function heldPrize(store: WheelStore, now: number): WheelStore["prize"] | null {
  const until = store.prize ? Date.parse(store.prize.holdUntil) : Number.NaN;
  return store.prize && Number.isFinite(until) && until > now ? store.prize : null;
}

/**
 * The dialog may open by itself (desktop only; the caller checks the pointer): not hidden, not
 * minimized, no prize waiting, and no open (automatic or manual) within the cooldown.
 */
export function canAutoOpen(store: WheelStore, now: number, cooldownDays: number): boolean {
  if (isTeaserHidden(store, now) || store.collapsed || heldPrize(store, now)) return false;
  return !isNum(store.promptedAt) || now - store.promptedAt >= Math.max(1, cooldownDays) * DAY_MS;
}

export function withNeverShow(store: WheelStore, now: number): WheelStore {
  return { ...store, hiddenUntil: now + WHEEL_NEVER_SHOW_DAYS * DAY_MS, collapsed: true };
}

export function withPrompted(store: WheelStore, now: number): WheelStore {
  return { ...store, promptedAt: now };
}

export function withCollapsed(store: WheelStore): WheelStore {
  return { ...store, collapsed: true };
}

export function withPrize(store: WheelStore, prize: { label: string; holdUntil: string }): WheelStore {
  return { ...store, prize: { label: prize.label.slice(0, 80), holdUntil: prize.holdUntil } };
}

/** Forgets the device's prize hint (the server has no held spin for this visitor, or an account is signed in). */
export function withoutPrize(store: WheelStore): WheelStore {
  const next = { ...store };
  delete next.prize;
  return next;
}

/** Closing the chip hides it for a day (it comes back while the prize is still unused). */
export function withChipHidden(store: WheelStore, now: number): WheelStore {
  return { ...store, chipHiddenUntil: now + DAY_MS };
}

export function isChipHidden(store: WheelStore, now: number): boolean {
  return isNum(store.chipHiddenUntil) && store.chipHiddenUntil > now;
}

/** The account's prize is still running at `now`. */
export function isPrizeLive(prize: WheelActivePrize | null | undefined, now: number): prize is WheelActivePrize {
  const end = prize ? Date.parse(prize.endsAt) : Number.NaN;
  return Number.isFinite(end) && end > now;
}

// ---------------------------------------------------------------------------------------------------
// Browser glue (localStorage hints, with a same-tab change event for useSyncExternalStore)

const CHANGE_EVENT = "prestij:wheel-change";

export function readWheelStoreRaw(): string | null {
  try {
    return window.localStorage.getItem(WHEEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeWheelStore(store: WheelStore): void {
  try {
    window.localStorage.setItem(WHEEL_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private mode or full storage: the hint is lost, nothing else.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeWheelStore(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === WHEEL_STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

// ---------------------------------------------------------------------------------------------------
// Per-tab cache of the loaded wheel (signed-in visitors would otherwise ask on every page load)

/** What the island loads once (my action loadWheelDialog): the visitor's state and the dialog texts. */
export type WheelDialogData = { state: WheelState | null; labels: WheelDialogLabels };

const CACHE_KEY = "prestij:wheel-state";
/** A cached answer is reused for this long (cleared on cart/checkout/order pages, where prizes get spent). */
export const WHEEL_STATE_TTL_MS = 10 * 60_000;

/** The cached answer for `signature` when younger than the TTL (pure; `raw` is the stored JSON). */
export function parseCachedWheelData(raw: string | null, signature: string, now: number): WheelDialogData | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { sig?: unknown; at?: unknown; data?: WheelDialogData };
    if (v.sig !== signature || !isNum(v.at) || now - v.at > WHEEL_STATE_TTL_MS || now < v.at) return null;
    return v.data && typeof v.data === "object" && v.data.labels ? v.data : null;
  } catch {
    return null;
  }
}

export function readCachedWheelData(signature: string, now: number): WheelDialogData | null {
  try {
    return parseCachedWheelData(window.sessionStorage.getItem(CACHE_KEY), signature, now);
  } catch {
    return null;
  }
}

export function writeCachedWheelData(signature: string, data: WheelDialogData, now: number): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ sig: signature, at: now, data }));
  } catch {
    // ignore
  }
}

export function clearCachedWheelData(): void {
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
