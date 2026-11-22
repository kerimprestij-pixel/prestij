// The locale list and the localized-text type, free of any database code. Client components and
// pure modules import from here; src/db/schema/common.ts re-exports these for the schema files (it
// pulls in drizzle-orm/pg-core, which must not end up in browser bundles).

/** Locales the site can serve. Turkish is the source language and is always required. */
export const LOCALES = ["tr", "en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

/** A text field translated per locale, stored as JSONB: { tr: "...", en: "...", ar: "..." }. */
export type LocalizedText = { tr: string } & Partial<Record<Exclude<Locale, "tr">, string>>;
