import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import { TAGS } from "@/lib/cache-tags";
import { validateOverride } from "@/lib/panel/ui-strings/template";
import { defaultLocale, isLocale, type Locale } from "./config";
import { defaultMessages, type Messages } from "./messages";

export type { Messages };

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null;

/**
 * Sets `value` at a dotted path, but only where the default dictionary already has a string leaf and
 * the override keeps that default's {placeholders} and plural syntax (checked on save by the panel and
 * again here, in case a later code change altered the default).
 */
function applyOverride(target: Node, dottedKey: string, value: string, locale: Locale): void {
  const path = dottedKey.split(".");
  if (path.some((segment) => !segment || FORBIDDEN_KEYS.has(segment))) return;
  let node: unknown = target;
  for (const segment of path.slice(0, -1)) {
    if (!isNode(node) || !Object.hasOwn(node, segment)) return;
    node = node[segment];
  }
  const leaf = path[path.length - 1];
  if (!isNode(node) || !Object.hasOwn(node, leaf)) return;
  const current = node[leaf];
  if (typeof current !== "string" || validateOverride(current, value, locale) !== null) return;
  node[leaf] = value;
}

/**
 * The built-in dictionary for `lang` with `ui_strings` rows applied (pure; shared by getMessages and
 * by code that must read fresh, uncached texts, such as e-mails rendered inside a transaction).
 */
export function mergeUiStringOverrides(lang: Locale, rows: readonly { key: string; value: unknown }[]): Messages {
  const messages = structuredClone(defaultMessages[lang]);
  for (const row of rows) {
    const value = isNode(row.value) ? row.value[lang] : undefined;
    const text = typeof value === "string" ? value.trim() : "";
    if (text) applyOverride(messages as Node, row.key, text, lang);
  }
  return messages;
}

/**
 * The UI dictionary for `locale`: built-in defaults deep-merged with panel overrides from `ui_strings`
 * (flat dotted keys, one optional text per locale). An override only replaces its own language: an
 * empty or missing locale keeps that language's built-in text. Cached until the panel updates
 * TAGS.uiStrings.
 */
export async function getMessages(locale: Locale): Promise<Messages> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.uiStrings);

  const lang = isLocale(locale) ? locale : defaultLocale;
  const rows = await db
    .select({ key: schema.uiStrings.key, value: schema.uiStrings.value })
    .from(schema.uiStrings);
  return mergeUiStringOverrides(lang, rows);
}
