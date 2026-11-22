// Dotted-path helpers for panel form state ("variants.2.price"). Pure (unit-tested).

export type Path = string | readonly (string | number)[];

export function splitPath(path: Path): (string | number)[] {
  if (typeof path !== "string") return [...path];
  if (!path) return [];
  return path.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

export function joinPath(parts: readonly (string | number | symbol)[]): string {
  return parts.map(String).join(".");
}

/** Value at a dotted path (undefined when any step is missing). */
export function getIn(source: unknown, path: Path): unknown {
  let current: unknown = source;
  for (const key of splitPath(path)) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/**
 * Immutable update at a dotted path: copies every object/array on the way, creates missing ones
 * (arrays for numeric keys). Returns the same reference when the value is unchanged.
 */
export function setIn<T>(source: T, path: Path, value: unknown): T {
  const keys = splitPath(path);
  if (keys.length === 0) return value as T;
  const step = (node: unknown, index: number): unknown => {
    const key = keys[index];
    const container: Record<string | number, unknown> | unknown[] =
      node !== null && typeof node === "object" ? (node as Record<string, unknown>) : typeof key === "number" ? [] : {};
    const currentChild = (container as Record<string | number, unknown>)[key];
    const nextChild = index === keys.length - 1 ? value : step(currentChild, index + 1);
    if (nextChild === currentChild && container === node) return node;
    if (Array.isArray(container)) {
      const copy = container.slice();
      copy[key as number] = nextChild;
      return copy;
    }
    return { ...container, [key]: nextChild };
  };
  return step(source, 0) as T;
}

const isEmptyish = (v: unknown) => v === undefined || v === null || v === "";

/**
 * Structural equality for dirty checks. Object keys whose values are undefined, null or "" on both
 * sides count as equal (an untouched optional field and a cleared one look the same to the user).
 */
export function looselyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => looselyEqual(item, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const key of keys) {
    const va = ra[key];
    const vb = rb[key];
    if (isEmptyish(va) && isEmptyish(vb)) continue;
    if (!looselyEqual(va, vb)) return false;
  }
  return true;
}

/** Errors at or below `prefix`, keyed relative to it ("title.en" under "title" → { en }). "" = the prefix itself. */
export function errorsUnder(errors: Record<string, string>, prefix: Path): Record<string, string> {
  const base = joinPath(splitPath(prefix));
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    if (key === base) out[""] = message;
    else if (!base) out[key] = message;
    else if (key.startsWith(`${base}.`)) out[key.slice(base.length + 1)] = message;
  }
  return out;
}

/** Drops errors at or below `prefix` (used when the user edits that field). */
export function withoutErrorsUnder(errors: Record<string, string>, prefix: Path): Record<string, string> {
  const base = joinPath(splitPath(prefix));
  let changed = false;
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    if (key === base || key.startsWith(`${base}.`)) changed = true;
    else out[key] = message;
  }
  return changed ? out : errors;
}
