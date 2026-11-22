// Day 4 infrastructure: the transactional e-mail outbox/log, durable rate-limit counters and the
// scheduled-job status table.
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";

export type EmailStatus = "queued" | "sending" | "sent" | "failed" | "cancelled";
export type EmailRelatedType =
  | "order"
  | "quote"
  | "sample"
  | "company"
  | "review"
  | "subscription"
  | "newsletter"
  | "campaign"
  | "contact"
  | "user"
  | "test";

/**
 * Transactional e-mail outbox and log (src/lib/email/**). Rows are rendered when they are queued, so the
 * log shows exactly what was sent. `last_error` is a short, secret-free reason (never a provider dump).
 */
export const emailMessages = pgTable(
  "email_messages",
  {
    id: id(),
    /** Template registry key, e.g. "order_paid". */
    template: text().notNull(),
    toEmail: text().notNull(),
    locale: text().notNull().default("tr"),
    subject: text().notNull(),
    html: text().notNull(),
    text: text().notNull(),
    /**
     * Extra message headers stored at enqueue time, e.g. List-Unsubscribe / List-Unsubscribe-Post for
     * marketing mails (their signed URL is per recipient). Never secrets.
     */
    headers: jsonb().$type<Record<string, string>>(),
    status: text().$type<EmailStatus>().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    lastError: text(),
    /** Not sent before this time (retry backoff, scheduled campaigns). */
    sendAfter: timestamp({ withTimezone: true }).notNull().defaultNow(),
    relatedType: text().$type<EmailRelatedType>(),
    /** Text so it can hold both integer ids (orders, quotes…) and Better Auth user ids. */
    relatedId: text(),
    /** e.g. "order:12:paid:customer". A second enqueue with the same key is a no-op. */
    dedupeKey: text(),
    /** User id of the panel user who caused the mail (test send, resend); null for the system. */
    createdBy: text(),
    sentAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index().on(t.status, t.sendAfter),
    index().on(t.relatedType, t.relatedId),
    index().on(t.createdAt),
    uniqueIndex("email_messages_dedupe_key_unique").on(t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  ],
).enableRLS();

/**
 * Durable rate-limit counters (src/lib/rate-limit-store.ts): one row per key and fixed window; the
 * store weighs the previous window in (sliding-window counter). Keys are stored hashed (no e-mail or
 * IP in the table). Rows past `expires_at` are deleted by the `ratelimits.prune` job.
 */
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    key: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index().on(t.expiresAt)],
).enableRLS();

export type JobRunStatus = "ok" | "error" | "skipped";

/** Last run of each scheduled job (src/lib/cron/run.ts). `last_result` holds counts only. */
export const jobRuns = pgTable("job_runs", {
  job: text().primaryKey(),
  lastStartedAt: timestamp({ withTimezone: true }),
  lastFinishedAt: timestamp({ withTimezone: true }),
  lastStatus: text().$type<JobRunStatus>(),
  lastResult: jsonb().$type<Record<string, number>>(),
  /** Error class / SQLSTATE only (never the message: it can carry query parameters). */
  lastError: text(),
  runCount: integer().notNull().default(0),
}).enableRLS();
