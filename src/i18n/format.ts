// Tiny, dependency-free helpers for UI strings. Safe in server and client components.

const PLURAL = /\{(\w+),\s*plural,((?:\s*(?:=\d+|zero|one|two|few|many|other)\s*\{[^{}]*\})+)\s*\}/g;
const BRANCH = /(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g;

const pluralRules = new Map<string, Intl.PluralRules>();
function rulesFor(locale: string): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules;
}

/**
 * Fills `{name}` placeholders: format("Sepet, {count} ürün", { count: 2 }) → "Sepet, 2 ürün".
 * Also understands ICU-style plurals, chosen with Intl.PluralRules for `locale` (default "en"):
 * format("{count, plural, one {# product} other {# products}}", { count: 1 }, "en") → "1 product".
 */
export function format(template: string, vars: Record<string, string | number>, locale = "en"): string {
  const withPlurals = template.replace(PLURAL, (match, key: string, body: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
    const value = Number(vars[key]);
    if (!Number.isFinite(value)) return match;
    const branches = new Map<string, string>();
    for (const [, selector, text] of body.matchAll(BRANCH)) branches.set(selector, text);
    const chosen = branches.get(`=${value}`) ?? branches.get(rulesFor(locale).select(value)) ?? branches.get("other");
    return chosen === undefined ? match : chosen.replace(/#/g, String(vars[key]));
  });
  return withPlurals.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}

type Tree = { [key: string]: string | Tree };

/** Flattens a nested dictionary into dotted keys: { header: { cart } } → { "header.cart": "…" }. */
export function flattenMessages(tree: object, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree as Tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else if (value && typeof value === "object") Object.assign(out, flattenMessages(value, path));
  }
  return out;
}
