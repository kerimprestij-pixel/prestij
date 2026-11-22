"use client";

// One shared seconds clock for every countdown on the page (gift wheel prize in the drawer and on
// /sepet). Hydration-safe through useSyncExternalStore: the server snapshot (and the hydration render)
// is null, so the component shows the value the server formatted; the live value follows right after.
// The clock runs only while at least one countdown is on screen and the tab is visible, ticks once per
// second aligned to the second boundary, and nothing reads Date.now() during render: the snapshot is
// the value the last tick stored.
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

let nowSeconds: number | null = null;
const listeners = new Set<() => void>();
let alignTimer: number | undefined;
let tickTimer: number | undefined;

function emit() {
  for (const listener of [...listeners]) listener();
}

function tick() {
  const next = Math.floor(Date.now() / 1000);
  if (next === nowSeconds) return;
  nowSeconds = next;
  emit();
}

function start() {
  if (alignTimer !== undefined || tickTimer !== undefined || document.visibilityState === "hidden") return;
  tick();
  // Flip on the second boundary, so every countdown on the page changes together.
  alignTimer = window.setTimeout(() => {
    alignTimer = undefined;
    tick();
    tickTimer = window.setInterval(tick, 1000);
  }, 1000 - (Date.now() % 1000));
}

function stop() {
  window.clearTimeout(alignTimer);
  window.clearInterval(tickTimer);
  alignTimer = undefined;
  tickTimer = undefined;
}

function onVisibilityChange() {
  if (document.visibilityState === "hidden") stop();
  else start();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) document.addEventListener("visibilitychange", onVisibilityChange);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    // Stale once nobody listens: the next countdown starts from its server value, then the live one.
    nowSeconds = null;
  };
}

const getSnapshot = () => nowSeconds;
const getServerSnapshot = (): number | null => null;
const subscribeNothing = () => () => {};

/** The external store behind useNowSeconds (exported for tests). */
export const secondsClock = { subscribe, getSnapshot, getServerSnapshot } as const;

/**
 * The current time in whole seconds while `active` (null on the server, during hydration, while
 * inactive and before the first tick). Each subscribed component re-renders once per second, nothing
 * else does.
 */
export function useNowSeconds(active: boolean): number | null {
  return useSyncExternalStore(active ? subscribe : subscribeNothing, active ? getSnapshot : getServerSnapshot, getServerSnapshot);
}

/** True while the element is (at least partly) inside the viewport; true where IntersectionObserver is missing. */
export function useInViewport(ref: RefObject<Element | null>): boolean {
  // The hydration render shows the server value whatever this is (useNowSeconds), so no mismatch.
  const [inView, setInView] = useState(() => typeof window !== "undefined" && typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setInView(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}
