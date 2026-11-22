"use client";
// A hydration-safe "seconds now" for the prize countdowns: one shared 1 s ticker for every subscriber,
// running only while the tab is visible (useSyncExternalStore; never Date.now() during render). The
// server snapshot is the caller's (the time the server rendered, or null: "not known yet").
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let timer: number | undefined;

function emit() {
  for (const listener of [...listeners]) listener();
}

function sync() {
  const run = listeners.size > 0 && document.visibilityState === "visible";
  if (run && timer === undefined) timer = window.setInterval(emit, 1000);
  if (!run && timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

function onVisibility() {
  sync();
  if (document.visibilityState === "visible") emit(); // catch up at once after the tab comes back
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) document.addEventListener("visibilitychange", onVisibility);
  sync();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) document.removeEventListener("visibilitychange", onVisibility);
    sync();
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The current time in whole seconds (epoch), updated every second while visible; `serverSeconds` during hydration. */
export function useNowSeconds(serverSeconds: number | null = null): number | null {
  return useSyncExternalStore<number | null>(subscribe, nowSeconds, () => serverSeconds);
}
