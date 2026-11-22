// Runs work when the browser is idle (the wheel never competes with the page's own loading).

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Runs `task` once the browser is idle (at the latest after `timeout` ms); returns a cancel function. */
export function whenIdle(task: () => void, timeout = 4000): () => void {
  const w = window as IdleWindow;
  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(task, { timeout });
    return () => w.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, 1500);
  return () => window.clearTimeout(handle);
}
