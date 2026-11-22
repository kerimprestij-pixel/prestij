// Tables used by Better Auth (users, sessions, accounts, verification tokens).
// Column names follow the Better Auth Drizzle adapter; extra user fields are declared
// as `additionalFields` in src/lib/auth.ts.
import { bigint, boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type UserRole = "customer" | "admin" | "editor" | "staff";

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  // admin plugin
  role: text().$type<UserRole>().default("customer"),
  banned: boolean().default(false),
  banReason: text(),
  banExpires: timestamp({ withTimezone: true }),
  // PRESTİJ fields
  phone: text(),
  locale: text().default("tr"),
  companyId: integer(),
  customerGroupId: integer(),
  marketingConsent: boolean().notNull().default(false),
  marketingConsentAt: timestamp({ withTimezone: true }),
}).enableRLS();

export const session = pgTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text(),
  },
  (t) => [index().on(t.userId)],
).enableRLS();

export const account = pgTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId)],
).enableRLS();

export const verification = pgTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.identifier)],
).enableRLS();

/**
 * Better Auth's database rate-limit store (`rateLimit.storage = "database"`). Model, fields and types
 * exactly as Better Auth 1.7 expects (@better-auth/core getAuthTables: model `rateLimit` with `key`
 * (unique string), `count` (number) and `lastRequest` (bigint, epoch milliseconds), plus the adapter's
 * text `id`); the Drizzle adapter finds it under the schema key `rateLimit`. Better Auth deletes rows
 * older than its longest window itself; the `ratelimits.prune` job also clears rows older than a day.
 * The `last_request` index is ours (both deletes filter on it).
 */
export const rateLimit = pgTable(
  "rate_limit",
  {
    id: text().primaryKey(),
    key: text().notNull().unique(),
    count: integer().notNull(),
    lastRequest: bigint({ mode: "number" }).notNull(),
  },
  (t) => [index().on(t.lastRequest)],
).enableRLS();
