import { integer, timestamp } from "drizzle-orm/pg-core";
import type { Locale, LocalizedText } from "../../i18n/locales";

// Defined in a database-free module so client bundles do not pull in drizzle (import from there in
// client-reachable code); re-exported here for the schema files and server code.
export { LOCALES } from "../../i18n/locales";
export type { Locale, LocalizedText };

/** Money is always stored as integer minor units (kuruş) to avoid rounding errors. 12990 = 129,90 TL. */
export type Kurus = number;

export const id = () => integer().primaryKey().generatedAlwaysAsIdentity();

export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Optional publish window used by themes, sections, announcements, campaigns. */
export const schedule = {
  startsAt: timestamp({ withTimezone: true }),
  endsAt: timestamp({ withTimezone: true }),
};

export type SeoFields = {
  title?: LocalizedText;
  description?: LocalizedText;
  ogImageId?: number;
  noIndex?: boolean;
};
