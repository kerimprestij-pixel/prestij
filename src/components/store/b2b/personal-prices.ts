"use client";
// Batches the business price islands of one page into one Server Action call per kind (variants for
// the product page, products for cards). Islands register their ids; after a short tick the queue is
// sent, results are cached per viewer and per locale until the viewer changes (sign-in / sign-out).
// Nothing runs for signed-out visitors or before the viewer has loaded.
import { useEffect, useSyncExternalStore } from "react";
import { useViewer } from "@/components/store/viewer/ViewerProvider";
import type { Locale } from "@/i18n/locales";
import { loadPersonalCardPrices, loadPersonalPrices, type PersonalCardPriceView, type PersonalPriceView } from "@/lib/customer/price-actions";

type Kind = "variant" | "product";
type ViewFor<K extends Kind> = K extends "variant" ? PersonalPriceView : PersonalCardPriceView;

type Bucket = {
  results: Map<number, PersonalPriceView | PersonalCardPriceView | null>;
  queued: Set<number>;
  inflight: Set<number>;
  timer: ReturnType<typeof setTimeout> | null;
};

const newBucket = (): Bucket => ({ results: new Map(), queued: new Set(), inflight: new Set(), timer: null });

let generation = "";
const buckets: Record<Kind, Bucket> = { variant: newBucket(), product: newBucket() };
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;
const getServerVersion = () => 0;

/** A new viewer (or locale) forgets every cached price. */
function switchGeneration(gen: string) {
  if (gen === generation) return;
  generation = gen;
  for (const kind of ["variant", "product"] as const) {
    const b = buckets[kind];
    if (b.timer) clearTimeout(b.timer);
    buckets[kind] = newBucket();
  }
  emit();
}

async function flush(kind: Kind, locale: Locale) {
  const bucket = buckets[kind];
  bucket.timer = null;
  const ids = [...bucket.queued];
  bucket.queued.clear();
  if (ids.length === 0) return;
  for (const id of ids) bucket.inflight.add(id);
  const gen = generation;
  let answer: Record<number, PersonalPriceView | PersonalCardPriceView> = {};
  try {
    answer = kind === "variant" ? await loadPersonalPrices(ids, locale) : await loadPersonalCardPrices(ids, locale);
  } catch {
    answer = {};
  }
  if (gen !== generation || buckets[kind] !== bucket) return;
  for (const id of ids) {
    bucket.inflight.delete(id);
    bucket.results.set(id, answer[id] ?? null);
  }
  emit();
}

function request(kind: Kind, ids: readonly number[], locale: Locale) {
  const bucket = buckets[kind];
  for (const id of ids) {
    if (!bucket.results.has(id) && !bucket.inflight.has(id)) bucket.queued.add(id);
  }
  if (bucket.queued.size > 0 && !bucket.timer) bucket.timer = setTimeout(() => void flush(kind, locale), 40);
}

/**
 * Personal prices for `ids` (variant ids or product ids), keyed by id; empty while loading, for
 * signed-out visitors and when the buyer pays retail.
 */
export function usePersonalPrices<K extends Kind>(kind: K, ids: readonly number[], locale: Locale): Map<number, ViewFor<K>> {
  const viewer = useViewer();
  const active = viewer.ready && viewer.signedIn;
  const gen = active ? `${locale}|${viewer.firstName ?? ""}|${viewer.isBusiness}|${viewer.companyStatus ?? ""}` : "";
  const key = ids.join(",");

  useEffect(() => {
    switchGeneration(gen);
    if (!active) return;
    request(kind, key ? key.split(",").map(Number) : [], locale);
  }, [active, gen, key, kind, locale]);

  useSyncExternalStore(subscribe, getVersion, getServerVersion);

  const out = new Map<number, ViewFor<K>>();
  if (!active || gen !== generation) return out;
  const bucket = buckets[kind];
  for (const id of ids) {
    const hit = bucket.results.get(id);
    if (hit) out.set(id, hit as ViewFor<K>);
  }
  return out;
}
