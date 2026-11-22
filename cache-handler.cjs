// Route (ISR) cache handler for self-hosted `next start` (next.config.ts `cacheHandler`; not used on
// Vercel). It is Next's own FileSystemCache with two changes:
//
// 1. Tag invalidations never move backwards in time. On `updateTag`/`revalidateTag`, Next 16.4.5 first
//    lets the "use cache" handler stamp the shared tags manifest with performance.timeOrigin +
//    performance.now(), then FileSystemCache.revalidateTag overwrites the same entry with Date.now().
//    "use cache" entries are stamped with the performance clock, which in a long-running process can
//    drift ahead of Date.now() (measured: +1.3 s). An entry refilled within that drift before a save was
//    then never expired by the save, and the storefront kept the previous version until the next save
//    of the same tag. Keeping the later of the two stamps expires both kinds of entries.
// 2. 404 responses are kept only in the bounded in-memory LRU (cacheMaxMemorySize), never written to
//    .next/server/route-cache. Otherwise every unknown slug under the [slug] routes persisted ~160 KB
//    on disk forever (anonymous disk amplification).
//
// Plain CommonJS on purpose: Next loads this file at runtime, outside the bundler.
"use strict";

const FileSystemCache = require("next/dist/server/lib/incremental-cache/file-system-cache.js").default;
const { tagsManifest } = require("next/dist/server/lib/incremental-cache/tags-manifest.external.js");

/** Keeps, per field, the later of the two manifest stamps (exported for unit tests). */
function laterStamps(previous, current) {
  if (!previous) return current;
  if (!current) return previous;
  const merged = { ...current };
  for (const field of ["expired", "stale"]) {
    const before = previous[field];
    const after = current[field];
    if (typeof before === "number" && (typeof after !== "number" || before > after)) merged[field] = before;
  }
  return merged;
}

/** True for a rendered App Router 404 (not-found) response. */
function isNotFoundPage(data) {
  return Boolean(data) && data.kind === "APP_PAGE" && data.status === 404;
}

class PrestijCacheHandler extends FileSystemCache {
  async revalidateTag(tags, durations) {
    const list = typeof tags === "string" ? [tags] : Array.isArray(tags) ? tags : [];
    const previous = new Map(list.map((tag) => [tag, tagsManifest.get(tag)]));
    await super.revalidateTag(tags, durations);
    for (const tag of list) {
      const merged = laterStamps(previous.get(tag), tagsManifest.get(tag));
      if (merged) tagsManifest.set(tag, merged);
    }
  }

  async set(key, data, ctx) {
    if (isNotFoundPage(data)) {
      const seedState = this.getSeedReadState(key);
      if (seedState) seedState.version++;
      FileSystemCache.memoryCache?.set(key, {
        value: data,
        lastModified: Date.now(),
        cacheControl: ctx && !ctx.fetchCache ? ctx.cacheControl : undefined,
      });
      return;
    }
    return super.set(key, data, ctx);
  }
}

module.exports = PrestijCacheHandler;
module.exports.default = PrestijCacheHandler;
module.exports.laterStamps = laterStamps;
module.exports.isNotFoundPage = isNotFoundPage;
