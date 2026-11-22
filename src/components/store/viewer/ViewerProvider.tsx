"use client";
// Who is browsing, for client islands on static pages (header greeting, favorite hearts, business
// badges). Mounted once in the storefront root layout: it calls the loadViewer() Server Action a single
// time after hydration, when the browser is idle, and keeps the result across client navigations.
// Static pages never read the session on the server, so they stay prerendered (○).
//
//   const viewer = useViewer();
//   if (!viewer.ready) → render the signed-out look (no layout shift when it resolves)
//   viewer.signedIn, viewer.firstName, viewer.isBusiness, viewer.companyStatus, viewer.favoriteProductIds
//   viewer.refresh()                     → reload after sign-in / sign-out / profile changes
//   viewer.setFavorite(productId, true)  → optimistic heart (call your Server Action, then refresh() on failure)

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadViewer } from "@/lib/customer/viewer-actions";
import { SIGNED_OUT_VIEWER, type ViewerState } from "@/lib/customer/viewer";

export type ViewerContextValue = ViewerState & {
  /** False until the first loadViewer() answer (render the signed-out look meanwhile). */
  ready: boolean;
  /** Loads the viewer again (after sign-in, sign-out, a profile or favorites change). */
  refresh: () => Promise<ViewerState>;
  /** Optimistically adds or removes a product in favoriteProductIds (no server call). */
  setFavorite: (productId: number, favorite: boolean) => void;
};

const ViewerContext = createContext<ViewerContextValue | null>(null);

const FALLBACK: ViewerContextValue = {
  ...SIGNED_OUT_VIEWER,
  ready: false,
  refresh: async () => SIGNED_OUT_VIEWER,
  setFavorite: () => {},
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Runs `task` when the browser is idle (at the latest after 2 s); returns a cancel function. */
function whenIdle(task: () => void): () => void {
  const w = window as IdleWindow;
  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(task, { timeout: 2000 });
    return () => w.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, 300);
  return () => window.clearTimeout(handle);
}

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [viewer, setViewer] = useState<ViewerState>(SIGNED_OUT_VIEWER);
  const [ready, setReady] = useState(false);

  const load = useCallback(async (): Promise<ViewerState> => {
    let next: ViewerState;
    try {
      next = await loadViewer();
    } catch {
      next = SIGNED_OUT_VIEWER;
    }
    setViewer(next);
    setReady(true);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    const cancel = whenIdle(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      cancel();
    };
  }, [load]);

  const setFavorite = useCallback((productId: number, favorite: boolean) => {
    setViewer((current) => {
      const has = current.favoriteProductIds.includes(productId);
      if (favorite === has) return current;
      return {
        ...current,
        favoriteProductIds: favorite ? [productId, ...current.favoriteProductIds] : current.favoriteProductIds.filter((id) => id !== productId),
      };
    });
  }, []);

  const value = useMemo<ViewerContextValue>(() => ({ ...viewer, ready, refresh: load, setFavorite }), [viewer, ready, load, setFavorite]);

  return <ViewerContext value={value}>{children}</ViewerContext>;
}

/** The current viewer (signed-out defaults outside the provider or before the first load). */
export function useViewer(): ViewerContextValue {
  return useContext(ViewerContext) ?? FALLBACK;
}

export default ViewerProvider;
