"use client";

// Shared state machine of the cart drawer and the /sepet page: holds the last server CartView, shows
// optimistic changes while an action runs (useOptimistic inside transitions), replaces them with the
// view the action returns, and keeps every other cart surface and the header badge in sync.
import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { Locale } from "@/i18n/config";
import {
  addSample as addSampleAction,
  applyCoupon as applyCouponAction,
  getCart,
  removeCoupon as removeCouponAction,
  removeLine as removeLineAction,
  setLineQuantity,
} from "@/lib/cart/actions";
import type { CartActionResult, CartNoticeCode } from "@/lib/cart/action-types";
import type { CartLineView, CartView } from "@/lib/cart/view";
import { publishCartView, subscribeCartView } from "./cart-store";

export type CartMessage = {
  id: number;
  text: string;
  tone: "success" | "error" | "info";
  /** False: announced to screen readers only (routine updates whose effect is already visible). */
  visible: boolean;
};

type Op =
  | { type: "quantity"; lineId: number; quantity: number }
  | { type: "remove"; lineId: number }
  | { type: "sample"; variantId: number }
  | { type: "removeCoupon" };

/** Notices whose result is already visible in the UI: screen-reader announcement only. */
const QUIET_NOTICES: ReadonlySet<CartNoticeCode> = new Set(["updated", "removed"]);

function applyOp(view: CartView, op: Op): CartView {
  switch (op.type) {
    case "quantity":
      return {
        ...view,
        lines: view.lines.map((l) =>
          l.lineId === op.lineId
            ? {
                ...l,
                quantity: op.quantity,
                canIncrease: l.included && !l.isSample && op.quantity < l.maxQuantity,
                canDecrease: l.included && !l.isSample && op.quantity > l.minQuantity,
              }
            : l,
        ),
      };
    case "remove": {
      const lines = view.lines.filter((l) => l.lineId !== op.lineId);
      // Samples cannot stay without a paid product; the server drops them too.
      const paidLeft = lines.some((l) => !l.isSample);
      const kept = paidLeft ? lines : [];
      return { ...view, lines: kept, isEmpty: kept.length === 0 };
    }
    case "sample":
      return {
        ...view,
        availableSamples: view.availableSamples.map((s) =>
          s.variantId === op.variantId ? { ...s, inCart: true, canAdd: false } : s,
        ),
      };
    case "removeCoupon":
      // Taking a gift wheel prize off keeps it in the account, ready to apply again (what the server answers).
      return {
        ...view,
        coupon: null,
        wheelPrize: view.wheelPrize?.status === "applied" ? { ...view.wheelPrize, status: "ready", message: null } : view.wheelPrize,
      };
  }
}

type Options = {
  locale: Locale;
  /** Server-rendered view (cart page) or null (drawer: loaded on open). */
  initialView: CartView | null;
  /** Localized fallback error when an action cannot be reached at all. */
  genericError: string;
};

export function useCartController({ locale, initialView, genericError }: Options) {
  const [view, setView] = useState<CartView | null>(initialView);
  const [seed, setSeed] = useState<CartView | null>(initialView);
  const [message, setMessage] = useState<CartMessage | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [optimisticView, addOptimistic] = useOptimistic(view, (current: CartView | null, op: Op) =>
    current ? applyOp(current, op) : current,
  );
  const [busyLineIds, markBusy] = useOptimistic<number[], number>([], (current, lineId) => [...current, lineId]);
  const seqRef = useRef(0);
  const messageId = useRef(0);
  const publishedSeed = useRef<CartView | null>(null);

  // A new server render (e.g. after navigating back to /sepet) replaces the local view.
  if (initialView !== seed) {
    setSeed(initialView);
    if (initialView) setView(initialView);
  }

  // Share each new server render once (badge + other surfaces); never re-publish an old one when a
  // hidden page becomes visible again.
  useEffect(() => {
    if (!initialView || publishedSeed.current === initialView) return;
    publishedSeed.current = initialView;
    seqRef.current = publishCartView(initialView);
  }, [initialView]);

  // Follow views published by other surfaces (and replay any published while this one was hidden).
  useEffect(
    () =>
      subscribeCartView((entry) => {
        if (entry.seq <= seqRef.current || entry.view.locale !== locale) return;
        seqRef.current = entry.seq;
        setView(entry.view);
      }, seqRef.current),
    [locale],
  );

  const say = useCallback((text: string, tone: CartMessage["tone"], visible = true) => {
    messageId.current += 1;
    setMessage({ id: messageId.current, text, tone, visible });
  }, []);

  const clearMessage = useCallback(() => setMessage(null), []);

  const adopt = useCallback((next: CartView) => {
    seqRef.current = publishCartView(next);
    setView(next);
  }, []);

  const run = useCallback(
    (
      call: () => Promise<CartActionResult>,
      options: { op?: Op; lineId?: number; onResult?: (result: CartActionResult) => void } = {},
    ) => {
      startTransition(async () => {
        if (options.op) addOptimistic(options.op);
        if (options.lineId != null) markBusy(options.lineId);
        let result: CartActionResult;
        try {
          result = await call();
        } catch {
          result = { ok: false, code: "generic", error: genericError };
        }
        startTransition(() => {
          if (result.view) adopt(result.view);
          if (!result.ok) say(result.error, "error");
          else if (result.notice) {
            const quiet = result.noticeCode != null && QUIET_NOTICES.has(result.noticeCode);
            say(result.notice, result.noticeCode === "samples_removed" || result.noticeCode === "quantities_adjusted" ? "info" : "success", !quiet);
          }
          options.onResult?.(result);
        });
      });
    },
    [addOptimistic, adopt, genericError, markBusy, say],
  );

  /** (Re)loads the cart from the server (getCart also prunes invalid samples and clamps quantities). */
  const load = useCallback(() => {
    startTransition(async () => {
      let result: CartActionResult | null = null;
      try {
        result = await getCart({ locale });
      } catch {
        result = null;
      }
      startTransition(() => {
        if (result?.view) {
          adopt(result.view);
          setLoadFailed(false);
          if (result.ok && result.notice) say(result.notice, "info");
        } else {
          setLoadFailed(true);
        }
      });
    });
  }, [adopt, locale, say]);

  const setQuantity = useCallback(
    (line: CartLineView, quantity: number) => {
      if (quantity === line.quantity) return;
      if (quantity <= 0) {
        run(() => removeLineAction({ lineId: line.lineId, locale }), { op: { type: "remove", lineId: line.lineId } });
        return;
      }
      run(() => setLineQuantity({ lineId: line.lineId, quantity, locale }), {
        op: { type: "quantity", lineId: line.lineId, quantity },
        lineId: line.lineId,
      });
    },
    [locale, run],
  );

  const remove = useCallback(
    (line: CartLineView) => {
      run(() => removeLineAction({ lineId: line.lineId, locale }), { op: { type: "remove", lineId: line.lineId } });
    },
    [locale, run],
  );

  const addSample = useCallback(
    (variantId: number) => {
      run(() => addSampleAction({ variantId, locale }), { op: { type: "sample", variantId } });
    },
    [locale, run],
  );

  const applyCoupon = useCallback(
    (code: string, onResult?: (result: CartActionResult) => void) => {
      run(() => applyCouponAction({ code, locale }), { onResult });
    },
    [locale, run],
  );

  const removeCoupon = useCallback(() => {
    run(() => removeCouponAction({ locale }), { op: { type: "removeCoupon" } });
  }, [locale, run]);

  /** Drops a view in another language (after a language switch the drawer reloads). */
  const usable = optimisticView && optimisticView.locale === locale ? optimisticView : null;

  return {
    view: usable,
    pending: isPending,
    busyLineIds,
    message,
    loadFailed,
    say,
    clearMessage,
    load,
    setQuantity,
    remove,
    addSample,
    applyCoupon,
    removeCoupon,
  };
}

export type CartController = ReturnType<typeof useCartController>;
