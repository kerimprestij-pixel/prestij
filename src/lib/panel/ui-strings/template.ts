// Placeholder and plural rules for UI text overrides. Pure (client- and test-safe): the panel checks
// as the user types, the server checks on save and getMessages checks again on render, so an override
// can never drop a {placeholder} the code fills in or break the ICU plural syntax format() understands.
import type { Locale } from "@/db/schema/common";

// Same grammar as src/i18n/format.ts (kept in sync; tests/unit/ui-strings-template.test.ts runs both).
const PLURAL = /\{(\w+),\s*plural,((?:\s*(?:=\d+|zero|one|two|few|many|other)\s*\{[^{}]*\})+)\s*\}/g;
const BRANCH = /(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g;
const SIMPLE = /\{(\w+)\}/g;

export type PluralPart = { name: string; selectors: string[] };

export type TemplateParts = {
  /** Names of plain {placeholders}, sorted and de-duplicated. */
  simple: string[];
  /** ICU plural blocks in order of appearance. */
  plurals: PluralPart[];
  /** True when a { or } is left over that is not part of a placeholder or plural block. */
  stray: boolean;
};

/** Splits a message template into its placeholders and plural blocks. */
export function analyzeTemplate(text: string): TemplateParts {
  const plurals: PluralPart[] = [];
  const withoutPlurals = text.replace(PLURAL, (_match, name: string, body: string) => {
    const selectors = [...body.matchAll(BRANCH)].map((m) => m[1]);
    plurals.push({ name, selectors });
    return "\u0000";
  });
  const simple = new Set<string>();
  const rest = withoutPlurals.replace(SIMPLE, (_match, name: string) => {
    simple.add(name);
    return "\u0000";
  });
  return { simple: [...simple].sort(), plurals, stray: /[{}]/.test(rest) };
}

const pluralCategories = new Map<string, Set<string>>();
/** CLDR plural categories of a locale (tr/en: one, other; ar: zero, one, two, few, many, other). */
export function pluralCategoriesOf(locale: string): Set<string> {
  let set = pluralCategories.get(locale);
  if (!set) {
    set = new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
    pluralCategories.set(locale, set);
  }
  return set;
}

const list = (names: Iterable<string>) => [...names].map((n) => `{${n}}`).join(", ");
const uniq = (names: string[]) => [...new Set(names)].sort();

/**
 * Turkish error message when `override` does not keep the default's placeholders and plural syntax
 * for `locale`, otherwise null. Rules:
 * - braces only for {placeholders} and plural blocks (no stray { or });
 * - exactly the same plain placeholders as the default (none missing, none added);
 * - a plural block for exactly the variables the default pluralizes, each with every category the
 *   default has (e.g. one + other) and only categories valid for the language (or exact =N cases).
 */
export function validateOverride(defaultText: string, override: string, locale: Locale): string | null {
  const d = analyzeTemplate(defaultText);
  const o = analyzeTemplate(override);
  if (o.stray) {
    return "Süslü parantezler { } yalnızca yer tutucular için kullanılabilir; eşleşmeyen ya da hatalı bir parantez var.";
  }

  const dPluralNames = uniq(d.plurals.map((p) => p.name));
  const oPluralNames = uniq(o.plurals.map((p) => p.name));

  // A variable the default pluralizes must stay a plural block (not a plain {count}), and vice versa.
  const becamePlain = dPluralNames.filter((n) => !oPluralNames.includes(n) && o.simple.includes(n));
  if (becamePlain.length > 0) {
    return `${list(becamePlain)} çoğul yapısıyla yazılmalı: {${becamePlain[0]}, plural, …} biçimini koruyun.`;
  }
  const becamePlural = oPluralNames.filter((n) => !dPluralNames.includes(n) && d.simple.includes(n));
  if (becamePlural.length > 0) {
    return `${list(becamePlural)} bu metinde düz yer tutucu olarak kullanılır; çoğul yapısı eklemeyin.`;
  }

  const missing = d.simple.filter((n) => !o.simple.includes(n));
  const missingPlural = dPluralNames.filter((n) => !oPluralNames.includes(n));
  if (missing.length > 0 || missingPlural.length > 0) {
    return `Şu yer tutucular eksik: ${list([...missing, ...missingPlural])}. Site bunları gerçek değerlerle doldurur.`;
  }
  const extra = [...o.simple.filter((n) => !d.simple.includes(n)), ...oPluralNames.filter((n) => !dPluralNames.includes(n))];
  if (extra.length > 0) {
    return `Bu metinde kullanılamayan yer tutucular: ${list(uniq(extra))}. Yalnızca ${
      d.simple.length + dPluralNames.length > 0 ? list([...d.simple, ...dPluralNames]) : "yer tutucusuz metin"
    } kullanılabilir.`;
  }

  const valid = pluralCategoriesOf(locale);
  for (const plural of o.plurals) {
    const bad = plural.selectors.filter((s) => !/^=\d+$/.test(s) && !valid.has(s));
    if (bad.length > 0) {
      return `"${bad.join('", "')}" bu dilde geçerli bir çoğul biçimi değil. Kullanılabilenler: ${[...valid].join(", ")} (ve =0 gibi tam sayılar).`;
    }
    if (!plural.selectors.includes("other")) return `{${plural.name}, plural, …} içinde "other { … }" biçimi zorunlu.`;
    const required = new Set(
      d.plurals.filter((p) => p.name === plural.name).flatMap((p) => p.selectors.filter((s) => !/^=\d+$/.test(s))),
    );
    const lacking = [...required].filter((s) => !plural.selectors.includes(s));
    if (lacking.length > 0) {
      return `{${plural.name}, plural, …} içinde şu biçimler eksik: ${lacking.join(", ")}. Varsayılan metindeki tüm biçimleri koruyun.`;
    }
  }
  return null;
}

/** Placeholders a message uses, for hints in the panel (plural variables marked). */
export function describePlaceholders(text: string): { name: string; plural: boolean }[] {
  const parts = analyzeTemplate(text);
  const plural = uniq(parts.plurals.map((p) => p.name));
  return [...parts.simple.filter((n) => !plural.includes(n)).map((name) => ({ name, plural: false })), ...plural.map((name) => ({ name, plural: true }))];
}
