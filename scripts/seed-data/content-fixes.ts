// Copy corrections made after scripts/content-day5.ts first wrote the day-5 content to the live database.
// The seed definitions hold the corrected text, so a fresh database gets it from scripts/seed.ts. Each
// correction also records the exact text it replaced, so the content script can rebuild every version it
// wrote earlier and update a stored value only while it still equals one of them (otherwise the client
// edited it: the step reports it as skipped).
//
// Rounds: round 1 = the review/FIX stage (2026-11-11, records without `round`), round 2 = the independent
// verification after it (`round: 2`), round 3 = the second review of that work (REVIEW2 / FIX2,
// `round: 3`). The live database holds the text of the last round it was given,
// so a step accepts the version before each round (earlierVersions), not only the very first one.
// Pure data helpers (no DB).

export type FixLocale = "tr" | "en" | "ar";

/**
 * One correction inside a text: `before` became `after` (the current seed text). `round` (default 1)
 * says in which correction round it was made; records of a later round come after the earlier ones.
 */
export type TextFix = { before: string; after: string; round?: number };

/** Corrections per language of one localized text. */
export type LocaleFixes = Partial<Record<FixLocale, readonly TextFix[]>>;

/** The round of a correction (records without one belong to round 1). */
export const roundOf = (fix: TextFix): number => fix.round ?? 1;

function assertRoundOrder(fixes: readonly TextFix[]): void {
  for (let i = 1; i < fixes.length; i += 1) {
    if (roundOf(fixes[i]) < roundOf(fixes[i - 1])) {
      throw new Error(`content fix of round ${roundOf(fixes[i])} listed after one of round ${roundOf(fixes[i - 1])}: "${fixes[i].after.slice(0, 80)}"`);
    }
  }
}

/**
 * `text` (the current seed text) with its fixes undone: the text as first written, or with
 * `fromRound` the text as it was before that round (only the fixes of that round and later are undone).
 * Fixes are undone in reverse order; each `after` must occur exactly once at that point (a record that no
 * longer matches the seed text throws, so a broken record can never silently update or skip a row).
 */
export function undoFixes(text: string, fixes: readonly TextFix[] = [], fromRound = 1): string {
  assertRoundOrder(fixes);
  let out = text;
  for (const fix of [...fixes].reverse()) {
    if (roundOf(fix) < fromRound) break;
    if (!fix.after) throw new Error("content fix with an empty `after` (give it some context)");
    const at = out.indexOf(fix.after);
    if (at < 0 || out.indexOf(fix.after, at + 1) >= 0) {
      throw new Error(`content fix not found exactly once in the seed text: "${fix.after.slice(0, 80)}"`);
    }
    out = out.slice(0, at) + fix.before + out.slice(at + fix.after.length);
  }
  return out;
}

/** undoFixes for each language of a localized text (languages without fixes are returned unchanged). */
export function undoLocalizedFixes<T extends Partial<Record<FixLocale, string>>>(text: T, fixes: LocaleFixes | undefined, fromRound = 1): T {
  if (!fixes) return text;
  const out: Partial<Record<FixLocale, string>> = { ...text };
  for (const locale of Object.keys(fixes) as FixLocale[]) {
    const value = text[locale];
    if (typeof value !== "string") throw new Error(`content fix for "${locale}" but the text has no ${locale} version`);
    out[locale] = undoFixes(value, fixes[locale], fromRound);
  }
  return out as T;
}

/** The correction rounds a record set contains, newest first. */
export function fixRounds(fixes: LocaleFixes | undefined): number[] {
  const rounds = new Set(Object.values(fixes ?? {}).flatMap((list) => (list ?? []).map(roundOf)));
  return [...rounds].sort((a, b) => b - a);
}

/** A path into a JSON value: object keys and array indexes ([] = the value itself). */
export type FixPath = readonly (string | number)[];

/** Corrections to the localized text at `path` inside a JSON value. */
export type PathFixes = { path: FixPath; fixes: LocaleFixes | undefined };

function getPath(value: unknown, path: FixPath): unknown {
  return path.reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string | number, unknown>)[key] : undefined), value);
}

function setPath(value: unknown, path: FixPath, next: unknown): unknown {
  if (path.length === 0) return next;
  const [key, ...rest] = path;
  if (Array.isArray(value)) {
    if (typeof key !== "number" || key < 0 || key >= value.length) throw new Error(`content fix path: no item ${String(key)}`);
    return value.map((item, i) => (i === key ? setPath(item, rest, next) : item));
  }
  if (!value || typeof value !== "object" || !(key in value)) throw new Error(`content fix path: no key "${String(key)}"`);
  const obj = value as Record<string, unknown>;
  return { ...obj, [key]: setPath(obj[key as string], rest, next) };
}

/**
 * Every earlier version of `value` (the current seed value): for each correction round, newest first,
 * the value with that round and every later one undone at each path. The last entry is the value as first
 * written. Empty when nothing was corrected. A step passes them all as previous defaults:
 * `decideDefaultUpdate(current, next, ...earlierVersions(next, [{ path: [], fixes }]))`.
 */
export function earlierVersions<T>(value: T, list: readonly PathFixes[]): T[] {
  const rounds = [...new Set(list.flatMap((entry) => fixRounds(entry.fixes)))].sort((a, b) => b - a);
  return rounds.map((round) =>
    list.reduce<T>((out, entry) => {
      const text = getPath(value, entry.path);
      if (!text || typeof text !== "object") throw new Error(`content fix path [${entry.path.join(", ")}]: not a localized text`);
      return setPath(out, entry.path, undoLocalizedFixes(text as Partial<Record<FixLocale, string>>, entry.fixes, round)) as T;
    }, value),
  );
}
