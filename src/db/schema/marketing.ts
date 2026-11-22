// Blog, newsletter, e-mail campaigns, contact messages, legal document versions.
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { id, timestamps, type LocalizedText, type SeoFields } from "./common";
import { media } from "./site";

export const blogPosts = pgTable(
  "blog_posts",
  {
    id: id(),
    slug: text().notNull().unique(),
    title: jsonb().$type<LocalizedText>().notNull(),
    excerpt: jsonb().$type<LocalizedText>(),
    body: jsonb().$type<LocalizedText>(), // rich text (HTML subset) per locale
    coverId: integer().references(() => media.id, { onDelete: "set null" }),
    authorName: text(),
    tags: text().array(),
    relatedProductIds: integer().array(),
    status: text().$type<"draft" | "published">().notNull().default("draft"),
    publishedAt: timestamp({ withTimezone: true }),
    seo: jsonb().$type<SeoFields>(),
    readingMinutes: integer(),
    ...timestamps,
  },
  (t) => [index().on(t.status, t.publishedAt)],
).enableRLS();

/**
 * Double opt-in (day 4): pending → confirm link → active. Rows from before day 4 stay `active`. The DB
 * default is still "active" (day-3 code paths and tests rely on it): the opt-in flows insert
 * `status: "pending"` explicitly.
 */
export type NewsletterStatus = "pending" | "active" | "unsubscribed";

export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: id(),
    email: text().notNull().unique(),
    locale: text().notNull().default("tr"),
    status: text().$type<NewsletterStatus>().notNull().default("active"),
    source: text(), // footer, checkout, popup, register, profile
    /** Explicit commercial e-message consent (İYS) and when it was given. */
    consentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    unsubscribeToken: text().notNull(),
    iysSynced: boolean().notNull().default(false),
    /** SHA-256 of the pending confirmation token (the token itself is only in the e-mail). */
    confirmTokenHash: text(),
    confirmedAt: timestamp({ withTimezone: true }),
    unsubscribedAt: timestamp({ withTimezone: true }),
    /** Where the consent was given (form / page), kept as proof of consent. */
    consentSource: text(),
    /** Hash of the client IP at consent time (proof without storing the IP). */
    consentIpHash: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("newsletter_subscribers_confirm_token_hash_unique").on(t.confirmTokenHash).where(sql`${t.confirmTokenHash} is not null`)],
).enableRLS();

export const emailCampaigns = pgTable("email_campaigns", {
  id: id(),
  subject: jsonb().$type<LocalizedText>().notNull(),
  body: jsonb().$type<LocalizedText>().notNull(),
  audience: text().$type<"all" | "retail" | "business">().notNull().default("all"),
  status: text().$type<"draft" | "scheduled" | "sending" | "sent">().notNull().default("draft"),
  scheduledAt: timestamp({ withTimezone: true }),
  sentAt: timestamp({ withTimezone: true }),
  stats: jsonb().$type<{ recipients?: number; sent?: number; failed?: number }>(),
  /** Panel user who created the campaign. */
  createdBy: text(),
  /** Each subscriber gets the campaign in their own locale (falls back to tr). */
  localeMode: text().$type<"per_subscriber">().notNull().default("per_subscriber"),
  ...timestamps,
}).enableRLS();

export const contactMessages = pgTable(
  "contact_messages",
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull(),
    phone: text(),
    /** Subject key from the contact form: general | quote | sample | other. */
    subject: text(),
    message: text().notNull(),
    /** Storefront language the message was sent from (reply in that language). */
    locale: text().notNull().default("tr"),
    isRead: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index().on(t.isRead, t.createdAt), index().on(t.createdAt)],
).enableRLS();

/** Versioned legal texts (KVKK, mesafeli satış, ön bilgilendirme, çerez, iade). */
export const legalDocuments = pgTable(
  "legal_documents",
  {
    id: id(),
    key: text().notNull(), // kvkk | distance_sales | pre_information | cookies | returns | membership
    version: text().notNull(),
    title: jsonb().$type<LocalizedText>().notNull(),
    body: jsonb().$type<LocalizedText>().notNull(),
    isCurrent: boolean().notNull().default(true),
    seo: jsonb().$type<SeoFields>(),
    ...timestamps,
  },
  (t) => [
    index().on(t.key, t.isCurrent),
    // Exactly one current version per key (publish: old isCurrent=false first, then insert the new one).
    uniqueIndex("legal_documents_one_current").on(t.key).where(sql`${t.isCurrent}`),
  ],
).enableRLS();
