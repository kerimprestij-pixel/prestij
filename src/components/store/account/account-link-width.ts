// Keeps the header still when the account link turns into "Merhaba, Ayşe" (wide screens only).
// The header is static and the viewer loads after hydration, so the greeting would widen the action
// group and push the centred navigation sideways on every page load. Instead:
// - AccountLink stores its signed-in width per language (a number of pixels, nothing personal) in
//   localStorage;
// - an inline script in the header (runs before first paint) puts that width on <html> as a CSS
//   variable plus an attribute, so the signed-out look that renders first already takes that space;
// - signing out (or a viewer that turns out signed out) clears it.
// Plain module (no "use client"): the server Header imports the script, the client link the helpers.

/** localStorage key prefix; the language is appended ("…:tr"), as the greeting's width depends on it. */
export const ACCOUNT_WIDTH_STORAGE_KEY = "prestij:account-link-width";
/** CSS variable on <html> with the reserved width, e.g. "112px". */
export const ACCOUNT_WIDTH_VAR = "--prestij-account-w";
/** Attribute on <html> while a width is reserved (the link's Tailwind variants key off it). */
export const ACCOUNT_WIDTH_ATTR = "data-account-hint";
/** The greeting only shows from Tailwind's `xl` breakpoint (80rem). */
export const ACCOUNT_GREETING_QUERY = "(min-width: 80rem)";

/** Larger than the 40px icon button, at most icon + gap + the max-w-32 greeting + padding (with slack). */
const MIN_WIDTH = 41;
const MAX_WIDTH = 240;

/** Storage key for one language. */
export function accountWidthKey(locale: string): string {
  return `${ACCOUNT_WIDTH_STORAGE_KEY}:${locale}`;
}

/** A stored width in whole pixels, or null when missing or implausible. */
export function parseAccountWidth(raw: string | null | undefined): number | null {
  if (raw == null || !/^\d{1,4}$/.test(raw)) return null;
  const width = Number(raw);
  return width >= MIN_WIDTH && width <= MAX_WIDTH ? width : null;
}

/** Whole pixels to reserve for a measured width (rounded up, so the reserved box never clips). */
export function accountWidthToStore(measured: number): number | null {
  if (!Number.isFinite(measured)) return null;
  const width = Math.ceil(measured);
  return width >= MIN_WIDTH && width <= MAX_WIDTH ? width : null;
}

/**
 * Inline script for the header, placed before the account link: applies the width stored for the
 * page's language (<html lang>) before paint.
 */
export function accountWidthPrePaintScript(): string {
  return `try{var d=document.documentElement,w=localStorage.getItem(${JSON.stringify(`${ACCOUNT_WIDTH_STORAGE_KEY}:`)}+d.lang);if(w&&/^\\d{1,4}$/.test(w)&&+w>=${MIN_WIDTH}&&+w<=${MAX_WIDTH}){d.style.setProperty(${JSON.stringify(
    ACCOUNT_WIDTH_VAR,
  )},+w+"px");d.setAttribute(${JSON.stringify(ACCOUNT_WIDTH_ATTR)},"")}}catch(e){}`;
}

/** Applies the reservation on this page and stores it for the next page loads in this language. */
export function rememberAccountWidth(locale: string, width: number): void {
  try {
    window.localStorage.setItem(accountWidthKey(locale), String(width));
  } catch {
    // Storage can be unavailable (private mode): the header then simply reflows once, as before.
  }
  const root = document.documentElement;
  root.style.setProperty(ACCOUNT_WIDTH_VAR, `${width}px`);
  root.setAttribute(ACCOUNT_WIDTH_ATTR, "");
}

/** Removes the reservation and every stored width (all languages): the visitor is signed out. */
export function forgetAccountWidth(): void {
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(`${ACCOUNT_WIDTH_STORAGE_KEY}:`)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Nothing stored or storage unavailable.
  }
  const root = document.documentElement;
  root.style.removeProperty(ACCOUNT_WIDTH_VAR);
  root.removeAttribute(ACCOUNT_WIDTH_ATTR);
}

/** The width currently stored for a language (for comparisons before writing). */
export function storedAccountWidth(locale: string): number | null {
  try {
    return parseAccountWidth(window.localStorage.getItem(accountWidthKey(locale)));
  } catch {
    return null;
  }
}

/** True when something is reserved or stored (so signing out has something to clear). */
export function hasAccountWidth(): boolean {
  if (document.documentElement.hasAttribute(ACCOUNT_WIDTH_ATTR)) return true;
  try {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i++) if (storage.key(i)?.startsWith(`${ACCOUNT_WIDTH_STORAGE_KEY}:`)) return true;
  } catch {
    // Storage unavailable: nothing stored.
  }
  return false;
}
