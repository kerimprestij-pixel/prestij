// Tiny bridge between the cart (owned elsewhere) and the header badge. The cart code calls
// publishCartCount(n) after every change; the badge listens and also restores the last value on load.
// Plain module (no "use client") so both sides can import the constants.

export const CART_COUNT_EVENT = "prestij:cart-count";
export const CART_COUNT_STORAGE_KEY = "prestij:cart-count";

/** Call from client code whenever the number of items in the cart changes. */
export function publishCartCount(count: number): void {
  if (typeof window === "undefined") return;
  const value = Math.max(0, Math.floor(Number(count) || 0));
  try {
    window.localStorage.setItem(CART_COUNT_STORAGE_KEY, String(value));
  } catch {
    // Storage can be unavailable (private mode); the event below still updates open badges.
  }
  window.dispatchEvent(new CustomEvent<number>(CART_COUNT_EVENT, { detail: value }));
}

export function readStoredCartCount(): number {
  try {
    const value = Number(window.localStorage.getItem(CART_COUNT_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}
