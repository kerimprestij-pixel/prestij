// Client-side cache of media rows by id, so pickers can show thumbnails for stored ids. Ids not known
// yet are fetched in one batch (getMediaItemsAction). Client-only module.
import { useEffect, useSyncExternalStore } from "react";
import { getMediaItemsAction } from "@/lib/panel/media/actions";
import type { MediaLike } from "@/lib/media/types";

/** null = looked up and not found (deleted image). */
const cache = new Map<number, MediaLike | null>();
const listeners = new Set<() => void>();
let version = 0;
const queue = new Set<number>();
const inflight = new Set<number>();
let scheduled = false;

function emit() {
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Adds media objects to the cache (call from event handlers/effects, never during render). */
export function primeMedia(items: readonly MediaLike[]): void {
  let changed = false;
  for (const item of items) {
    if (cache.get(item.id) !== item) {
      cache.set(item.id, item);
      changed = true;
    }
  }
  if (changed) emit();
}

export function cachedMedia(id: number): MediaLike | null | undefined {
  return cache.get(id);
}

function flush() {
  scheduled = false;
  const ids = [...queue];
  queue.clear();
  if (ids.length === 0) return;
  for (const id of ids) inflight.add(id);
  getMediaItemsAction(ids)
    .then((items) => {
      const found = new Set(items.map((m) => m.id));
      for (const item of items) cache.set(item.id, item);
      for (const id of ids) if (!found.has(id)) cache.set(id, null);
    })
    .catch(() => {
      // Leave them unknown; a later render retries.
    })
    .finally(() => {
      for (const id of ids) inflight.delete(id);
      emit();
    });
}

/** Queues unknown ids for one batched lookup. */
export function requestMedia(ids: readonly number[]): void {
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0 || cache.has(id) || inflight.has(id)) continue;
    queue.add(id);
  }
  if (queue.size > 0 && !scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
}

/**
 * Media for ids: an item, null (not found) or undefined (loading). `known` items (e.g. preloaded by
 * the page) are used first and need no request.
 */
export function useMediaLookup(ids: readonly number[], known?: readonly MediaLike[]): (id: number) => MediaLike | null | undefined {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const key = ids.join(",");
  const knownKey = known?.map((m) => m.id).join(",") ?? "";

  useEffect(() => {
    if (known?.length) primeMedia(known);
    requestMedia(key ? key.split(",").map(Number) : []);
    // `known` is keyed by its ids; the ids list by its joined key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, knownKey]);

  return (id: number) => known?.find((m) => m.id === id) ?? cache.get(id);
}
