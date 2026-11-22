// Shared machinery of the content scripts (scripts/content-day4.ts, scripts/content-day5.ts): the step
// report, the "update only while it is still the previous seeded default" rule, JSON path helpers, the
// production guard and the runner (one transaction per step, --dry-run, --only=…).
// Everything except runContentSteps is pure (unit-tested in tests/unit/day5-core-content-helpers.test.ts).
import { createScriptDb, type ScriptDb } from "./db";

// ---------------------------------------------------------------------------------------------------
// Reports

export type ContentReport = {
  /** One line per inserted row ("page_sections #31: quote_form on /kurumsal"). */
  inserted: string[];
  /** One line per updated row (previous seeded defaults only). */
  updated: string[];
  /** Why something was left alone (already there, edited by the client, …). */
  skipped: string[];
};

/** One step: runs inside its own transaction (`db` is that transaction) and reports what it did. */
export type ContentStep = (db: ScriptDb) => Promise<ContentReport>;

/** A registered step: `key` is what --only= takes, `owner` the area that wrote it. */
export type ContentStepDefinition = { key: string; owner: string; run: ContentStep };

export const emptyReport = (): ContentReport => ({ inserted: [], updated: [], skipped: [] });

/** True when a step changed nothing (a second run of an idempotent step must report this). */
export const isNothingToDo = (report: ContentReport): boolean => report.inserted.length + report.updated.length === 0;

/** Localized text from the three translations: `lt("Sıvı El Sabunu", "Liquid Hand Soap", "صابون سائل لليدين")`. */
export const lt = (tr: string, en: string, ar: string) => ({ tr, en, ar });

// ---------------------------------------------------------------------------------------------------
// JSON helpers

/** Deep equality that ignores object key order (jsonb returns keys sorted) and `undefined` properties. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** A path into JSON: object keys and array indexes, e.g. ["items", 0, "answer"]. */
export type Path = (string | number)[];

/** The value at `path`, or undefined when any step is missing. */
export function getAt(value: unknown, path: Path): unknown {
  return path.reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string | number, unknown>)[key] : undefined), value);
}

/** A copy of `value` with `next` at `path` (the path must exist). */
export function setAt(value: unknown, path: Path, next: unknown): unknown {
  if (path.length === 0) return next;
  const [key, ...rest] = path;
  if (Array.isArray(value)) return value.map((item, i) => (i === key ? setAt(item, rest, next) : item));
  const obj = (value ?? {}) as Record<string, unknown>;
  return { ...obj, [key]: setAt(obj[key as string], rest, next) };
}

// ---------------------------------------------------------------------------------------------------
// The "previous seeded default" rule

/** What to do with a stored value the script wants to change. */
export type DefaultDecision = "update" | "up_to_date" | "edited";

/**
 * Decides whether `current` (what the database holds) may become `next` (the new seeded content):
 *   - "up_to_date" when it already equals `next`;
 *   - "update" when it still equals one of the `previous` seeded defaults (pass `undefined` among them to
 *     also fill a value that was never set);
 *   - "edited" otherwise: the client changed it in the panel, so the script leaves it alone.
 * Comparison is sameJson (key order and undefined properties ignored).
 * `const decision = decideDefaultUpdate(row.seo?.title, NEW_TITLE, OLD_TITLE, undefined);`
 */
export function decideDefaultUpdate(current: unknown, next: unknown, ...previous: unknown[]): DefaultDecision {
  if (sameJson(current, next)) return "up_to_date";
  return previous.some((value) => sameJson(current, value)) ? "update" : "edited";
}

/** Report wording for a decision that skips the value (day-4 wording, kept for every script). */
export const SKIP_REASON: Record<Exclude<DefaultDecision, "update">, string> = {
  up_to_date: "already up to date",
  edited: "edited in the panel, left as is",
};

// ---------------------------------------------------------------------------------------------------
// Production guard + runner

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Throws unless the target is a local development database: refuses NODE_ENV=production and a
 * DATABASE_URL whose host is not local, unless `--allow-production` is among the arguments.
 */
export function assertSafeTarget(argv: readonly string[], env: Record<string, string | undefined> = process.env): void {
  if (argv.includes("--allow-production")) return;
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to run with NODE_ENV=production. Pass --allow-production to run it on purpose.");
  }
  let host = "";
  try {
    host = new URL(env.DATABASE_URL ?? "").hostname;
  } catch {
    // createScriptDb reports a missing or invalid DATABASE_URL.
  }
  if (host && !LOCAL_HOSTS.has(host)) {
    throw new Error(`DATABASE_URL points at "${host}", not a local database. Pass --allow-production to run it there on purpose.`);
  }
}

class DryRun extends Error {}

export type RunContentOptions = {
  /** First output line, e.g. "Day-5 content". */
  title: string;
  /** Every step, in run order. */
  steps: readonly ContentStepDefinition[];
  /** Command-line arguments: --dry-run, --only=a,b, --allow-production. */
  argv: readonly string[];
};

/**
 * Runs the steps: one transaction per step (a failing step is rolled back and reported, the others still
 * run), `--dry-run` rolls every step back after printing its report, `--only=a,b` limits the steps.
 * Sets process.exitCode = 1 when a step failed.
 */
export async function runContentSteps({ title, steps, argv }: RunContentOptions): Promise<void> {
  assertSafeTarget(argv);
  const dryRun = argv.includes("--dry-run");
  const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",").filter(Boolean) ?? null;
  const unknown = only?.filter((key) => !steps.some((s) => s.key === key)) ?? [];
  if (unknown.length) throw new Error(`Unknown step(s): ${unknown.join(", ")}. Steps: ${steps.map((s) => s.key).join(", ")}`);

  const { db, close } = createScriptDb();
  let failed = 0;
  try {
    console.log(`${title}${dryRun ? " (dry run: nothing is saved)" : ""}`);
    for (const step of steps) {
      if (only && !only.includes(step.key)) continue;
      let report: ContentReport | null = null;
      try {
        await db.transaction(async (tx) => {
          report = await step.run(tx);
          if (dryRun) throw new DryRun();
        });
      } catch (error) {
        if (!(error instanceof DryRun)) {
          failed += 1;
          console.error(`\n✗ ${step.key} (${step.owner}) failed and was rolled back:`, error instanceof Error ? error.message : error);
          continue;
        }
      }
      const r = report as ContentReport | null;
      if (!r) continue;
      printReport(step, r);
    }
  } finally {
    await close();
  }
  if (failed) {
    process.exitCode = 1;
  } else if (!dryRun) {
    console.log("\nDone. Restart a running server (or save the page once in the panel) to see the changes.");
  }
}

function printReport(step: ContentStepDefinition, r: ContentReport): void {
  console.log(`\n● ${step.key} (${step.owner})`);
  for (const line of r.inserted) console.log(`  + ${line}`);
  for (const line of r.updated) console.log(`  ~ ${line}`);
  for (const line of r.skipped) console.log(`  · ${line}`);
  if (isNothingToDo(r)) console.log("  nothing to do");
}
