// Client-side glue between the cart surfaces (drawer, /sepet page, add-to-cart button, header badge).
// Not a source of truth: every view comes from a cart Server Action or the server render, and the
// newest one wins. Plain module (no hooks, no "use client"), so client components share one instance.
import type { CartView } from "@/lib/cart/view";
import { publishCartCount } from "@/components/store/cart-count";

export type CartViewEntry = { view: CartView; seq: number };

let latest: CartViewEntry | null = null;
let seq = 0;
const viewListeners = new Set<(entry: CartViewEntry) => void>();

/**
 * Shares a fresh server view with every mounted cart surface and updates the header badge.
 * Returns the sequence number given to this view (newer = larger).
 */
export function publishCartView(view: CartView): number {
  latest = { view, seq: ++seq };
  publishCartCount(view.itemCount);
  for (const listener of [...viewListeners]) listener(latest);
  return latest.seq;
}

/**
 * Listens for published views. If a view newer than `sinceSeq` was published while the caller was
 * not listening (e.g. a page hidden by <Activity>), it is replayed asynchronously.
 */
export function subscribeCartView(listener: (entry: CartViewEntry) => void, sinceSeq = 0): () => void {
  viewListeners.add(listener);
  const pending = latest;
  if (pending && pending.seq > sinceSeq) {
    queueMicrotask(() => {
      if (viewListeners.has(listener)) listener(pending);
    });
  }
  return () => {
    viewListeners.delete(listener);
  };
}

// --- Drawer --------------------------------------------------------------------------------------

export type CartDrawerRequest = {
  /** The caller just published a fresh view (e.g. after addToCart): skip the reload. */
  fresh?: boolean;
  /** Localized message to show and announce (e.g. the action's notice). */
  notice?: string;
  /** Line to highlight briefly (the variant that was just added). */
  highlightVariantId?: number;
  /** Element that gets focus back when the drawer closes (defaults to the focused element). */
  returnFocus?: HTMLElement | null;
};

const drawerListeners = new Set<(request: CartDrawerRequest) => void>();

/** Opens the cart drawer (mounted once in the storefront layout). Returns false when none is mounted. */
export function openCartDrawer(request: CartDrawerRequest = {}): boolean {
  if (drawerListeners.size === 0) return false;
  for (const listener of [...drawerListeners]) listener(request);
  return true;
}

export function subscribeCartDrawer(listener: (request: CartDrawerRequest) => void): () => void {
  drawerListeners.add(listener);
  return () => {
    drawerListeners.delete(listener);
  };
}
