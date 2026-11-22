"use client";

// The cart drawer's island in the storefront layout (every page). It only listens for openCartDrawer()
// requests (header cart icon, add to cart); the sheet itself (./CartDrawerSheet: lines, samples,
// summary, focus trap — most of the cart UI code) is a separate chunk. It is fetched when the browser
// is idle after the page has loaded, or at the first open request if that comes sooner, so no page
// ships it in its first-load JavaScript. Requests that arrive before it is ready are queued.
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { subscribeCartDrawer, type CartDrawerRequest } from "./cart-store";
import type { CartDrawerSheetProps } from "./CartDrawerSheet";
import type { CartLinks, CartUiLabels } from "./labels";

type Props = { locale: CartDrawerSheetProps["locale"]; labels: CartUiLabels; links: CartLinks };
type OpenHandler = (request: CartDrawerRequest) => void;

/** If the chunk cannot be fetched (offline, or a new deployment replaced it), opening goes to /sepet. */
function SheetUnavailable({ links, register }: CartDrawerSheetProps) {
  useEffect(() => {
    register(() => window.location.assign(links.cart));
    return () => register(null);
  }, [links.cart, register]);
  return null;
}

const CartDrawerSheet = lazy<ComponentType<CartDrawerSheetProps>>(() =>
  import("./CartDrawerSheet").catch(() => ({ default: SheetUnavailable })),
);

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Runs `task` once the browser is idle (at the latest after 4 s); returns a cancel function. */
function whenIdle(task: () => void): () => void {
  const w = window as IdleWindow;
  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(task, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, 1500);
  return () => window.clearTimeout(handle);
}

export default function CartDrawer({ locale, labels, links }: Props) {
  const [wanted, setWanted] = useState(false);
  const handler = useRef<OpenHandler | null>(null);
  const queue = useRef<CartDrawerRequest[]>([]);

  // The sheet hands over its request handler once mounted; queued requests are replayed in order.
  const register = useCallback((open: OpenHandler | null) => {
    handler.current = open;
    if (!open) return;
    for (const request of queue.current.splice(0)) open(request);
  }, []);

  useEffect(
    () =>
      subscribeCartDrawer((request) => {
        if (handler.current) {
          handler.current(request);
          return;
        }
        queue.current.push(request);
        setWanted(true);
      }),
    [],
  );

  useEffect(() => whenIdle(() => setWanted(true)), []);

  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <CartDrawerSheet locale={locale} labels={labels} links={links} register={register} />
    </Suspense>
  );
}
